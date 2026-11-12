import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { vietnamDayStartUtc } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — trang báo cáo "Toàn hệ thống" (`/reports/system/*`, docs/DECISIONS.md #287). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong tháng 09/2026 (đã qua) và tháng 08/2026
 * (kỳ so sánh), hai chi nhánh. Trọng tâm: so sánh chi nhánh đúng định nghĩa (lượt khám đã tiếp nhận, bệnh nhân mới = lượt đầu tiên ở MỌI chi nhánh, ghi nhận sau chiết khấu theo ngày khám, thực thu theo
 * ngày thu, chờ thu, thời gian chờ, lãi gộp thuốc), kỳ so sánh là tháng liền trước, "Cần chú ý"; xếp hạng ghép nhiều chi nhánh; tổng hợp tháng + xu hướng; khám chéo chi nhánh KHÔNG lộ tiền;
 * chỉ người có `company_report.read` xem được; id chi nhánh của công ty khác → 404; cô lập công ty; Excel + nhật ký.
 */
describe('HTTP e2e — Toàn hệ thống (/api/v1/reports/system)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let adminToken: string;
  let branchOnlyToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let branchA: string;
  let branchB: string;
  let warehouseA: string;
  let warehouseB: string;
  let drugPara: string;
  let adminId: string;
  const patients: Record<string, string> = {};

  const SEP = 'from=2026-09-01&to=2026-09-30';
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const get = (token: string, path: string, query = `${SEP}&scope=all`) => http().get(`/api/v1/reports/system/${path}?${query}`).set(authed(token));
  const rowOf = <T extends { branchId: string }>(rows: T[], id: string): T | undefined => rows.find((r) => r.branchId === id);

  async function patient(key: string): Promise<string> {
    if (patients[key]) return patients[key];
    const n = Math.floor(Math.random() * 1_000_000_000);
    const created = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-SY-${key}-${n}`, fullName: `Bệnh nhân ${key} ${n}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    patients[key] = created.id;
    return created.id;
  }

  /** Lượt khám đã tiếp nhận, kèm phiếu thu (một dòng khám) và các khoản thanh toán. `waitMinutes` có thì lượt đã bắt đầu khám sau từng ấy phút. */
  async function visit(opts: {
    patientKey: string;
    branchId: string;
    date: string;
    time?: string;
    waitMinutes?: number;
    invoice?: { total: number; status: 'UNPAID' | 'PAID' | 'CANCELLED'; discountPercent?: number; payments?: Array<{ amount: number; paidAt: Date; type?: 'PAYMENT' | 'REFUND' }> };
    status?: 'COMPLETED' | 'CANCELLED';
  }): Promise<{ encounterId: string; invoiceId: string | null; serviceItemId: string | null }> {
    const when = at(opts.date, opts.time ?? '09:00');
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const e = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId,
        patientId: await patient(opts.patientKey),
        departmentId: department.id,
        encounterNo: `LK-SY-${randomUUID().slice(0, 10)}`,
        status: opts.status ?? 'COMPLETED',
        checkedInAt: when,
        startedAt: opts.waitMinutes === undefined ? null : new Date(when.getTime() + opts.waitMinutes * 60_000),
        completedAt: opts.waitMinutes === undefined ? null : new Date(when.getTime() + (opts.waitMinutes + 10) * 60_000),
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    if (!opts.invoice) return { encounterId: e.id, invoiceId: null, serviceItemId: null };
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId: e.id,
        invoiceNo: `PT-SY-${randomUUID().slice(0, 10)}`,
        status: opts.invoice.status,
        totalAmount: BigInt(opts.invoice.total),
        discountType: opts.invoice.discountPercent ? 'PERCENT' : null,
        discountValue: opts.invoice.discountPercent ? BigInt(opts.invoice.discountPercent) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const item = await privileged.encounterServiceItem.create({
      data: { tenantId: fixture.tenantA.id, encounterId: e.id, examTypeCode: 'KHAM', examTypeName: 'Khám nội', examTypePrice: BigInt(opts.invoice.total), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.invoiceLine.create({
      data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, sourceServiceItemId: item.id, examTypeCode: 'KHAM', examTypeName: 'Khám nội', unitPrice: BigInt(opts.invoice.total), quantity: 1, lineTotal: BigInt(opts.invoice.total), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    for (const p of opts.invoice.payments ?? []) {
      await privileged.payment.create({
        data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, method: 'CASH', type: p.type ?? 'PAYMENT', amount: BigInt(p.amount), paidAt: p.paidAt, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    return { encounterId: e.id, invoiceId: invoice.id, serviceItemId: item.id };
  }

  /** Ghi vật tư tiêu hao cho dịch vụ khám của một lượt (phiếu xuất SERVICE_CONSUMPTION đang hiệu lực) — #297 bổ sung 4. */
  async function consume(opts: { encounterId: string; serviceItemId: string; warehouseId: string; date: string; quantity: number; unitCost: number }) {
    const issue = await privileged.stockIssue.create({
      data: {
        tenantId: fixture.tenantA.id,
        issueNo: `PX-TH-${randomUUID().slice(0, 10)}`,
        warehouseId: opts.warehouseId,
        issueType: 'SERVICE_CONSUMPTION',
        status: 'POSTED',
        occurredAt: at(opts.date, '09:40'),
        totalAmount: 0n,
        encounterId: opts.encounterId,
        encounterServiceItemId: opts.serviceItemId,
        performedBy: adminId,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    await privileged.stockIssueLine.create({
      data: { tenantId: fixture.tenantA.id, issueId: issue.id, drugId: drugPara, quantity: opts.quantity, unitCost: BigInt(opts.unitCost), sellPrice: 0n, lineAmount: 0n, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
  }

  /** Bán thuốc cho một lượt khám: đơn thuốc + phiếu xuất bán theo đơn + dòng thuốc trong hoá đơn. */
  async function sellDrug(encounterId: string, invoiceId: string, opts: { quantity: number; sellPrice: number; unitCost: number }) {
    const prescription = await privileged.prescription.create({ data: { tenantId: fixture.tenantA.id, encounterId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const issue = await privileged.stockIssue.create({
      data: {
        tenantId: fixture.tenantA.id,
        issueNo: `PX-SY-${randomUUID().slice(0, 10)}`,
        warehouseId: warehouseA,
        prescriptionId: prescription.id,
        issueType: 'RETAIL_SALE',
        status: 'POSTED',
        occurredAt: at('2026-09-15', '09:30'),
        totalAmount: BigInt(opts.quantity * opts.sellPrice),
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const line = await privileged.stockIssueLine.create({
      data: { tenantId: fixture.tenantA.id, issueId: issue.id, drugId: drugPara, quantity: opts.quantity, unitCost: BigInt(opts.unitCost), sellPrice: BigInt(opts.sellPrice), lineAmount: BigInt(opts.quantity * opts.sellPrice), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.invoiceLine.create({
      data: { tenantId: fixture.tenantA.id, invoiceId, sourceStockIssueLineId: line.id, examTypeCode: 'PARA', examTypeName: 'Paracetamol 500mg', unitPrice: BigInt(opts.sellPrice), quantity: opts.quantity, lineTotal: BigInt(opts.quantity * opts.sellPrice), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
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

    fixture = await createTwoTenantFixture(privileged, 'System report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZSY2', name: 'Chi nhánh B hệ thống', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
    warehouseA = (await privileged.warehouse.create({ data: { tenantId: fixture.tenantA.id, branchId: branchA, code: 'ZZSYA', name: 'Kho A hệ thống', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
    warehouseB = (await privileged.warehouse.create({ data: { tenantId: fixture.tenantA.id, branchId: branchB, code: 'ZZSYB', name: 'Kho B hệ thống', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
    drugPara = (await privileged.drug.create({ data: { tenantId: fixture.tenantA.id, code: 'SY-PARA', name: 'Paracetamol 500mg', baseUnitCode: 'VIEN', isBatchManaged: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'sy-admin', [branchA]);
    adminId = admin.id;
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    // Vai trò chỉ có `company_report.read`: xem được trang (và chọn phạm vi) — kiểm thiếu quyền dùng lễ tân.
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'sy-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const branchOnlyRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-chi-nhanh-hien-tai', [['company_report', 'read']]);
    const branchOnly = await h.createUser(fixture.tenantA.id, { id: branchOnlyRole }, 'sy-branch-only', [branchA]);
    branchOnlyToken = await h.login(fixture.tenantA.id, branchOnly.username);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'sy-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    // ── Tháng 08/2026 (kỳ so sánh), chi nhánh A: một lượt, phiếu 100.000 thu 15/08 ──
    await visit({ patientKey: 'p4', branchId: branchA, date: '2026-08-15', invoice: { total: 100_000, status: 'PAID', payments: [{ amount: 100_000, paidAt: at('2026-08-15', '10:00') }] } });

    // ── Tháng 09/2026, chi nhánh A ──
    // A1: 10/09, bệnh nhân p1 (LẦN ĐẦU), chờ 20 phút, phiếu 500.000 ĐÃ THU 500.000 ngày 11/09 (thực thu tính theo ngày thu, ghi nhận theo ngày khám).
    const a1 = await visit({ patientKey: 'p1', branchId: branchA, date: '2026-09-10', waitMinutes: 20, invoice: { total: 500_000, status: 'PAID', payments: [{ amount: 500_000, paidAt: at('2026-09-11', '09:00') }] } });
    // Lượt A1 ghi tiêu hao 3 × 100 = 300 đ → lãi gộp dịch vụ chi nhánh A = 500.000 − 300 = 499.700 (#297 bổ sung 4).
    await consume({ encounterId: a1.encounterId, serviceItemId: a1.serviceItemId!, warehouseId: warehouseA, date: '2026-09-10', quantity: 3, unitCost: 100 });
    // A2: 12/09, bệnh nhân p2 (lần đầu), chờ 10 phút, phiếu 300.000 CHƯA THU.
    await visit({ patientKey: 'p2', branchId: branchA, date: '2026-09-12', waitMinutes: 10, invoice: { total: 300_000, status: 'UNPAID' } });
    // A3: 20/09, bệnh nhân p1 quay lại (KHÔNG phải bệnh nhân mới), phiếu 200.000 đã thu cùng ngày; hoàn 50.000 hôm sau.
    await visit({
      patientKey: 'p1',
      branchId: branchA,
      date: '2026-09-20',
      invoice: { total: 200_000, status: 'PAID', payments: [{ amount: 200_000, paidAt: at('2026-09-20', '09:30') }, { amount: 50_000, paidAt: at('2026-09-21', '09:00'), type: 'REFUND' }] },
    });
    // A4: 15/09, bệnh nhân p3 (lần đầu) mua thuốc: 10 viên × 1.000, vốn 400 → lãi gộp thuốc 6.000; đã thu 10.000.
    const a4 = await visit({ patientKey: 'p3', branchId: branchA, date: '2026-09-15', invoice: { total: 10_000, status: 'PAID', payments: [{ amount: 10_000, paidAt: at('2026-09-15', '10:00') }] } });
    // (phiếu A4 chỉ có dòng thuốc: bỏ dòng khám tự thêm của hàm `visit` để tiền bán thuốc là toàn bộ phiếu)
    await privileged.invoiceLine.updateMany({ where: { tenantId: fixture.tenantA.id, invoiceId: a4.invoiceId!, sourceServiceItemId: { not: null } }, data: { deletedAt: new Date(), deletedReason: 'Chỉ giữ dòng thuốc' } });
    await sellDrug(a4.encounterId, a4.invoiceId!, { quantity: 10, sellPrice: 1000, unitCost: 400 });
    // Lượt đã huỷ: không tính lượt khám, không tính ghi nhận.
    await visit({ patientKey: 'p5', branchId: branchA, date: '2026-09-22', status: 'CANCELLED', invoice: { total: 999_000, status: 'CANCELLED' } });
    // Ca thu ngân của chi nhánh A còn MỞ từ tháng 09 (đáng lẽ đã chốt).
    await privileged.cashierShift.create({
      data: { tenantId: fixture.tenantA.id, branchId: branchA, shiftNo: `CA-SY-${randomUUID().slice(0, 6)}`, cashierId: adminId, shiftLabel: 'Ca sáng', status: 'OPEN', openedAt: at('2026-09-25', '07:00'), openingFloatActual: 0n, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });

    // ── Tháng 09/2026, chi nhánh B ──
    // B1: 14/09, bệnh nhân p1 khám thêm ở chi nhánh B (KHÁM CHÉO; không phải bệnh nhân mới), chờ 30 phút, phiếu 400.000 đã thu cùng ngày.
    await visit({ patientKey: 'p1', branchId: branchB, date: '2026-09-14', waitMinutes: 30, invoice: { total: 400_000, status: 'PAID', payments: [{ amount: 400_000, paidAt: at('2026-09-14', '10:30') }] } });
    // B2: 16/09, bệnh nhân p6 (lần đầu), phiếu 150.000 CHƯA THU.
    const b2 = await visit({ patientKey: 'p6', branchId: branchB, date: '2026-09-16', invoice: { total: 150_000, status: 'UNPAID' } });
    // Lượt B2 (phiếu CHƯA THU vẫn là doanh thu ghi nhận) ghi tiêu hao 1 × 50 → lãi gộp dịch vụ chi nhánh B = 150.000 − 50 = 149.950.
    await consume({ encounterId: b2.encounterId, serviceItemId: b2.serviceItemId!, warehouseId: warehouseB, date: '2026-09-16', quantity: 1, unitCost: 50 });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền và kiểm tra đầu vào', () => {
    it('chưa đăng nhập → 401; lễ tân → 403; quản trị và vai trò có company_report.read → 200, cho cả 4 báo cáo', async () => {
      const queries: Record<string, string> = { overview: SEP, ranking: SEP, cross: SEP, monthly: 'month=2026-09' };
      for (const [path, q] of Object.entries(queries)) {
        expect((await http().get(`/api/v1/reports/system/${path}?${q}`)).status, path).toBe(401);
        expect((await get(receptionistToken, path, q)).status, path).toBe(403);
        expect((await get(adminToken, path, q)).status, path).toBe(200);
        expect((await get(branchOnlyToken, path, q)).status, path).toBe(200);
      }
    });

    it('khoảng ngày sai, tháng sai và quá dài → lỗi kiểm tra đầu vào, không phải 500', async () => {
      for (const q of ['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-09-01', 'from=2026-02-31&to=2026-03-01', 'from=2026-09-01']) {
        expect([400, 422], q).toContain((await get(adminToken, 'overview', q)).status);
        expect([400, 422], q).toContain((await get(adminToken, 'cross', q)).status);
      }
      for (const q of ['month=2026-13', 'month=2026-9', 'month=abc', '']) expect([400, 422], q).toContain((await get(adminToken, 'monthly', q)).status);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào; id chi nhánh lạ → 404', async () => {
      expect([400, 422]).toContain((await get(adminToken, 'overview', `${SEP}&scope=pick`)).status);
      expect((await get(adminToken, 'overview', `${SEP}&scope=pick&branchIds=${randomUUID()}`)).status).toBe(404);
    });
  });

  describe('So sánh chi nhánh', () => {
    it('từng chi nhánh: lượt khám đã tiếp nhận, bệnh nhân mới, ghi nhận sau chiết khấu, thực thu theo ngày thu, chờ thu, thời gian chờ, lãi gộp thuốc', async () => {
      const res = await get(adminToken, 'overview');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.branchCount).toBeGreaterThanOrEqual(2);
      // Chi nhánh A: 4 lượt tiếp nhận (lượt huỷ không tính); bệnh nhân mới = p1, p2, p3 (A3 là p1 quay lại).
      expect(rowOf(d.rows, branchA)).toMatchObject({ visits: 4, newPatients: 3, recognized: 500_000 + 300_000 + 200_000 + 10_000, collected: 500_000 + 200_000 - 50_000 + 10_000, unpaidAmount: 300_000, unpaidCount: 1, averageWaitMinutes: 15, followUpArrivalPercent: null, drugMargin: 6_000, serviceMargin: 499_700, totalMargin: 505_700 });
      // Chi nhánh B: p1 đã khám ở A trước đó nên KHÔNG là bệnh nhân mới ở B; p6 là mới.
      expect(rowOf(d.rows, branchB)).toMatchObject({ visits: 2, newPatients: 1, recognized: 550_000, collected: 400_000, unpaidAmount: 150_000, unpaidCount: 1, averageWaitMinutes: 30, drugMargin: 0, serviceMargin: 149_950, totalMargin: 149_950 });
      expect(d.totals).toMatchObject({ visits: 6, newPatients: 4, recognized: 1_560_000, collected: 1_060_000, unpaidAmount: 450_000, unpaidCount: 2, averageWaitMinutes: 20, drugMargin: 6_000, serviceMargin: 649_650, totalMargin: 655_650 });
    });

    it('kỳ so sánh là tháng liền trước (tháng tròn) và các KPI kèm % thay đổi', async () => {
      const d = (await get(adminToken, 'overview')).body.data;
      expect(d).toMatchObject({ previousFrom: '2026-08-01', previousTo: '2026-08-31' });
      expect(d.kpis.recognized).toMatchObject({ value: 1_560_000, previous: 100_000, percent: 1460, direction: 'up' });
      expect(d.kpis.collected).toMatchObject({ value: 1_060_000, previous: 100_000, direction: 'up' });
      expect(d.kpis.visits).toMatchObject({ value: 6, previous: 1 });
      expect(d.kpis.newPatients).toMatchObject({ value: 4, previous: 1 });
      expect(d.kpis).toMatchObject({ unpaidAmount: 450_000, unpaidCount: 2 });
    });

    it('thực thu theo ngày của từng chi nhánh: đủ mọi ngày của kỳ, ngày không thu = 0, hoàn tiền trừ ra', async () => {
      const d = (await get(adminToken, 'overview')).body.data;
      expect(d.daily.dates).toHaveLength(30);
      expect(d.daily.dates[0]).toBe('2026-09-01');
      const a = d.daily.series.find((s: { branchId: string }) => s.branchId === branchA);
      const b = d.daily.series.find((s: { branchId: string }) => s.branchId === branchB);
      expect(a.values).toHaveLength(30);
      expect(a.values[10]).toBe(500_000); // 11/09 (thu 500.000 của lượt khám 10/09)
      expect(a.values[14]).toBe(10_000); // 15/09
      expect(a.values[19]).toBe(200_000); // 20/09
      expect(a.values[20]).toBe(-50_000); // 21/09 hoàn tiền
      expect(a.values[0]).toBe(0);
      expect(b.values[13]).toBe(400_000); // 14/09
      expect(a.values.reduce((s: number, v: number) => s + v, 0)).toBe(660_000);
    });

    it('cơ cấu thực thu theo nhóm: tổng bốn nhóm đúng bằng tổng thực thu; thuốc là phần của phiếu thuốc', async () => {
      const d = (await get(adminToken, 'overview')).body.data;
      expect(d.groupTotal).toBe(d.totals.collected);
      const amount = (g: string) => d.groups.find((x: { group: string }) => x.group === g).amount;
      expect(amount('DRUG')).toBe(10_000);
      expect(amount('EXAM') + amount('PARACLINICAL') + amount('DRUG') + amount('PACKAGE')).toBe(1_060_000);
    });

    it('Cần chú ý: ca thu ngân còn mở từ trước hôm nay, phiếu chưa thu quá 3 ngày, chi nhánh chờ lâu nhất', async () => {
      const d = (await get(adminToken, 'overview')).body.data;
      const kinds = d.alerts.map((a: { kind: string; branchId: string }) => `${a.kind}:${a.branchId}`);
      expect(kinds).toContain(`OPEN_SHIFTS:${branchA}`);
      expect(kinds).toContain(`OVERDUE_UNPAID:${branchA}`);
      expect(kinds).toContain(`OVERDUE_UNPAID:${branchB}`);
      expect(kinds).toContain(`LONG_WAIT:${branchB}`);
      expect(kinds).not.toContain(`LONG_WAIT:${branchA}`);
      expect(d.alerts.find((a: { kind: string; branchId: string }) => a.kind === 'LONG_WAIT' && a.branchId === branchB).text).toBe('Thời gian chờ trung bình 30 phút, cao nhất hệ thống');
    });

    it('kỳ không có dữ liệu → mọi số 0, không lỗi', async () => {
      const d = (await get(adminToken, 'overview', 'from=2026-01-01&to=2026-01-31&scope=all')).body.data;
      expect(d.totals).toMatchObject({ visits: 0, recognized: 0, collected: 0, averageWaitMinutes: null, followUpArrivalPercent: null });
      expect(d.kpis.recognized).toMatchObject({ value: 0, previous: 0, percent: null });
    });
  });

  describe('phạm vi nhiều chi nhánh', () => {
    it('mặc định (không gửi scope) chỉ chi nhánh đang làm; scope=pick chỉ chi nhánh được chọn', async () => {
      const own = (await get(adminToken, 'overview', SEP)).body.data;
      expect(own.branchCount).toBe(1);
      expect(own.rows.map((r: { branchId: string }) => r.branchId)).toEqual([branchA]);
      const pickB = (await get(adminToken, 'overview', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(pickB.rows.map((r: { branchId: string }) => r.branchId)).toEqual([branchB]);
      // Bệnh nhân mới tính theo lượt đầu tiên ở MỌI chi nhánh dù chỉ xem một chi nhánh: p1 không mới ở B.
      expect(pickB.totals).toMatchObject({ visits: 2, newPatients: 1, recognized: 550_000 });
    });
  });

  describe('Xếp hạng', () => {
    it('dịch vụ, bác sĩ, thuốc: ghép nhiều chi nhánh, giá trị từng chi nhánh đúng thứ tự, xếp giảm dần', async () => {
      const res = await get(adminToken, 'ranking');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.branches.map((b: { branchId: string }) => b.branchId)).toEqual(expect.arrayContaining([branchA, branchB]));
      const indexA = d.branches.findIndex((b: { branchId: string }) => b.branchId === branchA);
      const indexB = d.branches.findIndex((b: { branchId: string }) => b.branchId === branchB);
      const kham = d.services.find((r: { name: string }) => r.name === 'Khám nội');
      // Ghi nhận khám: A = 500.000 + 300.000 + 200.000 = 1.000.000; B = 400.000 + 150.000 = 550.000 (lượt huỷ không tính).
      expect(kham).toMatchObject({ subtitle: 'Khám bệnh', total: 1_550_000 });
      expect(kham.byBranch[indexA]).toBe(1_000_000);
      expect(kham.byBranch[indexB]).toBe(550_000);
      expect(d.services.every((r: { subtitle: string }) => r.subtitle !== 'Thuốc và vật tư')).toBe(true);
      const drug = d.drugs.find((r: { name: string }) => r.name === 'Paracetamol 500mg');
      expect(drug).toMatchObject({ subtitle: 'Thuốc', quantity: 10, total: 6_000 });
      expect(drug.byBranch[indexA]).toBe(6_000);
      expect(drug.byBranch[indexB]).toBe(0);
      expect(d.doctors).toEqual([]); // dữ liệu thử không gán bác sĩ cho lượt khám nào
      // Lãi gộp dịch vụ (#297 bổ sung 4): chỉ các lượt có ghi tiêu hao — A1 (500.000 − 300) và B2 (150.000 − 50); phiếu chưa thu vẫn là doanh thu ghi nhận.
      expect(d.serviceMargins).toHaveLength(1);
      expect(d.serviceMargins[0]).toMatchObject({ name: 'Khám nội', subtitle: 'Khám bệnh', quantity: 2, total: 649_650 });
      expect(d.serviceMargins[0].byBranch[indexA]).toBe(499_700);
      expect(d.serviceMargins[0].byBranch[indexB]).toBe(149_950);
    });
  });

  describe('Tổng hợp tháng', () => {
    it('tháng đang xem so với tháng trước, theo chi nhánh, cơ cấu theo nhóm và xu hướng 6 tháng', async () => {
      const res = await get(adminToken, 'monthly', 'month=2026-09&scope=all');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d).toMatchObject({ month: '2026-09', previousMonth: '2026-08', from: '2026-09-01', to: '2026-09-30' });
      expect(d.kpis.collected).toMatchObject({ value: 1_060_000, previous: 100_000, direction: 'up' });
      expect(d.kpis.drugMargin).toMatchObject({ value: 6_000, previous: 0 });
      expect(d.kpis.serviceMargin).toMatchObject({ value: 649_650, previous: 0 });
      expect(d.kpis.totalMargin).toMatchObject({ value: 655_650, previous: 0 });
      const a = rowOf<{ branchId: string; current: Record<string, number>; previous: Record<string, number> }>(d.rows, branchA)!;
      expect(a.current).toMatchObject({ visits: 4, newPatients: 3, recognized: 1_010_000, collected: 660_000, drugMargin: 6_000, serviceMargin: 499_700, totalMargin: 505_700 });
      expect(rowOf<{ branchId: string; current: Record<string, number> }>(d.rows, branchB)!.current).toMatchObject({ serviceMargin: 149_950, totalMargin: 149_950 });
      expect(a.previous).toMatchObject({ visits: 1, newPatients: 1, recognized: 100_000, collected: 100_000 });
      expect(d.groupTotal).toBe(1_060_000);
      expect(d.trend.map((m: { month: string }) => m.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
      expect(d.trend[4]).toMatchObject({ visits: 1, collected: 100_000 });
      expect(d.trend[5]).toMatchObject({ visits: 6, newPatients: 4, recognized: 1_560_000, collected: 1_060_000 });
      expect(d.trend[0]).toMatchObject({ visits: 0, collected: 0 });
    });
  });

  describe('Khám chéo chi nhánh', () => {
    it('bệnh nhân khám ở từ hai chi nhánh: tổng, cặp chi nhánh, danh sách; KHÔNG có tiền theo bệnh nhân', async () => {
      const res = await get(adminToken, 'cross');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      // 5 bệnh nhân có lượt khám đã tiếp nhận (p1, p2, p3, p6 + không tính p5 đã huỷ); chỉ p1 khám ở cả A và B.
      expect(d.totals).toMatchObject({ patientCount: 4, crossPatientCount: 1, crossPercent: 25, crossVisits: 3 });
      expect(d.rowTotal).toBe(1);
      expect(d.rows).toHaveLength(1);
      expect(d.rows[0]).toMatchObject({ patientCode: expect.stringContaining('BN-SY-p1'), branchCount: 2, visitCount: 3, lastVisitDate: '2026-09-20' });
      expect(d.rows[0].branches.map((b: { visits: number }) => b.visits)).toEqual([2, 1]);
      expect(d.pairs).toHaveLength(1);
      expect(d.pairs[0].patientCount).toBe(1);
      const names = [d.pairs[0].branchAName, d.pairs[0].branchBName];
      expect(names).toContain('Chi nhánh B hệ thống');
      // Không rò tiền: không có khoá nào liên quan tiền trong bất kỳ dòng nào.
      expect(JSON.stringify(d.rows)).not.toMatch(/amount|recognized|collected|revenue|unpaid/i);
    });

    it('chỉ xem một chi nhánh thì không có bệnh nhân khám chéo', async () => {
      const d = (await get(adminToken, 'cross', SEP)).body.data;
      expect(d.totals).toMatchObject({ crossPatientCount: 0, crossVisits: 0 });
      expect(d.rows).toEqual([]);
      expect(d.pairs).toEqual([]);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0 ở cả 4 báo cáo; không đọc được chi nhánh của công ty này (404)', async () => {
      expect((await get(tenantBAdminToken, 'overview')).body.data).toMatchObject({ rows: [expect.objectContaining({ visits: 0, recognized: 0 })], totals: { visits: 0, collected: 0 } });
      expect((await get(tenantBAdminToken, 'ranking')).body.data).toMatchObject({ services: [], doctors: [], drugs: [] });
      expect((await get(tenantBAdminToken, 'monthly', 'month=2026-09')).body.data.trend.every((m: { visits: number }) => m.visits === 0)).toBe(true);
      expect((await get(tenantBAdminToken, 'cross', `${SEP}&scope=all`)).body.data.totals).toMatchObject({ patientCount: 0, crossPatientCount: 0 });
      expect((await get(tenantBAdminToken, 'overview', `${SEP}&scope=pick&branchIds=${branchA}`)).status).toBe(404);
    });
  });

  describe('xuất Excel', () => {
    async function readSheet(buffer: Buffer): Promise<{ names: string[]; text: string }> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const text = wb.worksheets.map((s) => s.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|')).join('\n');
      return { names: wb.worksheets.map((s) => s.name), text };
    }

    it('4 báo cáo xuất được, tên sheet đúng, ô tiền ghi SỐ khớp màn hình', async () => {
      const cases: Array<[string, string, string, string[]]> = [
        ['overview', SEP, 'So sánh chi nhánh', ['Chi nhánh B hệ thống', '1560000', '1060000', 'CẦN CHÚ Ý']],
        ['ranking', SEP, 'Xếp hạng', ['Khám nội', '1550000', 'Paracetamol 500mg', '6000']],
        ['monthly', 'month=2026-09', 'Tổng hợp tháng', ['1060000', '100000', '04/2026']],
        ['cross', SEP, 'Khám chéo chi nhánh', ['BN-SY-p1', 'Chi nhánh B hệ thống']],
      ];
      for (const [path, q, sheetName, expected] of cases) {
        const res = await h.download(`/api/v1/reports/system/${path}/export?${q}&scope=all`, adminToken);
        expect(res.status, path).toBe(200);
        expect(res.headers['content-type'], path).toContain('spreadsheetml');
        const sheet = await readSheet(res.body as Buffer);
        expect(sheet.names, path).toEqual([sheetName]);
        for (const token of expected) expect(sheet.text, `${path} ${token}`).toContain(token);
      }
    });

    it('ghi nhật ký xuất đúng chi nhánh đã đọc; thiếu quyền → 403 và không ghi nhật ký mới', async () => {
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'system_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('system_report_export');
      expect(JSON.stringify(audit?.afterJson)).toContain(branchA);
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'system_report.exported' } });
      expect((await h.download(`/api/v1/reports/system/overview/export?${SEP}`, receptionistToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'system_report.exported' } })).toBe(before);
    });
  });
});
