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
 * HTTP e2e — "Công nợ nhà cung cấp" Phần A "Nền sổ công nợ" + Phần B "Thanh toán" (docs/DECISIONS.md
 * #180/#182, kế hoạch kỹ thuật C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md).
 * Phần A: Duyệt phiếu nhập ghi PURCHASE đúng netAmount, "Trả ngay" (voucher POSTED ngay/Chờ duyệt rồi
 * Duyệt sau/Huỷ đảo ngược), Khai nợ đầu kỳ (chỉ 1 lần), cách ly tenant, permission. Phần B: "Thanh
 * toán công nợ" trên TỔNG nợ (không chọn từng phiếu, chặn trả vượt), `GET /supplier-debt/payments`.
 */
describe('HTTP e2e — /api/v1/supplier-debt (Công nợ nhà cung cấp, Phần A + Phần B)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let warehouseId: string;
  let cashAccountId: string;
  let drugId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-sd-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createSupplier(token: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set(authed(token))
      .send({ name: `NCC Test ${randomUUID().slice(0, 8)}` });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  /** Tạo + Duyệt 1 phiếu nhập PURCHASE cho `supplierId`, `unitCost * quantity = 100` (mặc định) —
   * trả về `receiptId`/`receiptNo`/`netAmount`. */
  async function createAndApprovePurchase(token: string, supplierId: string, overrides: { quantity?: number; unitCost?: number; prepaidAmount?: number; prepaidPaymentMethodCode?: string; prepaidCashAccountId?: string } = {}) {
    const quantity = overrides.quantity ?? 10;
    const unitCost = overrides.unitCost ?? 10;
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/receipts')
      .set(authed(token))
      .send({
        warehouseId,
        supplierId,
        receiptType: 'PURCHASE',
        lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost, batchNo: `LOT-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' }],
        ...(overrides.prepaidAmount !== undefined
          ? { prepaidAmount: overrides.prepaidAmount, prepaidPaymentMethodCode: overrides.prepaidPaymentMethodCode ?? 'CASH', prepaidCashAccountId: overrides.prepaidCashAccountId ?? cashAccountId }
          : {}),
      });
    expect(createRes.status).toBe(200);
    const receiptId = createRes.body.data.id as string;
    const receiptNo = createRes.body.data.receiptNo as string;

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/receipts/${receiptId}/approve`)
      .set(authed(token))
      .send({ version: createRes.body.data.version });
    expect(approveRes.status).toBe(200);
    return { receiptId, receiptNo, netAmount: quantity * unitCost, detail: approveRes.body.data };
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

    fixture = await createTwoTenantFixture(privileged, 'SupplierDebt e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');

    const warehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    warehouseId = warehousesRes.body.data.items[0].id;

    const accountsRes = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(clinicAdminToken));
    cashAccountId = accountsRes.body.data.items.find((a: { type: string }) => a.type === 'CASH').id;

    const drugRes = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(clinicAdminToken))
      .send({
        code: `DRG-SD-${randomUUID().slice(0, 8)}`,
        name: 'Thuốc test Công nợ NCC',
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
        activeIngredient: 'Test',
        unit: 'Viên',
        concentration: '500mg',
        manufacturerCode: 'TEST_MANUFACTURER',
        defaultSellPrice: 5000,
        drugGroupCode: 'TEST_GROUP',
        routeCode: 'TEST_ROUTE',
        registrationNumber: `VD-TEST-SD-${randomUUID().slice(0, 6)}`,
        dosageForm: 'Viên nén',
        countryOfOrigin: 'Việt Nam',
        ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
        units: [],
      });
    expect(drugRes.status).toBe(200);
    drugId = drugRes.body.data.id;
  });

  afterAll(async () => {
    // Trả `cashVoucherApprovalEnabled` về mặc định (an toàn nếu 1 test giữa chừng lỗi trước khi tự tắt lại).
    await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: false });
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/supplier-debt/summaries');
    expect(res.status).toBe(401);
  });

  it('lễ tân (không có quyền supplier_debt.read) → 403', async () => {
    const supplierId = await createSupplier(clinicAdminToken);
    const res = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(receptionistToken));
    expect(res.status).toBe(403);
  });

  it('NCC mới, chưa có bút toán nào — summary rỗng, canRecordOpeningBalance=true', async () => {
    const supplierId = await createSupplier(clinicAdminToken);
    const res = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ balance: 0, totalPurchase: 0, totalPaid: 0, canRecordOpeningBalance: true });
  });

  describe('Duyệt phiếu nhập — ghi PURCHASE đúng netAmount', () => {
    it('không "Trả ngay" — balance = netAmount, 1 dòng PURCHASE trong Sổ công nợ, tab Phiếu nhập UNPAID', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId, netAmount } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 15000 });
      expect(netAmount).toBe(150000);

      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data).toMatchObject({ balance: 150000, totalPurchase: 150000, totalPaid: 0, canRecordOpeningBalance: false });

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items).toHaveLength(1);
      expect(ledger.body.data.items[0]).toMatchObject({ entryType: 'PURCHASE', amountChange: 150000, balanceAfter: 150000, stockReceiptId: receiptId, reversed: false });

      const receipts = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/receipts`).set(authed(clinicAdminToken));
      expect(receipts.body.data.items).toEqual([{ stockReceiptId: receiptId, isOpeningBalance: false, originalAmount: 150000, paidAmount: 0, dueAmount: 150000, status: 'UNPAID' }]);
      expect(receipts.body.data.totalDueAmount).toBe(150000);
    });

    it('có chiết khấu Toàn phiếu — PURCHASE ghi đúng netAmount (sau chiết khấu), không phải totalAmount gross', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/inventory/receipts')
        .set(authed(clinicAdminToken))
        .send({
          warehouseId,
          supplierId,
          receiptType: 'PURCHASE',
          lines: [{ drugId, unitCode: 'VIEN', quantity: 10, unitCost: 10000, batchNo: `LOT-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' }],
          discountType: 'AMOUNT',
          discountValue: 5000,
          discountReason: 'Chiết khấu test',
        });
      expect(createRes.status).toBe(200);
      expect(createRes.body.data.totalAmount).toBe(100000);
      await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${createRes.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: createRes.body.data.version });

      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data.balance).toBe(95000); // 100.000 - 5.000 chiết khấu
    });
  });

  describe('"Trả ngay" — không cần duyệt phiếu chi (mặc định)', () => {
    it('trả ngay MỘT PHẦN → voucher POSTED ngay, balance = netAmount - prepaid, tab Phiếu nhập PARTIALLY_PAID', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000, prepaidAmount: 30000 });

      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data).toMatchObject({ balance: 70000, totalPurchase: 100000, totalPaid: 30000, pendingApprovalAmount: 0 });

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items).toHaveLength(2);
      expect(ledger.body.data.items[0]).toMatchObject({ entryType: 'PURCHASE', amountChange: 100000 });
      expect(ledger.body.data.items[1]).toMatchObject({ entryType: 'PAYMENT', amountChange: -30000, balanceAfter: 70000, stockReceiptId: receiptId });

      const receipts = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/receipts`).set(authed(clinicAdminToken));
      expect(receipts.body.data.items[0]).toMatchObject({ stockReceiptId: receiptId, paidAmount: 30000, dueAmount: 70000, status: 'PARTIALLY_PAID' });

      const receiptDetail = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${receiptId}`).set(authed(clinicAdminToken));
      expect(receiptDetail.body.data.prepaidAmount).toBe(30000);
      expect(receiptDetail.body.data.prepaidVoucherId).toBeTruthy();
    });

    it('trả ngay ĐỦ toàn bộ → dueAmount=0, FULLY_PAID', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 5, unitCost: 20000, prepaidAmount: 100000 });
      const receipts = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/receipts`).set(authed(clinicAdminToken));
      expect(receipts.body.data.items[0]).toMatchObject({ stockReceiptId: receiptId, dueAmount: 0, status: 'FULLY_PAID' });
      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data.balance).toBe(0);
    });

    it('trả ngay VƯỢT tiền hàng phải trả → 422', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/inventory/receipts')
        .set(authed(clinicAdminToken))
        .send({
          warehouseId,
          supplierId,
          receiptType: 'PURCHASE',
          lines: [{ drugId, unitCode: 'VIEN', quantity: 1, unitCost: 10000, batchNo: `LOT-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' }],
          prepaidAmount: 20000,
          prepaidPaymentMethodCode: 'CASH',
          prepaidCashAccountId: cashAccountId,
        });
      expect(createRes.status).toBe(200);
      const approveRes = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${createRes.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: createRes.body.data.version });
      expect(approveRes.status).toBe(422);
    });

    it('huỷ phiếu nhập KHÔNG tự đụng công nợ/voucher (StockReceiptService.voidReceipt() không gọi hook) — công nợ vẫn còn nguyên, ghi lại để dành Phần D', async () => {
      // Xác nhận hành vi HIỆN TẠI (Phần A cố ý CHƯA hook Huỷ chứng từ vào công nợ — đó là Phần D,
      // "Huỷ chứng từ" chưa code). Test này là "characterization test" chống hồi quy im lặng.
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 2, unitCost: 10000 });
      const balanceBefore = (await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken))).body.data.balance;
      await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/void`)
        .set(authed(clinicAdminToken))
        .send({ version: 2, reason: 'test huỷ — không liên quan công nợ' });
      const balanceAfter = (await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken))).body.data.balance;
      expect(balanceAfter).toBe(balanceBefore);
    });
  });

  describe('"Trả ngay" — cashVoucherApprovalEnabled BẬT (phiếu chi phải Duyệt)', () => {
    it('voucher PENDING_APPROVAL → balance CHƯA giảm → Duyệt phiếu chi → balance giảm đúng', async () => {
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: true });

      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000, prepaidAmount: 40000 });

      const summaryBefore = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summaryBefore.body.data).toMatchObject({ balance: 100000, totalPaid: 0, pendingApprovalAmount: 40000 });

      const receiptDetail = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${receiptId}`).set(authed(clinicAdminToken));
      const voucherId = receiptDetail.body.data.prepaidVoucherId as string;
      const voucherBefore = await request(app.getHttpServer()).get(`/api/v1/cash-vouchers/${voucherId}`).set(authed(clinicAdminToken));
      expect(voucherBefore.body.data.status).toBe('PENDING_APPROVAL');

      const approveVoucherRes = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${voucherId}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: voucherBefore.body.data.version });
      expect(approveVoucherRes.status).toBe(200);

      const summaryAfter = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summaryAfter.body.data).toMatchObject({ balance: 60000, totalPaid: 40000, pendingApprovalAmount: 0 });

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items.at(-1)).toMatchObject({ entryType: 'PAYMENT', amountChange: -40000, cashVoucherId: voucherId });

      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: false });
    });
  });

  describe('Huỷ phiếu chi "Trả ngay" (voidVoucher) — đảo bút toán PAYMENT', () => {
    it('voucher ĐÃ POSTED, huỷ → REVERSAL đảo đúng, balance quay lại như trước khi trả', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000, prepaidAmount: 25000 });
      const receiptDetail = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${receiptId}`).set(authed(clinicAdminToken));
      const voucherId = receiptDetail.body.data.prepaidVoucherId as string;

      const voucherRes = await request(app.getHttpServer()).get(`/api/v1/cash-vouchers/${voucherId}`).set(authed(clinicAdminToken));
      const voidRes = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${voucherId}/void`)
        .set(authed(clinicAdminToken))
        .send({ version: voucherRes.body.data.version, reason: 'test huỷ trả ngay' });
      expect(voidRes.status).toBe(200);

      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data).toMatchObject({ balance: 100000, totalPaid: 0 });

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items).toHaveLength(3);
      expect(ledger.body.data.items[1]).toMatchObject({ entryType: 'PAYMENT', reversed: true });
      expect(ledger.body.data.items[2]).toMatchObject({ entryType: 'REVERSAL', amountChange: 25000, reversalOfId: ledger.body.data.items[1].id, balanceAfter: 100000 });
    });

    it('voucher CÒN PENDING_APPROVAL (chưa từng POSTED), huỷ → không có gì để đảo (no-op), balance không đổi', async () => {
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: true });
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000, prepaidAmount: 25000 });
      const receipts = (await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/receipts`).set(authed(clinicAdminToken))).body.data.items;
      const receiptId = receipts[0].stockReceiptId;
      const receiptDetail = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${receiptId}`).set(authed(clinicAdminToken));
      const voucherId = receiptDetail.body.data.prepaidVoucherId as string;
      const voucherRes = await request(app.getHttpServer()).get(`/api/v1/cash-vouchers/${voucherId}`).set(authed(clinicAdminToken));
      expect(voucherRes.body.data.status).toBe('PENDING_APPROVAL');

      const voidRes = await request(app.getHttpServer())
        .post(`/api/v1/cash-vouchers/${voucherId}/void`)
        .set(authed(clinicAdminToken))
        .send({ version: voucherRes.body.data.version, reason: 'test huỷ khi còn chờ duyệt' });
      expect(voidRes.status).toBe(200);

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items).toHaveLength(1); // chỉ PURCHASE — không có PAYMENT/REVERSAL nào
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: false });
    });
  });

  describe('Khai nợ đầu kỳ (Q7)', () => {
    it('NCC chưa có bút toán nào → 200, ghi OPENING_BALANCE đúng dấu', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/opening-balance`)
        .set(authed(clinicAdminToken))
        .send({ amount: 12_500_000, occurredAt: '2026-09-01', note: 'Biên bản đối chiếu 31/08' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ balance: 12_500_000, openingBalanceAmount: 12_500_000, canRecordOpeningBalance: false });
    });

    it('cho phép số ÂM (Q8 — NCC đã nợ lại phòng khám từ trước)', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/opening-balance`)
        .set(authed(clinicAdminToken))
        .send({ amount: -500_000, occurredAt: '2026-09-01' });
      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe(-500_000);
    });

    it('gọi LẦN 2 (đã có bút toán) → 409 SUPPLIER_DEBT_OPENING_BALANCE_ALREADY_EXISTS', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(clinicAdminToken)).send({ amount: 100000, occurredAt: '2026-09-01' });
      const res = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(clinicAdminToken)).send({ amount: 200000, occurredAt: '2026-09-01' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SUPPLIER_DEBT_OPENING_BALANCE_ALREADY_EXISTS');
    });

    it('NCC đã có PURCHASE (không phải Khai nợ đầu kỳ) → cũng 409', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 1, unitCost: 1000 });
      const res = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(clinicAdminToken)).send({ amount: 100000, occurredAt: '2026-09-01' });
      expect(res.status).toBe(409);
    });

    it('thiếu quyền supplier_debt.pay (lễ tân) → 403', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(receptionistToken)).send({ amount: 100000, occurredAt: '2026-09-01' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /supplier-debt/summaries — trang Nhà cung cấp / Công nợ nhà cung cấp', () => {
    it('trả đúng balance cho từng NCC, gồm cả NCC 0 nợ', async () => {
      const s1 = await createSupplier(clinicAdminToken);
      const s2 = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, s1, { quantity: 2, unitCost: 5000 });

      const res = await request(app.getHttpServer()).get('/api/v1/supplier-debt/summaries').set(authed(clinicAdminToken));
      expect(res.status).toBe(200);
      const map = new Map(res.body.data.items.map((i: { supplierId: string; balance: number }) => [i.supplierId, i.balance]));
      expect(map.get(s1)).toBe(10000);
      expect(map.get(s2)).toBe(0);
    });
  });

  describe('Phần B — POST :supplierId/payment (Thanh toán công nợ trên TỔNG nợ)', () => {
    it('trả MỘT PHẦN → voucher POSTED ngay (mặc định không cần duyệt), balance giảm đúng, ghi PAYMENT trong Sổ công nợ', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(clinicAdminToken))
        .send({ amount: 40000, paymentMethodCode: 'CASH', cashAccountId, occurredAt: '2026-09-24' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ balance: 60000, totalPaid: 40000, pendingApprovalAmount: 0 });

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items.at(-1)).toMatchObject({ entryType: 'PAYMENT', amountChange: -40000, balanceAfter: 60000 });
    });

    it('trả ĐÚNG hết công nợ → balance = 0', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 5, unitCost: 20000 });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(clinicAdminToken))
        .send({ amount: 100000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe(0);
    });

    it('trả VƯỢT công nợ hiện tại → 422, không tạo bút toán/voucher nào', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 2, unitCost: 10000 });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(clinicAdminToken))
        .send({ amount: 30000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(422);
      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data.balance).toBe(20000);
    });

    it('cộng dồn với phiếu chi đang CHỜ DUYỆT khác cho cùng NCC → vượt quá phần còn lại → 422', async () => {
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: true });
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000 }); // nợ 100.000

      const first = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(clinicAdminToken))
        .send({ amount: 70000, paymentMethodCode: 'CASH', cashAccountId });
      expect(first.status).toBe(200); // vẫn Chờ duyệt, balance snapshot chưa đổi — chỉ pendingApprovalAmount tăng
      expect(first.body.data).toMatchObject({ balance: 100000, pendingApprovalAmount: 70000 });

      const second = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(clinicAdminToken))
        .send({ amount: 40000, paymentMethodCode: 'CASH', cashAccountId }); // 70.000 (chờ duyệt) + 40.000 > 100.000
      expect(second.status).toBe(422);

      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: false });
    });

    it('cashVoucherApprovalEnabled BẬT → voucher PENDING_APPROVAL, balance CHƯA giảm → Duyệt phiếu chi → balance giảm đúng', async () => {
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: true });
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000 });

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(clinicAdminToken))
        .send({ amount: 60000, paymentMethodCode: 'CASH', cashAccountId });
      expect(payRes.status).toBe(200);
      expect(payRes.body.data).toMatchObject({ balance: 100000, totalPaid: 0, pendingApprovalAmount: 60000 });

      const payments = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/payments?supplierId=${supplierId}`).set(authed(clinicAdminToken));
      const voucherId = payments.body.data.items.find((i: { status: string }) => i.status === 'PENDING_APPROVAL').id as string;

      const voucher = await request(app.getHttpServer()).get(`/api/v1/cash-vouchers/${voucherId}`).set(authed(clinicAdminToken));
      const approveRes = await request(app.getHttpServer()).post(`/api/v1/cash-vouchers/${voucherId}/approve`).set(authed(clinicAdminToken)).send({ version: voucher.body.data.version });
      expect(approveRes.status).toBe(200);

      const summaryAfter = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summaryAfter.body.data).toMatchObject({ balance: 40000, totalPaid: 60000, pendingApprovalAmount: 0 });

      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: false });
    });

    it('thiếu quyền supplier_debt.pay (lễ tân) → 403', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(receptionistToken))
        .send({ amount: 10000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(403);
    });
  });

  describe('Phần B — GET /supplier-debt/payments (trang "Phiếu thanh toán NCC")', () => {
    it('gồm CẢ "Trả ngay" lúc nhập LẪN "Thanh toán công nợ" đứng riêng, lọc đúng theo supplierId', async () => {
      const s1 = await createSupplier(clinicAdminToken);
      const s2 = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, s1, { quantity: 10, unitCost: 10000, prepaidAmount: 20000 });
      await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${s1}/payment`).set(authed(clinicAdminToken)).send({ amount: 30000, paymentMethodCode: 'CASH', cashAccountId });
      await createAndApprovePurchase(clinicAdminToken, s2, { quantity: 1, unitCost: 50000, prepaidAmount: 50000 });

      const forS1 = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/payments?supplierId=${s1}`).set(authed(clinicAdminToken));
      expect(forS1.status).toBe(200);
      expect(forS1.body.data.items).toHaveLength(2);
      expect(forS1.body.data.items.every((i: { supplierId: string }) => i.supplierId === s1)).toBe(true);

      const all = await request(app.getHttpServer()).get('/api/v1/supplier-debt/payments').set(authed(clinicAdminToken));
      const ids = new Set(all.body.data.items.map((i: { supplierId: string }) => i.supplierId));
      expect(ids.has(s1)).toBe(true);
      expect(ids.has(s2)).toBe(true);
    });

    it('thiếu quyền supplier_debt.read (lễ tân) → 403', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/supplier-debt/payments').set(authed(receptionistToken));
      expect(res.status).toBe(403);
    });
  });

  describe('Phần C — POST :supplierId/refund ("Thu tiền NCC hoàn lại", Q8)', () => {
    it('NCC chưa nợ gì (balance=0) → 422', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/refund`)
        .set(authed(clinicAdminToken))
        .send({ amount: 1000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(422);
    });

    it('NCC còn nợ (balance dương) → 422', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 2, unitCost: 10000 });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/refund`)
        .set(authed(clinicAdminToken))
        .send({ amount: 1000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(422);
    });

    it('NCC đang nợ lại (balance âm, qua Khai nợ đầu kỳ âm) — trả MỘT PHẦN → balance tăng đúng, ghi REFUND_RECEIVED, voucher INCOME POSTED ngay', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(clinicAdminToken)).send({ amount: -100_000, occurredAt: '2026-09-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/refund`)
        .set(authed(clinicAdminToken))
        .send({ amount: 40_000, paymentMethodCode: 'CASH', cashAccountId, occurredAt: '2026-09-24' });
      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe(-60_000);

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items.at(-1)).toMatchObject({ entryType: 'REFUND_RECEIVED', amountChange: 40_000, balanceAfter: -60_000 });

      const payments = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/payments?supplierId=${supplierId}`).set(authed(clinicAdminToken));
      const refundRow = payments.body.data.items.find((i: { direction: string }) => i.direction === 'INCOME');
      expect(refundRow).toMatchObject({ status: 'POSTED', amount: 40_000, supplierId });
    });

    it('trả ĐÚNG HẾT số nợ lại → balance = 0', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(clinicAdminToken)).send({ amount: -50_000, occurredAt: '2026-09-01' });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/refund`)
        .set(authed(clinicAdminToken))
        .send({ amount: 50_000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe(0);
    });

    it('trả VƯỢT số nợ lại → 422, không tạo bút toán/voucher nào', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(clinicAdminToken)).send({ amount: -30_000, occurredAt: '2026-09-01' });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/refund`)
        .set(authed(clinicAdminToken))
        .send({ amount: 30_001, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(422);
      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data.balance).toBe(-30_000);
    });

    it('LUÔN POSTED ngay kể cả khi cashVoucherApprovalEnabled BẬT (chỉ EXPENSE mới xét duyệt)', async () => {
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: true });
      const supplierId = await createSupplier(clinicAdminToken);
      await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(clinicAdminToken)).send({ amount: -20_000, occurredAt: '2026-09-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/refund`)
        .set(authed(clinicAdminToken))
        .send({ amount: 20_000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe(0);

      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ cashVoucherApprovalEnabled: false });
    });

    it('thiếu quyền supplier_debt.pay (lễ tân) → 403', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/refund`)
        .set(authed(receptionistToken))
        .send({ amount: 1000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(403);
    });

    it('NCC của tenant khác → 404', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/refund`)
        .set(authed(tenantBAdminToken))
        .send({ amount: 1000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(404);
    });
  });

  describe('Cách ly tenant', () => {
    it('NCC của tenant A, xem summary bằng token tenant B → 404', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(tenantBAdminToken));
      expect(res.status).toBe(404);
    });

    it('Khai nợ đầu kỳ cho NCC tenant khác → 404', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/${supplierId}/opening-balance`).set(authed(tenantBAdminToken)).send({ amount: 100000, occurredAt: '2026-09-01' });
      expect(res.status).toBe(404);
    });

    it('Thanh toán công nợ cho NCC tenant khác → 404', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(tenantBAdminToken))
        .send({ amount: 10000, paymentMethodCode: 'CASH', cashAccountId });
      expect(res.status).toBe(404);
    });
  });
});
