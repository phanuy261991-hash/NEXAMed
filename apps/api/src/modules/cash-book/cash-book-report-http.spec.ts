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
 * HTTP e2e cho "Sổ quỹ & Thu chi" Giai đoạn 2 (Sổ quỹ + Báo cáo dòng tiền + Chuyển quỹ + Thủ quỹ
 * riêng) — `.claude/plans/jiggly-meandering-leaf.md`. Cùng khuôn `cash-voucher-http.spec.ts`/
 * `cashier-shift-http.spec.ts`.
 */
describe('HTTP e2e — Sổ quỹ & Thu chi Giai đoạn 2', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let clinicAdminToken: string;
  let doctorUserId: string;
  let tenantBClinicAdminToken: string;
  let cashAccountId: string;
  let bankAccountId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-cash-book-report-${roleName}-${randomUUID()}`;
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

  /** "Tiếp nhận bệnh nhân" trực tiếp — đúng khuôn `billing-http.spec.ts` — trả `{id, encounterNo}`. */
  async function registerDirectAndPay(token: string, doctorId: string, amount: number) {
    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: 'Bệnh nhân e2e Sổ quỹ', dob: '1990-01-01', gender: 'female', phone: '0933555666', nationalId: randomNationalId() });
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

    const payRes = await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(token)).send({ method: 'CASH', version: 1 });
    expect(payRes.status).toBe(200);
    return encounterId as string;
  }

  async function createTransferVoucher(token: string, amount: number, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/cash-vouchers')
      .set(authed(token))
      .send({ cashAccountId, counterAccountId: bankAccountId, paymentMethodCode: 'CASH', amount, description: 'Nộp tiền mặt vào ngân hàng', ...overrides });
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

    fixture = await createTwoTenantFixture(privileged, 'CashBookReport e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorUserId = doctorA.userId;
    tenantBClinicAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    const accountsRes = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(receptionistToken));
    cashAccountId = accountsRes.body.data.items.find((a: { type: string }) => a.type === 'CASH').id;

    const bankRes = await request(app.getHttpServer())
      .post('/api/v1/cash-accounts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Tài khoản VCB', type: 'BANK', bankAccountNo: '0011223344', openingBalance: 0, openingBalanceAt: new Date().toISOString() });
    bankAccountId = bankRes.body.data.id as string;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('Chuyển quỹ (POST /cash-vouchers với counterAccountId)', () => {
    it('lễ tân (chỉ cash_voucher.create, KHÔNG có cash_account.manage) → 403', async () => {
      const res = await createTransferVoucher(receptionistToken, 100_000);
      expect(res.status).toBe(403);
    });

    it('clinic_admin lập phiếu chuyển quỹ hợp lệ → 200, direction ép EXPENSE, không có Loại thu chi, mã bắt đầu PCK', async () => {
      const res = await createTransferVoucher(clinicAdminToken, 500_000);
      expect(res.status).toBe(200);
      expect(res.body.data.direction).toBe('EXPENSE');
      expect(res.body.data.incomeExpenseTypeCode).toBeNull();
      expect(res.body.data.counterAccountId).toBe(bankAccountId);
      expect(res.body.data.cashAccountId).toBe(cashAccountId);
      expect(res.body.data.voucherNo).toMatch(/^PCK/);
      expect(res.body.data.isAutoGenerated).toBe(false);
      expect(res.body.data.status).toBe('POSTED'); // Chuyển quỹ KHÔNG qua duyệt dù bật cashVoucherApprovalEnabled.
    });

    it('quỹ đích trùng quỹ nguồn → 400', async () => {
      const res = await createTransferVoucher(clinicAdminToken, 100_000, { cashAccountId, counterAccountId: cashAccountId });
      expect(res.status).toBe(400);
    });

    it('quỹ đích không tồn tại → 404', async () => {
      const res = await createTransferVoucher(clinicAdminToken, 100_000, { counterAccountId: randomUUID() });
      expect(res.status).toBe(404);
    });

    it('gửi kèm incomeExpenseTypeCode cùng counterAccountId → 400 (2 hình dạng lẫn lộn)', async () => {
      const res = await createTransferVoucher(clinicAdminToken, 100_000, { incomeExpenseTypeCode: 'TC00001' });
      expect(res.status).toBe(400);
    });

    it('phiếu Chuyển quỹ KHÔNG tính vào totalIncomeAmount/totalExpenseAmount của GET /cash-vouchers', async () => {
      const before = await request(app.getHttpServer()).get('/api/v1/cash-vouchers').set(authed(clinicAdminToken));
      const beforeExpense = before.body.data.totalExpenseAmount as number;

      const transferRes = await createTransferVoucher(clinicAdminToken, 700_000);
      expect(transferRes.status).toBe(200);

      const after = await request(app.getHttpServer()).get('/api/v1/cash-vouchers').set(authed(clinicAdminToken));
      expect(after.body.data.totalExpenseAmount).toBe(beforeExpense); // không đổi — phiếu chuyển quỹ bị loại trừ.
    });
  });

  describe('Sổ quỹ (GET /cash-book/ledger)', () => {
    it('không có access token → 401', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/cash-book/ledger?cashAccountId=${cashAccountId}`);
      expect(res.status).toBe(401);
    });

    it('tenant B tra quỹ của tenant A → 404', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/cash-book/ledger?cashAccountId=${cashAccountId}`).set(authed(tenantBClinicAdminToken));
      expect(res.status).toBe(404);
    });

    it('số dư luỹ kế đúng qua chuỗi giao dịch trộn (thu tiền khám + phiếu thu/chi + chuyển quỹ)', async () => {
      // Quỹ mới tinh, không lẫn dữ liệu 2 describe trước — mở account riêng cho test này.
      const freshAccountRes = await request(app.getHttpServer())
        .post('/api/v1/cash-accounts')
        .set(authed(clinicAdminToken))
        .send({ name: 'Quỹ tiền mặt phụ', type: 'CASH', openingBalance: 1_000_000, openingBalanceAt: new Date().toISOString() });
      const freshAccountId = freshAccountRes.body.data.id as string;

      // +200.000 (Thu ngoài khám)
      const incomeRes = await request(app.getHttpServer())
        .post('/api/v1/cash-vouchers')
        .set(authed(clinicAdminToken))
        .send({ direction: 'INCOME', incomeExpenseTypeCode: 'TC00001', cashAccountId: freshAccountId, paymentMethodCode: 'CASH', amount: 200_000, description: 'Bán phế liệu' });
      expect(incomeRes.status).toBe(200);

      // -50.000 (Chi ngoài khám)
      const expenseRes = await request(app.getHttpServer())
        .post('/api/v1/cash-vouchers')
        .set(authed(clinicAdminToken))
        .send({ direction: 'EXPENSE', incomeExpenseTypeCode: 'TC00001', cashAccountId: freshAccountId, paymentMethodCode: 'CASH', amount: 50_000, description: 'Mua văn phòng phẩm' });
      expect(expenseRes.status).toBe(200);

      // -300.000 (Chuyển quỹ ra quỹ ngân hàng)
      const transferRes = await request(app.getHttpServer())
        .post('/api/v1/cash-vouchers')
        .set(authed(clinicAdminToken))
        .send({ cashAccountId: freshAccountId, counterAccountId: bankAccountId, paymentMethodCode: 'CASH', amount: 300_000, description: 'Nộp ngân hàng' });
      expect(transferRes.status).toBe(200);

      const ledger = await request(app.getHttpServer()).get(`/api/v1/cash-book/ledger?cashAccountId=${freshAccountId}`).set(authed(clinicAdminToken));
      expect(ledger.status).toBe(200);
      expect(ledger.body.data.openingBalance).toBe(1_000_000);
      expect(ledger.body.data.closingBalance).toBe(1_000_000 + 200_000 - 50_000 - 300_000);
      expect(ledger.body.data.entries).toHaveLength(3);
      const types = ledger.body.data.entries.map((e: { entryType: string }) => e.entryType);
      expect(types).toEqual(['VOUCHER_INCOME', 'VOUCHER_EXPENSE', 'TRANSFER_OUT']);
      // Số dư luỹ kế từng dòng đúng thứ tự.
      expect(ledger.body.data.entries[0].runningBalance).toBe(1_200_000);
      expect(ledger.body.data.entries[1].runningBalance).toBe(1_150_000);
      expect(ledger.body.data.entries[2].runningBalance).toBe(850_000);

      // Đứng từ góc quỹ ĐÍCH (bank) — phải thấy đúng 1 dòng TRANSFER_IN +300.000.
      const bankLedger = await request(app.getHttpServer()).get(`/api/v1/cash-book/ledger?cashAccountId=${bankAccountId}`).set(authed(clinicAdminToken));
      const bankTransferEntry = bankLedger.body.data.entries.find((e: { entryType: string; amountSigned: number }) => e.entryType === 'TRANSFER_IN' && e.amountSigned === 300_000);
      expect(bankTransferEntry).toBeDefined();
    });
  });

  describe('Báo cáo dòng tiền (GET /cash-book/cash-flow-report)', () => {
    const today = new Date().toISOString().slice(0, 10);

    it('lễ tân (không có cash_voucher.report) → 403', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/cash-book/cash-flow-report?from=${today}&to=${today}`).set(authed(receptionistToken));
      expect(res.status).toBe(403);
    });

    it('tenant B → 200 nhưng không lẫn dữ liệu tenant A', async () => {
      const encounterAmount = 250_000;
      await registerDirectAndPay(receptionistToken, doctorUserId, encounterAmount);

      const tenantARes = await request(app.getHttpServer()).get(`/api/v1/cash-book/cash-flow-report?from=${today}&to=${today}`).set(authed(clinicAdminToken));
      expect(tenantARes.status).toBe(200);
      const tenantBRes = await request(app.getHttpServer()).get(`/api/v1/cash-book/cash-flow-report?from=${today}&to=${today}`).set(authed(tenantBClinicAdminToken));
      expect(tenantBRes.status).toBe(200);
      expect(tenantBRes.body.data.totalIncome).toBe(0);
      expect(tenantARes.body.data.totalIncome).toBeGreaterThanOrEqual(encounterAmount);

      const invoiceBucket = tenantARes.body.data.byType.find((g: { key: string }) => g.key === 'INVOICE');
      expect(invoiceBucket.totalIncome).toBeGreaterThanOrEqual(encounterAmount);
    });

    it('Chuyển quỹ LOẠI TRỪ khỏi totalIncome/totalExpense/byType nhưng CÓ trong byAccount', async () => {
      const before = await request(app.getHttpServer()).get(`/api/v1/cash-book/cash-flow-report?from=${today}&to=${today}`).set(authed(clinicAdminToken));
      const beforeTotalExpense = before.body.data.totalExpense as number;

      const transferAmount = 123_000;
      const transferRes = await createTransferVoucher(clinicAdminToken, transferAmount);
      expect(transferRes.status).toBe(200);

      const after = await request(app.getHttpServer()).get(`/api/v1/cash-book/cash-flow-report?from=${today}&to=${today}`).set(authed(clinicAdminToken));
      expect(after.body.data.totalExpense).toBe(beforeTotalExpense); // không đổi ở mức tổng toàn phòng khám.

      const cashAccountBucket = after.body.data.byAccount.find((a: { key: string }) => a.key === cashAccountId);
      const bankAccountBucket = after.body.data.byAccount.find((a: { key: string }) => a.key === bankAccountId);
      expect(cashAccountBucket.totalExpense).toBeGreaterThanOrEqual(transferAmount); // quỹ nguồn: bị trừ.
      expect(bankAccountBucket.totalIncome).toBeGreaterThanOrEqual(transferAmount); // quỹ đích: được cộng.
    });

    it('Xuất Excel → 200, content-type .xlsx', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/cash-book/cash-flow-report/export?from=${today}&to=${today}`).set(authed(clinicAdminToken));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('.xlsx');
    });
  });

  describe('Thủ quỹ riêng (Đa thu ngân + Chuyển quỹ tự động lúc Chốt ca)', () => {
    let drawerCashierToken: string;
    let drawerCashierUserId: string;

    it('bật Đa thu ngân + Thủ quỹ riêng cùng lúc → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ cashierShiftMultiCashierEnabled: true, cashierDrawerSeparateEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body.data.cashierDrawerSeparateEnabled).toBe(true);

      const drawerCashier = await createUserWithRole(fixture.tenantA.id, 'receptionist');
      drawerCashierToken = drawerCashier.token;
      drawerCashierUserId = drawerCashier.userId;
    });

    it('mở ca → tự cấp két riêng (cash_account type=DRAWER, ownerUserId=chính actor)', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(drawerCashierToken)).send({ openingFloatActual: 0 });
      expect(res.status).toBe(200);
      const shiftId = res.body.data.id as string;

      const shiftRow = await privileged.cashierShift.findUniqueOrThrow({ where: { id: shiftId } });
      expect(shiftRow.drawerAccountId).not.toBeNull();

      const drawerAccount = await privileged.cashAccount.findUniqueOrThrow({ where: { id: shiftRow.drawerAccountId! } });
      expect(drawerAccount.type).toBe('DRAWER');
      expect(drawerAccount.ownerUserId).toBe(drawerCashierUserId);
      expect(drawerAccount.code).toMatch(/^QU/);

      // Mở lại ca (đóng rồi mở) phải tái dùng ĐÚNG két đã cấp, không tạo két thứ 2.
      await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/close`)
        .set(authed(drawerCashierToken))
        .send({ countedCashAmount: 0, keepForNextAmount: 0, version: 1 });
      const reopenRes = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(drawerCashierToken)).send({ openingFloatActual: 0 });
      const reopenShiftRow = await privileged.cashierShift.findUniqueOrThrow({ where: { id: reopenRes.body.data.id } });
      expect(reopenShiftRow.drawerAccountId).toBe(shiftRow.drawerAccountId);

      // Đóng lại để dọn cho case kế tiếp.
      await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${reopenRes.body.data.id}/close`)
        .set(authed(drawerCashierToken))
        .send({ countedCashAmount: 0, keepForNextAmount: 0, version: 1 });
    });

    it('thu tiền khám bằng tiền mặt → payment.cashAccountId đi vào ĐÚNG két riêng, KHÔNG vào quỹ CASH chung', async () => {
      const openRes = await request(app.getHttpServer()).post('/api/v1/cashier-shifts/open').set(authed(drawerCashierToken)).send({ openingFloatActual: 0 });
      const shiftId = openRes.body.data.id as string;
      const shiftRow = await privileged.cashierShift.findUniqueOrThrow({ where: { id: shiftId } });
      const drawerAccountId = shiftRow.drawerAccountId!;

      const encounterAmount = 180_000;
      const encounterId = await registerDirectAndPay(drawerCashierToken, doctorUserId, encounterAmount);

      const invoice = await privileged.invoice.findUniqueOrThrow({ where: { tenantId_encounterId: { tenantId: fixture.tenantA.id, encounterId } } });
      const paymentRow = await privileged.payment.findFirstOrThrow({ where: { invoiceId: invoice.id, type: 'PAYMENT' } });
      expect(paymentRow.cashAccountId).toBe(drawerAccountId);
      expect(paymentRow.cashAccountId).not.toBe(cashAccountId);

      // Chốt ca — đúng số tiền vừa thu, không giữ lại gì → tự sinh phiếu Chuyển quỹ gộp về Quỹ CASH mặc định.
      const closeRes = await request(app.getHttpServer())
        .post(`/api/v1/cashier-shifts/${shiftId}/close`)
        .set(authed(drawerCashierToken))
        .send({ countedCashAmount: encounterAmount, keepForNextAmount: 0, version: 1 });
      expect(closeRes.status).toBe(200);

      const autoVoucher = await privileged.cashVoucher.findFirstOrThrow({
        where: { tenantId: fixture.tenantA.id, cashAccountId: drawerAccountId, isAutoGenerated: true },
      });
      expect(autoVoucher.counterAccountId).toBe(cashAccountId);
      expect(Number(autoVoucher.amount)).toBe(encounterAmount);
      expect(autoVoucher.direction).toBe('EXPENSE');
      expect(autoVoucher.status).toBe('POSTED');
      expect(autoVoucher.incomeExpenseTypeCode).toBeNull();
      // CỐ Ý null — KHÔNG gắn vào chính ca vừa chốt, tránh "Tính toán lại" tự nạp lại phiếu này
      // và cộng dồn cashOutAmount mỗi lần tính lại (tự tham chiếu) — xem comment ở cashier-shift.service.ts.
      expect(autoVoucher.cashierShiftId).toBeNull();

      // "Tính toán lại" (resync-preview) không được đổi cashOutAmount so với lúc chốt (không tự
      // nạp lại phiếu vừa sinh) — endpoint này đòi `cashier_shift.manage` (chỉ clinic_admin).
      const resyncRes = await request(app.getHttpServer()).get(`/api/v1/cashier-shifts/${shiftId}/resync-preview`).set(authed(clinicAdminToken));
      expect(resyncRes.status).toBe(200);
      expect(resyncRes.body.data.expectedCashAmount).toBe(encounterAmount);
    });

    it('tắt Thủ quỹ riêng lại → PATCH bắt buộc gửi kèm hoặc trước khi tắt Đa thu ngân (không lỗi khi tắt cả 2)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ cashierDrawerSeparateEnabled: false, cashierShiftMultiCashierEnabled: false });
      expect(res.status).toBe(200);
      expect(res.body.data.cashierDrawerSeparateEnabled).toBe(false);
    });
  });
});
