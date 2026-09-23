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
 * HTTP e2e cho "Điều chuyển kho" — Kho Thuốc & Vật tư y tế Giai đoạn 4 (docs/DECISIONS.md #170, kế
 * hoạch kỹ thuật bright-bubbling-axolotl.md, mockup đã duyệt). Bao phủ luồng Nháp → Duyệt xuất
 * (trừ tồn kho nguồn NGAY, sinh StockIssue TRANSFER_OUT) → Xác nhận nhận hàng (cộng tồn kho đích
 * đúng SL THỰC NHẬN, sinh StockReceipt TRANSFER_IN) / Từ chối, cách ly tenant, permission, và phân
 * quyền theo Khoa/Phòng (kiến trúc mục 0 — kiểm ĐÚNG kho của từng bước).
 */
describe('HTTP e2e — /api/v1/inventory/transfers (Điều chuyển kho GĐ4)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let fromWarehouseId: string;
  let toWarehouseId: string;
  let tenantBWarehouseId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-transfer-${roleName}-${randomUUID()}`;
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

  async function getBalance(token: string, wh: string, drugId: string): Promise<number> {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(token)).query({ warehouseId: wh });
    const row = (res.body.data.items as { drugId: string; quantityOnHand: number }[]).find((i) => i.drugId === drugId);
    return row?.quantityOnHand ?? 0;
  }

  function createTransfer(token: string, fromWh: string, toWh: string, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/inventory/transfers')
      .set(authed(token))
      .send({ fromWarehouseId: fromWh, toWarehouseId: toWh, lines: [], ...overrides });
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

    fixture = await createTwoTenantFixture(privileged, 'StockTransfer e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    const warehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    fromWarehouseId = warehousesRes.body.data.items[0].id;
    const toWhRes = await request(app.getHttpServer()).post('/api/v1/warehouses').set(authed(clinicAdminToken)).send({ name: `Kho đích e2e ${randomUUID().slice(0, 6)}` });
    toWarehouseId = toWhRes.body.data.id;

    const tenantBWarehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(tenantBAdminToken));
    tenantBWarehouseId = tenantBWarehousesRes.body.data.items[0].id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/transfers');
    expect(res.status).toBe(401);
  });

  it('lễ tân (không có quyền stock_transfer) → 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/transfers').set(authed(receptionistToken));
    expect(res.status).toBe(403);
  });

  it('kho nguồn và kho đích trùng nhau → 400', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    const res = await createTransfer(clinicAdminToken, fromWarehouseId, fromWarehouseId, { lines: [{ drugId, quantityShipped: 1 }] });
    expect(res.status).toBe(400);
  });

  it('tạo phiếu Nháp — chưa đụng tồn kho', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Ibuprofen 400mg', isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 100, 1000);

    const res = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 20 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0].quantityReceived).toBeNull();

    expect(await getBalance(clinicAdminToken, fromWarehouseId, drugId)).toBe(100);
    expect(await getBalance(clinicAdminToken, toWarehouseId, drugId)).toBe(0);
  });

  it('sửa Nháp — thay đúng dòng hàng mới', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 50, 1000);
    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 5 }] });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/inventory/transfers/${created.body.data.id}`)
      .set(authed(clinicAdminToken))
      .send({ fromWarehouseId, toWarehouseId, version: created.body.data.version, lines: [{ drugId, quantityShipped: 8 }] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.lines[0].quantityShipped).toBe(8);
  });

  it('Duyệt xuất — trừ đúng tồn kho nguồn NGAY, sinh StockIssue TRANSFER_OUT, chuyển IN_TRANSIT', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Vitamin C 500mg', isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 60, 1000);

    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 25 }] });
    const shipped = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(shipped.status).toBe(200);
    expect(shipped.body.data.status).toBe('IN_TRANSIT');
    expect(shipped.body.data.shippedByName).toBeTruthy();

    expect(await getBalance(clinicAdminToken, fromWarehouseId, drugId)).toBe(35);
    // Kho đích CHƯA cộng gì — chỉ cộng lúc Xác nhận nhận hàng.
    expect(await getBalance(clinicAdminToken, toWarehouseId, drugId)).toBe(0);

    const issuesRes = await request(app.getHttpServer()).get('/api/v1/inventory/issues').set(authed(clinicAdminToken)).query({ warehouseId: fromWarehouseId, issueType: 'TRANSFER_OUT' });
    expect(issuesRes.body.data.items.length).toBeGreaterThanOrEqual(1);

    const ledgerRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(clinicAdminToken)).query({ warehouseId: fromWarehouseId });
    const transferOutEntry = ledgerRes.body.data.items.find((e: { reason: string }) => e.reason === 'ISSUE_TRANSFER_OUT');
    expect(transferOutEntry).toMatchObject({ quantityChange: -25, runningBalance: 35 });
  });

  it('Duyệt xuất khi không đủ tồn kho nguồn → 422, phiếu vẫn DRAFT, không đụng tồn', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 10, 1000);

    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 999 }] });
    const shipped = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(shipped.status).toBe(422);
    expect(shipped.body.error.code).toBe('STOCK_TRANSFER_INSUFFICIENT_STOCK');

    const stillDraft = await request(app.getHttpServer()).get(`/api/v1/inventory/transfers/${created.body.data.id}`).set(authed(clinicAdminToken));
    expect(stillDraft.body.data.status).toBe('DRAFT');
    expect(await getBalance(clinicAdminToken, fromWarehouseId, drugId)).toBe(10);
  });

  it('Xác nhận nhận hàng ĐỦ số — cộng đúng tồn kho đích, sinh StockReceipt TRANSFER_IN, chuyển COMPLETED', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Amoxicillin 500mg', isBatchManaged: true });
    const batchNo = `LOT-${randomUUID().slice(0, 6)}`;
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 200, 500, batchNo);
    const batchId = await getWarehouseBatchId(clinicAdminToken, drugId, fromWarehouseId);

    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, batchId, quantityShipped: 50 }] });
    const shipped = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    const lineId = shipped.body.data.lines[0].id;

    const received = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${created.body.data.id}/receive`)
      .set(authed(clinicAdminToken))
      .send({ version: shipped.body.data.version, lines: [{ lineId, quantityReceived: 50 }] });
    expect(received.status).toBe(200);
    expect(received.body.data.status).toBe('COMPLETED');
    expect(received.body.data.lines[0].quantityReceived).toBe(50);
    expect(received.body.data.lines[0].varianceNote).toBeNull();
    expect(received.body.data.receivedByName).toBeTruthy();

    expect(await getBalance(clinicAdminToken, toWarehouseId, drugId)).toBe(50);

    const receiptsRes = await request(app.getHttpServer()).get('/api/v1/inventory/receipts').set(authed(clinicAdminToken)).query({ warehouseId: toWarehouseId, receiptType: 'TRANSFER_IN' });
    expect(receiptsRes.body.data.items.length).toBeGreaterThanOrEqual(1);

    // Lô mới tại kho đích kế thừa ĐÚNG batchNo/giá vốn từ lô gốc bên kho nguồn (find-or-create).
    const destBatchesRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(clinicAdminToken)).query({ warehouseId: toWarehouseId });
    expect(destBatchesRes.body.data.items[0]).toMatchObject({ batchNo, unitCost: 500, quantityOnHand: 50 });
  });

  it('Xác nhận nhận hàng THIẾU không kèm ghi chú chênh lệch → 422', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 40, 1000);
    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 30 }] });
    const shipped = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    const lineId = shipped.body.data.lines[0].id;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${created.body.data.id}/receive`)
      .set(authed(clinicAdminToken))
      .send({ version: shipped.body.data.version, lines: [{ lineId, quantityReceived: 25 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STOCK_TRANSFER_VARIANCE_NOTE_REQUIRED');

    // Vẫn IN_TRANSIT, kho đích chưa cộng gì (transaction rollback đầy đủ).
    const stillInTransit = await request(app.getHttpServer()).get(`/api/v1/inventory/transfers/${created.body.data.id}`).set(authed(clinicAdminToken));
    expect(stillInTransit.body.data.status).toBe('IN_TRANSIT');
    expect(await getBalance(clinicAdminToken, toWarehouseId, drugId)).toBe(0);
  });

  it('Xác nhận nhận hàng THẤP hơn số đã xuất, kèm ghi chú → 200, cộng đúng số thực nhận', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 40, 1000);
    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 30 }] });
    const shipped = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    const lineId = shipped.body.data.lines[0].id;

    const received = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${created.body.data.id}/receive`)
      .set(authed(clinicAdminToken))
      .send({ version: shipped.body.data.version, lines: [{ lineId, quantityReceived: 25, varianceNote: 'Vỡ 5 vỉ lúc vận chuyển' }] });
    expect(received.status).toBe(200);
    expect(received.body.data.lines[0]).toMatchObject({ quantityReceived: 25, varianceNote: 'Vỡ 5 vỉ lúc vận chuyển' });
    expect(await getBalance(clinicAdminToken, toWarehouseId, drugId)).toBe(25);
    // Kho nguồn KHÔNG đảo ngược phần chênh lệch — đã trừ đúng 30 lúc Duyệt xuất, giữ nguyên.
    expect(await getBalance(clinicAdminToken, fromWarehouseId, drugId)).toBe(10);
  });

  it('Xác nhận nhận hàng NHIỀU hơn số đã xuất → 422, chặn cứng', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 40, 1000);
    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 30 }] });
    const shipped = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    const lineId = shipped.body.data.lines[0].id;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${created.body.data.id}/receive`)
      .set(authed(clinicAdminToken))
      .send({ version: shipped.body.data.version, lines: [{ lineId, quantityReceived: 31 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STOCK_TRANSFER_RECEIVED_EXCEEDS_SHIPPED');
  });

  it('Xác nhận nhận hàng khi phiếu chưa Duyệt xuất (còn DRAFT) → 409 STOCK_TRANSFER_NOT_IN_TRANSIT', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 1 }] });
    // Service kiểm trạng thái TRƯỚC khi đối chiếu từng dòng — `lineId` giả (chưa từng tồn tại) vẫn
    // phải rơi đúng vào nhánh 409 này, không phải 404/422 do không khớp dòng.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${created.body.data.id}/receive`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, lines: [{ lineId: randomUUID(), quantityReceived: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STOCK_TRANSFER_NOT_IN_TRANSIT');
  });

  it('Duyệt xuất trùng (2 request đồng thời) — chỉ 1 thành công', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 100, 1000);
    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 5 }] });
    const id = created.body.data.id;
    const version = created.body.data.version;

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${id}/ship`).set(authed(clinicAdminToken)).send({ version }),
      request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${id}/ship`).set(authed(clinicAdminToken)).send({ version }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('Từ chối phiếu Nháp — bắt buộc lý do, không đụng tồn; Duyệt lại sau khi Từ chối → 409', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 20, 1000);
    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 5 }] });
    const id = created.body.data.id;

    const missingReason = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${id}/reject`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(missingReason.status).toBe(400);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${id}/reject`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, reason: 'Lập nhầm kho đích' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(await getBalance(clinicAdminToken, fromWarehouseId, drugId)).toBe(20);

    const shipAfterReject = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${id}/ship`).set(authed(clinicAdminToken)).send({ version: rejected.body.data.version });
    expect(shipAfterReject.status).toBe(409);
    expect(shipAfterReject.body.error.code).toBe('STOCK_TRANSFER_NOT_DRAFT');
  });

  it('Thuốc quản lý theo lô — thiếu batchId → 422', async () => {
    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: true });
    const res = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 5 }] });
    expect(res.status).toBe(422);
  });

  it('cách ly tenant — tenant B không thấy phiếu điều chuyển của tenant A', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc tenant A điều chuyển', isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 10, 1000);
    const created = await createTransfer(clinicAdminToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 3 }] });

    const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/transfers/${created.body.data.id}`).set(authed(tenantBAdminToken));
    expect(getRes.status).toBe(404);

    const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/transfers').set(authed(tenantBAdminToken)).query({ fromWarehouseId: tenantBWarehouseId });
    expect(listRes.body.data.items.find((i: { id: string }) => i.id === created.body.data.id)).toBeUndefined();
  });

  it('quyền chỉ có stock_transfer.create không Duyệt xuất/Từ chối/Xác nhận nhận hàng được (403)', async () => {
    const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
    const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
    const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));

    const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `Kho-viên điều chuyển e2e ${randomUUID().slice(0, 6)}` });
    const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
      .filter((e) => e.dataScope !== 'none' && !(e.module === 'stock_transfer' && e.action === 'approve'))
      .map((e) => ({ permissionId: e.permissionId, dataScope: e.dataScope }));
    await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });

    const username = `e2e-transfer-limited-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: 'Kho viên hạn chế điều chuyển', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: newRole.body.data.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
    const limitedToken = login.body.data.accessToken as string;

    const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
    await createAndApproveReceipt(clinicAdminToken, fromWarehouseId, drugId, 10, 1000);
    const created = await createTransfer(limitedToken, fromWarehouseId, toWarehouseId, { lines: [{ drugId, quantityShipped: 5 }] });
    expect(created.status).toBe(200);

    const ship = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(limitedToken)).send({ version: created.body.data.version });
    expect(ship.status).toBe(403);
  });

  describe('Phân quyền theo Khoa/Phòng (kiến trúc mục 0, docs/DECISIONS.md #170)', () => {
    let deptAToken: string;
    let deptAUserId: string;
    let deptAWarehouseId: string;
    let deptBToken: string;
    let deptBWarehouseId: string;

    beforeAll(async () => {
      const deptARes = await request(app.getHttpServer()).post('/api/v1/departments').set(authed(clinicAdminToken)).send({ name: `Khoa Dược A e2e ${randomUUID().slice(0, 6)}` });
      const deptAId = deptARes.body.data.id as string;
      const deptBRes = await request(app.getHttpServer()).post('/api/v1/departments').set(authed(clinicAdminToken)).send({ name: `Khoa Dược B e2e ${randomUUID().slice(0, 6)}` });
      const deptBId = deptBRes.body.data.id as string;

      const whARes = await request(app.getHttpServer()).post('/api/v1/warehouses').set(authed(clinicAdminToken)).send({ name: `Kho Khoa A e2e ${randomUUID().slice(0, 6)}`, departmentId: deptAId });
      deptAWarehouseId = whARes.body.data.id as string;
      const whBRes = await request(app.getHttpServer()).post('/api/v1/warehouses').set(authed(clinicAdminToken)).send({ name: `Kho Khoa B e2e ${randomUUID().slice(0, 6)}`, departmentId: deptBId });
      deptBWarehouseId = whBRes.body.data.id as string;

      // Vai trò tuỳ biến: sao chép ma trận clinic_admin nhưng ép `stock_transfer.*` về scope `department`.
      const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
      const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
      const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));
      const buildScopedRole = async (label: string) => {
        const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `${label} e2e ${randomUUID().slice(0, 6)}` });
        const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
          .filter((e) => e.dataScope !== 'none')
          .map((e) => ({ permissionId: e.permissionId, dataScope: e.module === 'stock_transfer' ? 'department' : e.dataScope }));
        await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });
        return newRole.body.data.id as string;
      };
      const roleAId = await buildScopedRole('Dược Khoa A');
      const roleBId = await buildScopedRole('Dược Khoa B');

      const setupScopedUser = async (roleId: string, deptId: string) => {
        const created = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
        await privileged.userRole.deleteMany({ where: { tenantId: fixture.tenantA.id, userId: created.userId } });
        await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: created.userId, roleId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
        await privileged.userAccount.update({ where: { id: created.userId }, data: { departmentId: deptId } });
        const account = await privileged.userAccount.findUniqueOrThrow({ where: { id: created.userId } });
        const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username: account.username, password });
        return { userId: created.userId, token: login.body.data.accessToken as string };
      };
      const a = await setupScopedUser(roleAId, deptAId);
      deptAToken = a.token;
      deptAUserId = a.userId;
      const b = await setupScopedUser(roleBId, deptBId);
      deptBToken = b.token;
    });

    it('tạo + Duyệt xuất ở đúng Khoa quản lý kho NGUỒN — thành công', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      await createAndApproveReceipt(clinicAdminToken, deptAWarehouseId, drugId, 30, 1000);
      const created = await createTransfer(deptAToken, deptAWarehouseId, deptBWarehouseId, { lines: [{ drugId, quantityShipped: 10 }] });
      expect(created.status).toBe(200);
      const shipped = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(deptAToken)).send({ version: created.body.data.version });
      expect(shipped.status).toBe(200);
    });

    it('tạo phiếu với kho NGUỒN ngoài Khoa mình → 404 (không phải 403)', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      const res = await createTransfer(deptBToken, deptAWarehouseId, deptBWarehouseId, { lines: [{ drugId, quantityShipped: 1 }] });
      expect(res.status).toBe(404);
    });

    it('Duyệt xuất phiếu do actor Khoa KHÁC tạo (kho nguồn không thuộc Khoa mình) → 404', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      await createAndApproveReceipt(clinicAdminToken, deptAWarehouseId, drugId, 30, 1000);
      const created = await createTransfer(deptAToken, deptAWarehouseId, deptBWarehouseId, { lines: [{ drugId, quantityShipped: 5 }] });
      const shipRes = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(deptBToken)).send({ version: created.body.data.version });
      expect(shipRes.status).toBe(404);
    });

    it('Xác nhận nhận hàng CHỈ actor thuộc Khoa quản lý kho ĐÍCH mới làm được — actor Khoa nguồn bị 404, actor Khoa đích thành công', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      await createAndApproveReceipt(clinicAdminToken, deptAWarehouseId, drugId, 30, 1000);
      const created = await createTransfer(deptAToken, deptAWarehouseId, deptBWarehouseId, { lines: [{ drugId, quantityShipped: 10 }] });
      const shipped = await request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${created.body.data.id}/ship`).set(authed(deptAToken)).send({ version: created.body.data.version });
      const lineId = shipped.body.data.lines[0].id;

      // Actor Khoa A (kho NGUỒN) — không được Xác nhận nhận hàng (đó là việc của Khoa B, kho ĐÍCH).
      const receiveByWrongDept = await request(app.getHttpServer())
        .post(`/api/v1/inventory/transfers/${created.body.data.id}/receive`)
        .set(authed(deptAToken))
        .send({ version: shipped.body.data.version, lines: [{ lineId, quantityReceived: 10 }] });
      expect(receiveByWrongDept.status).toBe(404);

      const receiveByRightDept = await request(app.getHttpServer())
        .post(`/api/v1/inventory/transfers/${created.body.data.id}/receive`)
        .set(authed(deptBToken))
        .send({ version: shipped.body.data.version, lines: [{ lineId, quantityReceived: 10 }] });
      expect(receiveByRightDept.status).toBe(200);
      expect(receiveByRightDept.body.data.status).toBe('COMPLETED');
    });

    it('Xem (GET) — actor thuộc Khoa kho NGUỒN hoặc kho ĐÍCH đều xem được, Khoa khác thì 404', async () => {
      const drugId = await createDrug(clinicAdminToken, { isBatchManaged: false });
      await createAndApproveReceipt(clinicAdminToken, deptAWarehouseId, drugId, 30, 1000);
      const created = await createTransfer(deptAToken, deptAWarehouseId, deptBWarehouseId, { lines: [{ drugId, quantityShipped: 5 }] });

      const seenByA = await request(app.getHttpServer()).get(`/api/v1/inventory/transfers/${created.body.data.id}`).set(authed(deptAToken));
      expect(seenByA.status).toBe(200);
      const seenByB = await request(app.getHttpServer()).get(`/api/v1/inventory/transfers/${created.body.data.id}`).set(authed(deptBToken));
      expect(seenByB.status).toBe(200);
    });

    it('actor scope department nhưng CHƯA gán Khoa/Phòng → danh sách rỗng, không lỗi', async () => {
      await privileged.userAccount.update({ where: { id: deptAUserId }, data: { departmentId: null } });
      const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/transfers').set(authed(deptAToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.items).toEqual([]);

      const deptAWarehouse = await privileged.warehouse.findUniqueOrThrow({ where: { id: deptAWarehouseId } });
      await privileged.userAccount.update({ where: { id: deptAUserId }, data: { departmentId: deptAWarehouse.departmentId } });
    });
  });
});
