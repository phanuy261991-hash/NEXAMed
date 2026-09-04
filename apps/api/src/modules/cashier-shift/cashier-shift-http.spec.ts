import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e cho "Chốt ca" (đối soát tiền mặt/két, ngoài kế hoạch, mockup duyệt 2026-09-03,
 * `docs/CURRENT.md`) — v1 chỉ 1 két dùng chung toàn tenant, chỉ 1 ca `OPEN` tại một thời điểm.
 * Cùng khuôn `billing-http.spec.ts` (tạo lượt khám + thu tiền để có `payment` thật cho tổng kết)
 * và `work-shift-assignment-http.spec.ts` (RBAC theo `data_scope`).
 */
describe('HTTP e2e — /api/v1/cashier-shifts', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let cashierAToken: string;
  let cashierAUserId: string;
  let cashierA2Token: string;
  let clinicAdminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let tenantBReceptionistToken: string;
  let tenantBClinicAdminToken: string;
  /** Chia sẻ id 2 phiếu đã chốt (1 khớp/1 lệch) giữa các `describe` sau — dùng cho danh sách/duyệt/xử lý chênh lệch/sửa. */
  const cashierShiftIds: { matched?: string; discrepancy?: string } = {};

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-cashier-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  /** "Tiếp nhận bệnh nhân" trực tiếp + thu tiền ngay — sinh `payment` thật cho tổng kết ca (đúng khuôn `billing-http.spec.ts`). */
  async function chargeCash(token: string, doctorId: string, amount: number) {
    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: 'Bệnh nhân e2e chốt ca', dob: '1990-01-01', gender: 'female', phone: '0933555666', nationalId: randomNationalId() });
    const patientId = patientRes.body.data.id as string;

    const encounterRes = await request(app.getHttpServer())
      .post('/api/v1/reception/direct')
      .set(authed(token))
      .send({
        patientId,
        doctorId,
        checkedInAt: new Date().toISOString(),
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: amount, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = encounterRes.body.data.id as string;

    const payRes = await request(app.getHttpServer())
      .post(`/api/v1/billing/invoices/${encounterId}/pay`)
      .set(authed(token))
      .send({ method: 'CASH', version: 1 });
    expect(payRes.status).toBe(200);
    return encounterId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'CashierShift e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    const a = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    cashierAToken = a.token;
    cashierAUserId = a.userId;
    const a2 = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    cashierA2Token = a2.token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    tenantBReceptionistToken = (await createUserWithRole(fixture.tenantB.id, 'receptionist')).token;
    tenantBClinicAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current');
    expect(res.status).toBe(401);
  });

  it('bác sĩ (không có quyền cashier_shift) → 403 khi xem ca hiện tại / mở ca', async () => {
    const resCurrent = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(doctorToken));
    expect(resCurrent.status).toBe(403);

    const resOpen = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(doctorToken)).send({ openingFloatActual: 500_000 });
    expect(resOpen.status).toBe(403);
  });

  describe('Mở ca (chưa có ca trước)', () => {
    it('GET current → chưa có ca OPEN, chưa có ca CLOSED nào trước đó', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierAToken));
      expect(res.status).toBe(200);
      expect(res.body.data.openShift).toBeNull();
      expect(res.body.data.previousClosedShift).toBeNull();
    });

    it('mở ca lần đầu (không có vốn kỳ vọng) → 200, OPEN, openingFloatExpected=null, không cần lý do', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashier-shifts/open')
        .set(authed(cashierAToken))
        .send({ openingFloatActual: 500_000 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('OPEN');
      expect(res.body.data.openingFloatExpected).toBeNull();
      expect(res.body.data.openingFloatActual).toBe(500_000);
      expect(res.body.data.shiftNo).toMatch(/^PCC/);
      expect(res.body.data.cashierId).toBe(cashierAUserId);
    });

    it('GET current → thấy đúng ca vừa mở', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierAToken));
      expect(res.body.data.openShift).not.toBeNull();
      expect(res.body.data.openShift.status).toBe('OPEN');
    });

    it('mở ca thứ 2 khi đã có ca đang mở → 409 CASHIER_SHIFT_ALREADY_OPEN', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashier-shifts/open')
        .set(authed(cashierA2Token))
        .send({ openingFloatActual: 500_000 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASHIER_SHIFT_ALREADY_OPEN');
    });

    it('2 request mở ca gần như đồng thời sau khi ca cũ đã đóng → đúng 1 thành công, 1 thất bại 409', async () => {
      // Đóng ca đang mở trước (khớp đúng vốn đã đếm, không cần lý do) để dọn về trạng thái sạch.
      const current = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierAToken));
      const openId = current.body.data.openShift.id as string;
      const closeRes = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${openId}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 500_000, keepForNextAmount: 500_000, version: 1 });
      expect(closeRes.status).toBe(200);

      const [r1, r2] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierAToken)).send({ openingFloatActual: 500_000 }),
        request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierA2Token)).send({ openingFloatActual: 500_000 }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);

      // Dọn lại: đóng ca vừa thắng race để các test tiếp theo bắt đầu từ trạng thái "chưa có ca mở".
      const winnerToken = r1.status === 200 ? cashierAToken : cashierA2Token;
      const winnerId = (r1.status === 200 ? r1 : r2).body.data.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${winnerId}/close`)
        .set(authed(winnerToken))
        .send({ countedCashAmount: 500_000, keepForNextAmount: 500_000, version: 1 });
    });

    it('mở ca sau khi có ca trước đã đóng — vốn đầu ca lệch mà KHÔNG kèm lý do → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashier-shifts/open')
        .set(authed(cashierAToken))
        .send({ openingFloatActual: 400_000 }); // khác 500_000 (vốn để lại ca trước)
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CASHIER_SHIFT_DISCREPANCY_REASON_REQUIRED');
    });

    it('mở ca lệch vốn CÓ kèm lý do → 200, ghi đúng openingFloatExpected + lý do', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashier-shifts/open')
        .set(authed(cashierAToken))
        .send({ openingFloatActual: 400_000, openingDiscrepancyReason: 'Thiếu tiền lẻ đầu ca' });
      expect(res.status).toBe(200);
      expect(res.body.data.openingFloatExpected).toBe(500_000);
      expect(res.body.data.openingFloatActual).toBe(400_000);
      expect(res.body.data.openingDiscrepancyReason).toBe('Thiếu tiền lẻ đầu ca');

      // Dọn lại về đúng 500_000 để các test dưới đây tính "vốn để lại" nhất quán.
      await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${res.body.data.id}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 400_000, keepForNextAmount: 500_000, cashDiscrepancyReason: 'Bù từ ngăn khác', version: 1 });
    });
  });

  describe('Chốt ca — khớp/lệch, tổng kết hệ thống, race, quyền sở hữu', () => {
    it('mở ca, thu 150.000đ tiền mặt, GET summary → cashInAmount đúng, expectedCashAmount đúng', async () => {
      const open = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierAToken)).send({ openingFloatActual: 500_000 });
      expect(open.status).toBe(200);
      const shiftId = open.body.data.id as string;

      await chargeCash(cashierAToken, doctorUserId, 150_000);

      const summary = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${shiftId}/summary`).set(authed(cashierAToken));
      expect(summary.status).toBe(200);
      expect(summary.body.data.cashInAmount).toBe(150_000);
      expect(summary.body.data.cashInCount).toBe(1);
      expect(summary.body.data.cashOutAmount).toBe(0);
      expect(summary.body.data.expectedCashAmount).toBe(650_000);

      cashierShiftIds.matched = shiftId;
    });

    it('chốt ca KHỚP đúng số hệ thống → 200 CLOSED, không cần lý do chênh lệch', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 650_000, keepForNextAmount: 500_000, version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLOSED');
      expect(res.body.data.cashInAmount).toBe(150_000);
      expect(res.body.data.expectedCashAmount).toBe(650_000);
      expect(res.body.data.countedCashAmount).toBe(650_000);
      expect(res.body.data.cashDiscrepancyReason).toBeNull();
      expect(res.body.data.submittedAmount).toBe(150_000);
      expect(res.body.data.version).toBe(2);
    });

    it('chốt ca lại (đã CLOSED) → 409 CASHIER_SHIFT_NOT_OPEN', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 650_000, keepForNextAmount: 500_000, version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASHIER_SHIFT_NOT_OPEN');
    });

    it('mở ca mới, thu 200.000đ, chốt ca LỆCH không kèm lý do → 400, ca vẫn còn OPEN', async () => {
      const open = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierAToken)).send({ openingFloatActual: 500_000 });
      const shiftId = open.body.data.id as string;
      await chargeCash(cashierAToken, doctorUserId, 200_000);

      const badClose = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 690_000, keepForNextAmount: 500_000, version: 1 });
      expect(badClose.status).toBe(400);
      expect(badClose.body.error.code).toBe('CASHIER_SHIFT_DISCREPANCY_REASON_REQUIRED');

      const current = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierAToken));
      expect(current.body.data.openShift.id).toBe(shiftId);

      cashierShiftIds.discrepancy = shiftId;
    });

    it('version cũ khi chốt ca → 409 CONCURRENT_MODIFICATION, ca vẫn OPEN', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 700_000, keepForNextAmount: 500_000, version: 99 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('chốt ca LỆCH có kèm lý do → 200 CLOSED, lưu đúng lý do + số thiếu/dư', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 690_000, keepForNextAmount: 500_000, cashDiscrepancyReason: 'Thiếu do sai sót đếm tiền', version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLOSED');
      expect(res.body.data.expectedCashAmount).toBe(700_000);
      expect(res.body.data.countedCashAmount).toBe(690_000);
      expect(res.body.data.cashDiscrepancyReason).toBe('Thiếu do sai sót đếm tiền');
      expect(res.body.data.submittedAmount).toBe(190_000);
    });

    it('đóng ca KHÔNG PHẢI của mình (thu ngân khác, scope personal) → 404', async () => {
      const open = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierA2Token)).send({ openingFloatActual: 500_000 });
      const shiftId = open.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 500_000, keepForNextAmount: 500_000, version: 1 });
      expect(res.status).toBe(404);

      // Đóng đúng người để dọn về trạng thái sạch cho các test khác.
      const cleanup = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/close`)
        .set(authed(cashierA2Token))
        .send({ countedCashAmount: 500_000, keepForNextAmount: 500_000, version: 1 });
      expect(cleanup.status).toBe(200);
    });

    it('tenant B thao tác trên id của tenant A → 404 ở mọi endpoint chạm bản ghi', async () => {
      const getRes = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${cashierShiftIds.matched}`).set(authed(tenantBReceptionistToken));
      expect(getRes.status).toBe(404);

      const summaryRes = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/summary`).set(authed(tenantBReceptionistToken));
      expect(summaryRes.status).toBe(404);

      const closeRes = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/close`)
        .set(authed(tenantBReceptionistToken))
        .send({ countedCashAmount: 1, keepForNextAmount: 0, version: 1 });
      expect(closeRes.status).toBe(404);

      // 4 endpoint còn lại đòi quyền `manage` (global, chỉ clinic_admin) — dùng clinic_admin của tenant B để
      // qua được PermissionGuard rồi mới thấy đúng 404 do khác tenant (không lẫn với 403 thiếu quyền).
      const resyncRes = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/resync-preview`).set(authed(tenantBClinicAdminToken));
      expect(resyncRes.status).toBe(404);

      const editRes = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/edit`)
        .set(authed(tenantBClinicAdminToken))
        .send({ reason: 'Thử sửa xuyên tenant', version: 2 });
      expect(editRes.status).toBe(404);

      const approveRes = await request(app.getHttpServer()).post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/approve`).set(authed(tenantBClinicAdminToken)).send({ version: 2 });
      expect(approveRes.status).toBe(404);

      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/resolve-discrepancy`)
        .set(authed(tenantBClinicAdminToken))
        .send({ method: 'WAIVE', version: 2 });
      expect(resolveRes.status).toBe(404);
    });

  });

  describe('Danh sách phiếu chốt ca (Quản lý)', () => {
    it('receptionist (scope personal) gọi danh sách → 403 (đây là màn Quản lý, không phải "ca của tôi")', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cashier-shifts').set(authed(cashierAToken));
      expect(res.status).toBe(403);
    });

    it('clinic_admin (scope global) → thấy đủ 2 phiếu đã chốt, không thấy ca đang OPEN', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cashier-shifts').set(authed(clinicAdminToken));
      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(cashierShiftIds.matched);
      expect(ids).toContain(cashierShiftIds.discrepancy);
    });

    it('filter status=bad → chỉ phiếu có chênh lệch', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cashier-shifts').query({ status: 'bad' }).set(authed(clinicAdminToken));
      const ids = res.body.data.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(cashierShiftIds.discrepancy);
      expect(ids).not.toContain(cashierShiftIds.matched);
    });

    it('filter status=ok → chỉ phiếu khớp, không có chênh lệch', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cashier-shifts').query({ status: 'ok' }).set(authed(clinicAdminToken));
      const ids = res.body.data.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(cashierShiftIds.matched);
      expect(ids).not.toContain(cashierShiftIds.discrepancy);
    });

    it('tenant B (clinic_admin) → không thấy phiếu nào của tenant A', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cashier-shifts').set(authed(tenantBClinicAdminToken));
      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((i: { id: string }) => i.id);
      expect(ids).not.toContain(cashierShiftIds.matched);
      expect(ids).not.toContain(cashierShiftIds.discrepancy);
    });
  });

  describe('Xử lý chênh lệch (Quản lý)', () => {
    it('receptionist (không có manage) → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/resolve-discrepancy`)
        .set(authed(cashierAToken))
        .send({ method: 'DEDUCT', version: 2 });
      expect(res.status).toBe(403);
    });

    it('ca còn đang OPEN → 409 CASHIER_SHIFT_NOT_CLOSED', async () => {
      const open = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierAToken)).send({ openingFloatActual: 500_000 });
      const shiftId = open.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/resolve-discrepancy`)
        .set(authed(clinicAdminToken))
        .send({ method: 'WAIVE', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASHIER_SHIFT_NOT_CLOSED');

      await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 500_000, keepForNextAmount: 500_000, version: 1 });
    });

    it('clinic_admin xử lý chênh lệch → 200, lưu đúng phương án + người xử lý', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/resolve-discrepancy`)
        .set(authed(clinicAdminToken))
        .send({ method: 'DEDUCT', note: 'Trừ vào lương thu ngân', version: 2 });
      expect(res.status).toBe(200);
      expect(res.body.data.resolutionMethod).toBe('DEDUCT');
      expect(res.body.data.resolutionNote).toBe('Trừ vào lương thu ngân');
      expect(res.body.data.resolvedByName).toBeTruthy();
      expect(res.body.data.resolvedAt).not.toBeNull();
      expect(res.body.data.version).toBe(3);
    });
  });

  describe('Duyệt phiếu (Quản lý)', () => {
    it('receptionist (không có manage) → 403', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/approve`).set(authed(cashierAToken)).send({ version: 2 });
      expect(res.status).toBe(403);
    });

    it('clinic_admin duyệt phiếu CLOSED → 200, status APPROVED', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/approve`).set(authed(clinicAdminToken)).send({ version: 2 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');
      expect(res.body.data.approvedByName).toBeTruthy();
      expect(res.body.data.approvedAt).not.toBeNull();
    });

    it('duyệt lại phiếu đã APPROVED → 409 CASHIER_SHIFT_NOT_CLOSED', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/cashier-shifts/${cashierShiftIds.matched}/approve`).set(authed(clinicAdminToken)).send({ version: 3 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASHIER_SHIFT_NOT_CLOSED');
    });
  });

  describe('"Mở khoá để sửa" (Quản lý) — sửa sau khi chốt, audit before/after', () => {
    it('receptionist (không có manage) → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/edit`)
        .set(authed(cashierAToken))
        .send({ reason: 'Thử sửa', version: 3 });
      expect(res.status).toBe(403);
    });

    it('thiếu lý do sửa → 400 (Zod validation)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/edit`)
        .set(authed(clinicAdminToken))
        .send({ reason: '', version: 3 });
      expect(res.status).toBe(400);
    });

    it('ca còn đang OPEN → 409 CASHIER_SHIFT_NOT_CLOSED', async () => {
      const open = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierAToken)).send({ openingFloatActual: 500_000 });
      const shiftId = open.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/edit`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Thử sửa ca chưa chốt', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASHIER_SHIFT_NOT_CLOSED');

      await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 500_000, keepForNextAmount: 500_000, version: 1 });
    });

    it('sửa số đếm tay (countedCashAmount/keepForNextAmount/handoverNote) → 200, tính lại submittedAmount, đánh dấu editedAt', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/edit`)
        .set(authed(clinicAdminToken))
        .send({
          reason: 'Đếm lại phát hiện đúng, không thiếu như báo cáo ban đầu',
          version: 3,
          countedCashAmount: 700_000,
          keepForNextAmount: 500_000,
          cashDiscrepancyReason: 'Đếm lại đủ, lỗi ghi chép ban đầu',
          handoverNote: 'Đã bàn giao đủ cho ca sau',
        });
      expect(res.status).toBe(200);
      expect(res.body.data.countedCashAmount).toBe(700_000);
      expect(res.body.data.submittedAmount).toBe(200_000);
      expect(res.body.data.handoverNote).toBe('Đã bàn giao đủ cho ca sau');
      expect(res.body.data.cashDiscrepancyReason).toBe('Đếm lại đủ, lỗi ghi chép ban đầu');
      expect(res.body.data.editedByName).toBeTruthy();
      expect(res.body.data.editedAt).not.toBeNull();
      expect(res.body.data.version).toBe(4);
    });

    it('GET chi tiết sau khi sửa → phản ánh đúng giá trị mới + badge "đã chỉnh sửa"', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}`).set(authed(clinicAdminToken));
      expect(res.body.data.countedCashAmount).toBe(700_000);
      expect(res.body.data.handoverNote).toBe('Đã bàn giao đủ cho ca sau');
      expect(res.body.data.editedAt).not.toBeNull();
      expect(res.body.data.editedByName).toBeTruthy();
    });

    it('audit_log ghi đúng before/after cho cashier_shift.edited', async () => {
      const log = await privileged.auditLog.findFirst({
        where: { entityType: 'cashier_shift', entityId: cashierShiftIds.discrepancy, action: 'cashier_shift.edited' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(log).not.toBeNull();
      const before = log!.beforeJson as Record<string, unknown>;
      const after = log!.afterJson as Record<string, unknown>;
      expect(before.countedCashAmount).toBe(690_000);
      expect(after.countedCashAmount).toBe(700_000);
      expect(before.reason).toBe('Đếm lại phát hiện đúng, không thiếu như báo cáo ban đầu');
    });

    it('GET resync-preview (Quản lý, đọc-only) → tính lại đúng số hệ thống, KHÔNG lưu', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/resync-preview`).set(authed(clinicAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.cashInAmount).toBe(200_000);
      expect(res.body.data.expectedCashAmount).toBe(700_000);

      // Xác nhận resync-preview không ghi gì xuống DB — version không đổi.
      const detail = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}`).set(authed(clinicAdminToken));
      expect(detail.body.data.version).toBe(4);
    });

    it('sửa kèm resyncSystemTotals=true → ghi đè lại đúng số hệ thống hiện tại', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/edit`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Tính toán lại số hệ thống cho chắc chắn', version: 4, resyncSystemTotals: true });
      expect(res.status).toBe(200);
      expect(res.body.data.cashInAmount).toBe(200_000);
      expect(res.body.data.expectedCashAmount).toBe(700_000);
      expect(res.body.data.version).toBe(5);
    });

    it('version cũ khi sửa → 409 CONCURRENT_MODIFICATION', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftIds.discrepancy}/edit`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Thử version cũ', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });
  });

  describe('"Đa thu ngân" (2026-09-04) — mỗi thu ngân mở ca RIÊNG, chạy song song', () => {
    let cashierBToken: string;
    let cashierBUserId: string;

    beforeAll(async () => {
      const b = await createUserWithRole(fixture.tenantA.id, 'receptionist');
      cashierBToken = b.token;
      cashierBUserId = b.userId;
      const patch = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ cashierShiftMultiCashierEnabled: true });
      expect(patch.status).toBe(200);
      expect(patch.body.data.cashierShiftMultiCashierEnabled).toBe(true);
    });

    afterAll(async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ cashierShiftMultiCashierEnabled: false });
      expect(res.status).toBe(200);
      expect(res.body.data.cashierShiftMultiCashierEnabled).toBe(false);
    });

    it('2 thu ngân khác nhau mở ca gần như đồng thời → CẢ HAI đều thành công (khác chế độ mặc định)', async () => {
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/cashier-shifts/open')
          .set(authed(cashierAToken))
          .send({ openingFloatActual: 300_000, openingDiscrepancyReason: 'Mở ca đa thu ngân' }),
        request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierBToken)).send({ openingFloatActual: 200_000 }),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r1.body.data.cashierId).toBe(cashierAUserId);
      expect(r2.body.data.cashierId).toBe(cashierBUserId);
    });

    it('GET current của mỗi người → chỉ thấy đúng ca CỦA CHÍNH MÌNH, không lẫn của người kia', async () => {
      const curA = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierAToken));
      expect(curA.body.data.openShift.cashierId).toBe(cashierAUserId);

      const curB = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierBToken));
      expect(curB.body.data.openShift.cashierId).toBe(cashierBUserId);
      expect(curB.body.data.openShift.id).not.toBe(curA.body.data.openShift.id);
    });

    it('chính người đó mở ca lần 2 khi đang có ca của mình → vẫn 409 (chỉ nới cho NGƯỜI KHÁC, không nới cho chính mình)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashier-shifts/open')
        .set(authed(cashierAToken))
        .send({ openingFloatActual: 100_000, openingDiscrepancyReason: 'Thử mở lần 2' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASHIER_SHIFT_ALREADY_OPEN');
    });

    it('mỗi người thu tiền → phiếu tự gắn đúng vào ca CỦA NGƯỜI ĐÓ, tổng kết ca không lẫn nhau dù cùng khung giờ', async () => {
      await chargeCash(cashierAToken, doctorUserId, 111_000);
      await chargeCash(cashierBToken, doctorUserId, 222_000);

      const curA = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierAToken));
      const summaryA = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${curA.body.data.openShift.id}/summary`).set(authed(cashierAToken));
      expect(summaryA.body.data.cashInAmount).toBe(111_000);
      expect(summaryA.body.data.cashInCount).toBe(1);

      const curB = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierBToken));
      const summaryB = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${curB.body.data.openShift.id}/summary`).set(authed(cashierBToken));
      expect(summaryB.body.data.cashInAmount).toBe(222_000);
      expect(summaryB.body.data.cashInCount).toBe(1);
    });

    it('chốt ca của A → chỉ đúng số của A (111.000đ), B vẫn còn ca mở riêng không bị ảnh hưởng', async () => {
      const curA = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierAToken));
      const shiftA = curA.body.data.openShift;
      const closeRes = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftA.id}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: shiftA.openingFloatActual + 111_000, keepForNextAmount: shiftA.openingFloatActual, version: shiftA.version });
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.data.cashInAmount).toBe(111_000);
      expect(closeRes.body.data.expectedCashAmount).toBe(shiftA.openingFloatActual + 111_000);

      const curB = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierBToken));
      expect(curB.body.data.openShift).not.toBeNull();
      expect(curB.body.data.openShift.cashierId).toBe(cashierBUserId);
    });

    it('mở lại được cho A (ca cũ đã đóng) trong khi B vẫn đang mở — xác nhận DB cho phép nhiều ca cùng lúc, không rơi về chỉ 1', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashier-shifts/open')
        .set(authed(cashierAToken))
        .send({ openingFloatActual: 300_000, openingDiscrepancyReason: 'Mở lại sau khi B vẫn đang mở' });
      expect(res.status).toBe(200);

      // Dọn lại: đóng ca A vừa mở + ca B còn treo, đưa cả 2 về "chưa có ca mở" cho test khác.
      const closeA = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${res.body.data.id}/close`)
        .set(authed(cashierAToken))
        .send({ countedCashAmount: 300_000, keepForNextAmount: 300_000, version: res.body.data.version });
      expect(closeA.status).toBe(200);

      const curB = await request(app.getHttpServer()).get('/api/v1/cashier-shifts/current').set(authed(cashierBToken));
      const shiftB = curB.body.data.openShift;
      const closeB = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftB.id}/close`)
        .set(authed(cashierBToken))
        .send({ countedCashAmount: shiftB.openingFloatActual + 222_000, keepForNextAmount: shiftB.openingFloatActual, version: shiftB.version });
      expect(closeB.status).toBe(200);
      expect(closeB.body.data.cashInAmount).toBe(222_000);
    });
  });
});
