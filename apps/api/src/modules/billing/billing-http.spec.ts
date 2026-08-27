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
 * HTTP e2e cho module `billing` (Thu ngân cơ bản, Sprint 5/6, BIL-01→04) — phiếu thu tự động tạo
 * lúc tiếp nhận (`POST /reception/check-in|direct`), đánh dấu đã thu/chưa thu, lưu tạm, in, tổng
 * kết cuối ngày. Cùng khuôn `reception-http.spec.ts`/`prescription-http.spec.ts`.
 */
describe('HTTP e2e — /api/v1/billing/invoices', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let doctorAUserId: string;
  let doctorAToken: string;
  let tenantBReceptionistToken: string;
  let clinicAdminToken: string;
  let tenantBClinicAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-billing-${roleName}-${randomUUID()}`;
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

  function isoAt(hour: number, minute: number, day = 25) {
    return new Date(Date.UTC(2026, 7, day, hour, minute, 0)).toISOString();
  }

  /** "Tiếp nhận bệnh nhân" trực tiếp (không qua lịch hẹn) — đơn giản hơn check-in cho test billing thuần. */
  async function registerDirect(token: string, doctorId: string, services: Record<string, unknown>[], checkedInAt = isoAt(8, 0)) {
    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: 'Bệnh nhân e2e billing', dob: '1990-01-01', gender: 'female', phone: '0933444555', nationalId: randomNationalId() });
    const patientId = patientRes.body.data.id as string;

    const res = await request(app.getHttpServer())
      .post('/api/v1/reception/direct')
      .set(authed(token))
      .send({ patientId, doctorId, checkedInAt, services, receptionTypeCode: 'RT_NEW', examFormCode: 'EF_NORMAL' });
    return res.body.data as { id: string; encounterNo: string };
  }

  function pricedServices() {
    return [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }];
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

    fixture = await createTwoTenantFixture(privileged, 'Billing e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    tenantBReceptionistToken = (await createUserWithRole(fixture.tenantB.id, 'receptionist')).token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    // Cách ly tenant cho refund() phải test bằng vai trò CÓ đúng permission `invoice.refund`
    // (clinic_admin) ở tenant B — receptionist tenant B không có quyền này nên sẽ 403 trước khi
    // kịp chạm tới bước tra `encounterId` (PermissionGuard chặn theo data_scope trước data thật).
    tenantBClinicAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
  });

  /** #085 — huỷ lượt khám qua endpoint `encounter` (cross-module), dùng chung trong test hoàn tiền. */
  async function cancelEncounter(encounterId: string, version: number, reason = 'Khách bỏ về') {
    return request(app.getHttpServer())
      .post(`/api/v1/encounters/${encounterId}/cancel`)
      .set(authed(receptionistToken))
      .send({ cancelReason: reason, version });
  }

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('Tự động tạo phiếu thu lúc tiếp nhận (BIL-01)', () => {
    it('dịch vụ có giá → tự sinh phiếu thu UNPAID, tổng đúng, GET thấy đủ dòng', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());

      const res = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounter.id}`).set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('UNPAID');
      expect(res.body.data.totalAmount).toBe(150_000);
      expect(res.body.data.invoiceNo).toMatch(/^PT/);
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0]).toMatchObject({ examTypeCode: 'KT', unitPrice: 150_000, quantity: 1, lineTotal: 150_000 });
      expect(res.body.data.paymentMethod).toBeNull();
      expect(res.body.data.printedAt).toBeNull();
    });

    it('nhiều dòng có giá → SUM đúng tổng (docs/DECISIONS.md #080)', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, [
        { examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 },
        { examTypeCode: 'SA', examTypeName: 'Siêu âm ổ bụng', examTypePrice: 300_000, quantity: 1 },
      ]);

      const res = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounter.id}`).set(authed(receptionistToken));
      expect(res.body.data.totalAmount).toBe(450_000);
      expect(res.body.data.lines).toHaveLength(2);
    });

    it('dịch vụ CHƯA cấu hình giá (không examTypePrice) → không tạo phiếu thu, GET trả null', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, [{ examTypeCode: 'XN', examTypeName: 'Xét nghiệm chưa có giá', quantity: 1 }]);

      const res = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounter.id}`).set(authed(receptionistToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('dòng có giá LẪN dòng chưa có giá → chỉ tính dòng có giá, bỏ qua dòng kia', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, [
        { examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 },
        { examTypeCode: 'XN', examTypeName: 'Xét nghiệm chưa có giá', quantity: 1 },
      ]);

      const res = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounter.id}`).set(authed(receptionistToken));
      expect(res.body.data.totalAmount).toBe(150_000);
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0].examTypeCode).toBe('KT');
    });
  });

  describe('POST /api/v1/billing/invoices/:encounterId/pay (BIL-03)', () => {
    it('thu tiền hợp lệ → 200, status PAID, phương thức lưu đúng', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/pay`)
        .set(authed(receptionistToken))
        .send({ method: 'CASH', version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PAID');
      expect(res.body.data.paymentMethod).toBe('CASH');
      expect(res.body.data.paidAt).not.toBeNull();
      expect(res.body.data.version).toBe(2);
    });

    it('thu tiền lần 2 (đã PAID) → 409 INVOICE_ALREADY_PAID', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/pay`)
        .set(authed(receptionistToken))
        .send({ method: 'CASH', version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVOICE_ALREADY_PAID');
    });

    it('version cũ (chưa đổi) → 409 CONCURRENT_MODIFICATION', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/pay`)
        .set(authed(receptionistToken))
        .send({ method: 'CASH', version: 99 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('lượt khám không có phiếu thu (chưa có dịch vụ có giá) → 404', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, [{ examTypeCode: 'XN', examTypeName: 'Chưa có giá', quantity: 1 }]);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/pay`)
        .set(authed(receptionistToken))
        .send({ method: 'CASH', version: 1 });
      expect(res.status).toBe(404);
    });

    it('bác sĩ (không có invoice.update) → 403 breakGlassAvailable', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/pay`)
        .set(authed(doctorAToken))
        .send({ method: 'CASH', version: 1 });
      expect(res.status).toBe(403);
      expect(res.body.error.details?.breakGlassAvailable ?? res.body.error.breakGlassAvailable).toBe(true);
    });

    it('tenant B thu tiền phiếu thu của tenant A → 404 (cách ly tenant)', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/pay`)
        .set(authed(tenantBReceptionistToken))
        .send({ method: 'CASH', version: 1 });
      expect(res.status).toBe(404);
    });

    it('#085 — phiếu đã CANCELLED (lượt khám huỷ khi chưa thu) → 409 INVOICE_CLOSED, không thu được nữa', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await cancelEncounter(encounter.id, 1);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/pay`)
        .set(authed(receptionistToken))
        .send({ method: 'CASH', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVOICE_CLOSED');
    });
  });

  describe('POST /api/v1/billing/invoices/:encounterId/revert-payment', () => {
    it('đánh dấu chưa thu hợp lệ → 200, status quay lại UNPAID', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/revert-payment`)
        .set(authed(receptionistToken))
        .send({ reason: 'Đánh dấu nhầm', version: 2 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('UNPAID');
      expect(res.body.data.paymentMethod).toBeNull();
    });

    it('chưa từng thu (còn UNPAID) → 409 INVOICE_NOT_PAID', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/revert-payment`)
        .set(authed(receptionistToken))
        .send({ reason: 'Nhầm', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVOICE_NOT_PAID');
    });

    it('thiếu lý do → 400', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/revert-payment`)
        .set(authed(receptionistToken))
        .send({ reason: '', version: 2 });
      expect(res.status).toBe(400);
    });

    it('#085 — phiếu đã REFUNDED (hoàn tiền xong) → 409 INVOICE_CLOSED, không "đánh dấu chưa thu" được nữa', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
      await cancelEncounter(encounter.id, 1);
      await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Hoàn tiền test', version: 2 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/revert-payment`)
        .set(authed(receptionistToken))
        .send({ reason: 'Nhầm', version: 3 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVOICE_CLOSED');
    });
  });

  describe('POST /api/v1/billing/invoices/:encounterId/refund (#085 — hoàn tiền cho lượt khám đã huỷ)', () => {
    it('đủ điều kiện (PAID + lượt khám đã huỷ), clinic_admin → 200, status REFUNDED, ghi lại refundedAt/refundReason', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
      const cancelRes = await cancelEncounter(encounter.id, 1);
      expect(cancelRes.status).toBe(200);

      // Trước khi hoàn — GET xác nhận needsRefund=true, encounterCancelled=true, vẫn PAID.
      const before = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounter.id}`).set(authed(clinicAdminToken));
      expect(before.body.data.status).toBe('PAID');
      expect(before.body.data.encounterCancelled).toBe(true);
      expect(before.body.data.needsRefund).toBe(true);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Khách bỏ về, hoàn lại tiền', version: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REFUNDED');
      expect(res.body.data.needsRefund).toBe(false);
      expect(res.body.data.refundedAt).not.toBeNull();
      expect(res.body.data.refundReason).toBe('Khách bỏ về, hoàn lại tiền');
      // Vết thu tiền gốc vẫn còn nguyên — chỉ thêm dòng REFUND đối ứng, không xoá dòng PAYMENT.
      expect(res.body.data.paymentMethod).toBe('CASH');
    });

    it('lễ tân (không có invoice.refund, chỉ có invoice.update) → 403', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
      await cancelEncounter(encounter.id, 1);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(receptionistToken))
        .send({ reason: 'Thử hoàn', version: 2 });
      expect(res.status).toBe(403);
    });

    it('lượt khám CHƯA huỷ (vẫn PAID bình thường) → 409 INVOICE_NOT_REFUNDABLE, chặn hoàn nhầm', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Không nên hoàn được', version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVOICE_NOT_REFUNDABLE');
    });

    it('phiếu CHƯA thu (huỷ khi UNPAID → tự CANCELLED) → 409 INVOICE_NOT_REFUNDABLE (không có gì để hoàn)', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await cancelEncounter(encounter.id, 1);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Không có gì để hoàn', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVOICE_NOT_REFUNDABLE');
    });

    it('hoàn 2 lần (đã REFUNDED) → 409 INVOICE_NOT_REFUNDABLE', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
      await cancelEncounter(encounter.id, 1);
      await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Lần 1', version: 2 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Lần 2', version: 3 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVOICE_NOT_REFUNDABLE');
    });

    it('version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
      await cancelEncounter(encounter.id, 1);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Sai version', version: 99 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('thiếu lý do → 400', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
      await cancelEncounter(encounter.id, 1);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(clinicAdminToken))
        .send({ reason: '', version: 2 });
      expect(res.status).toBe(400);
    });

    it('tenant B (clinic_admin, CÓ đúng quyền invoice.refund) hoàn tiền phiếu thu của tenant A → 404 (cách ly tenant, không phải 403)', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
      await cancelEncounter(encounter.id, 1);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/refund`)
        .set(authed(tenantBClinicAdminToken))
        .send({ reason: 'x', version: 2 });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/billing/invoices/:encounterId/save-draft ("Lưu tạm", F8)', () => {
    it('lưu tạm phương thức + tiền khách đưa → 200, không đổi status', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/save-draft`)
        .set(authed(receptionistToken))
        .send({ pendingPaymentMethod: 'CASH', pendingCashReceivedAmount: 200_000, version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('UNPAID');
      expect(res.body.data.pendingPaymentMethod).toBe('CASH');
      expect(res.body.data.pendingCashReceivedAmount).toBe(200_000);
    });

    it('thu tiền xong thì tự xoá draft đang lưu tạm', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());
      await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/save-draft`)
        .set(authed(receptionistToken))
        .send({ pendingPaymentMethod: 'CASH', pendingCashReceivedAmount: 200_000, version: 1 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounter.id}/pay`)
        .set(authed(receptionistToken))
        .send({ method: 'CASH', version: 2 });
      expect(res.status).toBe(200);
      expect(res.body.data.pendingPaymentMethod).toBeNull();
      expect(res.body.data.pendingCashReceivedAmount).toBeNull();
    });
  });

  describe('POST /api/v1/billing/invoices/:encounterId/print (BIL-02)', () => {
    it('in phiếu → 200, set printedAt; gọi lại lần 2 (idempotent) không đổi thời điểm in đầu', async () => {
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices());

      const first = await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/print`).set(authed(receptionistToken));
      expect(first.status).toBe(200);
      expect(first.body.data.printedAt).not.toBeNull();
      const firstPrintedAt = first.body.data.printedAt as string;

      const second = await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounter.id}/print`).set(authed(receptionistToken));
      expect(second.status).toBe(200);
      expect(second.body.data.printedAt).toBe(firstPrintedAt);
    });
  });

  describe('GET /api/v1/billing/invoices (Danh sách + tổng kết cuối ngày, BIL-04)', () => {
    it('trả đúng danh sách trong ngày + tổng đã thu/chưa thu', async () => {
      const day = isoAt(9, 0, 26);
      const paid = await registerDirect(receptionistToken, doctorAUserId, pricedServices(), day);
      const unpaid = await registerDirect(receptionistToken, doctorAUserId, [{ examTypeCode: 'SA', examTypeName: 'Siêu âm', examTypePrice: 300_000, quantity: 1 }], day);
      await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${paid.id}/pay`).set(authed(receptionistToken)).send({ method: 'BANK_TRANSFER', version: 1 });

      const res = await request(app.getHttpServer()).get('/api/v1/billing/invoices').set(authed(receptionistToken)).query({ date: '2026-08-26' });

      expect(res.status).toBe(200);
      const items = res.body.data.items as Array<{ encounterId: string; status: string; totalAmount: number }>;
      const paidItem = items.find((i) => i.encounterId === paid.id);
      const unpaidItem = items.find((i) => i.encounterId === unpaid.id);
      expect(paidItem).toMatchObject({ status: 'PAID', totalAmount: 150_000 });
      expect(unpaidItem).toMatchObject({ status: 'UNPAID', totalAmount: 300_000 });
      expect(res.body.data.paidCount).toBeGreaterThanOrEqual(1);
      expect(res.body.data.paidTotalAmount).toBeGreaterThanOrEqual(150_000);
      expect(res.body.data.unpaidCount).toBeGreaterThanOrEqual(1);
      expect(res.body.data.unpaidTotalAmount).toBeGreaterThanOrEqual(300_000);
    });

    it('tenant B không thấy phiếu thu của tenant A', async () => {
      const day = isoAt(10, 0, 27);
      const encounter = await registerDirect(receptionistToken, doctorAUserId, pricedServices(), day);

      const res = await request(app.getHttpServer()).get('/api/v1/billing/invoices').set(authed(tenantBReceptionistToken)).query({ date: '2026-08-27' });
      expect(res.status).toBe(200);
      const items = res.body.data.items as Array<{ encounterId: string }>;
      expect(items.find((i) => i.encounterId === encounter.id)).toBeUndefined();
    });
  });
});
