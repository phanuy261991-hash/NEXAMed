import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e cho ĐỢT 3 chi nhánh — báo cáo tổng hợp nhiều chi nhánh (docs/DECISIONS.md #235): Báo cáo dòng tiền, Sổ quỹ (chọn quỹ chi nhánh khác), Nhập-Xuất-Tồn.
 * Trọng tâm là CÔ LẬP: quyền `company_report.read` là thứ DUY NHẤT cho phép gộp chi nhánh; thiếu quyền → 403/404 dù client tự gửi tham số; id chi nhánh của tenant khác → 404.
 *
 * Hai chi nhánh cùng tenant A: A (mặc định) và B. `adminA` (clinic_admin, có quyền toàn công ty) làm việc ở A; `viewerB` (vai trò tuỳ biến có đủ quyền xem báo cáo NHƯNG KHÔNG có
 * `company_report.read`) chỉ được gán chi nhánh B. Tenant B: một quản trị riêng để kiểm "gộp tất cả" không lộ dữ liệu tenant A.
 */
describe('HTTP e2e — Đợt 3 chi nhánh: báo cáo toàn công ty', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;

  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let branchA: string;
  let branchB: string;
  let adminAToken: string;
  let viewerBToken: string;
  let otherTenantAdminToken: string;
  let otherTenantBranch: string;
  let cashA: string;
  let cashB: string;
  let whA: string;
  let whB: string;
  const RANGE = { from: '2020-01-01', to: '2099-12-31' };

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

    fixture = await createTwoTenantFixture(privileged, 'Company Report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    otherTenantBranch = await getDefaultBranchId(privileged, fixture.tenantB.id);

    const adminA = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'adminA');
    adminAToken = await h.login(fixture.tenantA.id, adminA.username);

    const created = await http().post('/api/v1/branches').set(authed(adminAToken)).send({ name: 'Chi nhánh Quận 7' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    branchB = created.body.data.id as string;

    // Vai trò xem báo cáo KHÔNG có `company_report.read`: đủ quyền xem 3 báo cáo + Sổ quỹ, chỉ thiếu quyền mở rộng phạm vi.
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-chi-nhanh', [
      ['cash_voucher', 'read'],
      ['cash_voucher', 'report'],
      ['stock_receipt', 'report'],
      ['drug', 'read'],
    ]);
    const viewerB = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'viewerB', [branchB]);
    viewerBToken = await h.login(fixture.tenantA.id, viewerB.username);

    const adminOther = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'adminOther');
    otherTenantAdminToken = await h.login(fixture.tenantB.id, adminOther.username);

    cashA = (await privileged.cashAccount.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, type: 'CASH', deletedAt: null } })).id;
    cashB = (await privileged.cashAccount.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchB, type: 'CASH', deletedAt: null } })).id;
    whA = (await privileged.warehouse.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } })).id;
    whB = (await privileged.warehouse.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchB, deletedAt: null } })).id;

    // Số liệu: chi nhánh A thu 300.000 / chi 50.000; chi nhánh B thu 100.000.
    await h.postVoucher(adminAToken, 'INCOME', cashA, 300_000);
    await h.postVoucher(adminAToken, 'EXPENSE', cashA, 50_000);
    // Phiếu/phiếu nhập của chi nhánh B phải do tài khoản được gán chi nhánh B lập (không lập chéo chi nhánh được).
    const adminB = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'adminB', [branchB]);
    const adminBToken = await h.login(fixture.tenantA.id, adminB.username);
    await h.postVoucher(adminBToken, 'INCOME', cashB, 100_000);

    const drugId = await h.createDrug(adminAToken);
    await h.approvedOpeningReceipt(adminAToken, whA, drugId, 20);
    await h.approvedOpeningReceipt(adminBToken, whB, drugId, 5);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('Báo cáo dòng tiền', () => {
    it('mặc định (không gửi scope) chỉ là chi nhánh đang làm — y hệt trước Đợt 3', async () => {
      const res = await http().get('/api/v1/cash-book/cash-flow-report').query(RANGE).set(authed(adminAToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.totalIncome).toBe(300_000);
      expect(res.body.data.totalExpense).toBe(50_000);
      expect(res.body.data.byBranch).toHaveLength(1);
      expect(res.body.data.byBranch[0].branchId).toBe(branchA);
      expect(res.body.data.byAccount.map((a: { key: string }) => a.key)).not.toContain(cashB);
    });

    it('scope=all với quyền toàn công ty: cộng mọi chi nhánh, bảng "Theo chi nhánh" khớp tổng, mỗi quỹ ghi đúng chi nhánh', async () => {
      const res = await http().get('/api/v1/cash-book/cash-flow-report').query({ ...RANGE, scope: 'all' }).set(authed(adminAToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const data = res.body.data;
      expect(data.totalIncome).toBe(400_000);
      expect(data.totalExpense).toBe(50_000);
      const byBranch = new Map<string, { totalIncome: number; totalExpense: number }>(data.byBranch.map((b: { branchId: string; totalIncome: number; totalExpense: number }) => [b.branchId, b]));
      expect(byBranch.get(branchA)).toMatchObject({ totalIncome: 300_000, totalExpense: 50_000 });
      expect(byBranch.get(branchB)).toMatchObject({ totalIncome: 100_000, totalExpense: 0 });
      expect(data.byBranch.reduce((s: number, b: { totalIncome: number }) => s + b.totalIncome, 0)).toBe(data.totalIncome);
      const accountB = data.byAccount.find((a: { key: string }) => a.key === cashB);
      expect(accountB).toMatchObject({ branchId: branchB, branchName: 'Chi nhánh Quận 7', totalIncome: 100_000 });
      // Chi nhánh đang làm luôn đứng đầu danh sách.
      expect(data.byBranch[0].branchId).toBe(branchA);
    });

    it('scope=pick chỉ gộp đúng các chi nhánh được chọn (kể cả chi nhánh tài khoản không được gán)', async () => {
      const res = await http().get('/api/v1/cash-book/cash-flow-report').query({ ...RANGE, scope: 'pick', branchIds: branchB }).set(authed(adminAToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.totalIncome).toBe(100_000);
      expect(res.body.data.byBranch.map((b: { branchId: string }) => b.branchId)).toEqual([branchB]);
    });

    it('scope=pick sai: thiếu danh sách → 400; id lạ hoặc của TENANT KHÁC → 404', async () => {
      const empty = await http().get('/api/v1/cash-book/cash-flow-report').query({ ...RANGE, scope: 'pick' }).set(authed(adminAToken));
      expect(empty.status).toBe(400);
      const unknown = await http().get('/api/v1/cash-book/cash-flow-report').query({ ...RANGE, scope: 'pick', branchIds: '0191b2c0-0000-7000-8000-000000000000' }).set(authed(adminAToken));
      expect(unknown.status).toBe(404);
      const foreign = await http().get('/api/v1/cash-book/cash-flow-report').query({ ...RANGE, scope: 'pick', branchIds: `${branchA},${otherTenantBranch}` }).set(authed(adminAToken));
      expect(foreign.status).toBe(404);
    });

    it('thiếu quyền company_report.read: mặc định xem được chi nhánh mình, nhưng scope=all/pick bị chặn 403', async () => {
      const own = await http().get('/api/v1/cash-book/cash-flow-report').query(RANGE).set(authed(viewerBToken));
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.data.totalIncome).toBe(100_000);
      expect(own.body.data.byBranch.map((b: { branchId: string }) => b.branchId)).toEqual([branchB]);

      const all = await http().get('/api/v1/cash-book/cash-flow-report').query({ ...RANGE, scope: 'all' }).set(authed(viewerBToken));
      expect(all.status).toBe(403);
      expect(all.body.error.code).toBe('PERMISSION_DENIED');
      const pickOther = await http().get('/api/v1/cash-book/cash-flow-report').query({ ...RANGE, scope: 'pick', branchIds: branchA }).set(authed(viewerBToken));
      expect(pickOther.status).toBe(403);
    });

    it('cô lập tenant: quản trị tenant khác gộp "tất cả" cũng chỉ thấy chi nhánh của chính họ, không lẫn số liệu tenant A', async () => {
      const res = await http().get('/api/v1/cash-book/cash-flow-report').query({ ...RANGE, scope: 'all' }).set(authed(otherTenantAdminToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.byBranch.map((b: { branchId: string }) => b.branchId)).toEqual([otherTenantBranch]);
      expect(res.body.data.totalIncome).toBe(0);
      expect(JSON.stringify(res.body.data)).not.toContain(branchA);
      expect(JSON.stringify(res.body.data)).not.toContain(branchB);
    });

    it('xuất Excel theo đúng phạm vi: có sheet "Theo chi nhánh" khi gộp, bị chặn khi thiếu quyền, và audit ghi danh sách chi nhánh đã xuất', async () => {
      const ok = await h.download(`/api/v1/cash-book/cash-flow-report/export?from=${RANGE.from}&to=${RANGE.to}&scope=all`, adminAToken);
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toContain('spreadsheetml');

      const denied = await h.download(`/api/v1/cash-book/cash-flow-report/export?from=${RANGE.from}&to=${RANGE.to}&scope=all`, viewerBToken);
      expect(denied.status).toBe(403);

      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'cash_flow_report.exported' }, orderBy: { occurredAt: 'desc' } });
      const after = audit?.afterJson as { scope?: string; resolvedBranchIds?: string[] } | null;
      expect(after?.scope).toBe('all');
      expect([...(after?.resolvedBranchIds ?? [])].sort()).toEqual([branchA, branchB].sort());
    });
  });

  describe('Sổ quỹ', () => {
    it('danh sách quỹ: mặc định chỉ chi nhánh đang làm; scope=all liệt kê quỹ mọi chi nhánh; thiếu quyền → 403', async () => {
      const current = await http().get('/api/v1/cash-book/ledger/accounts').set(authed(adminAToken));
      expect(current.status, JSON.stringify(current.body)).toBe(200);
      expect(current.body.data.items.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining([cashA]));
      expect(current.body.data.items.map((a: { id: string }) => a.id)).not.toContain(cashB);

      const all = await http().get('/api/v1/cash-book/ledger/accounts').query({ scope: 'all' }).set(authed(adminAToken));
      expect(all.body.data.items.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining([cashA, cashB]));

      const denied = await http().get('/api/v1/cash-book/ledger/accounts').query({ scope: 'all' }).set(authed(viewerBToken));
      expect(denied.status).toBe(403);
    });

    it('xem sổ của quỹ chi nhánh khác: có quyền → xem được kèm tên chi nhánh; không có quyền → 404 (không lộ quỹ tồn tại)', async () => {
      const asAdmin = await http().get('/api/v1/cash-book/ledger').query({ cashAccountId: cashB }).set(authed(adminAToken));
      expect(asAdmin.status, JSON.stringify(asAdmin.body)).toBe(200);
      expect(asAdmin.body.data).toMatchObject({ cashAccountId: cashB, branchId: branchB, branchName: 'Chi nhánh Quận 7' });
      expect(asAdmin.body.data.closingBalance).toBe(100_000);

      const viewerOther = await http().get('/api/v1/cash-book/ledger').query({ cashAccountId: cashA }).set(authed(viewerBToken));
      expect(viewerOther.status).toBe(404);
      const viewerOwn = await http().get('/api/v1/cash-book/ledger').query({ cashAccountId: cashB }).set(authed(viewerBToken));
      expect(viewerOwn.status, JSON.stringify(viewerOwn.body)).toBe(200);

      // Cùng quy tắc cho bản xuất Excel của Sổ quỹ.
      const exportOther = await h.download(`/api/v1/cash-book/ledger/export?cashAccountId=${cashA}`, viewerBToken);
      expect(exportOther.status).toBe(404);
    });

    it('id quỹ của tenant khác → 404 kể cả với quản trị có quyền toàn công ty', async () => {
      const otherCash = await privileged.cashAccount.findFirstOrThrow({ where: { tenantId: fixture.tenantB.id, deletedAt: null } });
      const res = await http().get('/api/v1/cash-book/ledger').query({ cashAccountId: otherCash.id }).set(authed(adminAToken));
      expect(res.status).toBe(404);
    });
  });

  describe('Nhập-Xuất-Tồn', () => {
    it('mặc định chỉ kho của chi nhánh đang làm; scope=all thêm cột chi nhánh, branchCount=2 và danh sách kho trong phạm vi', async () => {
      const current = await http().get('/api/v1/inventory/reports/stock-ledger').query(RANGE).set(authed(adminAToken));
      expect(current.status, JSON.stringify(current.body)).toBe(200);
      expect(current.body.data.branchCount).toBe(1);
      expect(current.body.data.items.map((i: { warehouseId: string }) => i.warehouseId)).toEqual([whA]);
      expect(current.body.data.warehouses.map((w: { id: string }) => w.id)).toEqual([whA]);

      const all = await http().get('/api/v1/inventory/reports/stock-ledger').query({ ...RANGE, scope: 'all' }).set(authed(adminAToken));
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.body.data.branchCount).toBe(2);
      const byWarehouse = new Map<string, { branchId: string; branchName: string; closingQuantity: number }>(all.body.data.items.map((i: { warehouseId: string; branchId: string; branchName: string; closingQuantity: number }) => [i.warehouseId, i]));
      expect(byWarehouse.get(whA)).toMatchObject({ branchId: branchA, closingQuantity: 20 });
      expect(byWarehouse.get(whB)).toMatchObject({ branchId: branchB, branchName: 'Chi nhánh Quận 7', closingQuantity: 5 });
      expect(all.body.data.totalClosingQuantity).toBe(25);
      expect(all.body.data.warehouses.map((w: { id: string }) => w.id).sort()).toEqual([whA, whB].sort());
    });

    it('lọc theo kho của chi nhánh NGOÀI phạm vi cho báo cáo rỗng, không rò dữ liệu', async () => {
      const res = await http().get('/api/v1/inventory/reports/stock-ledger').query({ ...RANGE, warehouseId: whB }).set(authed(adminAToken));
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });

    it('thiếu quyền company_report.read: chỉ thấy kho chi nhánh mình; scope=all → 403 (cả xem lẫn xuất Excel)', async () => {
      const own = await http().get('/api/v1/inventory/reports/stock-ledger').query(RANGE).set(authed(viewerBToken));
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.data.items.map((i: { warehouseId: string }) => i.warehouseId)).toEqual([whB]);

      const all = await http().get('/api/v1/inventory/reports/stock-ledger').query({ ...RANGE, scope: 'all' }).set(authed(viewerBToken));
      expect(all.status).toBe(403);
      const exportAll = await h.download(`/api/v1/inventory/reports/stock-ledger/export?from=${RANGE.from}&to=${RANGE.to}&scope=all`, viewerBToken);
      expect(exportAll.status).toBe(403);
    });

    it('cô lập tenant: quản trị tenant khác gộp "tất cả" không thấy kho/mặt hàng của tenant A', async () => {
      const res = await http().get('/api/v1/inventory/reports/stock-ledger').query({ ...RANGE, scope: 'all' }).set(authed(otherTenantAdminToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(JSON.stringify(res.body.data)).not.toContain(whA);
      expect(JSON.stringify(res.body.data)).not.toContain(whB);
    });
  });

  describe('Danh sách chi nhánh cho bộ chọn Phạm vi', () => {
    it('chỉ người có company_report.read lấy được, và chỉ chi nhánh của tenant mình', async () => {
      const ok = await http().get('/api/v1/branches/report-scope-options').set(authed(adminAToken));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.items.map((b: { id: string }) => b.id).sort()).toEqual([branchA, branchB].sort());

      const denied = await http().get('/api/v1/branches/report-scope-options').set(authed(viewerBToken));
      expect(denied.status).toBe(403);

      const other = await http().get('/api/v1/branches/report-scope-options').set(authed(otherTenantAdminToken));
      expect(other.body.data.items.map((b: { id: string }) => b.id)).toEqual([otherTenantBranch]);
    });
  });
});
