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
 * HTTP e2e cho "Phiếu nhập kho" — Kho Thuốc & Vật tư y tế Giai đoạn 2 (docs/DECISIONS.md #146, kế
 * hoạch kỹ thuật precious-humming-goblet.md). Bao phủ luồng Nháp → Duyệt/Từ chối/Huỷ, cộng tồn
 * đúng theo lô/bình quân gia quyền, cách ly tenant, permission.
 */
describe('HTTP e2e — /api/v1/inventory (Phiếu nhập kho GĐ2)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let warehouseId: string;
  let tenantBWarehouseId: string;
  let supplierId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-inv-${roleName}-${randomUUID()}`;
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

  /** `isBatchManaged` mặc định `true` (đúng mặc định của `drug`, xem `drug-http.spec.ts`). */
  async function createDrug(token: string, overrides: Partial<{ name: string; baseUnitCode: string; isBatchManaged: boolean; units: unknown[] }> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(token))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: overrides.name ?? 'Paracetamol 500mg',
        itemType: 'MEDICINE',
        baseUnitCode: overrides.baseUnitCode ?? 'VIEN',
        activeIngredient: 'Paracetamol',
        unit: 'Viên',
        concentration: '500mg',
        manufacturerCode: 'TEST_MANUFACTURER',
        defaultSellPrice: 5000,
        drugGroupCode: 'TEST_GROUP',
        routeCode: 'TEST_ROUTE',
        registrationNumber: 'VD-TEST-0001',
        dosageForm: 'Viên nén',
        countryOfOrigin: 'Việt Nam',
        ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
        units: overrides.units ?? [],
        ...(overrides.isBatchManaged !== undefined ? { isBatchManaged: overrides.isBatchManaged } : {}),
      });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  async function createReceipt(token: string, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/inventory/receipts')
      .set(authed(token))
      .send({
        warehouseId,
        supplierId,
        receiptType: 'PURCHASE',
        lines: [],
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

    fixture = await createTwoTenantFixture(privileged, 'Inventory e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');

    const warehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    warehouseId = warehousesRes.body.data.items[0].id;
    const tenantBWarehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(tenantBAdminToken));
    tenantBWarehouseId = tenantBWarehousesRes.body.data.items[0].id;

    const supplierRes = await request(app.getHttpServer()).post('/api/v1/suppliers').set(authed(clinicAdminToken)).send({ name: 'Cty CP Dược phẩm Test' });
    supplierId = supplierRes.body.data.id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/receipts');
    expect(res.status).toBe(401);
  });

  it('lễ tân (không có quyền stock_receipt) → 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/receipts').set(authed(receptionistToken));
    expect(res.status).toBe(403);
  });

  it('tạo phiếu Nháp — chưa đụng tồn kho', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Amoxicillin 500mg' });
    const res = await createReceipt(clinicAdminToken, {
      lines: [{ drugId, unitCode: 'VIEN', quantity: 100, unitCost: 500, batchNo: `LOT-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.totalAmount).toBe(50000);
    expect(res.body.data.lines).toHaveLength(1);

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row).toBeUndefined();
  });

  it('sửa Nháp — thay đúng dòng hàng mới', async () => {
    const drugId = await createDrug(clinicAdminToken);
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 10, unitCost: 1000, batchNo: 'L1', expiryDate: '2027-01-01' }] });
    const id = created.body.data.id;

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/inventory/receipts/${id}`)
      .set(authed(clinicAdminToken))
      .send({ warehouseId, supplierId, receiptType: 'PURCHASE', version: created.body.data.version, lines: [{ drugId, unitCode: 'VIEN', quantity: 20, unitCost: 1500, batchNo: 'L2', expiryDate: '2027-02-01' }] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.lines).toHaveLength(1);
    expect(updated.body.data.lines[0].quantity).toBe(20);
    expect(updated.body.data.totalAmount).toBe(30000);
  });

  it('Duyệt phiếu nhà cung cấp — tồn tăng đúng, thẻ kho ghi đúng, giá vốn theo lô', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Vitamin C 1000mg' });
    const batchNo = `LOT-${randomUUID().slice(0, 6)}`;
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 100, unitCost: 500, batchNo, expiryDate: '2027-06-01' }] });
    const id = created.body.data.id;

    const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('POSTED');

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row.quantityOnHand).toBe(100);

    const batchesRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(clinicAdminToken));
    expect(batchesRes.body.data.totalQuantityOnHand).toBe(100);
    expect(batchesRes.body.data.items[0].batchNo).toBe(batchNo);
    expect(batchesRes.body.data.items[0].unitCost).toBe(500);

    // Bug thật (16/09/2026): frontend luôn gửi tường minh `belowMinOnly=false` (không bỏ trống) —
    // `z.coerce.boolean()` cũ coi chuỗi "false" là truthy, khiến mọi mặt hàng chưa cấu hình
    // `minStockAlert` biến mất khỏi "Tồn kho" dù checkbox lọc đang tắt. Test đúng shape request
    // thật của frontend (`inventory.queries.ts` `useStockBalancesQuery`), không phải bỏ trống param.
    const balanceExplicitFalse = await request(app.getHttpServer())
      .get('/api/v1/inventory/balances')
      .set(authed(clinicAdminToken))
      .query({ warehouseId, belowMinOnly: 'false' });
    const rowExplicitFalse = balanceExplicitFalse.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(rowExplicitFalse).toBeDefined();
    expect(rowExplicitFalse.quantityOnHand).toBe(100);

    const ledgerRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(clinicAdminToken));
    expect(ledgerRes.body.data.items).toHaveLength(1);
    expect(ledgerRes.body.data.items[0]).toMatchObject({ quantityChange: 100, runningBalance: 100, reason: 'RECEIPT_PURCHASE' });

    // Cache "giá nhập gần nhất" — chỉ cập nhật khi Duyệt PURCHASE (không có GET /drugs/:id riêng,
    // tra qua danh sách — đúng khuôn drug-http.spec.ts).
    const drugListRes = await request(app.getHttpServer()).get('/api/v1/drugs').set(authed(clinicAdminToken));
    const drugRow = drugListRes.body.data.items.find((d: { id: string }) => d.id === drugId);
    expect(drugRow.lastPurchaseUnitCost).toBe(500);
  });

  it('Duyệt phiếu tồn đầu kỳ — không cần Nhà cung cấp, bình quân gia quyền cho hàng không quản lý theo lô', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Bông băng y tế', isBatchManaged: false });
    const created = await createReceipt(clinicAdminToken, {
      receiptType: 'OPENING_BALANCE',
      supplierId: undefined,
      lines: [{ drugId, unitCode: 'VIEN', quantity: 200, unitCost: 1000 }],
    });
    expect(created.status).toBe(200);
    expect(created.body.data.supplierId).toBeNull();

    const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(approved.status).toBe(200);

    // Nhập bổ sung giá khác → bình quân gia quyền: (200×1000 + 100×1300)/300 = 1100.
    const second = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 100, unitCost: 1300 }] });
    await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${second.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: second.body.data.version });

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row.quantityOnHand).toBe(300);
  });

  it('Duyệt trùng (2 request đồng thời) — chỉ 1 thành công', async () => {
    const drugId = await createDrug(clinicAdminToken);
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 10, unitCost: 100, batchNo: 'RACE1', expiryDate: '2027-01-01' }] });
    const id = created.body.data.id;
    const version = created.body.data.version;

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${id}/approve`).set(authed(clinicAdminToken)).send({ version }),
      request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${id}/approve`).set(authed(clinicAdminToken)).send({ version }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('Từ chối phiếu Nháp — bắt buộc lý do, không đụng tồn', async () => {
    const drugId = await createDrug(clinicAdminToken);
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100, batchNo: 'REJ1', expiryDate: '2027-01-01' }] });
    const id = created.body.data.id;

    const missingReason = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${id}/reject`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(missingReason.status).toBe(400);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/inventory/receipts/${id}/reject`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Giá vốn ghi sai so với hoá đơn giấy' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    expect(balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId)).toBeUndefined();

    // Đã Từ chối → duyệt lại phải 409.
    const approveAfterReject = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${id}/approve`).set(authed(clinicAdminToken)).send({ version: rejected.body.data.version });
    expect(approveAfterReject.status).toBe(409);
    expect(approveAfterReject.body.error.code).toBe('STOCK_RECEIPT_NOT_DRAFT');
  });

  it('Huỷ phiếu đã Duyệt — trả lại đúng tồn, lý do bắt buộc', async () => {
    const drugId = await createDrug(clinicAdminToken);
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 40, unitCost: 200, batchNo: 'VOID1', expiryDate: '2027-01-01' }] });
    const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });

    const missingReason = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/void`).set(authed(clinicAdminToken)).send({ version: approved.body.data.version });
    expect(missingReason.status).toBe(400);

    const voided = await request(app.getHttpServer())
      .post(`/api/v1/inventory/receipts/${created.body.data.id}/void`)
      .set(authed(clinicAdminToken))
      .send({ version: approved.body.data.version, reason: 'Nhập trùng phiếu' });
    expect(voided.status).toBe(200);
    expect(voided.body.data.voided).toBe(true);

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row === undefined || row.quantityOnHand === 0).toBe(true);

    const ledgerRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(clinicAdminToken));
    expect(ledgerRes.body.data.items).toHaveLength(2);
    expect(ledgerRes.body.data.items[0]).toMatchObject({ quantityChange: -40, reason: 'RECEIPT_VOID', runningBalance: 0 });
  });

  it('Huỷ phiếu — chặn nếu tồn đã bị dùng bớt (giả lập tiêu thụ trực tiếp qua repository)', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 50, unitCost: 300 }] });
    const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(approved.status).toBe(200);

    // Mô phỏng GĐ3 (xuất kho) đã tiêu thụ bớt — chưa có endpoint thật ở GĐ2, ghi thẳng qua
    // privileged client (chỉ dùng cho TEST, không phải luồng nghiệp vụ thật).
    await privileged.stockBalance.updateMany({ where: { tenantId: fixture.tenantA.id, drugId, warehouseId, batchId: null }, data: { quantityOnHand: { decrement: 40 } } });

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/inventory/receipts/${created.body.data.id}/void`)
      .set(authed(clinicAdminToken))
      .send({ version: approved.body.data.version, reason: 'Thử huỷ khi tồn không đủ' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('STOCK_RECEIPT_VOID_NOT_ALLOWED');
  });

  it('Vật tư/thuốc quản lý theo lô — thiếu Số lô → 422', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: true });
    const res = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100 }] });
    expect(res.status).toBe(422);
  });

  it('Loại phiếu chưa hỗ trợ (TRANSFER_IN) → 422', async () => {
    const drugId = await createDrug(clinicAdminToken);
    const res = await createReceipt(clinicAdminToken, { receiptType: 'TRANSFER_IN', supplierId: undefined, lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100, batchNo: 'X', expiryDate: '2027-01-01' }] });
    expect(res.status).toBe(422);
  });

  it('Cảnh báo hạn dùng — lô hết hạn xuất hiện đúng trạng thái EXPIRED', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc test hạn dùng' });
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 10, unitCost: 100, batchNo: `EXP-${randomUUID().slice(0, 6)}`, expiryDate: '2020-01-01' }] });
    await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });

    const res = await request(app.getHttpServer()).get('/api/v1/inventory/expiry-warnings').set(authed(clinicAdminToken)).query({ warehouseId });
    expect(res.status).toBe(200);
    const item = res.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(item.status).toBe('EXPIRED');
    expect(res.body.data.expiredCount).toBeGreaterThanOrEqual(1);
  });

  it('Cảnh báo hạn dùng — tôn trọng ngưỡng expiryWarningDays đã cấu hình (2026-09-17)', async () => {
    // Lô hạn dùng còn 60 ngày — ngoài ngưỡng mặc định 30 ngày nên KHÔNG cảnh báo tới khi tenant tự
    // cấu hình ngưỡng lớn hơn (nối tenant_setting.expiry_warning_days, docs/CURRENT.md mục treo).
    const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc test ngưỡng cảnh báo' });
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 10, unitCost: 100, batchNo: `WARN-${randomUUID().slice(0, 6)}`, expiryDate: in60Days }] });
    await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });

    const beforeRes = await request(app.getHttpServer()).get('/api/v1/inventory/expiry-warnings').set(authed(clinicAdminToken)).query({ warehouseId });
    expect(beforeRes.body.data.items.some((i: { drugId: string }) => i.drugId === drugId)).toBe(false);

    const batchesBefore = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(clinicAdminToken));
    expect(batchesBefore.body.data.items[0].expiryStatus).toBeNull();

    const patch = await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ expiryWarningDays: 90 });
    expect(patch.status).toBe(200);

    const afterRes = await request(app.getHttpServer()).get('/api/v1/inventory/expiry-warnings').set(authed(clinicAdminToken)).query({ warehouseId });
    const item = afterRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(item.status).toBe('EXPIRING_SOON');

    const batchesAfter = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(clinicAdminToken));
    expect(batchesAfter.body.data.items[0].expiryStatus).toBe('EXPIRING_SOON');

    await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ expiryWarningDays: 30 });
  });

  it('quyền chỉ có stock_receipt.create không Duyệt/Từ chối/Huỷ được (403)', async () => {
    // Vai trò tuỳ biến: sao chép clinic_admin nhưng gỡ stock_receipt.approve — tạo qua API roles.
    const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
    const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
    const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));

    const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `Kho-viên e2e ${randomUUID().slice(0, 6)}` });
    const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
      .filter((e) => e.dataScope !== 'none' && !(e.module === 'stock_receipt' && e.action === 'approve'))
      .map((e) => ({ permissionId: e.permissionId, dataScope: e.dataScope }));
    await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });

    const username = `e2e-inv-limited-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: 'Kho viên hạn chế', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: newRole.body.data.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
    const limitedToken = login.body.data.accessToken as string;

    const drugId = await createDrug(clinicAdminToken);
    const created = await createReceipt(limitedToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100, batchNo: 'PERM1', expiryDate: '2027-01-01' }] });
    expect(created.status).toBe(200);

    const approve = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(limitedToken)).send({ version: created.body.data.version });
    expect(approve.status).toBe(403);
  });

  it('cách ly tenant — tenant B không thấy phiếu/tồn/thẻ kho của tenant A', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc tenant A' });
    const created = await createReceipt(clinicAdminToken, { lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100, batchNo: 'ISOL1', expiryDate: '2027-01-01' }] });
    await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });

    const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${created.body.data.id}`).set(authed(tenantBAdminToken));
    expect(getRes.status).toBe(404);

    const ledgerRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(tenantBAdminToken));
    expect(ledgerRes.status).toBe(200);
    expect(ledgerRes.body.data.items).toHaveLength(0);

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(tenantBAdminToken)).query({ warehouseId: tenantBWarehouseId });
    expect(balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId)).toBeUndefined();
  });

  /** Retrofit phân quyền theo Khoa/Phòng cho `stock_receipt` (docs/DECISIONS.md #173, đúng khuôn
   * `stock-count-http.spec.ts` — `StockCountService` là bản gốc của cơ chế này). */
  describe('Phân quyền theo Khoa/Phòng (retrofit #173)', () => {
    let deptAId: string;
    let deptAToken: string;
    let deptAUserId: string;
    let deptAWarehouseId: string;
    let otherWarehouseId: string;

    beforeAll(async () => {
      const deptARes = await request(app.getHttpServer()).post('/api/v1/departments').set(authed(clinicAdminToken)).send({ name: `Khoa Dược e2e ${randomUUID().slice(0, 6)}` });
      deptAId = deptARes.body.data.id as string;

      const whARes = await request(app.getHttpServer()).post('/api/v1/warehouses').set(authed(clinicAdminToken)).send({ name: `Kho Khoa A ${randomUUID().slice(0, 6)}`, departmentId: deptAId });
      deptAWarehouseId = whARes.body.data.id as string;
      // Kho KHÔNG thuộc Khoa Dược — dùng kho mặc định seed sẵn của tenant (không có departmentId).
      otherWarehouseId = warehouseId;

      // Vai trò tuỳ biến: sao chép ma trận clinic_admin nhưng ép CẢ 6 quyền stock_receipt.* về scope
      // `department` (đúng cách clinic_admin tự cấu hình qua "Vai trò & Phân quyền").
      const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
      const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
      const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));
      const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `Kho Khoa e2e ${randomUUID().slice(0, 6)}` });
      const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
        .filter((e) => e.dataScope !== 'none')
        .map((e) => ({ permissionId: e.permissionId, dataScope: e.module === 'stock_receipt' ? 'department' : e.dataScope }));
      await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });

      const username = `e2e-inv-deptA-${randomUUID()}`;
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const user = await privileged.userAccount.create({
        data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: 'Kho viên Khoa A', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: newRole.body.data.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      await privileged.userAccount.update({ where: { id: user.id }, data: { departmentId: deptAId } });

      const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
      deptAToken = login.body.data.accessToken as string;
      deptAUserId = user.id;
    });

    it('tạo phiếu ở đúng kho của Khoa mình — thành công', async () => {
      const drugId = await createDrug(clinicAdminToken);
      const res = await createReceipt(deptAToken, { warehouseId: deptAWarehouseId, lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100, batchNo: 'DEPT1', expiryDate: '2027-01-01' }] });
      expect(res.status).toBe(200);
    });

    it('tạo phiếu ở kho NGOÀI Khoa mình — 404 (không phải 403)', async () => {
      const drugId = await createDrug(clinicAdminToken);
      const res = await createReceipt(deptAToken, { warehouseId: otherWarehouseId, lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100, batchNo: 'DEPT2', expiryDate: '2027-01-01' }] });
      expect(res.status).toBe(404);
    });

    it('xem/duyệt phiếu do clinic_admin (global) tạo ở kho NGOÀI Khoa mình — 404', async () => {
      const drugId = await createDrug(clinicAdminToken);
      const created = await createReceipt(clinicAdminToken, { warehouseId: otherWarehouseId, lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100, batchNo: 'DEPT3', expiryDate: '2027-01-01' }] });
      expect(created.status).toBe(200);

      const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${created.body.data.id}`).set(authed(deptAToken));
      expect(getRes.status).toBe(404);

      const approveRes = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(deptAToken)).send({ version: created.body.data.version });
      expect(approveRes.status).toBe(404);
    });

    it('danh sách chỉ trả phiếu thuộc kho của Khoa mình', async () => {
      const drugId = await createDrug(clinicAdminToken);
      const ownReceipt = await createReceipt(deptAToken, { warehouseId: deptAWarehouseId, lines: [{ drugId, unitCode: 'VIEN', quantity: 1, unitCost: 100, batchNo: 'DEPT4', expiryDate: '2027-01-01' }] });
      const otherReceipt = await createReceipt(clinicAdminToken, { warehouseId: otherWarehouseId, lines: [{ drugId, unitCode: 'VIEN', quantity: 1, unitCost: 100, batchNo: 'DEPT5', expiryDate: '2027-01-01' }] });

      const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/receipts').set(authed(deptAToken));
      const ids = (listRes.body.data.items as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(ownReceipt.body.data.id);
      expect(ids).not.toContain(otherReceipt.body.data.id);
    });

    it('tự Duyệt được phiếu ở đúng Khoa mình — cộng đúng tồn', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc test Khoa A' });
      const created = await createReceipt(deptAToken, { warehouseId: deptAWarehouseId, lines: [{ drugId, unitCode: 'VIEN', quantity: 9, unitCost: 100, batchNo: 'DEPT6', expiryDate: '2027-01-01' }] });
      const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(deptAToken)).send({ version: created.body.data.version });
      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe('POSTED');

      const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId: deptAWarehouseId });
      const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
      expect(row.quantityOnHand).toBe(9);
    });

    it('actor scope department nhưng CHƯA gán Khoa/Phòng → danh sách rỗng, không lỗi', async () => {
      await privileged.userAccount.update({ where: { id: deptAUserId }, data: { departmentId: null } });
      const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/receipts').set(authed(deptAToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.items).toEqual([]);
      // Khôi phục lại Khoa cho các test khác trong cùng file (nếu describe block chạy tuần tự sau đây).
      await privileged.userAccount.update({ where: { id: deptAUserId }, data: { departmentId: deptAId } });
    });
  });

  /** "Phiếu nhập kho mở rộng" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — loại phiếu `RETURN_FROM_USE`
   * (đúng khuôn PURCHASE/OPENING_BALANCE, không cột đặc thù) + Chiết khấu 2 mode `TOTAL`/`PER_LINE`,
   * chỉ áp cho `receiptType='PURCHASE'`. Xem handoff HANDOFF-KhoThuoc-GD4-Phan3-4-5-2026-09-23.md. */
  describe('Phiếu nhập kho mở rộng — RETURN_FROM_USE + Chiết khấu (docs/DECISIONS.md #170)', () => {
    it('tạo + duyệt + huỷ phiếu RETURN_FROM_USE — hồi quy listForSourceReceipt() đảo đúng tồn', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc hoàn trả từ sử dụng' });
      const created = await createReceipt(clinicAdminToken, {
        receiptType: 'RETURN_FROM_USE',
        supplierId: undefined,
        lines: [{ drugId, unitCode: 'VIEN', quantity: 20, unitCost: 400, batchNo: `RFU-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' }],
      });
      expect(created.status).toBe(200);
      expect(created.body.data.supplierId).toBeNull();

      const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
      expect(approved.status).toBe(200);

      const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
      expect(balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId).quantityOnHand).toBe(20);

      const ledgerRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(clinicAdminToken));
      expect(ledgerRes.body.data.items[0]).toMatchObject({ quantityChange: 20, reason: 'RECEIPT_RETURN_FROM_USE', runningBalance: 20 });

      // Hồi quy: TRƯỚC khi sửa `listForSourceReceipt()`, RECEIPT_RETURN_FROM_USE không nằm trong
      // danh sách reason được đảo ngược → huỷ phiếu ÂM THẦM không hoàn tồn (tồn vẫn giữ nguyên 20
      // thay vì về 0). Nếu bug tái diễn, dòng `expect(row.quantityOnHand).toBe(0)` bên dưới sẽ fail.
      const voided = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${created.body.data.id}/void`)
        .set(authed(clinicAdminToken))
        .send({ version: approved.body.data.version, reason: 'Ghi nhầm phiếu hoàn trả' });
      expect(voided.status).toBe(200);

      const balanceAfterVoid = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
      const row = balanceAfterVoid.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
      expect(row === undefined || row.quantityOnHand === 0).toBe(true);
    });

    it('Chiết khấu "Toàn phiếu" (TOTAL) — thành tiền tính đúng ở cả list và detail', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc chiết khấu toàn phiếu' });
      // Tổng tiền hàng = 100 × 1000 = 100_000 → chiết khấu 10% = 10_000 → thành tiền = 90_000.
      const created = await createReceipt(clinicAdminToken, {
        discountType: 'PERCENT',
        discountValue: 10,
        discountReason: 'Chiết khấu theo hợp đồng NCC',
        lines: [{ drugId, unitCode: 'VIEN', quantity: 100, unitCost: 1000, batchNo: `DISC1-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' }],
      });
      expect(created.status).toBe(200);
      expect(created.body.data.totalAmount).toBe(100_000);
      expect(created.body.data.discountMode).toBe('TOTAL');
      expect(created.body.data.discountAmount).toBe(10_000);
      expect(created.body.data.netAmount).toBe(90_000);

      const detailRes = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${created.body.data.id}`).set(authed(clinicAdminToken));
      expect(detailRes.body.data.discountAmount).toBe(10_000);
      expect(detailRes.body.data.netAmount).toBe(90_000);

      const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/receipts').set(authed(clinicAdminToken)).query({ warehouseId });
      const listRow = listRes.body.data.items.find((i: { id: string }) => i.id === created.body.data.id);
      expect(listRow.discountType).toBe('PERCENT');
      expect(listRow.discountValue).toBe(10);
    });

    it('Chiết khấu "Từng dòng" (PER_LINE) — mỗi dòng chiết khấu riêng, tổng khớp', async () => {
      const drugA = await createDrug(clinicAdminToken, { name: 'Thuốc chiết khấu dòng A' });
      const drugB = await createDrug(clinicAdminToken, { name: 'Thuốc chiết khấu dòng B' });
      // Dòng A: 10 × 1000 = 10_000, chiết khấu AMOUNT 1_000 → còn 9_000.
      // Dòng B: 5 × 2000 = 10_000, chiết khấu PERCENT 20% = 2_000 → còn 8_000.
      // Tổng tiền hàng = 20_000, tổng chiết khấu = 3_000, thành tiền = 17_000.
      const created = await createReceipt(clinicAdminToken, {
        lines: [
          { drugId: drugA, unitCode: 'VIEN', quantity: 10, unitCost: 1000, batchNo: `DISC2A-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01', discountType: 'AMOUNT', discountValue: 1000 },
          { drugId: drugB, unitCode: 'VIEN', quantity: 5, unitCost: 2000, batchNo: `DISC2B-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01', discountType: 'PERCENT', discountValue: 20 },
        ],
      });
      expect(created.status).toBe(200);
      expect(created.body.data.totalAmount).toBe(20_000);
      expect(created.body.data.discountMode).toBe('PER_LINE');
      expect(created.body.data.discountAmount).toBe(3_000);
      expect(created.body.data.netAmount).toBe(17_000);

      const lineA = created.body.data.lines.find((l: { drugId: string }) => l.drugId === drugA);
      const lineB = created.body.data.lines.find((l: { drugId: string }) => l.drugId === drugB);
      expect(lineA.discountAmount).toBe(1000);
      expect(lineB.discountAmount).toBe(2000);
    });

    it('Chiết khấu trên loại phiếu KHÁC PURCHASE → 400', async () => {
      const drugId = await createDrug(clinicAdminToken);
      const res = await createReceipt(clinicAdminToken, {
        receiptType: 'OPENING_BALANCE',
        supplierId: undefined,
        discountType: 'PERCENT',
        discountValue: 10,
        discountReason: 'Không hợp lệ',
        lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100 }],
      });
      expect(res.status).toBe(400);
    });

    it('Đặt cả chiết khấu Toàn phiếu VÀ Từng dòng cùng lúc → 400 (loại trừ nhau)', async () => {
      const drugId = await createDrug(clinicAdminToken);
      const res = await createReceipt(clinicAdminToken, {
        discountType: 'PERCENT',
        discountValue: 10,
        discountReason: 'Toàn phiếu',
        lines: [{ drugId, unitCode: 'VIEN', quantity: 5, unitCost: 100, batchNo: 'MIX1', expiryDate: '2027-01-01', discountType: 'AMOUNT', discountValue: 50 }],
      });
      expect(res.status).toBe(400);
    });
  });
});
