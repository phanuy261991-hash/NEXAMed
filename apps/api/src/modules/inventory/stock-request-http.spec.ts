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
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e cho "Yêu cầu cấp hàng" theo cấp (docs/DECISIONS.md #298). Chi nhánh A = chi nhánh chính (kho chính whA); chi nhánh B có kho chính whB và một kho phụ whB2;
 * chi nhánh C để kiểm cô lập. `adminA` không có dòng gán (→ chi nhánh mặc định A), `adminB` chỉ được gán B, `adminC` chỉ được gán C. Giữ số lần đăng nhập thấp (rate limit /auth/login).
 */
describe('HTTP e2e — /api/v1/inventory/requests (Yêu cầu cấp hàng)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let branchC: string;
  let adminAToken: string;
  let adminBToken: string;
  let adminCToken: string;
  let tenantBAdminToken: string;
  let receptionistToken: string;
  let whA: string;
  let whB: string;
  let whB2: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string) {
    const username = `e2e-req-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return { id: user.id, username };
  }

  async function login(tenantId: string, username: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function createDrug(token: string, name = 'Găng tay y tế'): Promise<string> {
    const res = await http()
      .post('/api/v1/drugs')
      .set(authed(token))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name,
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
        activeIngredient: 'Test',
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
        isBatchManaged: false,
        minStockAlert: 20,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function stockIn(token: string, warehouseId: string, drugId: string, quantity: number) {
    const created = await http()
      .post('/api/v1/inventory/receipts')
      .set(authed(token))
      .send({ warehouseId, receiptType: 'OPENING_BALANCE', lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost: 1000 }] });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(token)).send({ version: created.body.data.version });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  }

  async function balance(token: string, warehouseId: string, drugId: string): Promise<number> {
    const res = await http().get('/api/v1/inventory/balances').set(authed(token)).query({ warehouseId });
    return (res.body.data.items as { drugId: string; quantityOnHand: number }[]).find((i) => i.drugId === drugId)?.quantityOnHand ?? 0;
  }

  type Detail = { id: string; version: number; status: string; supplierUpdatePending: boolean; lines: { id: string; drugId: string; fulfilStatus: string; displayStatus: string; requestedQty: number; allocatedQty: number; receivedQty: number; remainingQty: number; transfers: { id: string }[]; addedAfterAccept: boolean }[]; transfers: { id: string; status: string }[]; events: { eventType: string }[]; requestNo: string; supplyingWarehouseId: string; canActAsRequester: boolean; canActAsSupplier: boolean };

  async function createRequest(token: string, requestingWarehouseId: string, lines: { drugId: string; requestedQty: number }[], extra: Record<string, unknown> = {}) {
    const res = await http().post('/api/v1/inventory/requests').set(authed(token)).send({ requestingWarehouseId, lines, ...extra });
    return res;
  }

  async function submitted(token: string, requestingWarehouseId: string, lines: { drugId: string; requestedQty: number }[]): Promise<Detail> {
    const res = await createRequest(token, requestingWarehouseId, lines, { submit: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Detail;
  }

  async function get(token: string, id: string): Promise<Detail> {
    const res = await http().get(`/api/v1/inventory/requests/${id}`).set(authed(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Detail;
  }

  async function accept(token: string, d: Detail): Promise<Detail> {
    const res = await http().post(`/api/v1/inventory/requests/${d.id}/accept`).set(authed(token)).send({ version: d.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Detail;
  }

  async function transferVersion(token: string, transferId: string): Promise<{ version: number; lines: { id: string; quantityShipped: number }[] }> {
    const res = await http().get(`/api/v1/inventory/transfers/${transferId}`).set(authed(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  }

  async function shipTransfer(token: string, transferId: string) {
    const t = await transferVersion(token, transferId);
    const res = await http().post(`/api/v1/inventory/transfers/${transferId}/ship`).set(authed(token)).send({ version: t.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function receiveTransfer(token: string, transferId: string, shortBy = 0) {
    const t = await transferVersion(token, transferId);
    const res = await http()
      .post(`/api/v1/inventory/transfers/${transferId}/receive`)
      .set(authed(token))
      .send({
        version: t.version,
        lines: t.lines.map((l) => ({ lineId: l.id, quantityReceived: l.quantityShipped - shortBy, ...(shortBy > 0 ? { varianceReason: 'SHORTAGE', varianceNote: 'Thiếu khi đếm' } : {}) })),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { status: string };
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

    fixture = await createTwoTenantFixture(privileged, 'StockRequest e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    const adminA = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminA');
    adminAToken = await login(fixture.tenantA.id, adminA.username);
    const mkBranch = async (name: string) => {
      const created = await http().post('/api/v1/branches').set(authed(adminAToken)).send({ name, address: '1 Test', phone: '0283777556' });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      return created.body.data.id as string;
    };
    branchB = await mkBranch('Chi nhánh Thủ Đức');
    branchC = await mkBranch('Chi nhánh Quận 7');
    const adminB = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminB');
    await privileged.userBranch.create({ data: { tenantId: fixture.tenantA.id, userId: adminB.id, branchId: branchB, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    adminBToken = await login(fixture.tenantA.id, adminB.username);
    const adminC = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminC');
    await privileged.userBranch.create({ data: { tenantId: fixture.tenantA.id, userId: adminC.id, branchId: branchC, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    adminCToken = await login(fixture.tenantA.id, adminC.username);
    const tenantBAdmin = await createUser(fixture.tenantB.id, 'clinic_admin', 'tenantB');
    tenantBAdminToken = await login(fixture.tenantB.id, tenantBAdmin.username);
    const receptionist = await createUser(fixture.tenantA.id, 'receptionist', 'recep');
    receptionistToken = await login(fixture.tenantA.id, receptionist.username);

    whA = (await privileged.warehouse.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } })).id;
    whB = (await privileged.warehouse.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchB, deletedAt: null } })).id;
    const sub = await http().post('/api/v1/warehouses').set(authed(adminBToken)).send({ name: `Kho thủ thuật ${randomUUID().slice(0, 6)}` });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    whB2 = sub.body.data.id as string;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('quyền và công tắc', () => {
    it('không có access token → 401; lễ tân không có quyền stock_request → 403', async () => {
      expect((await http().get('/api/v1/inventory/requests')).status).toBe(401);
      expect((await http().get('/api/v1/inventory/requests').set(authed(receptionistToken))).status).toBe(403);
    });

    it('tắt công tắc "Dùng yêu cầu cấp hàng" → mọi API chính trả 409, bật lại thì chạy tiếp', async () => {
      const off = await http().patch('/api/v1/clinic-settings').set(authed(adminAToken)).send({ stockRequestEnabled: false });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      const res = await http().get('/api/v1/inventory/requests').set(authed(adminAToken));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STOCK_REQUEST_DISABLED');
      expect((await http().get('/api/v1/inventory/requests/pending-counts').set(authed(adminAToken))).body.data).toEqual({ toAccept: 0, updated: 0, ready: 0, actionable: 0 });
      const on = await http().patch('/api/v1/clinic-settings').set(authed(adminAToken)).send({ stockRequestEnabled: true });
      expect(on.status).toBe(200);
      expect((await http().get('/api/v1/inventory/requests').set(authed(adminAToken))).status).toBe(200);
    });

    it('cấu hình tự-phục vụ "stock-request-enabled" đọc được không cần quyền cấu hình', async () => {
      const res = await http().get('/api/v1/clinic-settings/stock-request-enabled').set(authed(receptionistToken));
      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(true);
    });
  });

  describe('kho cấp suy ra theo cấp', () => {
    it('kho chính chi nhánh phụ xin kho chính chi nhánh chính; kho phụ xin kho chính cùng chi nhánh; kho chính chi nhánh chính không có cấp trên', async () => {
      const b = await http().get('/api/v1/inventory/requests/options').set(authed(adminBToken));
      expect(b.status, JSON.stringify(b.body)).toBe(200);
      const byRequester = Object.fromEntries((b.body.data.options as { requestingWarehouseId: string; supplyingWarehouseId: string }[]).map((o) => [o.requestingWarehouseId, o.supplyingWarehouseId]));
      expect(byRequester[whB]).toBe(whA);
      expect(byRequester[whB2]).toBe(whB);
      const a = await http().get('/api/v1/inventory/requests/options').set(authed(adminAToken));
      expect(a.body.data.options).toEqual([]);
    });

    it('kho chính của chi nhánh chính xin hàng → 422 NO_SUPPLIER', async () => {
      const drugId = await createDrug(adminAToken);
      const res = await createRequest(adminAToken, whA, [{ drugId, requestedQty: 5 }], { submit: true });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('STOCK_REQUEST_NO_SUPPLIER');
    });
  });

  describe('lập, sửa, gửi, huỷ', () => {
    it('lưu nháp → sửa tự do → gửi; kho cấp không thấy bản nháp; số phiếu YCCH', async () => {
      const drugId = await createDrug(adminBToken, 'Bơm tiêm 5ml');
      const draft = await createRequest(adminBToken, whB, [{ drugId, requestedQty: 10 }], { submit: false });
      expect(draft.status, JSON.stringify(draft.body)).toBe(200);
      expect(draft.body.data.status).toBe('DRAFT');
      expect(draft.body.data.requestNo).toMatch(/^YCCH/);
      expect(draft.body.data.supplyingWarehouseId).toBe(whA);

      // Kho cấp (chi nhánh A) chưa thấy nháp.
      expect((await http().get(`/api/v1/inventory/requests/${draft.body.data.id}`).set(authed(adminAToken))).status).toBe(404);
      const incomingBefore = await http().get('/api/v1/inventory/requests').query({ view: 'incoming' }).set(authed(adminAToken));
      expect((incomingBefore.body.data.items as { id: string }[]).some((r) => r.id === draft.body.data.id)).toBe(false);

      const edited = await http()
        .patch(`/api/v1/inventory/requests/${draft.body.data.id}`)
        .set(authed(adminBToken))
        .send({ requestingWarehouseId: whB, priority: 'URGENT', neededBy: '2026-12-01', note: 'Cần gấp', version: draft.body.data.version, lines: [{ drugId, requestedQty: 12 }] });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(edited.body.data.priority).toBe('URGENT');
      expect(edited.body.data.neededBy).toBe('2026-12-01');
      expect(edited.body.data.lines[0].requestedQty).toBe(12);

      const sent = await http().post(`/api/v1/inventory/requests/${draft.body.data.id}/submit`).set(authed(adminBToken)).send({ version: edited.body.data.version });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect(sent.body.data.status).toBe('SUBMITTED');

      // Kho cấp thấy từ lúc đã gửi; tab "incoming" có phiếu, tab "mine" của kho cấp thì không.
      expect((await get(adminAToken, draft.body.data.id)).canActAsSupplier).toBe(true);
      const incoming = await http().get('/api/v1/inventory/requests').query({ view: 'incoming' }).set(authed(adminAToken));
      expect((incoming.body.data.items as { id: string }[]).some((r) => r.id === draft.body.data.id)).toBe(true);
      const mineA = await http().get('/api/v1/inventory/requests').set(authed(adminAToken));
      expect((mineA.body.data.items as { id: string }[]).some((r) => r.id === draft.body.data.id)).toBe(false);
    });

    it('một mặt hàng chỉ một dòng trên phiếu → 400', async () => {
      const drugId = await createDrug(adminBToken);
      const res = await createRequest(adminBToken, whB, [{ drugId, requestedQty: 1 }, { drugId, requestedQty: 2 }]);
      expect(res.status).toBe(400);
    });

    it('chưa tiếp nhận thì huỷ được (lý do bắt buộc); sau tiếp nhận thì không huỷ và không sửa tự do được → 409', async () => {
      const drugId = await createDrug(adminBToken);
      const d1 = await submitted(adminBToken, whB, [{ drugId, requestedQty: 3 }]);
      expect((await http().post(`/api/v1/inventory/requests/${d1.id}/cancel`).set(authed(adminBToken)).send({ version: d1.version, reason: '' })).status).toBe(400);
      const cancelled = await http().post(`/api/v1/inventory/requests/${d1.id}/cancel`).set(authed(adminBToken)).send({ version: d1.version, reason: 'Đặt nhầm' });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');

      const d2 = await submitted(adminBToken, whB, [{ drugId, requestedQty: 3 }]);
      const acc = await accept(adminAToken, d2);
      const cancel2 = await http().post(`/api/v1/inventory/requests/${d2.id}/cancel`).set(authed(adminBToken)).send({ version: acc.version, reason: 'Muộn rồi' });
      expect(cancel2.status).toBe(409);
      expect(cancel2.body.error.code).toBe('STOCK_REQUEST_INVALID_STATE');
      const edit = await http().patch(`/api/v1/inventory/requests/${d2.id}`).set(authed(adminBToken)).send({ requestingWarehouseId: whB, version: acc.version, lines: [{ drugId, requestedQty: 9 }] });
      expect(edit.status).toBe(409);
    });

    it('kho cấp từ chối cả phiếu (lý do bắt buộc)', async () => {
      const drugId = await createDrug(adminBToken);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 3 }]);
      expect((await http().post(`/api/v1/inventory/requests/${d.id}/reject`).set(authed(adminAToken)).send({ version: d.version, reason: '' })).status).toBe(400);
      const rejected = await http().post(`/api/v1/inventory/requests/${d.id}/reject`).set(authed(adminAToken)).send({ version: d.version, reason: 'Không còn quy cách này' });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
      expect(rejected.body.data.status).toBe('REJECTED');
      expect(rejected.body.data.rejectionReason).toBe('Không còn quy cách này');
    });

    it('bên xin không tiếp nhận được; bên cấp không huỷ/sửa phiếu của bên xin', async () => {
      const drugId = await createDrug(adminBToken);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 3 }]);
      // Chi nhánh B không phải kho cấp của phiếu này → 404.
      expect((await http().post(`/api/v1/inventory/requests/${d.id}/accept`).set(authed(adminBToken)).send({ version: d.version })).status).toBe(404);
      // Chi nhánh A là kho cấp, không phải bên xin → huỷ trả 404.
      expect((await http().post(`/api/v1/inventory/requests/${d.id}/cancel`).set(authed(adminAToken)).send({ version: d.version, reason: 'x' })).status).toBe(404);
    });
  });

  describe('cấp hàng bằng phiếu điều chuyển', () => {
    it('cấp một phần + chờ hàng về → phiếu điều chuyển nháp liên kết; đi hết luồng thì Cấp tiếp → hoàn thành', async () => {
      const drugId = await createDrug(adminAToken, 'Găng tay size M');
      await stockIn(adminAToken, whA, drugId, 12);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 20 }]);
      const acc = await accept(adminAToken, d);
      expect(acc.status).toBe('ACCEPTED');
      expect(acc.lines[0]!.displayStatus).toBe('PENDING');

      // Số cấp vượt tồn → 422.
      const tooMuch = await http()
        .post(`/api/v1/inventory/requests/${d.id}/allocate`)
        .set(authed(adminAToken))
        .send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 20 }] });
      expect(tooMuch.status).toBe(422);
      expect(tooMuch.body.error.code).toBe('STOCK_REQUEST_INSUFFICIENT_STOCK');

      // Còn thiếu mà không ghi quyết định phần thiếu → 422; vượt số còn thiếu → 422.
      const noRemainder = await http().post(`/api/v1/inventory/requests/${d.id}/allocate`).set(authed(adminAToken)).send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 12 }] });
      expect(noRemainder.status).toBe(422);
      expect(noRemainder.body.error.code).toBe('STOCK_REQUEST_ALLOCATION_INVALID');

      const allocated = await http()
        .post(`/api/v1/inventory/requests/${d.id}/allocate`)
        .set(authed(adminAToken))
        .send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 12, remainder: { action: 'WAIT', reason: 'Đang đặt thêm', expectedDate: '2026-12-05' } }] });
      expect(allocated.status, JSON.stringify(allocated.body)).toBe(200);
      const after = allocated.body.data as Detail & { lines: { decisionReason: string; waitExpectedDate: string }[] };
      expect(after.status).toBe('IN_PROGRESS');
      expect(after.lines[0]!.displayStatus).toBe('WAITING_STOCK');
      expect(after.lines[0]!.allocatedQty).toBe(12);
      expect(after.lines[0]!.remainingQty).toBe(8);
      expect(after.lines[0]!.decisionReason).toBe('Đang đặt thêm');
      expect(after.lines[0]!.waitExpectedDate).toBe('2026-12-05');
      expect(after.transfers).toHaveLength(1);
      expect(after.transfers[0]!.status).toBe('DRAFT');
      // Nháp chưa đụng tồn.
      expect(await balance(adminAToken, whA, drugId)).toBe(12);

      // Duyệt xuất ở phía cấp, kiểm nhận ở phía xin.
      const transferId = after.transfers[0]!.id;
      await shipTransfer(adminAToken, transferId);
      expect((await get(adminBToken, d.id)).lines[0]!.displayStatus).toBe('WAITING_STOCK');
      expect(await balance(adminAToken, whA, drugId)).toBe(0);
      const received = await receiveTransfer(adminBToken, transferId);
      expect(received.status).toBe('COMPLETED');
      const mid = await get(adminBToken, d.id);
      expect(mid.status).toBe('IN_PROGRESS');
      expect(mid.lines[0]!.receivedQty).toBe(12);
      expect(await balance(adminBToken, whB, drugId)).toBe(12);

      // Hàng về kho cấp → "Hàng đã về" + cấp tiếp 8.
      await stockIn(adminAToken, whA, drugId, 30);
      const incoming = await http().get('/api/v1/inventory/requests').query({ view: 'incoming' }).set(authed(adminAToken));
      expect((incoming.body.data.items as { id: string; readyToSupply: boolean }[]).find((r) => r.id === d.id)?.readyToSupply).toBe(true);
      const cont = await http()
        .post(`/api/v1/inventory/requests/${d.id}/allocate`)
        .set(authed(adminAToken))
        .send({ version: mid.version, lines: [{ lineId: mid.lines[0]!.id, allocateQty: 8 }] });
      expect(cont.status, JSON.stringify(cont.body)).toBe(200);
      expect(cont.body.data.transfers).toHaveLength(2);
      const second = (cont.body.data as Detail).transfers.find((t) => t.id !== transferId)!;
      await shipTransfer(adminAToken, second.id);
      expect(await receiveTransfer(adminBToken, second.id)).toMatchObject({ status: 'COMPLETED' });
      const done = await get(adminBToken, d.id);
      expect(done.status).toBe('COMPLETED');
      expect(done.lines[0]!.displayStatus).toBe('RECEIVED');
      expect(done.lines[0]!.receivedQty).toBe(20);
      expect(done.events.map((e) => e.eventType)).toEqual(expect.arrayContaining(['submitted', 'accepted', 'allocated', 'transfer_shipped', 'transfer_received', 'completed']));
    });

    it('nhận thiếu: phiếu chưa hoàn thành cho tới khi kho cấp xử lý chênh lệch', async () => {
      const drugId = await createDrug(adminAToken, 'Cồn 70');
      await stockIn(adminAToken, whA, drugId, 10);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 10 }]);
      const acc = await accept(adminAToken, d);
      const allocated = await http().post(`/api/v1/inventory/requests/${d.id}/allocate`).set(authed(adminAToken)).send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 10 }] });
      expect(allocated.status, JSON.stringify(allocated.body)).toBe(200);
      const transferId = (allocated.body.data as Detail).transfers[0]!.id;
      await shipTransfer(adminAToken, transferId);
      expect(await receiveTransfer(adminBToken, transferId, 2)).toMatchObject({ status: 'VARIANCE_PENDING' });
      const pending = await get(adminBToken, d.id);
      expect(pending.status).toBe('IN_PROGRESS');
      expect(pending.lines[0]!.displayStatus).toBe('VARIANCE_PENDING');

      const t = await transferVersion(adminAToken, transferId);
      const resolved = await http()
        .post(`/api/v1/inventory/transfers/${transferId}/resolve-variance`)
        .set(authed(adminAToken))
        .send({ version: t.version, lines: t.lines.map((l) => ({ lineId: l.id, resolution: 'WRITE_OFF' })) });
      expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
      expect((await get(adminBToken, d.id)).status).toBe('COMPLETED');
    });

    it('từ chối từng dòng (lý do bắt buộc) → dòng Từ chối; mọi dòng đã đóng thì phiếu hoàn thành', async () => {
      const drugId = await createDrug(adminAToken, 'Kim lấy máu');
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 4 }]);
      const acc = await accept(adminAToken, d);
      const noReason = await http().post(`/api/v1/inventory/requests/${d.id}/allocate`).set(authed(adminAToken)).send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 0, remainder: { action: 'REJECT', reason: '' } }] });
      expect(noReason.status).toBe(400);
      const rejected = await http()
        .post(`/api/v1/inventory/requests/${d.id}/allocate`)
        .set(authed(adminAToken))
        .send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 0, remainder: { action: 'REJECT', reason: 'NCC ngừng sản xuất quy cách này' } }] });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
      expect(rejected.body.data.lines[0].displayStatus).toBe('REJECTED');
      expect(rejected.body.data.lines[0].decisionReason).toBe('NCC ngừng sản xuất quy cách này');
      expect(rejected.body.data.transfers).toHaveLength(0);
      expect(rejected.body.data.status).toBe('COMPLETED');
    });

    it('kho cấp từ chối phiếu điều chuyển nháp → dòng yêu cầu quay về Chờ xử lý, cấp lại được', async () => {
      const drugId = await createDrug(adminAToken, 'Gạc vô trùng');
      await stockIn(adminAToken, whA, drugId, 10);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 5 }]);
      const acc = await accept(adminAToken, d);
      const allocated = await http().post(`/api/v1/inventory/requests/${d.id}/allocate`).set(authed(adminAToken)).send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 5 }] });
      const transferId = (allocated.body.data as Detail).transfers[0]!.id;
      const t = await transferVersion(adminAToken, transferId);
      const rej = await http().post(`/api/v1/inventory/transfers/${transferId}/reject`).set(authed(adminAToken)).send({ version: t.version, reason: 'Nhầm kho' });
      expect(rej.status, JSON.stringify(rej.body)).toBe(200);
      const back = await get(adminBToken, d.id);
      expect(back.status).toBe('ACCEPTED');
      expect(back.lines[0]!.fulfilStatus).toBe('PENDING');
      expect(back.lines[0]!.allocatedQty).toBe(0);
      expect(back.transfers).toHaveLength(0);
    });

    it('sửa lô trên phiếu điều chuyển nháp vẫn giữ liên kết dòng yêu cầu', async () => {
      const drugId = await createDrug(adminAToken, 'Băng keo');
      await stockIn(adminAToken, whA, drugId, 10);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 6 }]);
      const acc = await accept(adminAToken, d);
      const allocated = await http().post(`/api/v1/inventory/requests/${d.id}/allocate`).set(authed(adminAToken)).send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 6 }] });
      const transferId = (allocated.body.data as Detail).transfers[0]!.id;
      const t = await transferVersion(adminAToken, transferId);
      const edited = await http()
        .patch(`/api/v1/inventory/transfers/${transferId}`)
        .set(authed(adminAToken))
        .send({ fromWarehouseId: whA, toWarehouseId: whB, version: t.version, lines: [{ drugId, quantityShipped: 4 }] });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const after = await get(adminBToken, d.id);
      expect(after.lines[0]!.allocatedQty).toBe(4);
      expect(after.lines[0]!.remainingQty).toBe(2);
    });
  });

  describe('bên xin cập nhật sau khi gửi', () => {
    it('đã tiếp nhận mà chưa cấp: thêm mặt hàng báo kho cấp, rút dòng chưa có hàng, rút hết thì "Đã rút"', async () => {
      const drug1 = await createDrug(adminBToken, 'Hàng một');
      const drug2 = await createDrug(adminBToken, 'Hàng hai');
      const d = await submitted(adminBToken, whB, [{ drugId: drug1, requestedQty: 5 }]);
      const acc = await accept(adminAToken, d);
      expect(acc.supplierUpdatePending).toBe(false);

      const added = await http().post(`/api/v1/inventory/requests/${d.id}/lines`).set(authed(adminBToken)).send({ version: acc.version, lines: [{ drugId: drug2, requestedQty: 3 }] });
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      expect(added.body.data.supplierUpdatePending).toBe(true);
      expect(added.body.data.lines.find((l: { drugId: string }) => l.drugId === drug2).addedAfterAccept).toBe(true);
      // Thêm lại mặt hàng đã có → 422.
      const dup = await http().post(`/api/v1/inventory/requests/${d.id}/lines`).set(authed(adminBToken)).send({ version: added.body.data.version, lines: [{ drugId: drug2, requestedQty: 1 }] });
      expect(dup.status).toBe(422);

      // Kho cấp thấy nhãn ở bộ đếm, bấm "Đã xem cập nhật" thì tắt.
      expect((await http().get('/api/v1/inventory/requests/pending-counts').set(authed(adminAToken))).body.data.updated).toBeGreaterThanOrEqual(1);
      const ack = await http().post(`/api/v1/inventory/requests/${d.id}/acknowledge-update`).set(authed(adminAToken));
      expect(ack.status, JSON.stringify(ack.body)).toBe(200);
      expect(ack.body.data.supplierUpdatePending).toBe(false);

      // Rút hết mọi dòng khi chưa cấp dòng nào → cả phiếu "Đã rút". Lý do bắt buộc.
      const cur = await get(adminBToken, d.id);
      expect((await http().post(`/api/v1/inventory/requests/${d.id}/withdraw-lines`).set(authed(adminBToken)).send({ version: cur.version, lineIds: cur.lines.map((l) => l.id), reason: '' })).status).toBe(400);
      const withdrawn = await http().post(`/api/v1/inventory/requests/${d.id}/withdraw-lines`).set(authed(adminBToken)).send({ version: cur.version, lineIds: cur.lines.map((l) => l.id), reason: 'Không cần nữa' });
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      expect(withdrawn.body.data.status).toBe('WITHDRAWN');
      expect(withdrawn.body.data.lines.every((l: { displayStatus: string }) => l.displayStatus === 'WITHDRAWN')).toBe(true);
    });

    it('đã cấp một phần: không thêm mặt hàng, chỉ rút dòng đang chờ hàng về (phần đã cấp giữ nguyên)', async () => {
      const drugId = await createDrug(adminAToken, 'Hàng ba');
      const other = await createDrug(adminAToken, 'Hàng bốn');
      await stockIn(adminAToken, whA, drugId, 4);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 10 }]);
      const acc = await accept(adminAToken, d);
      const allocated = await http()
        .post(`/api/v1/inventory/requests/${d.id}/allocate`)
        .set(authed(adminAToken))
        .send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 4, remainder: { action: 'WAIT', reason: 'Chờ hàng' } }] });
      expect(allocated.status, JSON.stringify(allocated.body)).toBe(200);
      const cur = allocated.body.data as Detail;
      const add = await http().post(`/api/v1/inventory/requests/${d.id}/lines`).set(authed(adminBToken)).send({ version: cur.version, lines: [{ drugId: other, requestedQty: 1 }] });
      expect(add.status).toBe(409);

      const withdrawn = await http().post(`/api/v1/inventory/requests/${d.id}/withdraw-lines`).set(authed(adminBToken)).send({ version: cur.version, lineIds: [cur.lines[0]!.id], reason: 'Mượn được nơi khác' });
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      const line = withdrawn.body.data.lines[0];
      expect(line.fulfilStatus).toBe('ALLOCATED');
      expect(line.allocatedQty).toBe(4);
      // Còn phiếu điều chuyển đang nháp → chưa hoàn thành.
      expect(withdrawn.body.data.status).toBe('IN_PROGRESS');
    });

    it('nhắn bổ sung / nâng mức khẩn sau tiếp nhận ghi vào diễn biến và báo kho cấp', async () => {
      const drugId = await createDrug(adminBToken);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 5 }]);
      const acc = await accept(adminAToken, d);
      const noted = await http().post(`/api/v1/inventory/requests/${d.id}/note`).set(authed(adminBToken)).send({ version: acc.version, message: 'Cần trước thứ Sáu', priority: 'URGENT' });
      expect(noted.status, JSON.stringify(noted.body)).toBe(200);
      expect(noted.body.data.priority).toBe('URGENT');
      expect(noted.body.data.supplierUpdatePending).toBe(true);
      expect((noted.body.data as Detail).events.map((e) => e.eventType)).toContain('note_updated');
      // Không đổi gì → 400.
      expect((await http().post(`/api/v1/inventory/requests/${d.id}/note`).set(authed(adminBToken)).send({ version: noted.body.data.version })).status).toBe(400);
    });
  });

  describe('xin phần thiếu lên cấp trên', () => {
    it('kho chính chi nhánh phụ xin phần thiếu từ chi nhánh chính; dòng gốc chờ hàng về gắn với phiếu con', async () => {
      const drugId = await createDrug(adminBToken, 'Hàng năm');
      // Kho phụ whB2 xin kho chính whB (cùng chi nhánh B) 10 cái, whB chỉ có 3.
      await stockIn(adminBToken, whB, drugId, 3);
      const d = await submitted(adminBToken, whB2, [{ drugId, requestedQty: 10 }]);
      expect(d.supplyingWarehouseId).toBe(whB);
      const acc = await accept(adminBToken, d);
      const res = await http().post(`/api/v1/inventory/requests/${d.id}/escalate`).set(authed(adminBToken)).send({ version: acc.version, lineIds: [acc.lines[0]!.id] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { child, parent } = res.body.data as { child: Detail & { parentRequestId: string; supplyingBranchId: string; lines: { requestedQty: number }[] }; parent: Detail & { lines: { displayStatus: string; waitChildRequestNo: string; decisionReason: string }[] } };
      expect(child.status).toBe('SUBMITTED');
      expect(child.parentRequestId).toBe(d.id);
      expect(child.supplyingBranchId).toBe(branchA);
      expect(child.lines[0]!.requestedQty).toBe(10);
      expect(parent.lines[0]!.displayStatus).toBe('WAITING_STOCK');
      expect(parent.lines[0]!.waitChildRequestNo).toBe(child.requestNo);
      // Chi nhánh chính tiếp nhận được phiếu con.
      expect((await accept(adminAToken, { ...child, id: child.id, version: child.version })).status).toBe('ACCEPTED');
    });

    it('kho chính chi nhánh chính không còn cấp trên → 422', async () => {
      const drugId = await createDrug(adminBToken, 'Hàng sáu');
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 10 }]);
      const acc = await accept(adminAToken, d);
      const res = await http().post(`/api/v1/inventory/requests/${d.id}/escalate`).set(authed(adminAToken)).send({ version: acc.version, lineIds: [acc.lines[0]!.id] });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('STOCK_REQUEST_NO_SUPPLIER');
    });
  });

  describe('gợi ý mặt hàng dưới mức tồn tối thiểu', () => {
    it('chỉ trả mặt hàng có mức tối thiểu và tồn của kho xin nhỏ hơn mức đó, kèm số xin gợi ý', async () => {
      const low = await createDrug(adminBToken, 'Dưới mức tối thiểu');
      const enough = await createDrug(adminBToken, 'Đủ hàng');
      await stockIn(adminBToken, whB2, low, 5);
      await stockIn(adminBToken, whB2, enough, 50);
      const res = await http().get('/api/v1/inventory/requests/low-stock').query({ warehouseId: whB2 }).set(authed(adminBToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as { drugId: string; onHand: number; minStock: number; suggestedQty: number }[];
      const lowRow = items.find((i) => i.drugId === low);
      expect(lowRow).toMatchObject({ onHand: 5, minStock: 20, suggestedQty: 15 });
      expect(items.some((i) => i.drugId === enough)).toBe(false);
    });
  });

  describe('danh sách, đếm theo trạng thái, Excel', () => {
    it('lọc theo trạng thái/mức khẩn, dải đếm theo trạng thái không bị bộ lọc trạng thái, Excel trả file xlsx và ghi nhật ký', async () => {
      const drugId = await createDrug(adminBToken, 'Hàng bảy');
      await submitted(adminBToken, whB, [{ drugId, requestedQty: 2 }]);
      const all = await http().get('/api/v1/inventory/requests').query({ view: 'mine' }).set(authed(adminBToken));
      expect(all.status).toBe(200);
      const counts = all.body.data.statusCounts as Record<string, number>;
      expect(counts.SUBMITTED).toBeGreaterThanOrEqual(1);
      const filtered = await http().get('/api/v1/inventory/requests').query({ view: 'mine', status: 'SUBMITTED' }).set(authed(adminBToken));
      expect((filtered.body.data.items as { status: string }[]).every((r) => r.status === 'SUBMITTED')).toBe(true);
      expect(filtered.body.data.statusCounts.SUBMITTED).toBe(counts.SUBMITTED);

      const excel = await http().get('/api/v1/inventory/requests/export').query({ view: 'mine' }).set(authed(adminBToken)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(excel.status).toBe(200);
      expect(excel.headers['content-type']).toContain('spreadsheetml');
      expect((excel.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'stock_request.exported' } });
      expect(audit).not.toBeNull();
    });
  });

  describe('cô lập tenant và chi nhánh', () => {
    it('chi nhánh C và công ty B không thấy, không thao tác được phiếu của chi nhánh B → A', async () => {
      const drugId = await createDrug(adminBToken, 'Hàng tám');
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 2 }]);
      for (const token of [adminCToken, tenantBAdminToken]) {
        expect((await http().get(`/api/v1/inventory/requests/${d.id}`).set(authed(token))).status).toBe(404);
        expect((await http().post(`/api/v1/inventory/requests/${d.id}/accept`).set(authed(token)).send({ version: d.version })).status).toBe(404);
        expect((await http().post(`/api/v1/inventory/requests/${d.id}/cancel`).set(authed(token)).send({ version: d.version, reason: 'x' })).status).toBe(404);
        expect((await http().patch(`/api/v1/inventory/requests/${d.id}`).set(authed(token)).send({ requestingWarehouseId: whB, version: d.version, lines: [{ drugId, requestedQty: 1 }] })).status).toBe(404);
        for (const view of ['mine', 'incoming']) {
          const list = await http().get('/api/v1/inventory/requests').query({ view }).set(authed(token));
          expect((list.body.data.items as { id: string }[]).some((r) => r.id === d.id)).toBe(false);
        }
      }
      // Xin bằng kho của chi nhánh khác → 404.
      expect((await createRequest(adminCToken, whB, [{ drugId, requestedQty: 1 }])).status).toBe(404);
      // Kho cấp thấy tồn của bên xin chỉ ở dạng số lượng; bên xin không thấy tồn kho cấp.
      const supplierView = await get(adminAToken, d.id);
      const requesterView = (await http().get(`/api/v1/inventory/requests/${d.id}`).set(authed(adminBToken))).body.data as { lines: { supplierStock: number | null; requesterStockSnapshot: number | null }[] };
      expect(requesterView.lines[0]!.supplierStock).toBeNull();
      expect(requesterView.lines[0]!.requesterStockSnapshot).toBe(0);
      expect(JSON.stringify(supplierView)).not.toContain('unitCost');
    });

    it('chi nhánh C chưa có phiếu nào của mình; phiếu điều chuyển sinh ra không lộ cho chi nhánh C', async () => {
      const drugId = await createDrug(adminAToken, 'Hàng chín');
      await stockIn(adminAToken, whA, drugId, 5);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 5 }]);
      const acc = await accept(adminAToken, d);
      const allocated = await http().post(`/api/v1/inventory/requests/${d.id}/allocate`).set(authed(adminAToken)).send({ version: acc.version, lines: [{ lineId: acc.lines[0]!.id, allocateQty: 5 }] });
      const transferId = (allocated.body.data as Detail).transfers[0]!.id;
      expect((await http().get(`/api/v1/inventory/transfers/${transferId}`).set(authed(adminCToken))).status).toBe(404);
      // Bên xin chưa mở được phiếu điều chuyển còn Nháp của chi nhánh cấp.
      const requesterView = await get(adminBToken, d.id);
      expect(requesterView.transfers[0]).toMatchObject({ canOpen: false, status: 'DRAFT' });
      expect((await http().get(`/api/v1/inventory/transfers/${transferId}`).set(authed(adminBToken))).status).toBe(404);
      await shipTransfer(adminAToken, transferId);
      expect((await get(adminBToken, d.id)).transfers[0]).toMatchObject({ canOpen: true, status: 'IN_TRANSIT' });
      expect((await http().get(`/api/v1/inventory/transfers/${transferId}`).set(authed(adminBToken))).status).toBe(200);
    });
  });
  describe('tab "Hàng cần bổ sung" (mockup màn 4)', () => {
    type Restock = { warehouseId: string | null; canRequestUp: boolean; stats: { belowMin: number; deptWaiting: number; waitingArrival: number; requestedUp: number }; items: { drugId: string; onHand: number; minStock: number; deptWaitingQty: number; deptWaitingRequestNos: string[]; suggestedQty: number }[] };
    const restock = async (token: string) => {
      const res = await http().get('/api/v1/inventory/requests/restock').set(authed(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data as Restock;
    };

    it('kho chính chi nhánh chính: tồn dưới mức tối thiểu kèm phần chi nhánh/phòng ban đang chờ, gợi ý = tối thiểu - tồn + đang chờ', async () => {
      const drugId = await createDrug(adminAToken, 'Hàng cần bổ sung');
      await stockIn(adminAToken, whA, drugId, 4);
      const d = await submitted(adminBToken, whB, [{ drugId, requestedQty: 8 }]);
      const view = await restock(adminAToken);
      expect(view.warehouseId).toBe(whA);
      // Chi nhánh chính không có cấp trên để xin.
      expect(view.canRequestUp).toBe(false);
      const item = view.items.find((i) => i.drugId === drugId)!;
      expect(item).toMatchObject({ onHand: 4, minStock: 20, deptWaitingQty: 8, suggestedQty: 24 });
      expect(item.deptWaitingRequestNos).toContain(d.requestNo);
      expect(view.stats.belowMin).toBe(view.items.length);
      expect(view.stats.deptWaiting).toBeGreaterThanOrEqual(1);
    });

    it('phần đã giao không tính là đang chờ; mặt hàng đủ tồn không xuất hiện', async () => {
      const drugId = await createDrug(adminAToken, 'Hàng đủ tồn');
      await stockIn(adminAToken, whA, drugId, 100);
      expect((await restock(adminAToken)).items.some((i) => i.drugId === drugId)).toBe(false);
    });

    it('kho chính chi nhánh phụ: có cấp trên để xin, chỉ thấy kho của mình; công ty khác và lễ tân không vào được', async () => {
      const drugId = await createDrug(adminAToken, 'Hàng chi nhánh B');
      await stockIn(adminBToken, whB, drugId, 3);
      const view = await restock(adminBToken);
      expect(view.warehouseId).toBe(whB);
      expect(view.canRequestUp).toBe(true);
      expect(view.items.find((i) => i.drugId === drugId)).toMatchObject({ onHand: 3, suggestedQty: 17 });
      const other = await restock(adminAToken);
      expect(other.items.find((i) => i.drugId === drugId)?.onHand).toBe(0);
      const tenantB = await http().get('/api/v1/inventory/requests/restock').set(authed(tenantBAdminToken));
      expect(tenantB.status).toBe(200);
      expect((tenantB.body.data as Restock).items.some((i) => i.drugId === drugId)).toBe(false);
      expect((await http().get('/api/v1/inventory/requests/restock').set(authed(receptionistToken))).status).toBe(403);
    });
  });

  describe('mockup màn 2 và 5: tiến độ cấp, lọc, liên kết chờ hàng', () => {
    type ListItem = { id: string; requestNo: string; activeLineCount: number; allocatedLineCount: number; waitingLineCount: number; pendingLineCount: number; earliestWaitDate: string | null; requestingDepartmentName: string | null; readyToSupply: boolean };
    const listMine = async (token: string, query: Record<string, string> = {}) => {
      const res = await http().get('/api/v1/inventory/requests').set(authed(token)).query({ view: 'mine', ...query });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.items as ListItem[];
    };
    const allocate = (token: string, id: string, version: number, lines: Record<string, unknown>[]) => http().post(`/api/v1/inventory/requests/${id}/allocate`).set(authed(token)).send({ version, lines });

    it('cột Tiến độ cấp: danh sách trả số dòng còn hiệu lực/đã cấp/chờ hàng về/chưa xử lý và ngày dự kiến sớm nhất; tìm theo mặt hàng; lọc theo kho xin', async () => {
      const drugX = await createDrug(adminBToken, 'Khẩu trang tiến độ X');
      const drugY = await createDrug(adminBToken, 'Khẩu trang tiến độ Y');
      const drugZ = await createDrug(adminBToken, 'Khẩu trang tiến độ Z');
      await stockIn(adminBToken, whB, drugX, 5);
      const d = await submitted(adminBToken, whB2, [{ drugId: drugX, requestedQty: 5 }, { drugId: drugY, requestedQty: 4 }, { drugId: drugZ, requestedQty: 3 }]);
      const acc = await accept(adminBToken, d);
      const lineOf = (drugId: string) => acc.lines.find((l) => l.drugId === drugId)!.id;

      // Mới tiếp nhận: 3 dòng còn hiệu lực, chưa dòng nào được cấp.
      const before = (await listMine(adminBToken)).find((i) => i.id === d.id)!;
      expect(before).toMatchObject({ activeLineCount: 3, allocatedLineCount: 0, waitingLineCount: 0, pendingLineCount: 3, earliestWaitDate: null });

      // Cấp đủ X; Y chờ hàng về dự kiến 01-12; Z chờ hàng về dự kiến 15-11 (sớm hơn); không dòng nào còn chưa xử lý.
      const res = await allocate(adminBToken, d.id, acc.version, [
        { lineId: lineOf(drugX), allocateQty: 5 },
        { lineId: lineOf(drugY), allocateQty: 0, remainder: { action: 'WAIT', reason: 'Đang đặt thêm', expectedDate: '2026-12-01' } },
        { lineId: lineOf(drugZ), allocateQty: 0, remainder: { action: 'WAIT', reason: 'Đang đặt thêm', expectedDate: '2026-11-15' } },
      ]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = (await listMine(adminBToken)).find((i) => i.id === d.id)!;
      expect(after).toMatchObject({ activeLineCount: 3, allocatedLineCount: 1, waitingLineCount: 2, pendingLineCount: 0, earliestWaitDate: '2026-11-15', requestingDepartmentName: null });

      // Tìm theo tên mặt hàng (không chỉ số phiếu) và theo số phiếu.
      expect((await listMine(adminBToken, { q: 'tiến độ Z' })).some((i) => i.id === d.id)).toBe(true);
      expect((await listMine(adminBToken, { q: d.requestNo.slice(-6) })).some((i) => i.id === d.id)).toBe(true);
      expect((await listMine(adminBToken, { q: 'không có mặt hàng nào tên thế này' })).length).toBe(0);

      // Ô lọc kho của tab "Yêu cầu của tôi" là KHO XIN: đúng kho xin thấy phiếu, kho khác thì không.
      expect((await listMine(adminBToken, { warehouseId: whB2 })).some((i) => i.id === d.id)).toBe(true);
      expect((await listMine(adminBToken, { warehouseId: whB })).some((i) => i.id === d.id)).toBe(false);
    });

    it('hộp Chờ hàng về: phiếu chi tiết trả các phiếu xin phần thiếu (con); dòng có thể chờ phiếu con đó; phiếu lạ hoặc của phiếu khác bị từ chối', async () => {
      const drugX = await createDrug(adminBToken, 'Liên kết con X');
      const drugY = await createDrug(adminBToken, 'Liên kết con Y');
      const d = await submitted(adminBToken, whB2, [{ drugId: drugX, requestedQty: 6 }, { drugId: drugY, requestedQty: 4 }]);
      const acc = await accept(adminBToken, d);
      const lineX = acc.lines.find((l) => l.drugId === drugX)!.id;
      const lineY = acc.lines.find((l) => l.drugId === drugY)!.id;

      // Chưa xin cấp trên: chưa có phiếu con.
      expect((acc as unknown as { childRequests: unknown[] }).childRequests).toEqual([]);

      // Xin phần thiếu của dòng X lên cấp trên → sinh phiếu con, dòng X tự gắn phiếu con.
      const esc = await http().post(`/api/v1/inventory/requests/${d.id}/escalate`).set(authed(adminBToken)).send({ version: acc.version, lineIds: [lineX] });
      expect(esc.status, JSON.stringify(esc.body)).toBe(200);
      const parent = esc.body.data.parent as Detail & { childRequests: { id: string; requestNo: string; status: string; supplyingBranchName: string }[]; lines: { id: string; waitChildRequestId: string | null; waitChildRequestNo: string | null }[] };
      const child = esc.body.data.child as Detail;
      expect(parent.childRequests).toHaveLength(1);
      expect(parent.childRequests[0]).toMatchObject({ id: child.id, status: 'SUBMITTED' });

      // Dòng Y (chưa xử lý) chọn "chờ phiếu xin cấp trên" qua hộp Chờ hàng về → gắn đúng phiếu con.
      const linked = await allocate(adminBToken, d.id, parent.version, [{ lineId: lineY, allocateQty: 0, remainder: { action: 'WAIT', reason: 'Chờ chi nhánh chính cấp', childRequestId: child.id } }]);
      expect(linked.status, JSON.stringify(linked.body)).toBe(200);
      const afterLink = linked.body.data as { lines: { id: string; waitChildRequestId: string | null; waitChildRequestNo: string | null }[] };
      expect(afterLink.lines.find((l) => l.id === lineY)).toMatchObject({ waitChildRequestId: child.id, waitChildRequestNo: child.requestNo });
      // Dòng X vẫn giữ liên kết cũ.
      expect(afterLink.lines.find((l) => l.id === lineX)?.waitChildRequestId).toBe(child.id);

      // Phiếu con không thuộc phiếu này → 422 (không gắn được phiếu của người khác).
      const drugW = await createDrug(adminBToken, 'Liên kết con W');
      const other = await submitted(adminBToken, whB2, [{ drugId: drugW, requestedQty: 2 }]);
      const otherAcc = await accept(adminBToken, other);
      const foreign = await allocate(adminBToken, other.id, otherAcc.version, [{ lineId: otherAcc.lines[0]!.id, allocateQty: 0, remainder: { action: 'WAIT', reason: 'x', childRequestId: child.id } }]);
      expect(foreign.status).toBe(422);
      expect(foreign.body.error.code).toBe('STOCK_REQUEST_ALLOCATION_INVALID');
      const unknown = await allocate(adminBToken, other.id, otherAcc.version, [{ lineId: otherAcc.lines[0]!.id, allocateQty: 0, remainder: { action: 'WAIT', reason: 'x', childRequestId: randomUUID() } }]);
      expect(unknown.status).toBe(422);
    });

    it('"Hàng đã về" giữ chỗ tồn theo thứ tự phiếu: tồn chỉ đủ cho phiếu cũ thì chỉ phiếu cũ nổi nhãn, nhập thêm đủ thì phiếu mới nổi nhãn', async () => {
      const drugId = await createDrug(adminBToken, 'Giữ chỗ tồn');
      const waitAll = async (token: string, lines: { lineId: string }[], version: number, id: string) => allocate(token, id, version, lines.map((l) => ({ lineId: l.lineId, allocateQty: 0, remainder: { action: 'WAIT', reason: 'Đang đặt thêm' } })));
      // Phiếu cũ xin 8, phiếu mới xin 5, cùng kho cấp whB, cùng chờ hàng về (kho cấp chưa có tồn).
      const older = await submitted(adminBToken, whB2, [{ drugId, requestedQty: 8 }]);
      const olderAcc = await accept(adminBToken, older);
      expect((await waitAll(adminBToken, [{ lineId: olderAcc.lines[0]!.id }], olderAcc.version, older.id)).status).toBe(200);
      const newer = await submitted(adminBToken, whB2, [{ drugId, requestedQty: 5 }]);
      const newerAcc = await accept(adminBToken, newer);
      expect((await waitAll(adminBToken, [{ lineId: newerAcc.lines[0]!.id }], newerAcc.version, newer.id)).status).toBe(200);

      const readyOf = async () => {
        const res = await http().get('/api/v1/inventory/requests').set(authed(adminBToken)).query({ view: 'incoming', limit: 100 });
        const items = res.body.data.items as ListItem[];
        return { older: items.find((i) => i.id === older.id)!.readyToSupply, newer: items.find((i) => i.id === newer.id)!.readyToSupply };
      };
      expect(await readyOf()).toEqual({ older: false, newer: false });

      // Tồn 10: đủ cho phiếu cũ (8), phần còn lại 2 không đủ cho phiếu mới (5) → chỉ phiếu cũ nổi nhãn.
      await stockIn(adminBToken, whB, drugId, 10);
      expect(await readyOf()).toEqual({ older: true, newer: false });

      // Nhập thêm 3 (tổng 13 = 8 + 5): đủ cho cả hai.
      await stockIn(adminBToken, whB, drugId, 3);
      expect(await readyOf()).toEqual({ older: true, newer: true });
    });

    it('ma trận bên xin (mockup màn 6b): đổi ngày cần làm được khi còn mở; phiếu đã huỷ thì mọi nút của bên xin đều bị chặn 409', async () => {
      const drugId = await createDrug(adminBToken, 'Ma trận bên xin');
      const d = await submitted(adminBToken, whB2, [{ drugId, requestedQty: 3 }]);

      // Đã gửi: đổi ngày cần hàng (không cần nhắn) được.
      const dated = await http().post(`/api/v1/inventory/requests/${d.id}/note`).set(authed(adminBToken)).send({ version: d.version, neededBy: '2026-12-25' });
      expect(dated.status, JSON.stringify(dated.body)).toBe(200);
      expect(dated.body.data.neededBy).toBe('2026-12-25');

      // Huỷ (kho cấp chưa tiếp nhận) rồi thử mọi thao tác của bên xin → 409.
      const cancelled = await http().post(`/api/v1/inventory/requests/${d.id}/cancel`).set(authed(adminBToken)).send({ version: dated.body.data.version, reason: 'Không cần nữa' });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const closed = cancelled.body.data as Detail;
      const lineId = closed.lines[0]!.id;
      const other = await createDrug(adminBToken, 'Ma trận bên xin thêm');
      const attempts = [
        http().post(`/api/v1/inventory/requests/${d.id}/note`).set(authed(adminBToken)).send({ version: closed.version, message: 'Nhắn thêm' }),
        http().post(`/api/v1/inventory/requests/${d.id}/lines`).set(authed(adminBToken)).send({ version: closed.version, lines: [{ drugId: other, requestedQty: 1 }] }),
        http().post(`/api/v1/inventory/requests/${d.id}/withdraw-lines`).set(authed(adminBToken)).send({ version: closed.version, lineIds: [lineId], reason: 'x' }),
        http().post(`/api/v1/inventory/requests/${d.id}/cancel`).set(authed(adminBToken)).send({ version: closed.version, reason: 'x' }),
        http().patch(`/api/v1/inventory/requests/${d.id}`).set(authed(adminBToken)).send({ version: closed.version, requestingWarehouseId: whB2, lines: [{ drugId, requestedQty: 1 }] }),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status, JSON.stringify(res.body)).toBe(409);
    });

    it('chấm số "Cần duyệt": hàng đã về được đếm riêng, phiếu thuộc nhiều nhóm chỉ đếm một lần; chi nhánh khác không bị ảnh hưởng', async () => {
      const drugId = await createDrug(adminBToken, 'Đếm hàng đã về');
      await stockIn(adminBToken, whB, drugId, 3);
      const d = await submitted(adminBToken, whB2, [{ drugId, requestedQty: 10 }]);
      const acc = await accept(adminBToken, d);
      const counts = async (token: string) => (await http().get('/api/v1/inventory/requests/pending-counts').set(authed(token))).body.data as { toAccept: number; updated: number; ready: number; actionable: number };
      const base = await counts(adminBToken);

      // Cấp 3, 7 còn lại chờ hàng về; kho cấp chưa đủ tồn nên CHƯA "hàng đã về".
      const part = await allocate(adminBToken, d.id, acc.version, [{ lineId: acc.lines[0]!.id, allocateQty: 3, remainder: { action: 'WAIT', reason: 'Đang đặt thêm' } }]);
      expect(part.status, JSON.stringify(part.body)).toBe(200);
      expect((await counts(adminBToken)).ready).toBe(base.ready);

      // Nhập thêm đủ 7: phiếu nổi "Hàng đã về" → ready tăng 1; actionable tăng đúng 1.
      await stockIn(adminBToken, whB, drugId, 7);
      const withReady = await counts(adminBToken);
      expect(withReady.ready).toBe(base.ready + 1);
      expect(withReady.actionable).toBe(base.actionable + 1);
      expect(withReady.actionable).toBeGreaterThanOrEqual(withReady.toAccept);
      const incoming = await http().get('/api/v1/inventory/requests').set(authed(adminBToken)).query({ view: 'incoming' });
      expect((incoming.body.data.items as ListItem[]).find((i) => i.id === d.id)?.readyToSupply).toBe(true);

      // Chi nhánh C không thấy phiếu của B: mọi số đếm của C không đổi vì B.
      const c = await counts(adminCToken);
      expect(c).toEqual({ toAccept: 0, updated: 0, ready: 0, actionable: 0 });
    });
  });
});
