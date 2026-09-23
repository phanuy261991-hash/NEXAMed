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
 * HTTP e2e cho "Báo cáo Nhập-Xuất-Tồn" (Kho Thuốc GĐ4, phần 5/5, docs/DECISIONS.md #170, kế hoạch
 * kỹ thuật bright-bubbling-axolotl.md mục 5) — bảng kê Đầu kỳ/Nhập/Xuất/Cuối kỳ theo mặt hàng
 * trong khoảng ngày, đúng khuôn `cash-book-report-http.spec.ts`.
 */
describe('HTTP e2e — /api/v1/inventory/reports/stock-ledger (Báo cáo Nhập-Xuất-Tồn GĐ4)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let doctorToken: string;
  let tenantBAdminToken: string;
  let warehouseId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-stkledger-${roleName}-${randomUUID()}`;
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

  async function createDrug(name: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(clinicAdminToken))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name,
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
        isBatchManaged: false,
        units: [],
      });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  /** Nhập kho THẲNG lên `POSTED` (tạo Nháp rồi Duyệt luôn) — `occurredAt` điều khiển bucket Đầu kỳ/Nhập. */
  async function receiveStock(wh: string, drugId: string, quantity: number, occurredAt: string) {
    const created = await request(app.getHttpServer())
      .post('/api/v1/inventory/receipts')
      .set(authed(clinicAdminToken))
      .send({ warehouseId: wh, receiptType: 'OPENING_BALANCE', occurredAt, lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost: 100 }] });
    expect(created.status).toBe(200);
    const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(approved.status).toBe(200);
  }

  /** Xuất kho (WRITE_OFF, Nháp→Duyệt) — `occurredAt` điều khiển bucket Xuất. */
  async function issueStock(wh: string, drugId: string, quantity: number, occurredAt: string) {
    const created = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues/manual')
      .set(authed(clinicAdminToken))
      .send({ issueType: 'WRITE_OFF', warehouseId: wh, occurredAt, note: 'Xuất huỷ test báo cáo NXT', lines: [{ drugId, quantity }] });
    expect(created.status).toBe(200);
    const approved = await request(app.getHttpServer()).post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`).set(authed(clinicAdminToken)).send({ version: created.body.data.version });
    expect(approved.status).toBe(200);
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

    fixture = await createTwoTenantFixture(privileged, 'StockLedgerReport e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    // `doctor` có `stock_receipt.read` nhưng KHÔNG có `stock_receipt.report` — dùng để test 403.
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');

    const warehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    warehouseId = warehousesRes.body.data.items[0].id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/reports/stock-ledger?from=2026-01-01&to=2026-01-31');
    expect(res.status).toBe(401);
  });

  it('bác sĩ (có stock_receipt.read, KHÔNG có stock_receipt.report) → 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/reports/stock-ledger?from=2026-01-01&to=2026-01-31').set(authed(doctorToken));
    expect(res.status).toBe(403);
  });

  it('Đầu kỳ/Nhập/Xuất/Cuối kỳ đúng qua kịch bản nhập rồi xuất nhiều lần, trong VÀ ngoài khoảng ngày lọc', async () => {
    const drugId = await createDrug('Thuốc test Báo cáo NXT');
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    // Đầu kỳ: nhập 50 TRƯỚC mốc `from` (3 ngày trước).
    await receiveStock(warehouseId, drugId, 50, threeDaysAgo.toISOString());
    // Trong kỳ: nhập thêm 30 — tính vào "Nhập".
    await receiveStock(warehouseId, drugId, 30, today.toISOString());
    // Trong kỳ: xuất 10 — tính vào "Xuất".
    await issueStock(warehouseId, drugId, 10, today.toISOString());
    // NGOÀI kỳ (sau mốc `to`): nhập 999 — KHÔNG được tính vào bất kỳ cột nào.
    await receiveStock(warehouseId, drugId, 999, tomorrow.toISOString());

    const res = await request(app.getHttpServer())
      .get('/api/v1/inventory/reports/stock-ledger')
      .set(authed(clinicAdminToken))
      .query({ from: fmt(today), to: fmt(today), warehouseId });
    expect(res.status).toBe(200);

    const item = res.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(item).toBeDefined();
    expect(item.openingQuantity).toBe(50);
    expect(item.totalIn).toBe(30);
    expect(item.totalOut).toBe(10);
    expect(item.closingQuantity).toBe(70); // 50 + 30 - 10, KHÔNG cộng 999 nhập ngoài kỳ.
  });

  it('lọc theo warehouseId — chỉ trả mặt hàng của đúng kho đó', async () => {
    const otherWarehouseRes = await request(app.getHttpServer()).post('/api/v1/warehouses').set(authed(clinicAdminToken)).send({ name: `Kho phụ e2e ${randomUUID().slice(0, 6)}` });
    const otherWarehouseId = otherWarehouseRes.body.data.id as string;

    const drugInMain = await createDrug('Thuốc kho chính');
    const drugInOther = await createDrug('Thuốc kho phụ');
    const today = new Date().toISOString();
    const todayOnly = today.slice(0, 10);

    await receiveStock(warehouseId, drugInMain, 20, today);
    await receiveStock(otherWarehouseId, drugInOther, 15, today);

    const mainRes = await request(app.getHttpServer()).get('/api/v1/inventory/reports/stock-ledger').set(authed(clinicAdminToken)).query({ from: todayOnly, to: todayOnly, warehouseId });
    expect(mainRes.body.data.items.some((i: { drugId: string }) => i.drugId === drugInMain)).toBe(true);
    expect(mainRes.body.data.items.some((i: { drugId: string }) => i.drugId === drugInOther)).toBe(false);

    const otherRes = await request(app.getHttpServer()).get('/api/v1/inventory/reports/stock-ledger').set(authed(clinicAdminToken)).query({ from: todayOnly, to: todayOnly, warehouseId: otherWarehouseId });
    expect(otherRes.body.data.items.some((i: { drugId: string }) => i.drugId === drugInOther)).toBe(true);
    expect(otherRes.body.data.items.some((i: { drugId: string }) => i.drugId === drugInMain)).toBe(false);
  });

  it('Xuất Excel (GET .../export) → 200, content-type .xlsx, GHI AUDIT LOG', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/reports/stock-ledger/export').set(authed(clinicAdminToken)).query({ from: today, to: today, warehouseId });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');

    const auditRow = await privileged.auditLog.findFirst({
      where: { tenantId: fixture.tenantA.id, action: 'stock_ledger_report.exported', entityId: fixture.tenantA.id },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditRow).not.toBeNull();
  });

  it('Xuất Excel — bác sĩ (không có stock_receipt.report) → 403', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/reports/stock-ledger/export').set(authed(doctorToken)).query({ from: today, to: today });
    expect(res.status).toBe(403);
  });

  it('cách ly tenant — tenant B không thấy dữ liệu Nhập-Xuất-Tồn của tenant A', async () => {
    const drugId = await createDrug('Thuốc tenant A báo cáo NXT');
    const today = new Date().toISOString();
    const todayOnly = today.slice(0, 10);
    await receiveStock(warehouseId, drugId, 25, today);

    const res = await request(app.getHttpServer()).get('/api/v1/inventory/reports/stock-ledger').set(authed(tenantBAdminToken)).query({ from: todayOnly, to: todayOnly });
    expect(res.status).toBe(200);
    expect(res.body.data.items.some((i: { drugId: string }) => i.drugId === drugId)).toBe(false);
  });
});
