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
 * HTTP e2e cho tầng CHI NHÁNH, ĐỢT 2 (docs/DECISIONS.md #233): kho, phiếu nhập/tồn/thẻ kho, quỹ + phiếu thu/chi, điều chuyển kho liên chi nhánh,
 * công nợ NCC (dòng thấy đủ, chi nhánh gốc rõ ràng), ví tạm ứng. Mọi kiểm tra đều theo mẫu "tạo ở chi nhánh B → từ chi nhánh A không thấy/không sửa được".
 * Hai tài khoản quản trị: `adminA` (không có dòng gán → chi nhánh mặc định A) và `adminB` (chỉ được gán chi nhánh B). Giữ số lần đăng nhập thấp
 * (rate limit /auth/login).
 */
describe('HTTP e2e — Chi nhánh Đợt 2 (kho, tiền, điều chuyển, công nợ NCC, ví)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let adminAToken: string;
  let adminBToken: string;
  let whA: string;
  let whB: string;
  let cashA: string;
  let cashB: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string) {
    const username = `e2e-br2-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return { id: user.id, username };
  }

  async function login(tenantId: string, username: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function createDrug(token: string): Promise<string> {
    const res = await http()
      .post('/api/v1/drugs')
      .set(authed(token))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: 'Paracetamol 500mg',
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
        isBatchManaged: false,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function postReceipt(token: string, warehouseId: string, drugId: string, quantity: number, extra: Record<string, unknown> = {}) {
    return http()
      .post('/api/v1/inventory/receipts')
      .set(authed(token))
      .send({ warehouseId, receiptType: 'OPENING_BALANCE', lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost: 1000 }], ...extra });
  }

  async function approvedReceipt(token: string, warehouseId: string, drugId: string, quantity: number) {
    const created = await postReceipt(token, warehouseId, drugId, quantity);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(token)).send({ version: created.body.data.version });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    return approved.body.data;
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

    fixture = await createTwoTenantFixture(privileged, 'Branch Dot2 e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    const adminA = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminA');
    adminAToken = await login(fixture.tenantA.id, adminA.username);

    // Chi nhánh B tạo qua HTTP để kiểm luôn "chi nhánh mới tự có 1 kho + 1 quỹ tiền mặt" (Q2).
    const created = await http().post('/api/v1/branches').set(authed(adminAToken)).send({ name: 'Chi nhánh Quận 7', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    branchB = created.body.data.id;

    const adminB = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminB');
    await privileged.userBranch.create({ data: { tenantId: fixture.tenantA.id, userId: adminB.id, branchId: branchB, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    adminBToken = await login(fixture.tenantA.id, adminB.username);

    whA = (await privileged.warehouse.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } })).id;
    whB = (await privileged.warehouse.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchB, deletedAt: null } })).id;
    cashA = (await privileged.cashAccount.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, type: 'CASH', deletedAt: null } })).id;
    cashB = (await privileged.cashAccount.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchB, type: 'CASH', deletedAt: null } })).id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('chi nhánh mới tự có đúng 1 kho mặc định + 1 quỹ tiền mặt mặc định (Q2); mỗi chi nhánh một bộ riêng', async () => {
    const wh = await privileged.warehouse.findMany({ where: { tenantId: fixture.tenantA.id, branchId: branchB, deletedAt: null } });
    expect(wh).toHaveLength(1);
    expect(wh[0]!.isDefault).toBe(true);
    const cash = await privileged.cashAccount.findMany({ where: { tenantId: fixture.tenantA.id, branchId: branchB, deletedAt: null } });
    expect(cash.filter((c) => c.type === 'CASH')).toHaveLength(1);
    expect(cash.find((c) => c.type === 'CASH')!.isDefault).toBe(true);
    expect(whA).not.toBe(whB);
    expect(cashA).not.toBe(cashB);
  });

  it('KHO: mỗi chi nhánh chỉ thấy kho của mình; tra/sửa/tạo kho chi nhánh không được gán → 404; kho đích điều chuyển cho thấy tối thiểu', async () => {
    const listA = await http().get('/api/v1/warehouses').set(authed(adminAToken));
    expect(listA.body.data.items.map((w: { id: string }) => w.id)).toEqual([whA]);
    const listB = await http().get('/api/v1/warehouses').set(authed(adminBToken));
    expect(listB.body.data.items.map((w: { id: string }) => w.id)).toEqual([whB]);

    // allBranches chỉ mở rộng trong các chi nhánh ĐƯỢC GÁN — adminA không được gán B nên vẫn không thấy.
    const allA = await http().get('/api/v1/warehouses').query({ allBranches: 'true' }).set(authed(adminAToken));
    expect(allA.body.data.items.map((w: { id: string }) => w.id)).toEqual([whA]);

    expect((await http().get(`/api/v1/warehouses/${whB}`).set(authed(adminAToken))).status).toBe(404);
    expect((await http().patch(`/api/v1/warehouses/${whB}`).set(authed(adminAToken)).send({ name: 'Sửa lén', version: 1 })).status).toBe(404);
    expect((await http().post('/api/v1/warehouses').set(authed(adminAToken)).send({ name: 'Kho lén', branchId: branchB })).status).toBe(404);

    const dest = await http().get('/api/v1/warehouses/transfer-destinations').set(authed(adminAToken));
    expect(dest.status).toBe(200);
    const items = dest.body.data.items as Record<string, unknown>[];
    expect(items.map((i) => i.id).sort()).toEqual([whA, whB].sort());
    expect(Object.keys(items[0]!).sort()).toEqual(['branchId', 'branchName', 'code', 'id', 'name']);
  });

  it('PHIẾU NHẬP + TỒN + THẺ KHO: phiếu/tồn/lô/thẻ kho của chi nhánh B không lộ sang A; nhập vào kho B từ A → 404', async () => {
    const drugId = await createDrug(adminAToken);
    const receiptB = await approvedReceipt(adminBToken, whB, drugId, 50);

    expect((await http().get(`/api/v1/inventory/receipts/${receiptB.id}`).set(authed(adminAToken))).status).toBe(404);
    const listA = await http().get('/api/v1/inventory/receipts').set(authed(adminAToken));
    expect(listA.body.data.items.some((r: { id: string }) => r.id === receiptB.id)).toBe(false);
    const listB = await http().get('/api/v1/inventory/receipts').set(authed(adminBToken));
    expect(listB.body.data.items.some((r: { id: string }) => r.id === receiptB.id)).toBe(true);

    // Tạo phiếu vào kho của chi nhánh khác.
    expect((await postReceipt(adminAToken, whB, drugId, 1)).status).toBe(404);

    // Tồn kho / lô / thẻ kho: A không thấy gì của B (kể cả chỉ định đích danh kho B), B thấy đủ.
    const balA = await http().get('/api/v1/inventory/balances').set(authed(adminAToken));
    expect(balA.body.data.items.some((i: { drugId: string }) => i.drugId === drugId)).toBe(false);
    const balAWithB = await http().get('/api/v1/inventory/balances').query({ warehouseId: whB }).set(authed(adminAToken));
    expect(balAWithB.body.data.items).toEqual([]);
    const batchesA = await http().get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(adminAToken));
    expect(batchesA.body.data.totalQuantityOnHand).toBe(0);
    const ledgerA = await http().get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(adminAToken));
    expect(ledgerA.body.data.items).toEqual([]);

    const balB = await http().get('/api/v1/inventory/balances').set(authed(adminBToken));
    expect(balB.body.data.items.find((i: { drugId: string }) => i.drugId === drugId)?.quantityOnHand).toBe(50);
  });

  it('QUỸ + PHIẾU THU/CHI: quỹ/phiếu của B không lộ sang A; lập phiếu vào quỹ B từ A → 404; chuyển quỹ khác chi nhánh bị chặn', async () => {
    const listA = await http().get('/api/v1/cash-accounts').set(authed(adminAToken));
    expect(listA.body.data.items.map((a: { id: string }) => a.id)).toContain(cashA);
    expect(listA.body.data.items.map((a: { id: string }) => a.id)).not.toContain(cashB);
    const allA = await http().get('/api/v1/cash-accounts').query({ allBranches: 'true' }).set(authed(adminAToken));
    expect(allA.body.data.items.map((a: { id: string }) => a.id)).not.toContain(cashB);

    const voucherB = await http()
      .post('/api/v1/cash-vouchers')
      .set(authed(adminBToken))
      .send({ direction: 'INCOME', incomeExpenseTypeCode: 'TC00001', cashAccountId: cashB, paymentMethodCode: 'CASH', amount: 100000, description: 'Thu chi nhánh B' });
    expect(voucherB.status, JSON.stringify(voucherB.body)).toBe(200);

    expect((await http().get(`/api/v1/cash-vouchers/${voucherB.body.data.id}`).set(authed(adminAToken))).status).toBe(404);
    const vListA = await http().get('/api/v1/cash-vouchers').set(authed(adminAToken));
    expect(vListA.body.data.items.some((v: { id: string }) => v.id === voucherB.body.data.id)).toBe(false);

    const crossCreate = await http()
      .post('/api/v1/cash-vouchers')
      .set(authed(adminAToken))
      .send({ direction: 'INCOME', incomeExpenseTypeCode: 'TC00001', cashAccountId: cashB, paymentMethodCode: 'CASH', amount: 1000, description: 'Lén vào quỹ B' });
    expect(crossCreate.status).toBe(404);

    // Chuyển quỹ A → B (khác chi nhánh) bị chặn dù người gọi biết id quỹ.
    const transfer = await http()
      .post('/api/v1/cash-vouchers')
      .set(authed(adminAToken))
      .send({ cashAccountId: cashA, counterAccountId: cashB, paymentMethodCode: 'CASH', amount: 1000, description: 'Chuyển quỹ khác chi nhánh' });
    expect([404, 422], JSON.stringify(transfer.body)).toContain(transfer.status);
    expect(transfer.body.error.code).not.toBe('VALIDATION_ERROR');
  });

  it('ĐIỀU CHUYỂN liên chi nhánh: phiếu thuộc chi nhánh GỬI; bên nhận chỉ thấy từ lúc Duyệt xuất (tab Phiếu đến), không thấy giá vốn; kiểm nhận thiếu → chờ bên gửi xử lý', async () => {
    const drugId = await createDrug(adminAToken);
    await approvedReceipt(adminAToken, whA, drugId, 40);

    const draft = await http()
      .post('/api/v1/inventory/transfers')
      .set(authed(adminAToken))
      .send({ fromWarehouseId: whA, toWarehouseId: whB, lines: [{ drugId, quantityShipped: 30 }] });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    const id = draft.body.data.id as string;

    // Nháp: bên nhận KHÔNG thấy (cả danh sách "Phiếu đến" lẫn tra theo id).
    const inBefore = await http().get('/api/v1/inventory/transfers').query({ direction: 'in' }).set(authed(adminBToken));
    expect(inBefore.body.data.items.some((t: { id: string }) => t.id === id)).toBe(false);
    expect((await http().get(`/api/v1/inventory/transfers/${id}`).set(authed(adminBToken))).status).toBe(404);

    const shipped = await http().post(`/api/v1/inventory/transfers/${id}/ship`).set(authed(adminAToken)).send({ version: draft.body.data.version });
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
    expect(shipped.body.data.lines[0].unitCost).toBe(1000); // bên gửi thấy giá vốn

    // Đã Duyệt xuất: bên nhận thấy ở "Phiếu đến", nhưng giá vốn bị ẩn; chấm số "chờ nhận" = 1.
    const inAfter = await http().get('/api/v1/inventory/transfers').query({ direction: 'in' }).set(authed(adminBToken));
    expect(inAfter.body.data.items.some((t: { id: string }) => t.id === id)).toBe(true);
    const detailB = await http().get(`/api/v1/inventory/transfers/${id}`).set(authed(adminBToken));
    expect(detailB.status).toBe(200);
    expect(detailB.body.data.lines[0].unitCost).toBeNull();
    expect(detailB.body.data).toMatchObject({ fromBranchId: branchA, toBranchId: branchB });
    const counts = await http().get('/api/v1/inventory/transfers/pending-counts').set(authed(adminBToken));
    expect(counts.body.data.incoming).toBeGreaterThanOrEqual(1);

    // Bên nhận kiểm nhận THIẾU: bắt buộc lý do; có lý do → VARIANCE_PENDING, hàng thực nhận vào kho B.
    const lineId = detailB.body.data.lines[0].id as string;
    const noReason = await http().post(`/api/v1/inventory/transfers/${id}/receive`).set(authed(adminBToken)).send({ version: detailB.body.data.version, lines: [{ lineId, quantityReceived: 25 }] });
    expect(noReason.status).toBe(422);
    const over = await http().post(`/api/v1/inventory/transfers/${id}/receive`).set(authed(adminBToken)).send({ version: detailB.body.data.version, lines: [{ lineId, quantityReceived: 31 }] });
    expect(over.status).toBe(422);
    const received = await http()
      .post(`/api/v1/inventory/transfers/${id}/receive`)
      .set(authed(adminBToken))
      .send({ version: detailB.body.data.version, lines: [{ lineId, quantityReceived: 25, varianceReason: 'DAMAGED', varianceNote: 'Vỡ 5 viên' }] });
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    expect(received.body.data.status).toBe('VARIANCE_PENDING');
    const balB = await http().get('/api/v1/inventory/balances').set(authed(adminBToken));
    expect(balB.body.data.items.find((i: { drugId: string }) => i.drugId === drugId)?.quantityOnHand).toBe(25);

    // Chỉ chi nhánh GỬI xử lý được; bên nhận gọi → 404/403 (không phải kho gửi của chi nhánh đang làm).
    const lineIdA = received.body.data.lines[0].id as string;
    const byReceiver = await http()
      .post(`/api/v1/inventory/transfers/${id}/resolve-variance`)
      .set(authed(adminBToken))
      .send({ version: received.body.data.version, lines: [{ lineId: lineIdA, resolution: 'WRITE_OFF' }] });
    expect([403, 404]).toContain(byReceiver.status);

    const toResolve = await http().get('/api/v1/inventory/transfers/pending-counts').set(authed(adminAToken));
    expect(toResolve.body.data.toResolve).toBeGreaterThanOrEqual(1);

    // Bên gửi chọn "hàng về kho gửi" → COMPLETED, kho A được cộng lại 5; sinh phiếu nhập TRANSFER_RETURN.
    const resolved = await http()
      .post(`/api/v1/inventory/transfers/${id}/resolve-variance`)
      .set(authed(adminAToken))
      .send({ version: received.body.data.version, lines: [{ lineId: lineIdA, resolution: 'RETURN_TO_SOURCE' }] });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body.data.status).toBe('COMPLETED');
    const balA = await http().get('/api/v1/inventory/balances').set(authed(adminAToken));
    expect(balA.body.data.items.find((i: { drugId: string }) => i.drugId === drugId)?.quantityOnHand).toBe(15);
    const returnReceipts = await http().get('/api/v1/inventory/receipts').query({ receiptType: 'TRANSFER_RETURN' }).set(authed(adminAToken));
    expect(returnReceipts.body.data.items.length).toBe(1);
  });

  it('ĐIỀU CHUYỂN: từ chối nhận cả phiếu → hàng không vào kho nhận; bên gửi xác nhận nhận lại thiếu → hao hụt (bắt buộc ghi chú); báo cáo hao hụt', async () => {
    const drugId = await createDrug(adminAToken);
    await approvedReceipt(adminAToken, whA, drugId, 20);
    const draft = await http().post('/api/v1/inventory/transfers').set(authed(adminAToken)).send({ fromWarehouseId: whA, toWarehouseId: whB, lines: [{ drugId, quantityShipped: 10 }] });
    const id = draft.body.data.id as string;
    const shipped = await http().post(`/api/v1/inventory/transfers/${id}/ship`).set(authed(adminAToken)).send({ version: draft.body.data.version });
    expect(shipped.status).toBe(200);

    const rejectNoNote = await http().post(`/api/v1/inventory/transfers/${id}/reject-receipt`).set(authed(adminBToken)).send({ version: shipped.body.data.version, reason: 'DAMAGED', note: '' });
    expect(rejectNoNote.status).toBe(400);
    const rejected = await http().post(`/api/v1/inventory/transfers/${id}/reject-receipt`).set(authed(adminBToken)).send({ version: shipped.body.data.version, reason: 'DAMAGED', note: 'Thùng ướt, hàng hỏng' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.data.status).toBe('RETURNING');
    const balB = await http().get('/api/v1/inventory/balances').set(authed(adminBToken));
    expect(balB.body.data.items.find((i: { drugId: string }) => i.drugId === drugId)?.quantityOnHand ?? 0).toBe(0);

    const lineId = rejected.body.data.lines[0].id as string;
    const noNote = await http().post(`/api/v1/inventory/transfers/${id}/confirm-return`).set(authed(adminAToken)).send({ version: rejected.body.data.version, lines: [{ lineId, quantityReturnedBack: 7 }] });
    expect(noNote.status).toBe(422);
    const back = await http()
      .post(`/api/v1/inventory/transfers/${id}/confirm-return`)
      .set(authed(adminAToken))
      .send({ version: rejected.body.data.version, lines: [{ lineId, quantityReturnedBack: 7, note: 'Hỏng 3 viên trên đường về' }] });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.data.status).toBe('RETURNED');

    const today = new Date().toISOString().slice(0, 10);
    const report = await http().get('/api/v1/inventory/transfers/shrinkage-report').query({ from: today, to: today }).set(authed(adminAToken));
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body.data.items.some((i: { transferId: string; quantity: number }) => i.transferId === id && i.quantity === 3)).toBe(true);
    // Q1/Q3 (báo cáo hao hụt): dải số + bộ lọc kho gửi/nguyên nhân.
    expect(report.body.data.transferCount).toBeGreaterThanOrEqual(1);
    expect(report.body.data.countByCause.RETURN_SHORTAGE).toBeGreaterThanOrEqual(1);
    const hasTransfer = (res: { body: { data: { items: { transferId: string }[] } } }) => res.body.data.items.some((i) => i.transferId === id);
    const byCause = await http().get('/api/v1/inventory/transfers/shrinkage-report').query({ from: today, to: today, cause: 'RETURN_SHORTAGE' }).set(authed(adminAToken));
    expect(hasTransfer(byCause)).toBe(true);
    const wrongCause = await http().get('/api/v1/inventory/transfers/shrinkage-report').query({ from: today, to: today, cause: 'WRITE_OFF' }).set(authed(adminAToken));
    expect(hasTransfer(wrongCause)).toBe(false);
    // Dải "theo nguyên nhân" không bị bộ lọc nguyên nhân làm mất nhóm còn lại.
    expect(wrongCause.body.data.countByCause.RETURN_SHORTAGE).toBe(report.body.data.countByCause.RETURN_SHORTAGE);
    const byWarehouse = await http().get('/api/v1/inventory/transfers/shrinkage-report').query({ from: today, to: today, fromWarehouseId: whA }).set(authed(adminAToken));
    expect(hasTransfer(byWarehouse)).toBe(true);
    const otherWarehouse = await http().get('/api/v1/inventory/transfers/shrinkage-report').query({ from: today, to: today, fromWarehouseId: whB }).set(authed(adminAToken));
    expect(hasTransfer(otherWarehouse)).toBe(false);

    // Q2: Xuất Excel — cần quyền, trả đúng tệp xlsx và ghi nhật ký xuất.
    expect((await http().get('/api/v1/inventory/transfers/shrinkage-report/export').query({ from: today, to: today })).status).toBe(401);
    const exported = await http().get('/api/v1/inventory/transfers/shrinkage-report/export').query({ from: today, to: today }).set(authed(adminAToken)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    expect((exported.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const audit = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'stock_ledger_report.exported' } });
    expect(audit).toBeGreaterThanOrEqual(1);

    // Bên nhận không có hao hụt nào của chi nhánh mình.
    const reportB = await http().get('/api/v1/inventory/transfers/shrinkage-report').query({ from: today, to: today }).set(authed(adminBToken));
    expect(reportB.body.data.items.some((i: { transferId: string }) => i.transferId === id)).toBe(false);
  });

  it('CÔNG NỢ NCC: dòng + số tiền thấy đủ cả công ty, kèm chi nhánh gốc của chứng từ; phiếu chi nhánh khác không mở được', async () => {
    const supplier = await http().post('/api/v1/suppliers').set(authed(adminAToken)).send({ name: `NCC e2e ${randomUUID().slice(0, 6)}` });
    expect(supplier.status, JSON.stringify(supplier.body)).toBe(200);
    const supplierId = supplier.body.data.id as string;
    const drugId = await createDrug(adminAToken);

    // Phiếu nhập mua hàng ở kho B (chi nhánh B) → sinh công nợ PURCHASE.
    const created = await postReceipt(adminBToken, whB, drugId, 10, { receiptType: 'PURCHASE', supplierId });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(adminBToken)).send({ version: created.body.data.version });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    // Người ở chi nhánh A: sổ công nợ có dòng PURCHASE với chi nhánh gốc B + số phiếu; nhưng KHÔNG mở được phiếu.
    const ledger = await http().get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(adminAToken));
    expect(ledger.status, JSON.stringify(ledger.body)).toBe(200);
    const purchase = ledger.body.data.items.find((e: { entryType: string }) => e.entryType === 'PURCHASE');
    expect(purchase).toMatchObject({ amountChange: 10000, sourceBranchId: branchB, sourceBranchName: 'Chi nhánh Quận 7', stockReceiptNo: approved.body.data.receiptNo });
    expect((await http().get(`/api/v1/inventory/receipts/${created.body.data.id}`).set(authed(adminAToken))).status).toBe(404);

    const receiptsTab = await http().get(`/api/v1/supplier-debt/${supplierId}/receipts`).set(authed(adminAToken));
    expect(receiptsTab.body.data.items[0]).toMatchObject({ originalAmount: 10000, sourceBranchId: branchB, stockReceiptNo: approved.body.data.receiptNo });
    const summary = await http().get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(adminAToken));
    expect(summary.body.data.balance).toBe(10000);

    // Phiếu thanh toán NCC: lập ở chi nhánh B, người ở A thấy dòng + tiền kèm chi nhánh nhưng không mở được phiếu.
    const pay = await http()
      .post(`/api/v1/supplier-debt/${supplierId}/payment`)
      .set(authed(adminBToken))
      .send({ amount: 4000, paymentMethodCode: 'CASH', cashAccountId: cashB });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const payments = await http().get('/api/v1/supplier-debt/payments').query({ supplierId }).set(authed(adminAToken));
    expect(payments.body.data.items).toHaveLength(1);
    expect(payments.body.data.items[0]).toMatchObject({ amount: 4000, branchId: branchB, branchName: 'Chi nhánh Quận 7' });
    expect((await http().get(`/api/v1/cash-vouchers/${payments.body.data.items[0].id}`).set(authed(adminAToken))).status).toBe(404);

    // Thanh toán bằng quỹ của chi nhánh khác → 404 (quỹ phải thuộc chi nhánh đang làm).
    const crossPay = await http().post(`/api/v1/supplier-debt/${supplierId}/payment`).set(authed(adminAToken)).send({ amount: 1000, paymentMethodCode: 'CASH', cashAccountId: cashB });
    expect(crossPay.status).toBe(404);
  });

  it('VÍ TẠM ỨNG: số dư dùng chung cả công ty; giao dịch nạp ở chi nhánh B ghi rõ chi nhánh, nạp vào quỹ chi nhánh khác → 404', async () => {
    const patient = await privileged.patient.create({
      data: {
        tenantId: fixture.tenantA.id,
        patientCode: `BN-W2-${Math.floor(Math.random() * 1_000_000_000)}`,
        fullName: 'Bệnh nhân ví chi nhánh',
        dob: new Date('1990-01-01'),
        gender: 'other',
        phone: '0911111111',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });

    const topup = await http().post('/api/v1/wallet/topup').set(authed(adminBToken)).send({ patientId: patient.id, amount: 500000, paymentMethodCode: 'CASH' });
    expect(topup.status, JSON.stringify(topup.body)).toBe(200);

    // Người ở chi nhánh A vẫn thấy số dư (dùng chung cả công ty).
    const wallet = await http().get('/api/v1/wallet').query({ patientId: patient.id }).set(authed(adminAToken));
    expect(wallet.body.data.balance).toBe(500000);
    const txs = await http().get('/api/v1/wallet/transactions').query({ patientId: patient.id }).set(authed(adminAToken));
    expect(txs.body.data.items[0]).toMatchObject({ type: 'TOPUP', amount: 500000, branchId: branchB, branchName: 'Chi nhánh Quận 7' });

    // Phiếu quỹ sinh ra thuộc quỹ chi nhánh B: A không mở được.
    const voucherId = txs.body.data.items[0].cashVoucherId as string;
    expect((await http().get(`/api/v1/cash-vouchers/${voucherId}`).set(authed(adminAToken))).status).toBe(404);

    // Nạp chỉ định quỹ của chi nhánh khác.
    const cross = await http().post('/api/v1/wallet/topup').set(authed(adminAToken)).send({ patientId: patient.id, amount: 1000, paymentMethodCode: 'CASH', cashAccountId: cashB });
    expect(cross.status).toBe(404);
  });

  it('PHIẾU THU: lượt khám chi nhánh khác → 404 (không phải "chưa có phiếu"); lượt khám của chi nhánh mình chưa có phiếu → 200 null', async () => {
    const patient = await privileged.patient.create({
      data: {
        tenantId: fixture.tenantA.id,
        patientCode: `BN-W3-${Math.floor(Math.random() * 1_000_000_000)}`,
        fullName: 'Bệnh nhân phiếu thu chi nhánh',
        dob: new Date('1990-01-01'),
        gender: 'other',
        phone: '0922222222',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const encounterB = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: branchB,
        patientId: patient.id,
        departmentId: department.id,
        encounterNo: `LK-W3-${Math.floor(Math.random() * 1_000_000_000)}`,
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });

    expect((await http().get(`/api/v1/billing/invoices/${encounterB.id}`).set(authed(adminAToken))).status).toBe(404);
    const own = await http().get(`/api/v1/billing/invoices/${encounterB.id}`).set(authed(adminBToken));
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.data).toBeNull();
  });

  it('cô lập tenant: kho/quỹ/điều chuyển của công ty này không tra được từ tenant khác', async () => {
    const adminOther = await createUser(fixture.tenantB.id, 'clinic_admin', 'otherTenant');
    const otherToken = await login(fixture.tenantB.id, adminOther.username);
    expect((await http().get(`/api/v1/warehouses/${whB}`).set(authed(otherToken))).status).toBe(404);
    const dest = await http().get('/api/v1/warehouses/transfer-destinations').set(authed(otherToken));
    expect(dest.body.data.items.map((i: { id: string }) => i.id)).not.toContain(whB);
    expect(dest.body.data.items.map((i: { id: string }) => i.id)).not.toContain(whA);
    const cash = await http().get('/api/v1/cash-accounts').query({ allBranches: 'true' }).set(authed(otherToken));
    expect(cash.body.data.items.map((a: { id: string }) => a.id)).not.toContain(cashB);
  });
});
