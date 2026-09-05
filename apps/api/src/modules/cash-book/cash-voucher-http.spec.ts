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
 * HTTP e2e cho "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — Phiếu thu/chi (`cash_voucher`). Cùng
 * khuôn `cashier-shift-http.spec.ts` (fixture 2 tenant, `chargeCash`-style helper) — ở đây phiếu
 * thu/chi gắn ca thay vì thu tiền khám, nhưng cùng đi vào `computeCashierShiftTotals()`.
 *
 * `paymentMethodCode: 'CASH'` resolve `countsAsCash=true` nhờ migration
 * `20260827121000_seed_payment_method_catalog` (seed thẳng bằng SQL, chạy cùng `prisma migrate
 * deploy` ở `global-setup.ts` — không cần `db:seed` riêng cho test).
 */
describe('HTTP e2e — /api/v1/cash-vouchers', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let cashierToken: string;
  let cashier2Token: string;
  let clinicAdminToken: string;
  let doctorToken: string;
  let tenantBClinicAdminToken: string;
  let cashAccountId: string;
  let cashierShiftId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-cash-voucher-${roleName}-${randomUUID()}`;
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

  async function createVoucher(token: string, direction: 'INCOME' | 'EXPENSE', amount: number, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/cash-vouchers')
      .set(authed(token))
      .send({
        direction,
        incomeExpenseTypeCode: 'TC00001',
        cashAccountId,
        paymentMethodCode: 'CASH',
        amount,
        description: direction === 'INCOME' ? 'Bán phế liệu' : 'Tiền điện tháng 8/2026',
        ...overrides,
      });
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

    fixture = await createTwoTenantFixture(privileged, 'CashVoucher e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    cashierToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    cashier2Token = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    doctorToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBClinicAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    const accountsRes = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(cashierToken));
    cashAccountId = accountsRes.body.data.items.find((a: { type: string }) => a.type === 'CASH').id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/cash-vouchers');
    expect(res.status).toBe(401);
  });

  it('bác sĩ (không có quyền cash_voucher) → 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/cash-vouchers').set(authed(doctorToken));
    expect(res.status).toBe(403);
  });

  it('tạo phiếu tham chiếu quỹ không tồn tại → 404', async () => {
    const res = await createVoucher(cashierToken, 'INCOME', 100_000, { cashAccountId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('mở ca thu ngân — điều kiện tiên quyết để phiếu gắn đúng cashierShiftId', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(cashierToken)).send({ openingFloatActual: 1_000_000 });
    expect(res.status).toBe(200);
    cashierShiftId = res.body.data.id as string;
  });

  let incomeVoucherId: string;

  it('tạo phiếu THU tiền mặt 500.000đ → 200 POSTED, mã bắt đầu PTQ, gắn đúng ca đang mở', async () => {
    const res = await createVoucher(cashierToken, 'INCOME', 500_000);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('POSTED');
    expect(res.body.data.voucherNo).toMatch(/^PTQ/);
    expect(res.body.data.voided).toBe(false);
    expect(res.body.data.createdByName).toBeTruthy();
    incomeVoucherId = res.body.data.id;

    const listRes = await request(app.getHttpServer()).get(`/api/v1/cash-vouchers?cashierShiftId=${cashierShiftId}`).set(authed(cashierToken));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items.some((v: { id: string }) => v.id === incomeVoucherId)).toBe(true);
  });

  let expenseVoucherId: string;

  it('tạo phiếu CHI tiền mặt 200.000đ (chưa bật duyệt) → 200 POSTED ngay, mã bắt đầu PCQ', async () => {
    const res = await createVoucher(cashierToken, 'EXPENSE', 200_000);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('POSTED');
    expect(res.body.data.voucherNo).toMatch(/^PCQ/);
    expenseVoucherId = res.body.data.id;
  });

  it('GET summary ca hiện tại → otherCashInAmount/otherCashOutAmount + expectedCashAmount cộng đúng cả 2 phiếu vừa lập', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${cashierShiftId}/summary`).set(authed(cashierToken));
    expect(res.status).toBe(200);
    expect(res.body.data.cashInAmount).toBe(500_000);
    expect(res.body.data.cashOutAmount).toBe(200_000);
    expect(res.body.data.otherCashInAmount).toBe(500_000);
    expect(res.body.data.otherCashOutAmount).toBe(200_000);
    expect(res.body.data.expectedCashAmount).toBe(1_000_000 + 500_000 - 200_000);
  });

  it('GET list lọc theo direction → tổng kết totalIncomeAmount/totalExpenseAmount đúng', async () => {
    const income = await request(app.getHttpServer()).get('/api/v1/cash-vouchers?direction=INCOME').set(authed(cashierToken));
    expect(income.body.data.totalIncomeAmount).toBe(500_000);
    expect(income.body.data.totalExpenseAmount).toBe(0);

    const expense = await request(app.getHttpServer()).get('/api/v1/cash-vouchers?direction=EXPENSE').set(authed(cashierToken));
    expect(expense.body.data.totalExpenseAmount).toBe(200_000);
  });

  it('GET chi tiết phiếu THU vừa tạo → đúng dữ liệu', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/cash-vouchers/${incomeVoucherId}`).set(authed(cashierToken));
    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(500_000);
    expect(res.body.data.direction).toBe('INCOME');
  });

  describe('Phạm vi personal (receptionist chỉ sửa/huỷ được phiếu do chính mình lập)', () => {
    it('thu ngân KHÁC (không lập phiếu này) sửa → 404', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/cash-vouchers/${incomeVoucherId}`)
        .set(authed(cashier2Token))
        .send({ description: 'Sửa trộm', version: 1 });
      expect(res.status).toBe(404);
    });

    it('thu ngân KHÁC huỷ → 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${incomeVoucherId}/void`)
        .set(authed(cashier2Token))
        .send({ reason: 'Huỷ trộm', version: 1 });
      expect(res.status).toBe(404);
    });

    it('clinic_admin (global) sửa được phiếu do thu ngân khác lập → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/cash-vouchers/${incomeVoucherId}`)
        .set(authed(clinicAdminToken))
        .send({ description: 'Bán phế liệu (đã kiểm)', version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe('Bán phế liệu (đã kiểm)');
      expect(res.body.data.version).toBe(2);
    });
  });

  describe('Công tắc "Phiếu chi phải được duyệt"', () => {
    it('bật cashVoucherApprovalEnabled → 200', async () => {
      const res = await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body.data.cashVoucherApprovalEnabled).toBe(true);
    });

    let pendingExpenseId: string;

    it('tạo phiếu CHI mới → PENDING_APPROVAL (không tính vào tổng kết ngay)', async () => {
      const res = await createVoucher(cashierToken, 'EXPENSE', 100_000);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING_APPROVAL');
      pendingExpenseId = res.body.data.id;

      const list = await request(app.getHttpServer()).get('/api/v1/cash-vouchers?status=PENDING_APPROVAL').set(authed(cashierToken));
      expect(list.body.data.pendingApprovalCount).toBeGreaterThanOrEqual(1);
      expect(list.body.data.items.some((v: { id: string }) => v.id === pendingExpenseId)).toBe(true);
    });

    it('phiếu THU vẫn không cần duyệt dù công tắc đang bật → POSTED ngay', async () => {
      const res = await createVoucher(cashierToken, 'INCOME', 80_000);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('POSTED');
    });

    it('receptionist không có cash_voucher.approve → duyệt bị 403', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/cash-vouchers/${pendingExpenseId}/approve`).set(authed(cashierToken)).send({ version: 1 });
      expect(res.status).toBe(403);
    });

    it('clinic_admin duyệt phiếu chờ duyệt → 200 POSTED, ghi người duyệt', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/cash-vouchers/${pendingExpenseId}/approve`).set(authed(clinicAdminToken)).send({ version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('POSTED');
      expect(res.body.data.approvedByName).toBeTruthy();
      expect(res.body.data.approvedAt).toBeTruthy();
    });

    it('duyệt lại phiếu đã duyệt xong → 409 CASH_VOUCHER_NOT_PENDING_APPROVAL', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/cash-vouchers/${pendingExpenseId}/approve`).set(authed(clinicAdminToken)).send({ version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASH_VOUCHER_NOT_PENDING_APPROVAL');
    });

    let rejectedVoucherId: string;

    it('tạo phiếu CHI mới rồi Từ chối → REJECTED, ghi lý do', async () => {
      const created = await createVoucher(cashierToken, 'EXPENSE', 50_000);
      rejectedVoucherId = created.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${rejectedVoucherId}/reject`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Sai loại thu chi', version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.rejectionReason).toBe('Sai loại thu chi');
    });

    it('từ chối lại phiếu đã REJECTED → 409 CASH_VOUCHER_NOT_PENDING_APPROVAL', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${rejectedVoucherId}/reject`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'x', version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASH_VOUCHER_NOT_PENDING_APPROVAL');
    });

    it('sửa phiếu đã REJECTED → 409 CASH_VOUCHER_NOT_EDITABLE (chỉ đọc, lập phiếu mới thay vì hồi sinh)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/cash-vouchers/${rejectedVoucherId}`)
        .set(authed(clinicAdminToken))
        .send({ description: 'x', version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASH_VOUCHER_NOT_EDITABLE');
    });

    it('huỷ phiếu đã REJECTED → 409 CASH_VOUCHER_NOT_EDITABLE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${rejectedVoucherId}/void`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'x', version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASH_VOUCHER_NOT_EDITABLE');
    });
  });

  describe('Huỷ phiếu (soft-delete) và in phiếu', () => {
    it('huỷ phiếu THU đang POSTED → 200, voided=true', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${incomeVoucherId}/void`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Lập nhầm', version: 2 });
      expect(res.status).toBe(200);
      expect(res.body.data.voided).toBe(true);
    });

    it('GET chi tiết phiếu đã huỷ → vẫn xem được, voided=true (không "biến mất")', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/cash-vouchers/${incomeVoucherId}`).set(authed(clinicAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.voided).toBe(true);
    });

    it('sửa phiếu đã huỷ → 404 (không còn ở đường EDIT)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/cash-vouchers/${incomeVoucherId}`)
        .set(authed(clinicAdminToken))
        .send({ description: 'x', version: 3 });
      expect(res.status).toBe(404);
    });

    it('huỷ lại phiếu đã huỷ → 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${incomeVoucherId}/void`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'x', version: 3 });
      expect(res.status).toBe(404);
    });

    it('in phiếu CHI → 200, ghi printedAt; gọi lại lần 2 vẫn 200 (idempotent)', async () => {
      const first = await request(app.getHttpServer()).post(`/api/v1/cash-vouchers/${expenseVoucherId}/print`).set(authed(cashierToken)).send({});
      expect(first.status).toBe(200);
      expect(first.body.data.printedAt).toBeTruthy();

      const second = await request(app.getHttpServer()).post(`/api/v1/cash-vouchers/${expenseVoucherId}/print`).set(authed(cashierToken)).send({});
      expect(second.status).toBe(200);
      expect(second.body.data.printedAt).toBe(first.body.data.printedAt);
    });
  });

  describe('Chốt ca — phiếu gắn ca đã chốt tự khoá sửa/huỷ', () => {
    it('chốt ca hiện tại (khớp đúng số hệ thống)', async () => {
      const summary = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${cashierShiftId}/summary`).set(authed(cashierToken));
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${cashierShiftId}/close`)
        .set(authed(cashierToken))
        .send({ countedCashAmount: summary.body.data.expectedCashAmount, keepForNextAmount: summary.body.data.expectedCashAmount, version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLOSED');
    });

    it('sửa phiếu CHI (vẫn POSTED, chưa từng huỷ) gắn ca vừa chốt → 409 CASH_VOUCHER_NOT_EDITABLE', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/cash-vouchers/${expenseVoucherId}`)
        .set(authed(clinicAdminToken))
        .send({ description: 'Sửa sau khi chốt ca', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASH_VOUCHER_NOT_EDITABLE');
    });

    it('huỷ phiếu CHI gắn ca vừa chốt → 409 CASH_VOUCHER_NOT_EDITABLE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${expenseVoucherId}/void`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'x', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CASH_VOUCHER_NOT_EDITABLE');
    });
  });

  describe('Cách ly tenant', () => {
    it('GET /cash-vouchers bằng token tenant B → không thấy phiếu nào của tenant A', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cash-vouchers').set(authed(tenantBClinicAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });

    it('GET chi tiết phiếu của tenant A bằng token tenant B → 404 (không phải 403)', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/cash-vouchers/${expenseVoucherId}`).set(authed(tenantBClinicAdminToken));
      expect(res.status).toBe(404);
    });

    it('tenant B thao tác trên id phiếu của tenant A → 404 ở mọi endpoint chạm bản ghi (sửa/huỷ/duyệt/từ chối/in)', async () => {
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/cash-vouchers/${expenseVoucherId}`)
        .set(authed(tenantBClinicAdminToken))
        .send({ description: 'Sửa xuyên tenant', version: 1 });
      expect(patchRes.status).toBe(404);

      const voidRes = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${expenseVoucherId}/void`)
        .set(authed(tenantBClinicAdminToken))
        .send({ reason: 'Huỷ xuyên tenant', version: 1 });
      expect(voidRes.status).toBe(404);

      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${expenseVoucherId}/approve`)
        .set(authed(tenantBClinicAdminToken))
        .send({ version: 1 });
      expect(approveRes.status).toBe(404);

      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${expenseVoucherId}/reject`)
        .set(authed(tenantBClinicAdminToken))
        .send({ reason: 'Từ chối xuyên tenant', version: 1 });
      expect(rejectRes.status).toBe(404);

      const printRes = await request(app.getHttpServer()).post(`/api/v1/cash-vouchers/${expenseVoucherId}/print`).set(authed(tenantBClinicAdminToken)).send({});
      expect(printRes.status).toBe(404);
    });

    it('GET /cash-accounts bằng token tenant B → không thấy quỹ của tenant A', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(tenantBClinicAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.items.every((a: { id: string }) => a.id !== cashAccountId)).toBe(true);
    });
  });
});
