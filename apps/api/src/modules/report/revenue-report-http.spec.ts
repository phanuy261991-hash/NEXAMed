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
 * HTTP e2e — trang báo cáo "Doanh thu" (`/reports/revenue/*`, docs/DECISIONS.md #287). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định (tháng 09–10/2026), nên kết quả không đổi
 * theo ngày chạy. Trọng tâm: GHI NHẬN theo ngày khám và THỰC THU theo ngày thu độc lập nhau (kể cả phiếu khám 23:30 ngày 30/09 thu lúc 00:30 ngày 01/10); chiết khấu; phiếu đã huỷ không tính;
 * hoàn tiền; theo dịch vụ/phương thức/thu ngân; phạm vi nhiều chi nhánh cần `company_report.read`; cô lập CHI NHÁNH và CÔNG TY; chỉ quản lý (`revenue_report.read`) xem được; Excel + nhật ký.
 */
describe('HTTP e2e — Doanh thu (/api/v1/reports/revenue)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let adminToken: string;
  let viewerToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let tenantBAdminToken: string;
  let branchA: string;
  let branchB: string;
  let adminId: string;
  let cashier2Id: string;
  const invoices: Record<string, string> = {};

  const RANGE = 'from=2026-09-01&to=2026-10-31';
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const get = (token: string, path: string, query = RANGE) => http().get(`/api/v1/reports/revenue/${path}?${query}`).set(authed(token));

  async function makeEncounter(checkedInAt: Date, branchId: string): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-RV-${n}`, fullName: `Bệnh nhân doanh thu ${n}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const e = await privileged.encounter.create({
      data: { tenantId: fixture.tenantA.id, branchId, patientId: patient.id, departmentId: department.id, encounterNo: `LK-RV-${randomUUID().slice(0, 10)}`, status: 'COMPLETED', checkedInAt, insuranceSnapshot: { selfPay: true }, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return e.id;
  }

  async function makeInvoice(
    tag: string,
    checkedInAt: Date,
    opts: { branchId?: string; status: 'UNPAID' | 'PAID' | 'CANCELLED'; total: number; lineNames: string[]; discountPercent?: number; payments?: Array<{ type: 'PAYMENT' | 'REFUND'; method: string; amount: number; paidAt: Date; by: string }> },
  ) {
    const encounterId = await makeEncounter(checkedInAt, opts.branchId ?? branchA);
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        invoiceNo: `PT-RV-${randomUUID().slice(0, 10)}`,
        status: opts.status,
        totalAmount: BigInt(opts.total),
        discountType: opts.discountPercent ? 'PERCENT' : null,
        discountValue: opts.discountPercent ? BigInt(opts.discountPercent) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    invoices[tag] = invoice.id;
    for (const name of opts.lineNames) {
      const lineTotal = Math.round(opts.total / opts.lineNames.length);
      const item = await privileged.encounterServiceItem.create({
        data: { tenantId: fixture.tenantA.id, encounterId, examTypeCode: 'KHAM', examTypeName: name, examTypePrice: BigInt(lineTotal), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      await privileged.invoiceLine.create({
        data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, sourceServiceItemId: item.id, examTypeCode: 'KHAM', examTypeName: name, unitPrice: BigInt(lineTotal), quantity: 1, lineTotal: BigInt(lineTotal), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    for (const p of opts.payments ?? []) {
      await privileged.payment.create({
        data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, method: p.method, type: p.type, amount: BigInt(p.amount), paidAt: p.paidAt, createdBy: p.by, updatedBy: p.by },
      });
    }
  }

  async function makeShift(branchId: string, no: string, cashierId: string, openedAt: Date, closed?: { closedAt: Date; expected: number; counted: number }) {
    return privileged.cashierShift.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        shiftNo: no,
        cashierId,
        shiftLabel: 'Ca sáng',
        status: closed ? 'CLOSED' : 'OPEN',
        openedAt,
        openingFloatActual: BigInt(0),
        closedAt: closed?.closedAt ?? null,
        expectedCashAmount: closed ? BigInt(closed.expected) : null,
        countedCashAmount: closed ? BigInt(closed.counted) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
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

    fixture = await createTwoTenantFixture(privileged, 'Revenue report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZRV2', name: 'Chi nhánh B doanh thu', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'rv-admin', [branchA]);
    adminId = admin.id;
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    // Vai trò xem được báo cáo doanh thu nhưng KHÔNG có `company_report.read`: chỉ xem chi nhánh đang làm.
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-doanh-thu-chi-nhanh', [['revenue_report', 'read']]);
    const viewer = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'rv-viewer', [branchA]);
    viewerToken = await h.login(fixture.tenantA.id, viewer.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'rv-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    cashier2Id = receptionist.id;
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'rv-doctor', [branchA]);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'rv-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    // ── Chi nhánh A ──
    // I1: khám 10/09, đã thu 500.000 tiền mặt cùng ngày (admin); hoàn 100.000 ngày 20/09 (admin).
    await makeInvoice('i1', at('2026-09-10', '09:00'), {
      status: 'PAID', total: 500_000, lineNames: ['Khám nội'],
      payments: [
        { type: 'PAYMENT', method: 'CASH', amount: 500_000, paidAt: at('2026-09-10', '09:10'), by: adminId },
        { type: 'REFUND', method: 'CASH', amount: 100_000, paidAt: at('2026-09-20', '10:00'), by: adminId },
      ],
    });
    // I2: khám 23:30 ngày 30/09 (giờ VN), giảm 10% → phải thu 360.000, thu 00:30 ngày 01/10 bằng chuyển khoản (thu ngân 2) — ghi nhận ở tháng 9, thực thu ở tháng 10.
    await makeInvoice('i2', at('2026-09-30', '23:30'), {
      status: 'PAID', total: 400_000, lineNames: ['Khám nội', 'Siêu âm'], discountPercent: 10,
      payments: [{ type: 'PAYMENT', method: 'TRANSFER', amount: 360_000, paidAt: at('2026-10-01', '00:30'), by: cashier2Id }],
    });
    // I3: khám 05/10, CHƯA THU 200.000.
    await makeInvoice('i3', at('2026-10-05', '09:00'), { status: 'UNPAID', total: 200_000, lineNames: ['Siêu âm'] });
    // I4: phiếu ĐÃ HUỶ — không tính vào đâu cả.
    await makeInvoice('i4', at('2026-09-12', '09:00'), { status: 'CANCELLED', total: 999_000, lineNames: ['Dịch vụ đã huỷ'] });
    // I6: khám 14/09, CHƯA THU 300.000.
    await makeInvoice('i6', at('2026-09-14', '09:00'), { status: 'UNPAID', total: 300_000, lineNames: ['Khám nội'] });
    // ── Chi nhánh B ── chỉ thấy khi gộp chi nhánh.
    await makeInvoice('i5', at('2026-09-15', '09:00'), {
      branchId: branchB, status: 'PAID', total: 1_000_000, lineNames: ['Khám nội'],
      payments: [{ type: 'PAYMENT', method: 'CASH', amount: 1_000_000, paidAt: at('2026-09-15', '09:30'), by: adminId }],
    });

    await makeShift(branchA, 'PCC-RV-1', adminId, at('2026-09-10', '08:00'), { closedAt: at('2026-09-10', '17:00'), expected: 500_000, counted: 490_000 });
    await makeShift(branchA, 'PCC-RV-2', cashier2Id, at('2026-09-11', '08:00'));
    await makeShift(branchB, 'PCC-RV-3', adminId, at('2026-09-15', '08:00'), { closedAt: at('2026-09-15', '17:00'), expected: 1_000_000, counted: 1_000_000 });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền và kiểm tra đầu vào', () => {
    it('chưa đăng nhập → 401; lễ tân và bác sĩ → 403; quản trị và vai trò có revenue_report.read → 200, cho cả 5 báo cáo', async () => {
      for (const path of ['by-period', 'by-service', 'by-method', 'unpaid', 'by-cashier']) {
        expect((await http().get(`/api/v1/reports/revenue/${path}?${RANGE}`)).status, path).toBe(401);
        expect((await get(receptionistToken, path)).status, path).toBe(403);
        expect((await get(doctorToken, path)).status, path).toBe(403);
        expect((await get(adminToken, path)).status, path).toBe(200);
        expect((await get(viewerToken, path)).status, path).toBe(200);
      }
    });

    it('khoảng ngày sai: ngược, quá 366 ngày, ngày không có thật, thiếu tham số, kiểu gom lạ → lỗi kiểm tra đầu vào, không phải 500', async () => {
      for (const q of ['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-09-01', 'from=2026-02-31&to=2026-03-01', 'from=2026-09-01', `${RANGE}&groupBy=nam`]) {
        const res = await get(adminToken, 'by-period', q);
        expect([400, 422], q).toContain(res.status);
      }
    });
  });

  describe('Theo kỳ', () => {
    it('Ghi nhận theo ngày khám, Thực thu theo ngày thu: hai cột độc lập; chiết khấu; phiếu huỷ không tính; hoàn tiền trừ vào thực thu', async () => {
      const res = await get(adminToken, 'by-period');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.groupBy).toBe('month');
      expect(d.branchCount).toBe(1);
      expect(d.rows.map((r: { label: string }) => r.label)).toEqual(['T9/2026', 'T10/2026']);
      // Tháng 9: I1 500.000 + I2 360.000 (23:30 ngày 30/09 vẫn là tháng 9) + I6 300.000; thu 500.000, hoàn 100.000.
      expect(d.rows[0]).toMatchObject({ recognized: 1_160_000, discount: 40_000, collected: 500_000, refunded: 100_000, net: 400_000, netDeltaPercent: null });
      // Tháng 10: I3 200.000; thu 360.000 của I2 (00:30 ngày 01/10 giờ VN).
      expect(d.rows[1]).toMatchObject({ recognized: 200_000, discount: 0, collected: 360_000, refunded: 0, net: 360_000, netDeltaPercent: -10 });
      expect(d.totals).toMatchObject({ recognized: 1_360_000, discount: 40_000, collected: 860_000, refunded: 100_000, net: 760_000 });
      // Tất cả dịch vụ đều là khám → bốn nhóm cộng lại đúng bằng tổng ghi nhận.
      const groups = d.totals.byGroup;
      expect(groups.EXAM).toBe(1_360_000);
      expect(groups.EXAM + groups.PARACLINICAL + groups.DRUG + groups.PACKAGE).toBe(d.totals.recognized);
    });

    it('gom theo ngày: ranh giới nửa đêm giờ Việt Nam tách đúng ngày ghi nhận và ngày thu', async () => {
      const d = (await get(adminToken, 'by-period', `${RANGE}&groupBy=day`)).body.data;
      expect(d.rows).toHaveLength(61);
      const byKey = new Map<string, { recognized: number; collected: number }>(d.rows.map((r: { key: string; recognized: number; collected: number }) => [r.key, r]));
      expect(byKey.get('2026-09-30')).toMatchObject({ recognized: 360_000, collected: 0 });
      expect(byKey.get('2026-10-01')).toMatchObject({ recognized: 0, collected: 360_000 });
      expect(byKey.get('2026-09-20')).toMatchObject({ recognized: 0, collected: 0 });
      expect(d.totals.recognized).toBe(1_360_000);
    });

    it('gom theo tuần và quý cho cùng tổng', async () => {
      for (const groupBy of ['week', 'quarter']) {
        const d = (await get(adminToken, 'by-period', `${RANGE}&groupBy=${groupBy}`)).body.data;
        expect(d.totals, groupBy).toMatchObject({ recognized: 1_360_000, net: 760_000 });
      }
      const quarters = (await get(adminToken, 'by-period', `${RANGE}&groupBy=quarter`)).body.data.rows;
      expect(quarters.map((r: { label: string }) => r.label)).toEqual(['Q3/2026', 'Q4/2026']);
    });

    it('kỳ chỉ trong tháng 9: thu của I2 (01/10) không lọt vào, ghi nhận của I3 (05/10) cũng không', async () => {
      const d = (await get(adminToken, 'by-period', 'from=2026-09-01&to=2026-09-30')).body.data;
      expect(d.totals).toMatchObject({ recognized: 1_160_000, collected: 500_000, refunded: 100_000, net: 400_000 });
    });
  });

  describe('Theo nhóm và dịch vụ', () => {
    it('doanh thu từng dịch vụ sau chiết khấu, tổng bằng tổng ghi nhận, sắp theo doanh thu giảm dần', async () => {
      const d = (await get(adminToken, 'by-service')).body.data;
      expect(d.totalAmount).toBe(1_360_000);
      expect(d.rows.map((r: { name: string; quantity: number; invoiceCount: number; amount: number }) => [r.name, r.quantity, r.invoiceCount, r.amount])).toEqual([
        ['Khám nội', 3, 3, 980_000],
        ['Siêu âm', 2, 2, 380_000],
      ]);
      expect(d.rows[0].sharePercent).toBe(72.1);
      expect(d.groups.find((g: { group: string }) => g.group === 'EXAM')).toMatchObject({ quantity: 5, amount: 1_360_000 });
      expect(d.rowTotal).toBe(2);
      expect(d.rows.some((r: { name: string }) => r.name === 'Dịch vụ đã huỷ')).toBe(false);
    });
  });

  describe('Theo phương thức', () => {
    it('thu, hoàn và thực thu theo phương thức; tỉ trọng theo thực thu', async () => {
      const d = (await get(adminToken, 'by-method')).body.data;
      const byCode = new Map<string, { methodName: string; paymentCount: number; collected: number; refundCount: number; refunded: number; net: number; sharePercent: number }>(d.rows.map((r: { methodCode: string }) => [r.methodCode, r]));
      expect(byCode.get('CASH')).toMatchObject({ paymentCount: 1, collected: 500_000, refundCount: 1, refunded: 100_000, net: 400_000, sharePercent: 52.6 });
      expect(byCode.get('TRANSFER')).toMatchObject({ paymentCount: 1, collected: 360_000, net: 360_000, sharePercent: 47.4 });
      expect(d.totals).toMatchObject({ paymentCount: 2, collected: 860_000, refundCount: 1, refunded: 100_000, net: 760_000 });
      expect(typeof byCode.get('CASH')!.methodName).toBe('string');
    });
  });

  describe('Phiếu chưa thu', () => {
    it('chỉ phiếu CHƯA THU trong kỳ, cũ nhất trước, số phải thu sau chiết khấu; phân nhóm theo tuổi phiếu cộng đúng', async () => {
      const d = (await get(adminToken, 'unpaid')).body.data;
      expect(d.totalCount).toBe(2);
      expect(d.totalAmount).toBe(500_000);
      expect(d.rows.map((r: { invoiceId: string; amount: number; date: string }) => [r.invoiceId, r.amount, r.date])).toEqual([
        [invoices.i6, 300_000, '2026-09-14'],
        [invoices.i3, 200_000, '2026-10-05'],
      ]);
      expect(d.rows[0].ageDays).toBeGreaterThanOrEqual(d.rows[1].ageDays);
      expect(d.oldestAgeDays).toBe(d.rows[0].ageDays);
      expect(d.aging.reduce((s: number, a: { invoiceCount: number }) => s + a.invoiceCount, 0)).toBe(2);
      expect(d.aging.reduce((s: number, a: { amount: number }) => s + a.amount, 0)).toBe(500_000);
      expect(typeof d.rows[0].patientName).toBe('string');
    });

    it('kỳ không có phiếu chưa thu → danh sách rỗng, không có tuổi phiếu', async () => {
      const d = (await get(adminToken, 'unpaid', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(d).toMatchObject({ totalCount: 0, totalAmount: 0, oldestAgeDays: null, rows: [] });
    });
  });

  describe('Theo thu ngân và chốt ca', () => {
    it('thu/hoàn theo người ghi nhận, số ca, chênh lệch kiểm đếm; ca đang mở chưa có số dự kiến', async () => {
      const d = (await get(adminToken, 'by-cashier')).body.data;
      const byId = new Map<string, { shiftCount: number; paymentCount: number; collected: number; refunded: number; net: number; discrepancy: number; discrepancyShiftCount: number }>(d.cashiers.map((c: { userId: string }) => [c.userId, c]));
      expect(byId.get(adminId)).toMatchObject({ shiftCount: 1, paymentCount: 2, collected: 500_000, refunded: 100_000, net: 400_000, discrepancy: -10_000, discrepancyShiftCount: 1 });
      expect(byId.get(cashier2Id)).toMatchObject({ shiftCount: 1, paymentCount: 1, collected: 360_000, net: 360_000, discrepancy: 0, discrepancyShiftCount: 0 });
      expect(d.totals).toMatchObject({ shiftCount: 2, collected: 860_000, refunded: 100_000, net: 760_000, discrepancy: -10_000, discrepancyShiftCount: 1 });
      expect(d.shiftTotal).toBe(2);
      expect(d.shifts.map((s: { shiftNo: string }) => s.shiftNo)).toEqual(['PCC-RV-2', 'PCC-RV-1']);
      expect(d.shifts[0]).toMatchObject({ status: 'OPEN', closedAt: null, expectedCash: null, countedCash: null, discrepancy: null });
      expect(d.shifts[1]).toMatchObject({ status: 'CLOSED', expectedCash: 500_000, countedCash: 490_000, discrepancy: -10_000, branchId: branchA });
    });
  });

  describe('phạm vi nhiều chi nhánh', () => {
    it('chi nhánh đang làm chỉ thấy số của mình; gộp mới thấy chi nhánh B (có company_report.read)', async () => {
      const own = (await get(adminToken, 'by-period')).body.data;
      expect(own.totals.recognized).toBe(1_360_000);
      const all = (await get(adminToken, 'by-period', `${RANGE}&scope=all`)).body.data;
      expect(all.branchCount).toBeGreaterThanOrEqual(2);
      expect(all.totals).toMatchObject({ recognized: 2_360_000, collected: 1_860_000, net: 1_760_000 });
      const pickB = (await get(adminToken, 'by-period', `${RANGE}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(pickB.totals).toMatchObject({ recognized: 1_000_000, net: 1_000_000 });
      const cashierAll = (await get(adminToken, 'by-cashier', `${RANGE}&scope=all`)).body.data;
      expect(cashierAll.totals.shiftCount).toBe(3);
      expect(cashierAll.shifts.find((s: { shiftNo: string }) => s.shiftNo === 'PCC-RV-3')).toMatchObject({ branchId: branchB });
      const unpaidAll = (await get(adminToken, 'unpaid', `${RANGE}&scope=all`)).body.data;
      expect(unpaidAll.totalCount).toBe(2);
    });

    it('thiếu company_report.read: scope=all và scope=pick đều 403 dù tự gửi tham số', async () => {
      for (const path of ['by-period', 'by-service', 'by-method', 'unpaid', 'by-cashier']) {
        expect((await get(viewerToken, path, `${RANGE}&scope=all`)).status, path).toBe(403);
        expect((await get(viewerToken, path, `${RANGE}&scope=pick&branchIds=${branchB}`)).status, path).toBe(403);
      }
      const own = await get(viewerToken, 'by-period');
      expect(own.status).toBe(200);
      expect(own.body.data.branchCount).toBe(1);
      expect(own.body.data.totals.recognized).toBe(1_360_000);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào', async () => {
      expect([400, 422]).toContain((await get(adminToken, 'by-period', `${RANGE}&scope=pick`)).status);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0 ở cả 5 báo cáo; không đọc được chi nhánh của công ty này (404)', async () => {
      expect((await get(tenantBAdminToken, 'by-period')).body.data.totals).toMatchObject({ recognized: 0, net: 0 });
      expect((await get(tenantBAdminToken, 'by-service')).body.data).toMatchObject({ totalAmount: 0, rows: [] });
      expect((await get(tenantBAdminToken, 'by-method')).body.data.rows).toEqual([]);
      expect((await get(tenantBAdminToken, 'unpaid')).body.data.totalCount).toBe(0);
      expect((await get(tenantBAdminToken, 'by-cashier')).body.data).toMatchObject({ cashiers: [], shifts: [] });
      expect((await get(tenantBAdminToken, 'by-period', `${RANGE}&scope=pick&branchIds=${branchA}`)).status).toBe(404);
    });
  });

  describe('xuất Excel', () => {
    async function readSheet(buffer: Buffer): Promise<{ names: string[]; text: string }> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const text = wb.worksheets.map((s) => s.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|')).join('\n');
      return { names: wb.worksheets.map((s) => s.name), text };
    }

    it('5 báo cáo xuất được, tên sheet đúng, ô tiền ghi SỐ khớp màn hình', async () => {
      const cases: Array<[string, string, string[]]> = [
        ['by-period', 'Doanh thu theo kỳ', ['1160000', '400000', '360000', '760000']],
        ['by-service', 'Theo nhóm và dịch vụ', ['Khám nội', '980000']],
        ['by-method', 'Theo phương thức', ['400000', '360000']],
        ['unpaid', 'Phiếu chưa thu', ['300000', '200000']],
        ['by-cashier', 'Theo thu ngân và chốt ca', ['PCC-RV-1', '-10000']],
      ];
      for (const [path, sheetName, expected] of cases) {
        const res = await h.download(`/api/v1/reports/revenue/${path}/export?${RANGE}`, adminToken);
        expect(res.status, path).toBe(200);
        expect(res.headers['content-type'], path).toContain('spreadsheetml');
        const sheet = await readSheet(res.body as Buffer);
        expect(sheet.names, path).toEqual([sheetName]);
        for (const token of expected) expect(sheet.text, `${path} ${token}`).toContain(token);
      }
    });

    it('ghi nhật ký xuất đúng chi nhánh đã đọc; thiếu quyền → 403 và không ghi nhật ký mới', async () => {
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'revenue_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('revenue_report_export');
      expect(JSON.stringify(audit?.afterJson)).toContain(branchA);
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'revenue_report.exported' } });
      expect((await h.download(`/api/v1/reports/revenue/by-period/export?${RANGE}`, receptionistToken)).status).toBe(403);
      expect((await h.download(`/api/v1/reports/revenue/by-period/export?${RANGE}&scope=all`, viewerToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'revenue_report.exported' } })).toBe(before);
    });
  });
});
