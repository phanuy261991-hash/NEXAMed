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
 * HTTP e2e cho "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2). Chi nhánh A = chi nhánh chính (kho whA); chi nhánh B có kho whB; chi nhánh C để kiểm cô lập.
 * `adminA` không có dòng gán (→ chi nhánh mặc định A), `adminB` chỉ gán B, `adminC` chỉ gán C. Giữ số lần đăng nhập thấp (rate limit /auth/login).
 */
describe('HTTP e2e — /api/v1/inventory/purchase-orders (Đơn đặt hàng NCC)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminAToken: string;
  let adminBToken: string;
  let adminCToken: string;
  let tenantBAdminToken: string;
  let receptionistToken: string;
  let whA: string;
  let whB: string;
  let whC: string;
  let supplierId: string;
  let otherSupplierId: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string) {
    const username = `e2e-po-${label}-${randomUUID()}`;
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

  type OrderLine = { id: string; drugId: string; quantity: number; receivedQty: number; remainingQty: number; sourceRequests: { requestNo: string }[] };
  type Order = {
    id: string;
    orderNo: string;
    version: number;
    status: string;
    warehouseId: string;
    totalAmount: number;
    receivedLineCount: number;
    draftReceiptCount: number;
    requiresMainApproval: boolean;
    canActAsApprover: boolean;
    isOwnBranch: boolean;
    lines: OrderLine[];
    receipts: { id: string; status: string; voided: boolean }[];
  };

  async function createOrder(token: string, warehouseId: string, lines: { drugId: string; quantity: number; unitCode?: string; expectedUnitCost?: number; sourceRequestLineId?: string }[], extra: { supplierId?: string } = {}) {
    return http()
      .post('/api/v1/inventory/purchase-orders')
      .set(authed(token))
      .send({ supplierId: extra.supplierId ?? supplierId, warehouseId, lines: lines.map((l) => ({ unitCode: 'VIEN', ...l })) });
  }

  async function made(token: string, warehouseId: string, lines: { drugId: string; quantity: number; expectedUnitCost?: number }[]): Promise<Order> {
    const res = await createOrder(token, warehouseId, lines);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Order;
  }

  async function get(token: string, id: string): Promise<Order> {
    const res = await http().get(`/api/v1/inventory/purchase-orders/${id}`).set(authed(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Order;
  }

  async function act(token: string, id: string, action: string, version: number, extra: Record<string, unknown> = {}) {
    return http().post(`/api/v1/inventory/purchase-orders/${id}/${action}`).set(authed(token)).send({ version, ...extra });
  }

  async function approveAndOrder(token: string, o: Order): Promise<Order> {
    const approved = await act(token, o.id, 'approve', o.version);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const ordered = await act(token, o.id, 'order', (approved.body.data as Order).version);
    expect(ordered.status, JSON.stringify(ordered.body)).toBe(200);
    return ordered.body.data as Order;
  }

  /** Phiếu nhập mua hàng theo đơn: mỗi phần tử là [dòng đơn, số nhận]. */
  async function receiptFor(token: string, o: Order, picks: [OrderLine, number][], extra: Record<string, unknown> = {}) {
    return http()
      .post('/api/v1/inventory/receipts')
      .set(authed(token))
      .send({
        warehouseId: o.warehouseId,
        supplierId,
        receiptType: 'PURCHASE',
        purchaseOrderId: o.id,
        lines: picks.map(([line, qty]) => ({ drugId: line.drugId, unitCode: 'VIEN', quantity: qty, unitCost: 1000, purchaseOrderLineId: line.id })),
        ...extra,
      });
  }

  async function receiveAndApprove(token: string, o: Order, picks: [OrderLine, number][]): Promise<string> {
    const created = await receiptFor(token, o, picks);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(token)).send({ version: created.body.data.version });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    return created.body.data.id as string;
  }

  async function setSettings(body: Record<string, boolean>) {
    const res = await http().patch('/api/v1/clinic-settings').set(authed(adminAToken)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
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

    fixture = await createTwoTenantFixture(privileged, 'PurchaseOrder e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    const branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    const adminA = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminA');
    adminAToken = await login(fixture.tenantA.id, adminA.username);
    const mkBranch = async (name: string) => {
      const created = await http().post('/api/v1/branches').set(authed(adminAToken)).send({ name, address: '1 Test', phone: '0283777556' });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      return created.body.data.id as string;
    };
    const branchB = await mkBranch('Chi nhánh Thủ Đức');
    const branchC = await mkBranch('Chi nhánh Quận 7');
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
    whC = (await privileged.warehouse.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchC, deletedAt: null } })).id;
    const s1 = await http().post('/api/v1/suppliers').set(authed(adminAToken)).send({ name: `NCC PO ${randomUUID().slice(0, 6)}` });
    expect(s1.status, JSON.stringify(s1.body)).toBe(200);
    supplierId = s1.body.data.id as string;
    const s2 = await http().post('/api/v1/suppliers').set(authed(adminAToken)).send({ name: `NCC PO khác ${randomUUID().slice(0, 6)}` });
    otherSupplierId = s2.body.data.id as string;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('quyền và dữ liệu đầu vào', () => {
    it('không có access token → 401; lễ tân không có quyền purchase_order → 403', async () => {
      expect((await http().get('/api/v1/inventory/purchase-orders')).status).toBe(401);
      expect((await http().get('/api/v1/inventory/purchase-orders').set(authed(receptionistToken))).status).toBe(403);
    });

    it('thiếu dòng / trùng mặt hàng / số đặt <= 0 → 400; mã đơn bắt đầu DDH, tổng dự kiến chỉ cộng dòng có đơn giá', async () => {
      const drugId = await createDrug(adminAToken);
      const d2 = await createDrug(adminAToken, 'Bơm tiêm');
      expect((await createOrder(adminAToken, whA, [])).status).toBe(400);
      expect((await createOrder(adminAToken, whA, [{ drugId, quantity: 1 }, { drugId, quantity: 2 }])).status).toBe(400);
      expect((await createOrder(adminAToken, whA, [{ drugId, quantity: 0 }])).status).toBe(400);
      const o = await made(adminAToken, whA, [{ drugId, quantity: 10, expectedUnitCost: 2000 }, { drugId: d2, quantity: 5 }]);
      expect(o.orderNo).toMatch(/^DDH/);
      expect(o.status).toBe('DRAFT');
      expect(o.totalAmount).toBe(20000);
    });

    it('đơn vị ngoài chuỗi quy đổi → 422', async () => {
      const drugId = await createDrug(adminAToken);
      expect((await createOrder(adminAToken, whA, [{ drugId, quantity: 1, unitCode: 'HOP' }])).status).toBe(422);
    });
  });

  describe('vòng đời và nhận hàng nhiều đợt', () => {
    it('Nháp → Duyệt → Đặt NCC → nhận 2 đợt → Đã nhận đủ; nhận vượt bị chặn; huỷ phiếu nhập đã duyệt lùi trạng thái', async () => {
      const drugId = await createDrug(adminAToken);
      let o = await made(adminAToken, whA, [{ drugId, quantity: 10 }]);
      // Chưa đặt NCC thì chưa nhận hàng theo đơn được.
      const early = await receiptFor(adminAToken, o, [[o.lines[0]!, 5]]);
      expect(early.status).toBe(409);
      o = await approveAndOrder(adminAToken, o);
      expect(o.status).toBe('ORDERED');

      const first = await receiveAndApprove(adminAToken, o, [[o.lines[0]!, 6]]);
      o = await get(adminAToken, o.id);
      expect(o.status).toBe('PARTIALLY_RECEIVED');
      expect(o.lines[0]).toMatchObject({ receivedQty: 6, remainingQty: 4 });

      const over = await receiptFor(adminAToken, o, [[o.lines[0]!, 5]]);
      expect(over.status).toBe(422);
      expect(over.body.error.code).toBe('PURCHASE_ORDER_OVER_RECEIPT');

      await receiveAndApprove(adminAToken, o, [[o.lines[0]!, 4]]);
      o = await get(adminAToken, o.id);
      expect(o.status).toBe('RECEIVED');
      expect(o.receivedLineCount).toBe(1);

      // Huỷ phiếu nhập đợt 1 (đã duyệt) → số đã nhận giảm, đơn lùi về Nhận một phần.
      const voided = await http().post(`/api/v1/inventory/receipts/${first}/void`).set(authed(adminAToken)).send({ version: 2, reason: 'Nhập nhầm đợt 1' });
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      o = await get(adminAToken, o.id);
      expect(o.status).toBe('PARTIALLY_RECEIVED');
      expect(o.lines[0]).toMatchObject({ receivedQty: 4, remainingQty: 6 });
    });

    it('phiếu nhập lệch đơn (NCC khác, kho khác, mặt hàng lạ, đơn vị khác, thiếu dòng đơn) → 422', async () => {
      const drugId = await createDrug(adminAToken);
      const stranger = await createDrug(adminAToken, 'Hàng lạ');
      const o = await approveAndOrder(adminAToken, await made(adminAToken, whA, [{ drugId, quantity: 10 }]));
      const line = o.lines[0]!;
      expect((await receiptFor(adminAToken, o, [[line, 1]], { supplierId: otherSupplierId })).status).toBe(422);
      const wrongWh = await privileged.warehouse.create({ data: { tenantId: fixture.tenantA.id, branchId: (await privileged.warehouse.findFirstOrThrow({ where: { id: whA } })).branchId, code: `K-${randomUUID().slice(0, 6)}`, name: 'Kho phụ test', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      expect((await receiptFor(adminAToken, o, [[line, 1]], { warehouseId: wrongWh.id })).status).toBe(422);
      expect((await receiptFor(adminAToken, o, [[{ ...line, drugId: stranger }, 1]])).status).toBe(422);
      const noLine = await http()
        .post('/api/v1/inventory/receipts')
        .set(authed(adminAToken))
        .send({ warehouseId: o.warehouseId, supplierId, receiptType: 'PURCHASE', purchaseOrderId: o.id, lines: [{ drugId, unitCode: 'VIEN', quantity: 1, unitCost: 1000 }] });
      expect(noLine.status).toBe(400);
    });

    it('công tắc "Cho phép nhận vượt số đặt" BẬT → nhận vượt được; TẮT lại thì chặn', async () => {
      const drugId = await createDrug(adminAToken);
      const o = await approveAndOrder(adminAToken, await made(adminAToken, whA, [{ drugId, quantity: 3 }]));
      expect((await receiptFor(adminAToken, o, [[o.lines[0]!, 5]])).status).toBe(422);
      await setSettings({ allowOverReceipt: true });
      try {
        expect((await receiptFor(adminAToken, o, [[o.lines[0]!, 5]])).status).toBe(200);
      } finally {
        await setSettings({ allowOverReceipt: false });
      }
    });

    it('duyệt lại lúc Duyệt phiếu nhập: đơn bị đóng sau khi lập Nháp thì không duyệt được phiếu nhập (409)', async () => {
      const drugId = await createDrug(adminAToken);
      const o = await approveAndOrder(adminAToken, await made(adminAToken, whA, [{ drugId, quantity: 5 }]));
      const draft = await receiptFor(adminAToken, o, [[o.lines[0]!, 2]]);
      expect(draft.status).toBe(200);
      // Còn phiếu nhập Nháp → không đóng được đơn.
      const blocked = await act(adminAToken, o.id, 'close', o.version, { reason: 'NCC hết hàng' });
      expect(blocked.status).toBe(409);
      // Bỏ phiếu Nháp (từ chối) rồi đóng đơn.
      const rejected = await http().post(`/api/v1/inventory/receipts/${draft.body.data.id}/reject`).set(authed(adminAToken)).send({ version: draft.body.data.version, reason: 'Làm lại' });
      expect(rejected.status).toBe(200);
      const closed = await act(adminAToken, o.id, 'close', o.version, { reason: 'NCC hết hàng' });
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      expect((closed.body.data as Order).status).toBe('CLOSED');
      expect((await receiptFor(adminAToken, o, [[o.lines[0]!, 1]])).status).toBe(409);
    });

    it('danh sách Phiếu nhập kho lọc "Từ đơn" và hiện số đơn', async () => {
      const drugId = await createDrug(adminAToken);
      const o = await approveAndOrder(adminAToken, await made(adminAToken, whA, [{ drugId, quantity: 2 }]));
      await receiveAndApprove(adminAToken, o, [[o.lines[0]!, 2]]);
      const yes = await http().get('/api/v1/inventory/receipts').set(authed(adminAToken)).query({ fromOrder: 'yes' });
      expect(yes.status).toBe(200);
      const items = yes.body.data.items as { purchaseOrderNo: string | null }[];
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.purchaseOrderNo !== null)).toBe(true);
      expect(items.some((i) => i.purchaseOrderNo === o.orderNo)).toBe(true);
      const no = await http().get('/api/v1/inventory/receipts').set(authed(adminAToken)).query({ fromOrder: 'no' });
      expect((no.body.data.items as { purchaseOrderNo: string | null }[]).every((i) => i.purchaseOrderNo === null)).toBe(true);
    });
  });

  describe('sổ công nợ NCC (mockup màn 12)', () => {
    it('bút toán của phiếu nhập theo đơn hiện số đơn và đợt nhận (1, 2); phiếu lập tay không có', async () => {
      const drugId = await createDrug(adminAToken, 'Hàng sổ công nợ');
      const o = await approveAndOrder(adminAToken, await made(adminAToken, whA, [{ drugId, quantity: 10 }]));
      const r1 = await receiveAndApprove(adminAToken, o, [[o.lines[0]!, 6]]);
      const r2 = await receiveAndApprove(adminAToken, o, [[o.lines[0]!, 4]]);
      const ledger = await http().get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(adminAToken));
      expect(ledger.status, JSON.stringify(ledger.body)).toBe(200);
      const items = ledger.body.data.items as { stockReceiptId: string | null; purchaseOrderNo: string | null; purchaseOrderRound: number | null }[];
      expect(items.find((i) => i.stockReceiptId === r1)).toMatchObject({ purchaseOrderNo: o.orderNo, purchaseOrderRound: 1 });
      expect(items.find((i) => i.stockReceiptId === r2)).toMatchObject({ purchaseOrderNo: o.orderNo, purchaseOrderRound: 2 });
      // Chi nhánh khác công ty không đọc được sổ này.
      expect((await http().get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(tenantBAdminToken))).status).toBe(404);
    });
  });

  describe('huỷ, từ chối và sửa', () => {
    it('huỷ Nháp (lý do bắt buộc); đơn đã nhận hàng không huỷ được (409); sửa đơn đã đặt NCC bị chặn', async () => {
      const drugId = await createDrug(adminAToken);
      const draft = await made(adminAToken, whA, [{ drugId, quantity: 4 }]);
      expect((await act(adminAToken, draft.id, 'cancel', draft.version, { reason: '' })).status).toBe(400);
      const cancelled = await act(adminAToken, draft.id, 'cancel', draft.version, { reason: 'Đặt nhầm' });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect((cancelled.body.data as Order).status).toBe('CANCELLED');

      const o = await approveAndOrder(adminAToken, await made(adminAToken, whA, [{ drugId, quantity: 4 }]));
      const patch = await http().patch(`/api/v1/inventory/purchase-orders/${o.id}`).set(authed(adminAToken)).send({ version: o.version, supplierId, warehouseId: whA, lines: [{ drugId, unitCode: 'VIEN', quantity: 9 }] });
      expect(patch.status).toBe(409);
      await receiveAndApprove(adminAToken, o, [[o.lines[0]!, 1]]);
      const current = await get(adminAToken, o.id);
      expect((await act(adminAToken, o.id, 'cancel', current.version, { reason: 'Muộn rồi' })).status).toBe(409);
    });

    it('phiên bản cũ (version lệch) → 409 xung đột', async () => {
      const drugId = await createDrug(adminAToken);
      const o = await made(adminAToken, whA, [{ drugId, quantity: 4 }]);
      const stale = await act(adminAToken, o.id, 'approve', o.version + 5);
      expect(stale.status).toBe(409);
    });
  });

  describe('duyệt theo chi nhánh', () => {
    it('công tắc "cần chi nhánh chính duyệt": chi nhánh phụ không tự duyệt; chi nhánh chính duyệt được; chi nhánh khác không thấy', async () => {
      await setSettings({ branchPurchaseNeedsMainApproval: true });
      try {
        const drugId = await createDrug(adminAToken);
        const o = await made(adminBToken, whB, [{ drugId, quantity: 7, expectedUnitCost: 1500 }]);
        expect(o.requiresMainApproval).toBe(true);
        // Tự duyệt ngay trên Nháp bị chặn (phía duyệt là chi nhánh chính).
        const self = await act(adminBToken, o.id, 'approve', o.version);
        expect(self.status).toBe(403);
        expect(self.body.error.code).toBe('PURCHASE_ORDER_APPROVER_BRANCH');
        const submitted = await act(adminBToken, o.id, 'submit', o.version);
        expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
        const pending = submitted.body.data as Order;
        expect(pending.status).toBe('PENDING_APPROVAL');
        expect((await act(adminBToken, o.id, 'approve', pending.version)).status).toBe(403);

        // Chi nhánh C không thấy; chi nhánh chính (A) thấy trong tab "Cần tôi duyệt" và mở được ở chế độ duyệt.
        expect((await http().get(`/api/v1/inventory/purchase-orders/${o.id}`).set(authed(adminCToken))).status).toBe(404);
        const viewA = await get(adminAToken, o.id);
        expect(viewA).toMatchObject({ isOwnBranch: false, canActAsApprover: true });
        const list = await http().get('/api/v1/inventory/purchase-orders').set(authed(adminAToken)).query({ view: 'approval' });
        expect((list.body.data.items as { id: string }[]).map((i) => i.id)).toContain(o.id);
        const mine = await http().get('/api/v1/inventory/purchase-orders').set(authed(adminAToken)).query({ view: 'mine' });
        expect((mine.body.data.items as { id: string }[]).map((i) => i.id)).not.toContain(o.id);
        const counts = await http().get('/api/v1/inventory/purchase-orders/pending-counts').set(authed(adminAToken));
        expect(counts.body.data.toApprove).toBeGreaterThanOrEqual(1);
        // Chi nhánh chính không sửa/đặt NCC hộ đơn của chi nhánh phụ.
        expect((await act(adminAToken, o.id, 'order', pending.version)).status).toBe(404);

        const approved = await act(adminAToken, o.id, 'approve', pending.version);
        expect(approved.status, JSON.stringify(approved.body)).toBe(200);
        expect((approved.body.data as Order).status).toBe('APPROVED');
        // Duyệt xong, chi nhánh chính chỉ xem lại được quyết định của mình (không thao tác thêm); chi nhánh C vẫn không thấy; chi nhánh B gửi nhà cung cấp.
        expect((await get(adminAToken, o.id)).isOwnBranch).toBe(false);
        expect((await act(adminAToken, o.id, 'cancel', (approved.body.data as Order).version, { reason: 'x' })).status).toBe(404);
        expect((await http().get(`/api/v1/inventory/purchase-orders/${o.id}`).set(authed(adminCToken))).status).toBe(404);
        const ordered = await act(adminBToken, o.id, 'order', (approved.body.data as Order).version);
        expect(ordered.status, JSON.stringify(ordered.body)).toBe(200);
        expect((ordered.body.data as Order).status).toBe('ORDERED');
      } finally {
        await setSettings({ branchPurchaseNeedsMainApproval: false });
      }
    });

    it('từ chối bắt buộc lý do; đơn bị từ chối sửa xong quay về Nháp rồi gửi duyệt lại', async () => {
      await setSettings({ branchPurchaseNeedsMainApproval: true });
      try {
        const drugId = await createDrug(adminAToken);
        const o = await made(adminBToken, whB, [{ drugId, quantity: 3 }]);
        const submitted = (await act(adminBToken, o.id, 'submit', o.version)).body.data as Order;
        expect((await act(adminAToken, o.id, 'reject', submitted.version, { reason: '' })).status).toBe(400);
        const rejected = await act(adminAToken, o.id, 'reject', submitted.version, { reason: 'Vượt ngân sách quý' });
        expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
        const r = rejected.body.data as Order;
        expect(r.status).toBe('REJECTED');
        const edited = await http().patch(`/api/v1/inventory/purchase-orders/${o.id}`).set(authed(adminBToken)).send({ version: r.version, supplierId, warehouseId: whB, lines: [{ drugId, unitCode: 'VIEN', quantity: 2 }] });
        expect(edited.status, JSON.stringify(edited.body)).toBe(200);
        expect(edited.body.data.status).toBe('DRAFT');
        expect(edited.body.data.rejectionReason).toBeNull();
        expect((await act(adminBToken, o.id, 'submit', edited.body.data.version)).status).toBe(200);
      } finally {
        await setSettings({ branchPurchaseNeedsMainApproval: false });
      }
    });

    it('công tắc "Cho phép chi nhánh đặt hàng NCC riêng" TẮT: chi nhánh phụ không lập đơn, không lập Phiếu nhập mua hàng; chi nhánh chính vẫn được', async () => {
      await setSettings({ branchPurchasingEnabled: false });
      try {
        const drugId = await createDrug(adminAToken);
        const blocked = await createOrder(adminBToken, whB, [{ drugId, quantity: 1 }]);
        expect(blocked.status).toBe(409);
        expect(blocked.body.error.code).toBe('BRANCH_PURCHASING_DISABLED');
        const receipt = await http().post('/api/v1/inventory/receipts').set(authed(adminBToken)).send({ warehouseId: whB, supplierId, receiptType: 'PURCHASE', lines: [{ drugId, unitCode: 'VIEN', quantity: 1, unitCost: 1000 }] });
        expect(receipt.status).toBe(409);
        expect(receipt.body.error.code).toBe('BRANCH_PURCHASING_DISABLED');
        // Nhập tồn đầu kỳ (không phải mua hàng) vẫn bình thường.
        const opening = await http().post('/api/v1/inventory/receipts').set(authed(adminBToken)).send({ warehouseId: whB, receiptType: 'OPENING_BALANCE', lines: [{ drugId, unitCode: 'VIEN', quantity: 1, unitCost: 1000 }] });
        expect(opening.status).toBe(200);
        expect((await createOrder(adminAToken, whA, [{ drugId, quantity: 1 }])).status).toBe(200);
        const options = await http().get('/api/v1/inventory/purchase-orders/options').set(authed(adminBToken));
        expect(options.body.data).toMatchObject({ canOrderHere: false, isMainBranch: false });
      } finally {
        await setSettings({ branchPurchasingEnabled: true });
      }
    });
  });

  describe('cô lập tenant và chi nhánh', () => {
    it('công ty khác và chi nhánh khác không thấy / không tạo được đơn của người khác', async () => {
      const drugId = await createDrug(adminAToken);
      const o = await made(adminAToken, whA, [{ drugId, quantity: 2 }]);
      expect((await http().get(`/api/v1/inventory/purchase-orders/${o.id}`).set(authed(tenantBAdminToken))).status).toBe(404);
      expect((await http().get(`/api/v1/inventory/purchase-orders/${o.id}`).set(authed(adminBToken))).status).toBe(404);
      expect((await http().get(`/api/v1/inventory/purchase-orders/${o.id}`).set(authed(adminCToken))).status).toBe(404);
      for (const token of [adminBToken, adminCToken, tenantBAdminToken]) {
        const list = await http().get('/api/v1/inventory/purchase-orders').set(authed(token));
        expect((list.body.data.items as { id: string }[]).map((i) => i.id)).not.toContain(o.id);
      }
      // Dùng kho của chi nhánh khác → 404; thao tác hộ đơn người khác → 404.
      expect((await createOrder(adminCToken, whB, [{ drugId, quantity: 1 }])).status).toBe(404);
      expect((await act(adminBToken, o.id, 'approve', o.version)).status).toBe(404);
      expect((await act(tenantBAdminToken, o.id, 'cancel', o.version, { reason: 'x' })).status).toBe(404);
      // Phiếu nhập của chi nhánh C không gắn được vào đơn của chi nhánh A.
      const approved = await approveAndOrder(adminAToken, o);
      const cross = await http()
        .post('/api/v1/inventory/receipts')
        .set(authed(adminCToken))
        .send({ warehouseId: whC, supplierId, receiptType: 'PURCHASE', purchaseOrderId: approved.id, lines: [{ drugId, unitCode: 'VIEN', quantity: 1, unitCost: 1000, purchaseOrderLineId: approved.lines[0]!.id }] });
      expect(cross.status).toBe(404);
    });
  });

  describe('liên kết với Yêu cầu cấp hàng', () => {
    async function waitingRequest(drugId: string, orderId: string | null) {
      // Chi nhánh B xin kho chính chi nhánh A; kho A hết hàng → dòng chờ hàng về (gắn đơn nếu có).
      const created = await http().post('/api/v1/inventory/requests').set(authed(adminBToken)).send({ requestingWarehouseId: whB, submit: true, lines: [{ drugId, requestedQty: 5 }] });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const req = created.body.data as { id: string; version: number; lines: { id: string }[] };
      const accepted = await http().post(`/api/v1/inventory/requests/${req.id}/accept`).set(authed(adminAToken)).send({ version: req.version });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      const allocated = await http()
        .post(`/api/v1/inventory/requests/${req.id}/allocate`)
        .set(authed(adminAToken))
        .send({ version: accepted.body.data.version, lines: [{ lineId: req.lines[0]!.id, allocateQty: 0, remainder: { action: 'WAIT', reason: 'Kho hết hàng, đang đặt', ...(orderId ? { purchaseOrderId: orderId } : {}) } }] });
      return { allocated, req, lineId: req.lines[0]!.id };
    }

    it('dòng chờ hàng về gắn đơn của kho cấp; đơn của kho khác bị từ chối (422); lập đơn từ dòng chờ gắn nhãn nguồn', async () => {
      const drugId = await createDrug(adminAToken);
      const otherWarehouseOrder = await made(adminCToken, whC, [{ drugId, quantity: 5 }]);
      const bad = await waitingRequest(drugId, otherWarehouseOrder.id);
      expect(bad.allocated.status).toBe(422);

      const order = await made(adminAToken, whA, [{ drugId, quantity: 5 }]);
      const ok = await waitingRequest(drugId, order.id);
      expect(ok.allocated.status, JSON.stringify(ok.allocated.body)).toBe(200);
      const line = (ok.allocated.body.data as { lines: { waitPurchaseOrderId: string | null; waitPurchaseOrderNo: string | null; displayStatus: string }[] }).lines[0]!;
      expect(line).toMatchObject({ waitPurchaseOrderId: order.id, waitPurchaseOrderNo: order.orderNo, displayStatus: 'WAITING_STOCK' });
      const withSource = await get(adminAToken, order.id);
      expect(withSource.lines[0]!.sourceRequests).toHaveLength(1);

      // Lập đơn mới từ chính dòng chờ (sourceRequestLineId) cũng gắn được; dòng không còn chờ → 422.
      const drug2 = await createDrug(adminAToken, 'Gạc');
      const w2 = await waitingRequest(drug2, null);
      expect(w2.allocated.status).toBe(200);
      const linked = await createOrder(adminAToken, whA, [{ drugId: drug2, quantity: 5, sourceRequestLineId: w2.lineId }]);
      expect(linked.status, JSON.stringify(linked.body)).toBe(200);
      expect((linked.body.data as Order).lines[0]!.sourceRequests).toHaveLength(1);
      const stale = await createOrder(adminAToken, whA, [{ drugId, quantity: 1, sourceRequestLineId: randomUUID() }]);
      expect(stale.status).toBe(422);
    });

    it('đơn đã đặt NCC: bên xin chỉ "Yêu cầu rút", kho cấp xác nhận (dòng rút) hoặc từ chối (dòng giữ chờ); đơn không bị huỷ theo', async () => {
      const drugId = await createDrug(adminAToken);
      const order = await approveAndOrder(adminAToken, await made(adminAToken, whA, [{ drugId, quantity: 5 }]));
      const w = await waitingRequest(drugId, order.id);
      expect(w.allocated.status, JSON.stringify(w.allocated.body)).toBe(200);
      let detail = w.allocated.body.data as { id: string; version: number; lines: { withdrawRequestedAt: string | null; fulfilStatus: string }[] };

      const wd = await http().post(`/api/v1/inventory/requests/${w.req.id}/withdraw-lines`).set(authed(adminBToken)).send({ version: detail.version, lineIds: [w.lineId], reason: 'Đã mượn từ phòng khác' });
      expect(wd.status, JSON.stringify(wd.body)).toBe(200);
      detail = wd.body.data;
      expect(detail.lines[0]).toMatchObject({ fulfilStatus: 'WAITING_STOCK' });
      expect(detail.lines[0]!.withdrawRequestedAt).not.toBeNull();
      // Gửi lần hai khi đang chờ xác nhận → 409.
      expect((await http().post(`/api/v1/inventory/requests/${w.req.id}/withdraw-lines`).set(authed(adminBToken)).send({ version: detail.version, lineIds: [w.lineId], reason: 'Lại' })).status).toBe(409);
      // Bên xin không tự xác nhận được (không có quyền approve ở kho cấp / sai phía).
      expect((await http().post(`/api/v1/inventory/requests/${w.req.id}/withdraw-requests/resolve`).set(authed(adminBToken)).send({ version: detail.version, lineIds: [w.lineId], action: 'CONFIRM' })).status).toBe(404);

      const declined = await http().post(`/api/v1/inventory/requests/${w.req.id}/withdraw-requests/resolve`).set(authed(adminAToken)).send({ version: detail.version, lineIds: [w.lineId], action: 'DECLINE', note: 'Đã đặt, giữ lại' });
      expect(declined.status, JSON.stringify(declined.body)).toBe(200);
      detail = declined.body.data;
      expect(detail.lines[0]).toMatchObject({ fulfilStatus: 'WAITING_STOCK', withdrawRequestedAt: null });

      const again = await http().post(`/api/v1/inventory/requests/${w.req.id}/withdraw-lines`).set(authed(adminBToken)).send({ version: detail.version, lineIds: [w.lineId], reason: 'Chốt bỏ' });
      detail = again.body.data;
      const confirmed = await http().post(`/api/v1/inventory/requests/${w.req.id}/withdraw-requests/resolve`).set(authed(adminAToken)).send({ version: detail.version, lineIds: [w.lineId], action: 'CONFIRM' });
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(confirmed.body.data.lines[0]).toMatchObject({ fulfilStatus: 'WITHDRAWN', withdrawRequestedAt: null });
      expect((await get(adminAToken, order.id)).status).toBe('ORDERED');
    });

    it('huỷ đơn gỡ liên kết các dòng đang chờ đơn đó', async () => {
      const drugId = await createDrug(adminAToken);
      const order = await made(adminAToken, whA, [{ drugId, quantity: 5 }]);
      const w = await waitingRequest(drugId, order.id);
      expect(w.allocated.status).toBe(200);
      const cancelled = await act(adminAToken, order.id, 'cancel', order.version, { reason: 'Không cần nữa' });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const request = await http().get(`/api/v1/inventory/requests/${w.req.id}`).set(authed(adminAToken));
      expect(request.body.data.lines[0].waitPurchaseOrderId).toBeNull();
    });
  });

  describe('Excel', () => {
    it('xuất Excel danh sách đơn của chi nhánh', async () => {
      const res = await http().get('/api/v1/inventory/purchase-orders/export').set(authed(adminAToken)).query({ view: 'mine' }).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
    });
  });
});
