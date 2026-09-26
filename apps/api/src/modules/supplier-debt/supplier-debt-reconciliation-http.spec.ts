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
 * HTTP e2e — "Công nợ nhà cung cấp" Phần E "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md
 * #182 câu 3, kế hoạch C:\Users\Administrator\.claude\plans\playful-baking-kazoo.md). "Biên bản đối
 * chiếu" gộp 1 bước: khớp → tự Chốt ngay; lệch → tự sinh Phiếu điều chỉnh Chờ duyệt, biên bản giữ
 * DRAFT tới khi Duyệt/Từ chối xử lý xong (Từ chối → biên bản tự CANCELLED). Sau khi Chốt, chứng từ
 * NCC đó có ngày ≤ ngày chốt chỉ Huỷ/Điều chỉnh được bởi actor có `supplier_debt.unlock`.
 */
describe('HTTP e2e — /api/v1/supplier-debt (Phần E — Đối chiếu & chốt công nợ theo kỳ)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let noUnlockToken: string;
  let tenantBAdminToken: string;
  let warehouseId: string;
  let drugId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-sdr-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  /** Vai trò tuỳ biến sao chép ma trận `clinic_admin` (đủ `stock_receipt.approve`/`supplier_debt.
   * approve`/`.adjust`), CHỈ bỏ đúng `supplier_debt.unlock` — mô phỏng actor KHÔNG có quyền mở khoá
   * kỳ đã chốt (đúng khuôn `createCustomRoleToken` ở `supplier-debt-http.spec.ts` Phần D). */
  async function createNoUnlockRoleToken() {
    const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
    const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
    const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));
    const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `no-unlock e2e ${randomUUID().slice(0, 6)}` });
    const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
      .filter((e) => e.dataScope !== 'none')
      .map((e) => ({ permissionId: e.permissionId, dataScope: `${e.module}.${e.action}` === 'supplier_debt.unlock' ? 'none' : e.dataScope }));
    await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });

    const username = `e2e-sdr-nounlock-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: 'User no-unlock', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: newRole.body.data.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
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

  /** Tạo + Duyệt 1 phiếu nhập PURCHASE cho `supplierId`, `occurredAt` truyền được để kiểm soát ngày
   * chứng từ chính xác (cần cho biên giới "ngày ≤ ngày chốt"). */
  async function createAndApprovePurchase(token: string, supplierId: string, params: { quantity: number; unitCost: number; occurredAt: string }) {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/receipts')
      .set(authed(token))
      .send({
        warehouseId,
        supplierId,
        receiptType: 'PURCHASE',
        occurredAt: params.occurredAt,
        lines: [{ drugId, unitCode: 'VIEN', quantity: params.quantity, unitCost: params.unitCost, batchNo: `LOT-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' }],
      });
    expect(createRes.status).toBe(200);
    const receiptId = createRes.body.data.id as string;

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/receipts/${receiptId}/approve`)
      .set(authed(token))
      .send({ version: createRes.body.data.version });
    expect(approveRes.status).toBe(200);
    return { receiptId, netAmount: params.quantity * params.unitCost, version: approveRes.body.data.version as number };
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

    fixture = await createTwoTenantFixture(privileged, 'SupplierDebtReconciliation e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
    noUnlockToken = await createNoUnlockRoleToken();

    const warehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    warehouseId = warehousesRes.body.data.items[0].id;

    const drugRes = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(clinicAdminToken))
      .send({
        code: `DRG-SDR-${randomUUID().slice(0, 8)}`,
        name: 'Thuốc test Đối chiếu công nợ',
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
        activeIngredient: 'Test',
        unit: 'Viên',
        concentration: '500mg',
        manufacturerCode: 'TEST_MANUFACTURER',
        defaultSellPrice: 5000,
        drugGroupCode: 'TEST_GROUP',
        routeCode: 'TEST_ROUTE',
        registrationNumber: `VD-TEST-SDR-${randomUUID().slice(0, 6)}`,
        dosageForm: 'Viên nén',
        countryOfOrigin: 'Việt Nam',
        ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
        units: [],
      });
    expect(drugRes.status).toBe(200);
    drugId = drugRes.body.data.id;
  });

  afterAll(async () => {
    await privileged.$disconnect();
    await app.close();
  });

  it('preview: xem trước chênh lệch, không ghi gì', async () => {
    const supplierId = await createSupplier(clinicAdminToken);
    await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000, occurredAt: '2026-01-10T00:00:00.000Z' });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/supplier-debt/${supplierId}/reconciliation-preview`)
      .query({ asOfDate: '2026-01-15', confirmedBalance: 100000 })
      .set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ systemBalance: 100000, confirmedBalance: 100000, differenceAmount: 0 });

    const listRes = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/reconciliations`).set(authed(clinicAdminToken));
    expect(listRes.body.data.items).toEqual([]); // preview không ghi gì
  });

  describe('luồng khớp tuyệt đối — tự Chốt ngay', () => {
    let supplierId: string;
    let receiptId: string;
    let receiptVersion: number;

    beforeAll(async () => {
      supplierId = await createSupplier(clinicAdminToken);
      const purchase = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 10000, occurredAt: '2026-01-10T00:00:00.000Z' });
      receiptId = purchase.receiptId;
      receiptVersion = purchase.version;
    });

    it('lập biên bản khớp → tự FINALIZED ngay, không sinh phiếu điều chỉnh', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-01-15', confirmedBalance: 100000 });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('FINALIZED');
      expect(res.body.data.differenceAmount).toBe(0);
      expect(res.body.data.resultingAdjustmentId).toBeNull();
      expect(res.body.data.finalizedAt).not.toBeNull();

      const summaryRes = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summaryRes.body.data.lockedAsOfDate).toMatch(/^2026-01-15/);
    });

    it('ngày đối chiếu lùi hơn/bằng biên bản đã chốt gần nhất → 409', async () => {
      const earlier = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-01-10', confirmedBalance: 100000 });
      expect(earlier.status).toBe(409);
      expect(earlier.body.error.code).toBe('SUPPLIER_DEBT_RECONCILIATION_AS_OF_DATE_TOO_EARLY');

      const sameDay = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-01-15', confirmedBalance: 100000 });
      expect(sameDay.status).toBe(409);
      expect(sameDay.body.error.code).toBe('SUPPLIER_DEBT_RECONCILIATION_AS_OF_DATE_TOO_EARLY');
    });

    it('sau khi Chốt, Huỷ phiếu nhập ngày ≤ ngày chốt — actor KHÔNG có unlock → 409, CÓ unlock → thành công', async () => {
      const blocked = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/void`)
        .set(authed(noUnlockToken))
        .send({ reason: 'test khoá kỳ', version: receiptVersion });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('SUPPLIER_DEBT_PERIOD_LOCKED');

      const allowed = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/void`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'test khoá kỳ — có quyền mở khoá', version: receiptVersion });
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.voided).toBe(true);
    });
  });

  describe('luồng lệch — sinh phiếu điều chỉnh, Chốt sau', () => {
    let supplierId: string;

    beforeAll(async () => {
      supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 5000, occurredAt: '2026-02-10T00:00:00.000Z' });
    });

    it('lập biên bản lệch → DRAFT + sinh đúng 1 Phiếu điều chỉnh PENDING_APPROVAL, gọi Chốt ngay → 409 NOT_READY', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-02-15', confirmedBalance: 70000 });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.differenceAmount).toBe(20000);
      expect(res.body.data.resultingAdjustmentId).not.toBeNull();
      expect(res.body.data.resultingAdjustmentStatus).toBe('PENDING_APPROVAL');

      const adjustmentsRes = await request(app.getHttpServer())
        .get('/api/v1/supplier-debt/adjustments')
        .query({ supplierId })
        .set(authed(clinicAdminToken));
      const adjustment = adjustmentsRes.body.data.items.find((a: { id: string }) => a.id === res.body.data.resultingAdjustmentId);
      expect(adjustment).toMatchObject({ kind: 'INCREASE', amount: 20000, status: 'PENDING_APPROVAL', evidenceRef: res.body.data.reconciliationNo });

      const finalizeTooEarly = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations/${res.body.data.id}/finalize`)
        .set(authed(clinicAdminToken))
        .send({ version: res.body.data.version });
      expect(finalizeTooEarly.status).toBe(409);
      expect(finalizeTooEarly.body.error.code).toBe('SUPPLIER_DEBT_RECONCILIATION_NOT_READY');

      // Duyệt phiếu điều chỉnh → giờ Chốt được.
      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/adjustments/${adjustment.id}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: adjustment.version });
      expect(approveRes.status).toBe(200);

      const finalizeRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations/${res.body.data.id}/finalize`)
        .set(authed(clinicAdminToken))
        .send({ version: res.body.data.version });
      expect(finalizeRes.status).toBe(200);
      expect(finalizeRes.body.data.status).toBe('FINALIZED');

      const summaryRes = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summaryRes.body.data.lockedAsOfDate).toMatch(/^2026-02-15/);
      expect(summaryRes.body.data.balance).toBe(70000); // 50000 gốc + 20000 điều chỉnh Tăng
    });
  });

  describe('luồng lệch bị Từ chối — biên bản tự CANCELLED', () => {
    let supplierId: string;

    beforeAll(async () => {
      supplierId = await createSupplier(clinicAdminToken);
      await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 3000, occurredAt: '2026-03-10T00:00:00.000Z' });
    });

    it('Từ chối phiếu điều chỉnh tự sinh → biên bản CANCELLED, Chốt báo lỗi rõ, không cho sửa lại', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-03-15', confirmedBalance: 40000 });
      expect(createRes.status).toBe(201);
      const adjustmentId = createRes.body.data.resultingAdjustmentId as string;

      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/adjustments/${adjustmentId}/reject`)
        .set(authed(clinicAdminToken))
        .send({ version: 1, rejectionReason: 'Số liệu NCC xác nhận sai, cần đối chiếu lại' });
      expect(rejectRes.status).toBe(200);

      const listRes = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/reconciliations`).set(authed(clinicAdminToken));
      const row = listRes.body.data.items.find((r: { id: string }) => r.id === createRes.body.data.id);
      expect(row.status).toBe('CANCELLED');

      const finalizeRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations/${createRes.body.data.id}/finalize`)
        .set(authed(clinicAdminToken))
        .send({ version: createRes.body.data.version });
      expect(finalizeRes.status).toBe(409);
      expect(finalizeRes.body.error.code).toBe('SUPPLIER_DEBT_RECONCILIATION_NOT_READY');
    });
  });

  describe('Duyệt Phiếu điều chỉnh gắn chứng từ đã khoá kỳ', () => {
    let supplierId: string;
    let receiptId: string;

    beforeAll(async () => {
      supplierId = await createSupplier(clinicAdminToken);
      const purchase = await createAndApprovePurchase(clinicAdminToken, supplierId, { quantity: 10, unitCost: 4000, occurredAt: '2026-04-10T00:00:00.000Z' });
      receiptId = purchase.receiptId;
      const lockRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-04-15', confirmedBalance: 40000 });
      expect(lockRes.body.data.status).toBe('FINALIZED');
    });

    it('gắn phiếu điều chỉnh Tăng vào chứng từ đã khoá — Duyệt bởi actor KHÔNG unlock → 409, CÓ unlock → thành công', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/supplier-debt/adjustments')
        .set(authed(clinicAdminToken))
        .send({ supplierId, kind: 'INCREASE', amount: 1000, targetReceiptId: receiptId, reason: 'Điều chỉnh test khoá kỳ' });
      expect(createRes.status).toBe(201);

      const blocked = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`)
        .set(authed(noUnlockToken))
        .send({ version: createRes.body.data.version });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('SUPPLIER_DEBT_PERIOD_LOCKED');

      const allowed = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/adjustments/${createRes.body.data.id}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: createRes.body.data.version });
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.status).toBe('APPROVED');
    });
  });

  describe('cách ly tenant + phân quyền', () => {
    it('reconciliations của NCC tenant khác → 404 (không phải 403)', async () => {
      const supplierId = await createSupplier(tenantBAdminToken);
      const previewRes = await request(app.getHttpServer())
        .get(`/api/v1/supplier-debt/${supplierId}/reconciliation-preview`)
        .query({ asOfDate: '2026-01-15', confirmedBalance: 0 })
        .set(authed(clinicAdminToken));
      expect(previewRes.status).toBe(404);

      const createRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-01-15', confirmedBalance: 0 });
      expect(createRes.status).toBe(404);

      const listRes = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/reconciliations`).set(authed(clinicAdminToken));
      expect(listRes.status).toBe(404);
    });

    it('lễ tân (không có supplier_debt.adjust) → 403 khi lập biên bản', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(receptionistToken))
        .send({ asOfDate: '2026-01-15', confirmedBalance: 0 });
      expect(res.status).toBe(403);
    });

    it('lễ tân (không có supplier_debt.approve) → 403 khi Chốt', async () => {
      const supplierId = await createSupplier(clinicAdminToken);
      const createRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-01-15', confirmedBalance: 0 });
      expect(createRes.body.data.status).toBe('FINALIZED'); // NCC chưa có bút toán nào, 0=0 khớp
      // Lập tiếp 1 biên bản lệch để có bản DRAFT thật sự cần "Chốt" riêng bị chặn quyền.
      const draftRes = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations`)
        .set(authed(clinicAdminToken))
        .send({ asOfDate: '2026-01-20', confirmedBalance: 5000 });
      expect(draftRes.body.data.status).toBe('DRAFT');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/supplier-debt/${supplierId}/reconciliations/${draftRes.body.data.id}/finalize`)
        .set(authed(receptionistToken))
        .send({ version: draftRes.body.data.version });
      expect(res.status).toBe(403);
    });
  });
});
