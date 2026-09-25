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

    it('Phần D — huỷ phiếu nhập ĐÃ Duyệt (actor có stock_receipt.approve) tự đảo công nợ NGAY trong cùng transaction', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 2, unitCost: 10000 });
      const balanceBefore = (await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken))).body.data.balance;
      expect(balanceBefore).toBe(20000);
      const voidRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/void`)
        .set(authed(clinicAdminToken))
        .send({ version: 2, reason: 'test huỷ — Phần D tự đảo công nợ' });
      expect(voidRes.status).toBe(200);
      const balanceAfter = (await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken))).body.data.balance;
      expect(balanceAfter).toBe(0);
      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      const reversalEntry = ledger.body.data.items.find((e: { entryType: string }) => e.entryType === 'REVERSAL');
      expect(reversalEntry).toBeDefined();
      expect(reversalEntry.amountChange).toBe(-20000);
      expect(reversalEntry.stockReceiptId).toBe(receiptId);
    });

    it('huỷ phiếu nhập KHÔNG gắn NCC (receiptType=OPENING_BALANCE) không đụng gì tới sổ công nợ (no-op an toàn)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/inventory/receipts')
        .set(authed(clinicAdminToken))
        .send({
          warehouseId,
          receiptType: 'OPENING_BALANCE',
          lines: [{ drugId, unitCode: 'VIEN', quantity: 1, unitCost: 10000, batchNo: `LOT-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' }],
        });
      expect(createRes.status).toBe(200);
      const approveRes = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${createRes.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: createRes.body.data.version });
      expect(approveRes.status).toBe(200);
      const voidRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${createRes.body.data.id}/void`)
        .set(authed(clinicAdminToken))
        .send({ version: 2, reason: 'test huỷ phiếu không gắn NCC' });
      expect(voidRes.status).toBe(200);
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

  /**
   * Phần D — "Luồng xử lý sai sót" (docs/DECISIONS.md #180/#182, kế hoạch clever-dazzling-bentley.md).
   * 2 vai trò tuỳ biến riêng cho phần này (sao chép ma trận `clinic_admin` qua API, cùng khuôn đã
   * dùng ở `stock-issue-http.spec.ts` "Phân quyền theo Khoa/Phòng"):
   * - `requesterOnlyToken` — CÓ `supplier_debt.adjust`, KHÔNG có `supplier_debt.approve`/
   *   `stock_receipt.approve`/`stock_issue.create` — mô phỏng nhân viên chỉ được "Đề nghị huỷ".
   * - `approverOnlyToken` — CÓ `supplier_debt.approve`, KHÔNG có `stock_receipt.approve`/
   *   `stock_issue.create` (VÀ không có `supplier_debt.adjust`, để phép thử "Tự duyệt" ở nhánh khác
   *   không bị lẫn) — xác nhận đúng chốt "chỉ cần supplier_debt.approve, không cần quyền duyệt phiếu
   *   gốc của người duyệt".
   */
  describe('Phần D — Luồng xử lý sai sót', () => {
    let requesterOnlyToken: string;
    let approverOnlyToken: string;

    async function createCustomRoleToken(roleLabel: string, overrides: Record<string, 'none' | 'global'>) {
      const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
      const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
      const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));
      const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `${roleLabel} e2e ${randomUUID().slice(0, 6)}` });
      const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
        .filter((e) => e.dataScope !== 'none')
        .map((e) => {
          const key = `${e.module}.${e.action}`;
          return { permissionId: e.permissionId, dataScope: key in overrides ? overrides[key] : e.dataScope };
        });
      await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });

      const username = `e2e-sd-${roleLabel}-${randomUUID()}`;
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const user = await privileged.userAccount.create({
        data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: `User ${roleLabel}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: newRole.body.data.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
      return login.body.data.accessToken as string;
    }

    beforeAll(async () => {
      requesterOnlyToken = await createCustomRoleToken('requester-only', {
        'supplier_debt.approve': 'none',
        'stock_receipt.approve': 'none',
        'stock_issue.create': 'none',
      });
      approverOnlyToken = await createCustomRoleToken('approver-only', {
        'supplier_debt.adjust': 'none',
        'stock_receipt.approve': 'none',
        'stock_issue.create': 'none',
      });
    });

    it('lễ tân (không có supplier_debt.adjust) → 403 khi tạo Phiếu điều chỉnh', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer()).post('/api/v1/supplier-debt/adjustments').set(authed(receptionistToken)).send({ supplierId, kind: 'INCREASE', amount: 1000, reason: 'test' });
      expect(res.status).toBe(403);
    });

    it('lễ tân (không có supplier_debt.approve) → 403 khi duyệt', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer()).post('/api/v1/supplier-debt/adjustments').set(authed(clinicAdminToken)).send({ supplierId, kind: 'INCREASE', amount: 1000, reason: 'test' });
      const res = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`).set(authed(receptionistToken)).send({ version: 1 });
      expect(res.status).toBe(403);
    });

    it('INCREASE — VALIDATE: thiếu amount → 400', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer()).post('/api/v1/supplier-debt/adjustments').set(authed(clinicAdminToken)).send({ supplierId, kind: 'INCREASE', reason: 'thiếu số tiền' });
      expect(res.status).toBe(400);
    });

    it('VOID_REQUEST — VALIDATE: có amount → 400 (chỉ INCREASE/DECREASE mới có amount)', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 1, unitCost: 1000 });
      const res = await request(app.getHttpServer()).post('/api/v1/supplier-debt/adjustments').set(authed(clinicAdminToken)).send({ supplierId, kind: 'VOID_REQUEST', amount: 1000, targetReceiptId: receiptId, reason: 'sai' });
      expect(res.status).toBe(400);
    });

    it('VOID_REQUEST — VALIDATE: chọn CẢ targetReceiptId LẪN targetIssueId → 400', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 1, unitCost: 1000 });
      const res = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId, kind: 'VOID_REQUEST', targetReceiptId: receiptId, targetIssueId: randomUUID(), reason: 'sai' });
      expect(res.status).toBe(400);
    });

    it('VOID_REQUEST — phiếu nhập thuộc NCC KHÁC → 422', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const otherSupplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 1, unitCost: 1000 });
      const res = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId: otherSupplierId, kind: 'VOID_REQUEST', targetReceiptId: receiptId, reason: 'nhầm NCC' });
      expect(res.status).toBe(422);
    });

    it('INCREASE — duyệt xong ghi ADJUSTMENT_INCREASE, balance tăng đúng, không đụng tồn kho', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId, kind: 'INCREASE', amount: 30000, reason: 'NCC gửi hoá đơn điều chỉnh tăng', evidenceRef: 'BB-001' });
      expect(createRes.status).toBe(201);
      expect(createRes.body.data.status).toBe('PENDING_APPROVAL');

      const summaryBefore = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summaryBefore.body.data.balance).toBe(0); // Chờ duyệt — CHƯA đụng sổ.
      expect(summaryBefore.body.data.pendingAdjustmentCount).toBe(1);

      const approveRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`).set(authed(approverOnlyToken)).send({ version: 1 });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data).toMatchObject({ status: 'APPROVED', selfApproved: false });

      const summaryAfter = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summaryAfter.body.data.balance).toBe(30000);
      expect(summaryAfter.body.data.pendingAdjustmentCount).toBe(0);

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items[0]).toMatchObject({ entryType: 'ADJUSTMENT_INCREASE', amountChange: 30000, balanceAfter: 30000 });
    });

    it('DECREASE — duyệt xong ghi ADJUSTMENT_DECREASE, balance giảm đúng (được phép âm — NCC nợ lại)', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId, kind: 'DECREASE', amount: 5000, reason: 'NCC giảm giá sau khi đã ghi nợ' });
      const approveRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: 1 });
      expect(approveRes.status).toBe(200);
      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data.balance).toBe(-5000);
    });

    it('"Tự duyệt" (#182 câu 1) — clinic_admin lập rồi tự duyệt luôn → selfApproved=true, ghi rõ trong Nhật ký', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId, kind: 'INCREASE', amount: 1000, reason: 'test tự duyệt' });
      const approveRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: 1 });
      expect(approveRes.body.data.selfApproved).toBe(true);
      const list = await request(app.getHttpServer()).get('/api/v1/supplier-debt/adjustments').set(authed(clinicAdminToken)).query({ supplierId });
      expect(list.body.data.items[0]).toMatchObject({ selfApproved: true, status: 'APPROVED' });
    });

    it('Từ chối — bắt buộc lý do, KHÔNG đụng sổ công nợ', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId, kind: 'INCREASE', amount: 1000, reason: 'sẽ bị từ chối' });

      const missingReasonRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/reject`).set(authed(clinicAdminToken)).send({ version: 1 });
      expect(missingReasonRes.status).toBe(400);

      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/reject`)
        .set(authed(approverOnlyToken))
        .send({ version: 1, rejectionReason: 'Sai số tiền, lập lại' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Sai số tiền, lập lại' });

      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data.balance).toBe(0);
    });

    it('Duyệt/Từ chối lại phiếu ĐÃ xử lý → 409 SUPPLIER_DEBT_ADJUSTMENT_NOT_PENDING', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId, kind: 'INCREASE', amount: 1000, reason: 'test' });
      await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: 1 });

      const reApproveRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: 2 });
      expect(reApproveRes.status).toBe(409);
      expect(reApproveRes.body.error.code).toBe('SUPPLIER_DEBT_ADJUSTMENT_NOT_PENDING');

      const rejectAfterRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/reject`).set(authed(clinicAdminToken)).send({ version: 2, rejectionReason: 'quá muộn' });
      expect(rejectAfterRes.status).toBe(409);
    });

    it('VOID_REQUEST — người CHỈ có supplier_debt.adjust đề nghị, người CHỈ có supplier_debt.approve (không stock_receipt.approve) duyệt → tự huỷ phiếu + tự đảo công nợ', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 4, unitCost: 5000 }); // netAmount=20000

      // Xác nhận requester THẬT SỰ không có quyền huỷ trực tiếp.
      const directVoidRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/void`)
        .set(authed(requesterOnlyToken))
        .send({ version: 2, reason: 'thử huỷ trực tiếp — phải bị chặn' });
      expect(directVoidRes.status).toBe(403);

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(requesterOnlyToken))
        .send({ supplierId, kind: 'VOID_REQUEST', targetReceiptId: receiptId, reason: 'Lập nhầm nhà cung cấp, cần huỷ và lập lại' });
      expect(createRes.status).toBe(201);
      expect(createRes.body.data.kind).toBe('VOID_REQUEST');

      // Xác nhận approver THẬT SỰ không có quyền huỷ trực tiếp (chỉ có supplier_debt.approve).
      const approverDirectVoidRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/void`)
        .set(authed(approverOnlyToken))
        .send({ version: 2, reason: 'approver thử huỷ trực tiếp — phải bị chặn' });
      expect(approverDirectVoidRes.status).toBe(403);

      const approveRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`).set(authed(approverOnlyToken)).send({ version: 1 });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data).toMatchObject({ status: 'APPROVED', selfApproved: false });

      const receiptDetail = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${receiptId}`).set(authed(clinicAdminToken));
      expect(receiptDetail.body.data.voided).toBe(true);

      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data.balance).toBe(0); // PURCHASE 20000 tự đảo bằng REVERSAL -20000.
    });

    it('badge "Có điều chỉnh" — GET /supplier-debt/adjustments?targetReceiptId= trả đúng phiếu liên quan', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const { receiptId } = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 1, unitCost: 1000 });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId, kind: 'VOID_REQUEST', targetReceiptId: receiptId, reason: 'test badge' });
      expect(createRes.status).toBe(201);

      const linked = await request(app.getHttpServer()).get('/api/v1/supplier-debt/adjustments').set(authed(clinicAdminToken)).query({ targetReceiptId: receiptId });
      expect(linked.body.data.items).toHaveLength(1);
      expect(linked.body.data.items[0].id).toBe(createRes.body.data.id);

      const unrelated = await request(app.getHttpServer()).get('/api/v1/supplier-debt/adjustments').set(authed(clinicAdminToken)).query({ targetReceiptId: randomUUID() });
      expect(unrelated.body.data.items).toHaveLength(0);
    });

    it('Kiểm tra toàn vẹn số dư (mục 4.2.6) — SUM(amountChange) lệch balance snapshot → chặn Thanh toán/Thu tiền hoàn lại (409)', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 2, unitCost: 5000 }); // balance=10000
      const account = await privileged.supplierDebtAccount.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, supplierId } });
      // Ghi tay 1 dòng lệch trực tiếp qua Prisma (bỏ qua applyEntry()/updateBalance() cùng lúc) — mô
      // phỏng lỗi hệ thống giả định, đúng tinh thần "không do người dùng" của mục 4.2.6.
      await privileged.supplierDebtEntry.create({
        data: {
          tenantId: fixture.tenantA.id,
          accountId: account.id,
          entryType: 'OPENING_BALANCE',
          amountChange: 1000n,
          balanceAfter: 999999n,
          occurredAt: new Date(),
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });

      const paymentRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/payment`)
        .set(authed(clinicAdminToken))
        .send({ amount: 1000, paymentMethodCode: 'CASH', cashAccountId });
      expect(paymentRes.status).toBe(409);
      expect(paymentRes.body.error.code).toBe('SUPPLIER_DEBT_INTEGRITY_MISMATCH');
    });

    describe('Cách ly tenant', () => {
      it('4 endpoint mới đều 404 khi thao tác chéo tenant', async () => {
        const supplierId = await createSupplier(clinicAdminToken);
        const createRes = await request(app.getHttpServer())
          .post('/api/v1/supplier-debt/adjustments')
          .set(authed(clinicAdminToken))
          .send({ supplierId, kind: 'INCREASE', amount: 1000, reason: 'test cách ly' });
        expect(createRes.status).toBe(201);
        const adjustmentId = createRes.body.data.id;

        const crossCreateRes = await request(app.getHttpServer())
          .post('/api/v1/supplier-debt/adjustments')
          .set(authed(tenantBAdminToken))
          .send({ supplierId, kind: 'INCREASE', amount: 1000, reason: 'test cách ly — NCC tenant khác' });
        expect(crossCreateRes.status).toBe(404);

        const crossApproveRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${adjustmentId}/approve`).set(authed(tenantBAdminToken)).send({ version: 1 });
        expect(crossApproveRes.status).toBe(404);

        const crossRejectRes = await request(app.getHttpServer()).post(`/api/v1/supplier-debt/adjustments/${adjustmentId}/reject`).set(authed(tenantBAdminToken)).send({ version: 1, rejectionReason: 'x' });
        expect(crossRejectRes.status).toBe(404);

        const crossListRes = await request(app.getHttpServer()).get('/api/v1/supplier-debt/adjustments').set(authed(tenantBAdminToken)).query({ supplierId });
        expect(crossListRes.body.data.items).toHaveLength(0);
      });
    });
  });
});
