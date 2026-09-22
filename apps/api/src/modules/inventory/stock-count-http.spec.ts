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
 * HTTP e2e cho "Kiểm kê" — Kho Thuốc & Vật tư y tế Giai đoạn 4 (docs/DECISIONS.md #170, kế hoạch
 * kỹ thuật bright-bubbling-axolotl.md). Bao phủ luồng Nháp → Duyệt/Từ chối, đọc lại tồn kho SỐNG
 * lúc Duyệt để tự sinh Phiếu nhập (dư)/Phiếu xuất (thiếu), cách ly tenant, permission, và phân
 * quyền theo Khoa/Phòng (kiến trúc mục 0).
 */
describe('HTTP e2e — /api/v1/inventory/counts (Kiểm kê kho GĐ4)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let warehouseId: string;
  let tenantBWarehouseId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-count-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createDrug(token: string, overrides: Partial<{ name: string; isBatchManaged: boolean }> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(token))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: overrides.name ?? 'Paracetamol 500mg',
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
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
        units: [],
        ...(overrides.isBatchManaged !== undefined ? { isBatchManaged: overrides.isBatchManaged } : {}),
      });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  async function createAndApproveReceipt(token: string, wh: string, drugId: string, quantity: number, unitCost: number, batchNo?: string) {
    const created = await request(app.getHttpServer())
      .post('/api/v1/inventory/receipts')
      .set(authed(token))
      .send({
        warehouseId: wh,
        receiptType: 'OPENING_BALANCE',
        lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost, batchNo, expiryDate: batchNo ? '2028-01-01' : undefined }],
      });
    expect(created.status).toBe(200);
    const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(token)).send({ version: created.body.data.version });
    expect(approved.status).toBe(200);
    return approved.body.data;
  }

  async function getWarehouseBatchId(token: string, drugId: string, wh: string): Promise<string> {
    const res = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(token)).query({ warehouseId: wh });
    return res.body.data.items[0].batchId as string;
  }

  async function createCount(token: string, wh: string, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/inventory/counts')
      .set(authed(token))
      .send({ warehouseId: wh, lines: [], ...overrides });
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

    fixture = await createTwoTenantFixture(privileged, 'StockCount e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    const warehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    warehouseId = warehousesRes.body.data.items[0].id;
    const tenantBWarehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(tenantBAdminToken));
    tenantBWarehouseId = tenantBWarehousesRes.body.data.items[0].id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/counts');
    expect(res.status).toBe(401);
  });

  it('lễ tân (không có quyền stock_count) → 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/counts').set(authed(receptionistToken));
    expect(res.status).toBe(403);
  });

  it('tạo phiếu Nháp — chưa đụng tồn kho', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Ibuprofen 400mg', isBatchManaged: false });
    const res = await createCount(clinicAdminToken, warehouseId, {
      lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 10 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0].difference).toBeNull();

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    expect(balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId)).toBeUndefined();
  });

  it('sửa Nháp — thay đúng dòng đếm mới', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 5 }] });
    const id = created.body.data.id;

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/inventory/counts/${id}`)
      .set(authed(clinicAdminToken))
      .send({ warehouseId, version: created.body.data.version, lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 8 }] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.lines).toHaveLength(1);
    expect(updated.body.data.lines[0].countedQuantity).toBe(8);
  });

  it('Duyệt — dòng DƯ (không quản lý theo lô) tự sinh StockReceipt COUNT_SURPLUS, cộng đúng tồn', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Vitamin C 500mg', isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, warehouseId, drugId, 50, 1000);

    // Đếm thực tế 56 — tồn sống lúc thêm dòng là 50, nhưng KHÔNG dùng số này để tính (chỉ tham khảo).
    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 50, countedQuantity: 56 }] });
    expect(created.status).toBe(200);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/inventory/counts/${created.body.data.id}/approve`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Kiểm đếm định kỳ, phát hiện dư 6' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('POSTED');
    expect(approved.body.data.lines[0].difference).toBe(6);
    expect(approved.body.data.approvalReason).toBe('Kiểm đếm định kỳ, phát hiện dư 6');

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row.quantityOnHand).toBe(56);

    const ledgerRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(clinicAdminToken));
    const surplusEntry = ledgerRes.body.data.items.find((e: { reason: string }) => e.reason === 'RECEIPT_COUNT_SURPLUS');
    expect(surplusEntry).toMatchObject({ quantityChange: 6, runningBalance: 56 });

    const receiptsRes = await request(app.getHttpServer()).get('/api/v1/inventory/receipts').set(authed(clinicAdminToken)).query({ receiptType: 'COUNT_SURPLUS' });
    expect(receiptsRes.body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('Duyệt — dòng THIẾU (có quản lý theo lô) tự sinh StockIssue COUNT_SHORTAGE, trừ đúng tồn', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Amoxicillin 500mg', isBatchManaged: true });
    const batchNo = `LOT-${randomUUID().slice(0, 6)}`;
    await createAndApproveReceipt(clinicAdminToken, warehouseId, drugId, 200, 500, batchNo);
    const batchId = await getWarehouseBatchId(clinicAdminToken, drugId, warehouseId);

    // Đếm thực tế 195 — thiếu 5 so với tồn sống 200.
    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, batchId, systemQuantitySnapshot: 200, countedQuantity: 195 }] });
    expect(created.status).toBe(200);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/inventory/counts/${created.body.data.id}/approve`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Kiểm đếm định kỳ, phát hiện thiếu 5' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.lines[0].difference).toBe(-5);

    const batchesRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(clinicAdminToken)).query({ warehouseId });
    expect(batchesRes.body.data.items[0].quantityOnHand).toBe(195);

    const ledgerRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(clinicAdminToken));
    const shortageEntry = ledgerRes.body.data.items.find((e: { reason: string }) => e.reason === 'ISSUE_COUNT_SHORTAGE');
    expect(shortageEntry).toMatchObject({ quantityChange: -5, runningBalance: 195 });

    const issuesRes = await request(app.getHttpServer()).get('/api/v1/inventory/issues').set(authed(clinicAdminToken)).query({ issueType: 'COUNT_SHORTAGE' });
    expect(issuesRes.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(issuesRes.body.data.items[0].patientFullName).toBeNull();
  });

  it('Duyệt — dòng khớp đúng tồn sống thì không sinh phiếu nào, difference=0', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, warehouseId, drugId, 30, 1000);

    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 30, countedQuantity: 30 }] });
    // KHÔNG kèm `reason` — phiếu khớp hoàn toàn thì không bắt buộc (docs/DECISIONS.md #171).
    const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/counts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(approved.status).toBe(200);
    expect(approved.body.data.lines[0].difference).toBe(0);
    expect(approved.body.data.approvalReason).toBeNull();

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row.quantityOnHand).toBe(30);
  });

  it('Duyệt CÓ chênh lệch mà KHÔNG kèm lý do → 422, kèm lý do → 200 (docs/DECISIONS.md #171)', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 4 }] });

    const withoutReason = await request(app.getHttpServer()).post(`/api/v1/inventory/counts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(withoutReason.status).toBe(422);
    expect(withoutReason.body.error.code).toBe('STOCK_COUNT_APPROVAL_REASON_REQUIRED');

    // Phiếu vẫn còn DRAFT sau lần từ chối (transaction rollback đầy đủ, kể cả bước lật trạng thái).
    const stillDraft = await request(app.getHttpServer()).get(`/api/v1/inventory/counts/${created.body.data.id}`).set(authed(clinicAdminToken));
    expect(stillDraft.body.data.status).toBe('DRAFT');

    const withReason = await request(app.getHttpServer())
      .post(`/api/v1/inventory/counts/${created.body.data.id}/approve`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Kiểm đếm định kỳ, thuốc để lẫn ngăn khác' });
    expect(withReason.status).toBe(200);
    expect(withReason.body.data.approvalReason).toBe('Kiểm đếm định kỳ, thuốc để lẫn ngăn khác');
  });

  it('Duyệt — đọc lại tồn SỐNG tại thời điểm Duyệt, không dùng snapshot cũ lúc thêm dòng', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, warehouseId, drugId, 10, 1000);

    // Tạo phiếu kiểm kê với snapshot=10 (đúng lúc thêm dòng), đếm=10 (tưởng khớp).
    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 10, countedQuantity: 10 }] });

    // Trước khi Duyệt, có giao dịch KHÁC làm tồn thay đổi (nhập thêm 5) — snapshot cũ (10) giờ sai.
    await createAndApproveReceipt(clinicAdminToken, warehouseId, drugId, 5, 1000);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/inventory/counts/${created.body.data.id}/approve`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Đối chiếu lại — tồn sống đổi so với lúc đếm' });
    expect(approved.status).toBe(200);
    // Tồn sống lúc Duyệt là 15 (10+5), đếm 10 → thiếu 5 — KHÔNG phải khớp như khi thêm dòng.
    expect(approved.body.data.lines[0].difference).toBe(-5);

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row.quantityOnHand).toBe(10);
  });

  it('Duyệt trùng (2 request đồng thời) — chỉ 1 thành công', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 3 }] });
    const id = created.body.data.id;
    const version = created.body.data.version;

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/inventory/counts/${id}/approve`).set(authed(clinicAdminToken)).send({ version, reason: 'Kiểm đếm định kỳ' }),
      request(app.getHttpServer()).post(`/api/v1/inventory/counts/${id}/approve`).set(authed(clinicAdminToken)).send({ version, reason: 'Kiểm đếm định kỳ' }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('Từ chối phiếu Nháp — bắt buộc lý do, không đụng tồn', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 5 }] });
    const id = created.body.data.id;

    const missingReason = await request(app.getHttpServer()).post(`/api/v1/inventory/counts/${id}/reject`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(missingReason.status).toBe(400);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/inventory/counts/${id}/reject`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Đếm nhầm, cần đếm lại' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    expect(balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId)).toBeUndefined();

    const approveAfterReject = await request(app.getHttpServer()).post(`/api/v1/inventory/counts/${id}/approve`).set(authed(clinicAdminToken)).send({ version: rejected.body.data.version });
    expect(approveAfterReject.status).toBe(409);
    expect(approveAfterReject.body.error.code).toBe('STOCK_COUNT_NOT_DRAFT');
  });

  it('Thuốc quản lý theo lô — thiếu cả batchId lẫn newBatchNo → 422', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: true });
    const res = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 5 }] });
    expect(res.status).toBe(422);
  });

  it('Thuốc quản lý theo lô — lô hoàn toàn MỚI (chưa từng có) → thêm được, Duyệt tự tạo lô + sinh dư đúng số đếm', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Cephalexin 500mg', isBatchManaged: true });
    const newBatchNo = `NEW-${randomUUID().slice(0, 6)}`;
    const created = await createCount(clinicAdminToken, warehouseId, {
      lines: [{ drugId, newBatchNo, newBatchExpiryDate: '2028-06-01', systemQuantitySnapshot: 0, countedQuantity: 12 }],
    });
    expect(created.status).toBe(200);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/inventory/counts/${created.body.data.id}/approve`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Phát hiện lô mới chưa từng nhập vào hệ thống' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.lines[0].difference).toBe(12);

    const batchesRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(clinicAdminToken)).query({ warehouseId });
    expect(batchesRes.body.data.items).toHaveLength(1);
    expect(batchesRes.body.data.items[0].batchNo).toBe(newBatchNo);
    expect(batchesRes.body.data.items[0].quantityOnHand).toBe(12);
  });

  it('cách ly tenant — tenant B không thấy phiếu kiểm kê của tenant A', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc tenant A kiểm kê', isBatchManaged: false });
    const created = await createCount(clinicAdminToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 5 }] });
    await request(app.getHttpServer())
      .post(`/api/v1/inventory/counts/${created.body.data.id}/approve`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Kiểm đếm định kỳ' });

    const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/counts/${created.body.data.id}`).set(authed(tenantBAdminToken));
    expect(getRes.status).toBe(404);

    const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/counts').set(authed(tenantBAdminToken)).query({ warehouseId: tenantBWarehouseId });
    expect(listRes.body.data.items.find((i: { id: string }) => i.id === created.body.data.id)).toBeUndefined();
  });

  it('quyền chỉ có stock_count.create không Duyệt/Từ chối được (403)', async () => {
    const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
    const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
    const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));

    const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `Kho-viên kiểm kê e2e ${randomUUID().slice(0, 6)}` });
    const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
      .filter((e) => e.dataScope !== 'none' && !(e.module === 'stock_count' && e.action === 'approve'))
      .map((e) => ({ permissionId: e.permissionId, dataScope: e.dataScope }));
    await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });

    const username = `e2e-count-limited-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: 'Kho viên hạn chế kiểm kê', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: newRole.body.data.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
    const limitedToken = login.body.data.accessToken as string;

    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    const created = await createCount(limitedToken, warehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 5 }] });
    expect(created.status).toBe(200);

    const approve = await request(app.getHttpServer()).post(`/api/v1/inventory/counts/${created.body.data.id}/approve`).set(authed(limitedToken)).send({ version: created.body.data.version });
    expect(approve.status).toBe(403);
  });

  describe('Phân quyền theo Khoa/Phòng (kiến trúc mục 0, docs/DECISIONS.md #170)', () => {
    let deptAToken: string;
    let deptAUserId: string;
    let deptAWarehouseId: string;
    let otherWarehouseId: string;

    beforeAll(async () => {
      const deptARes = await request(app.getHttpServer()).post('/api/v1/departments').set(authed(clinicAdminToken)).send({ name: `Khoa Dược e2e ${randomUUID().slice(0, 6)}` });
      const deptAId = deptARes.body.data.id as string;

      const whARes = await request(app.getHttpServer()).post('/api/v1/warehouses').set(authed(clinicAdminToken)).send({ name: `Kho Khoa A ${randomUUID().slice(0, 6)}`, departmentId: deptAId });
      deptAWarehouseId = whARes.body.data.id as string;
      // Kho KHÔNG thuộc Khoa Dược — dùng kho mặc định seed sẵn của tenant (không có departmentId).
      otherWarehouseId = warehouseId;

      // Vai trò tuỳ biến: sao chép ma trận clinic_admin nhưng ép CẢ 3 quyền stock_count.* về scope
      // `department` (đúng cách clinic_admin tự cấu hình qua "Vai trò & Phân quyền", UI generic đã
      // hỗ trợ sẵn từ ADM-07 #057 — không cần sửa gì thêm ở đó).
      const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
      const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
      const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));
      const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `Dược Khoa e2e ${randomUUID().slice(0, 6)}` });
      const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
        .filter((e) => e.dataScope !== 'none')
        .map((e) => ({ permissionId: e.permissionId, dataScope: e.module === 'stock_count' ? 'department' : e.dataScope }));
      await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });

      const created = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
      // Gán ĐÚNG vai trò tuỳ biến (thay clinic_admin mặc định) + Khoa Dược — dùng privileged client
      // vì đây là thiết lập dữ liệu test, không phải luồng nghiệp vụ thật đang kiểm.
      await privileged.userRole.deleteMany({ where: { tenantId: fixture.tenantA.id, userId: created.userId } });
      await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: created.userId, roleId: newRole.body.data.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      await privileged.userAccount.update({ where: { id: created.userId }, data: { departmentId: deptAId } });

      const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username: (await privileged.userAccount.findUniqueOrThrow({ where: { id: created.userId } })).username, password });
      deptAToken = login.body.data.accessToken as string;
      deptAUserId = created.userId;
    });

    it('tạo phiếu ở đúng kho của Khoa mình — thành công', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      const res = await createCount(deptAToken, deptAWarehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 3 }] });
      expect(res.status).toBe(200);
    });

    it('tạo phiếu ở kho NGOÀI Khoa mình — 404 (không phải 403)', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      const res = await createCount(deptAToken, otherWarehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 3 }] });
      expect(res.status).toBe(404);
    });

    it('xem/duyệt phiếu do clinic_admin (global) tạo ở kho NGOÀI Khoa mình — 404', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      const created = await createCount(clinicAdminToken, otherWarehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 3 }] });
      expect(created.status).toBe(200);

      const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/counts/${created.body.data.id}`).set(authed(deptAToken));
      expect(getRes.status).toBe(404);

      const approveRes = await request(app.getHttpServer()).post(`/api/v1/inventory/counts/${created.body.data.id}/approve`).set(authed(deptAToken)).send({ version: created.body.data.version });
      expect(approveRes.status).toBe(404);
    });

    it('danh sách chỉ trả phiếu thuộc kho của Khoa mình', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      const ownCount = await createCount(deptAToken, deptAWarehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 1 }] });
      const otherCount = await createCount(clinicAdminToken, otherWarehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 1 }] });

      const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/counts').set(authed(deptAToken));
      const ids = (listRes.body.data.items as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(ownCount.body.data.id);
      expect(ids).not.toContain(otherCount.body.data.id);
    });

    it('tự Duyệt được phiếu ở đúng Khoa mình — tự sinh dư/thiếu bình thường', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      const created = await createCount(deptAToken, deptAWarehouseId, { lines: [{ drugId, systemQuantitySnapshot: 0, countedQuantity: 7 }] });
      const approved = await request(app.getHttpServer())
        .post(`/api/v1/inventory/counts/${created.body.data.id}/approve`)
        .set(authed(deptAToken))
        .send({ version: created.body.data.version, reason: 'Kiểm đếm định kỳ' });
      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe('POSTED');

      const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId: deptAWarehouseId });
      const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
      expect(row.quantityOnHand).toBe(7);
    });

    it('actor scope department nhưng CHƯA gán Khoa/Phòng → danh sách rỗng, không lỗi', async () => {
      await privileged.userAccount.update({ where: { id: deptAUserId }, data: { departmentId: null } });
      const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/counts').set(authed(deptAToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.items).toEqual([]);
      // Khôi phục lại Khoa cho các test khác trong cùng file (nếu describe block chạy tuần tự sau đây).
      await privileged.userAccount.update({ where: { id: deptAUserId }, data: { departmentId: (await privileged.warehouse.findUniqueOrThrow({ where: { id: deptAWarehouseId } })).departmentId } });
    });
  });
});
