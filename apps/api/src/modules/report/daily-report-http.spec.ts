import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { addDaysToDateString, getVietnamDateString, vietnamDayStartUtc } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — "Báo cáo ngày" (`GET /reports/daily`, docs/DECISIONS.md #287). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định, đọc lại qua HTTP.
 * Trọng tâm: lượt khám theo trạng thái/Loại tiếp nhận, thực thu theo NGÀY THU, ghi nhận theo NGÀY KHÁM sau chiết khấu, phiếu chưa thu, ca thu ngân + chênh lệch, thu chi tại quầy;
 * chọn hôm nay/hôm qua; phạm vi nhiều chi nhánh (cần `company_report.read`); cô lập CHI NHÁNH và CÔNG TY; phân quyền; xuất Excel + nhật ký.
 */
describe('HTTP e2e — Báo cáo ngày (/api/v1/reports/daily)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let adminToken: string;
  let adminId: string;
  let viewerToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let tenantBAdminToken: string;
  let branchA: string;
  let branchB: string;

  const today = getVietnamDateString();
  const yesterday = addDaysToDateString(today, -1)!;
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };

  async function makeEncounter(tag: string, checkedInAt: Date, opts: { branchId?: string; status?: 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'; receptionType?: 'RT_NEW' | 'RT_RETURN' | null } = {}): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-DR-${tag}-${n}`, fullName: `Bệnh nhân báo cáo ngày ${tag}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const encounter = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId: patient.id,
        departmentId: department.id,
        encounterNo: `LK-DR-${randomUUID().slice(0, 10)}`,
        status: opts.status ?? 'COMPLETED',
        receptionTypeCode: opts.receptionType === undefined ? null : opts.receptionType,
        checkedInAt,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return encounter.id;
  }

  async function makeInvoice(
    encounterId: string,
    opts: { status: 'UNPAID' | 'PAID'; total: number; lineNames: string[]; discountPercent?: number; payments?: Array<{ type: 'PAYMENT' | 'REFUND'; method: string; amount: number; paidAt: Date }> },
  ) {
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        invoiceNo: `PT-DR-${randomUUID().slice(0, 10)}`,
        status: opts.status,
        totalAmount: BigInt(opts.total),
        discountType: opts.discountPercent ? 'PERCENT' : null,
        discountValue: opts.discountPercent ? BigInt(opts.discountPercent) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
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
        data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, method: p.method, type: p.type, amount: BigInt(p.amount), paidAt: p.paidAt, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    return invoice;
  }

  async function makeShift(branchId: string, no: string, openedAt: Date, closed?: { closedAt: Date; expected: number; counted: number }) {
    return privileged.cashierShift.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        shiftNo: no,
        cashierId: adminId,
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

  async function makeCashAccount(branchId: string, name: string) {
    return privileged.cashAccount.create({
      data: { tenantId: fixture.tenantA.id, branchId, code: `QU-DR-${randomUUID().slice(0, 6)}`, name, type: 'CASH', openingBalanceAt: new Date('2026-01-01T00:00:00Z'), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
  }

  async function makeVoucher(cashAccountId: string, direction: 'INCOME' | 'EXPENSE', amount: number, opts: { status?: 'POSTED' | 'PENDING_APPROVAL'; date?: string } = {}) {
    return privileged.cashVoucher.create({
      data: {
        tenantId: fixture.tenantA.id,
        voucherNo: `PTC-DR-${randomUUID().slice(0, 10)}`,
        direction,
        incomeExpenseTypeCode: 'TC00001',
        cashAccountId,
        paymentMethodCode: 'CASH',
        amount: BigInt(amount),
        occurredAt: new Date(`${opts.date ?? today}T00:00:00.000Z`),
        description: 'Phiếu thử báo cáo ngày',
        status: opts.status ?? 'POSTED',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  const getDaily = (token: string, query = '') => http().get(`/api/v1/reports/daily${query}`).set(authed(token));

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

    fixture = await createTwoTenantFixture(privileged, 'Daily report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZDR2', name: 'Chi nhánh B báo cáo ngày', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'dr-admin', [branchA]);
    adminId = admin.id;
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    // Vai trò xem được báo cáo ngày nhưng KHÔNG có `company_report.read`: chỉ xem chi nhánh đang làm.
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-ngay-chi-nhanh', [['daily_report', 'read']]);
    const viewer = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'dr-viewer', [branchA]);
    viewerToken = await h.login(fixture.tenantA.id, viewer.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'dr-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'dr-doctor', [branchA]);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'dr-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    // ── Chi nhánh A, HÔM NAY ──
    // E1: khám mới, hoàn tất, 300.000 thu tiền mặt 09:30 rồi hoàn 50.000 lúc 11:00.
    const e1 = await makeEncounter('e1', at(today, '09:00'), { status: 'COMPLETED', receptionType: 'RT_NEW' });
    await makeInvoice(e1, { status: 'PAID', total: 300_000, lineNames: ['Khám nội'], payments: [{ type: 'PAYMENT', method: 'CASH', amount: 300_000, paidAt: at(today, '09:30') }, { type: 'REFUND', method: 'CASH', amount: 50_000, paidAt: at(today, '11:00') }] });
    // E2: tái khám, hoàn tất, 200.000 chuyển khoản.
    const e2 = await makeEncounter('e2', at(today, '09:20'), { status: 'COMPLETED', receptionType: 'RT_RETURN' });
    await makeInvoice(e2, { status: 'PAID', total: 200_000, lineNames: ['Khám nhi'], payments: [{ type: 'PAYMENT', method: 'TRANSFER', amount: 200_000, paidAt: at(today, '09:50') }] });
    // E3: tái khám, còn đang chờ, phiếu CHƯA THU 600.000 giảm 10% → 540.000.
    const e3 = await makeEncounter('e3', at(today, '10:00'), { status: 'CHECKED_IN', receptionType: 'RT_RETURN' });
    await makeInvoice(e3, { status: 'UNPAID', total: 600_000, lineNames: ['Khám nội', 'Công thức máu', 'Siêu âm'], discountPercent: 10 });
    // E4 huỷ, E5 không đến — không tính vào Tiếp nhận.
    await makeEncounter('e4', at(today, '10:10'), { status: 'CANCELLED', receptionType: 'RT_NEW' });
    await makeEncounter('e5', at(today, '10:20'), { status: 'NO_SHOW', receptionType: 'RT_NEW' });
    // Ca thu ngân hôm nay (đã chốt, thiếu 10.000) và ca hôm qua (không được lọt vào hôm nay).
    await makeShift(branchA, `PCC-DR-${randomUUID().slice(0, 6)}`, at(today, '07:30'), { closedAt: at(today, '12:00'), expected: 300_000, counted: 290_000 });
    await makeShift(branchA, `PCC-DR-${randomUUID().slice(0, 6)}`, at(yesterday, '07:30'), { closedAt: at(yesterday, '12:00'), expected: 100_000, counted: 100_000 });
    // Thu chi tại quầy: chi 1.200.000 đã ghi sổ; một phiếu chờ duyệt và một phiếu hôm qua không tính.
    const accountA = await makeCashAccount(branchA, 'Quỹ A báo cáo ngày');
    await makeVoucher(accountA.id, 'EXPENSE', 1_200_000);
    await makeVoucher(accountA.id, 'EXPENSE', 777_000, { status: 'PENDING_APPROVAL' });
    await makeVoucher(accountA.id, 'INCOME', 555_000, { date: yesterday });

    // ── Chi nhánh A, HÔM QUA ──
    const e6 = await makeEncounter('e6', at(yesterday, '09:00'), { status: 'COMPLETED', receptionType: 'RT_NEW' });
    await makeInvoice(e6, { status: 'PAID', total: 100_000, lineNames: ['Khám hôm qua'], payments: [{ type: 'PAYMENT', method: 'CASH', amount: 100_000, paidAt: at(yesterday, '09:30') }] });

    // ── Chi nhánh B của cùng công ty, HÔM NAY ──
    const e7 = await makeEncounter('e7', at(today, '10:00'), { branchId: branchB, status: 'COMPLETED', receptionType: 'RT_NEW' });
    await makeInvoice(e7, { status: 'PAID', total: 400_000, lineNames: ['Khám chi nhánh B'], payments: [{ type: 'PAYMENT', method: 'CASH', amount: 400_000, paidAt: at(today, '10:05') }] });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('chưa đăng nhập → 401; lễ tân và bác sĩ (không có daily_report.read) → 403; quản trị và vai trò có quyền → 200', async () => {
      expect((await http().get('/api/v1/reports/daily')).status).toBe(401);
      expect((await getDaily(receptionistToken)).status).toBe(403);
      expect((await getDaily(doctorToken)).status).toBe(403);
      expect((await getDaily(adminToken)).status).toBe(200);
      expect((await getDaily(viewerToken)).status).toBe(200);
    });

    it('tham số ngày sai → lỗi kiểm tra đầu vào, không phải 500', async () => {
      const res = await getDaily(adminToken, '?day=lastweek');
      expect([400, 422]).toContain(res.status);
    });
  });

  describe('chi nhánh đang làm việc, hôm nay', () => {
    it('lượt khám: Tiếp nhận = chờ + hoàn tất, huỷ/không đến tách riêng, khám mới/tái khám theo Loại tiếp nhận', async () => {
      const res = await getDaily(adminToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.date).toBe(today);
      expect(d.branches).toHaveLength(1);
      expect(d.branches[0].branchId).toBe(branchA);
      expect(d.branches[0].visits).toEqual({ received: 3, newCount: 1, returnCount: 2, completed: 2, stillOpen: 1, cancelled: 1, noShow: 1 });
    });

    it('tiền thu theo NGÀY THU: thu 500.000 (2 lượt), hoàn 50.000 (1 lượt), thực thu 450.000; theo phương thức; không lẫn hôm qua và chi nhánh B', async () => {
      const c = (await getDaily(adminToken)).body.data.branches[0].collection;
      expect(c).toMatchObject({ collectedCount: 2, collectedAmount: 500_000, refundedCount: 1, refundedAmount: 50_000, netAmount: 450_000 });
      expect(c.byMethod.map((m: { methodCode: string; amount: number; paymentCount: number }) => [m.methodCode, m.amount, m.paymentCount])).toEqual([
        ['CASH', 300_000, 1],
        ['TRANSFER', 200_000, 1],
      ]);
      expect(c.byMethod.every((m: { methodName: string }) => m.methodName.length > 0)).toBe(true);
    });

    it('ghi nhận theo NGÀY KHÁM SAU chiết khấu (600.000 giảm 10% = 540.000), chia nhóm, tổng nhóm = tổng', async () => {
      const r = (await getDaily(adminToken)).body.data.branches[0].recognized;
      // 300.000 + 200.000 + 540.000
      expect(r.total).toBe(1_040_000);
      expect(r.byGroup).toEqual({ EXAM: 1_040_000, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 });
    });

    it('phiếu chưa thu của lượt khám trong ngày, tiền sau chiết khấu', async () => {
      const u = (await getDaily(adminToken)).body.data.branches[0].unpaid;
      expect(u).toEqual({ invoiceCount: 1, amount: 540_000 });
    });

    it('ca thu ngân mở trong ngày kèm chênh lệch kiểm đếm; ca hôm qua không lọt vào', async () => {
      const shifts = (await getDaily(adminToken)).body.data.branches[0].shifts;
      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toMatchObject({ label: 'Ca sáng', status: 'CLOSED', expectedCash: 300_000, countedCash: 290_000, discrepancy: -10_000 });
      expect(shifts[0].cashierName).toBeTruthy();
    });

    it('thu chi tại quầy: chỉ phiếu ĐÃ GHI SỔ của hôm nay (không tính chờ duyệt, không tính hôm qua)', async () => {
      const v = (await getDaily(adminToken)).body.data.branches[0].counterVouchers;
      expect(v).toEqual({ incomeAmount: 0, expenseAmount: 1_200_000 });
    });

    it('dòng cộng của phạm vi một chi nhánh bằng đúng số chi nhánh đó', async () => {
      const d = (await getDaily(adminToken)).body.data;
      expect(d.totals.visits).toEqual(d.branches[0].visits);
      expect(d.totals.collection.netAmount).toBe(450_000);
      expect(d.totals.recognized.total).toBe(1_040_000);
      expect(d.totals.shiftDiscrepancy).toBe(-10_000);
    });
  });

  describe('hôm qua', () => {
    it('chỉ thấy số của hôm qua, không lẫn hôm nay', async () => {
      const d = (await getDaily(adminToken, '?day=yesterday')).body.data;
      expect(d.date).toBe(yesterday);
      const b = d.branches[0];
      expect(b.visits).toMatchObject({ received: 1, newCount: 1, returnCount: 0, completed: 1, cancelled: 0, noShow: 0 });
      expect(b.collection).toMatchObject({ collectedAmount: 100_000, refundedAmount: 0, netAmount: 100_000 });
      expect(b.recognized.total).toBe(100_000);
      expect(b.unpaid).toEqual({ invoiceCount: 0, amount: 0 });
      expect(b.shifts).toHaveLength(1);
      expect(b.shifts[0]).toMatchObject({ expectedCash: 100_000, discrepancy: 0 });
      expect(b.counterVouchers).toEqual({ incomeAmount: 555_000, expenseAmount: 0 });
    });
  });

  describe('phạm vi nhiều chi nhánh', () => {
    it('scope=all: chi nhánh đang làm đứng đầu, mỗi chi nhánh một phần tử, dòng cộng là tổng của cả hai', async () => {
      const res = await getDaily(adminToken, '?scope=all');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.branches.map((b: { branchId: string }) => b.branchId)).toEqual([branchA, branchB]);
      expect(d.branches[1].branchName).toBe('Chi nhánh B báo cáo ngày');
      expect(d.branches[1].collection.netAmount).toBe(400_000);
      expect(d.branches[1].visits.received).toBe(1);
      expect(d.totals.collection.collectedAmount).toBe(900_000);
      expect(d.totals.collection.netAmount).toBe(850_000);
      expect(d.totals.visits.received).toBe(4);
      expect(d.totals.visits.newCount).toBe(2);
      expect(d.totals.recognized.total).toBe(1_440_000);
      expect(d.totals.collection.byMethod.map((m: { methodCode: string; amount: number }) => [m.methodCode, m.amount])).toEqual([
        ['CASH', 700_000],
        ['TRANSFER', 200_000],
      ]);
    });

    it('scope=pick chỉ lấy chi nhánh được chọn; mỗi chi nhánh vẫn chỉ chứa số của chính nó', async () => {
      const d = (await getDaily(adminToken, `?scope=pick&branchIds=${branchB}`)).body.data;
      expect(d.branches).toHaveLength(1);
      expect(d.branches[0].branchId).toBe(branchB);
      expect(d.branches[0].collection.netAmount).toBe(400_000);
      expect(d.branches[0].unpaid).toEqual({ invoiceCount: 0, amount: 0 });
      expect(d.branches[0].counterVouchers).toEqual({ incomeAmount: 0, expenseAmount: 0 });
    });

    it('thiếu company_report.read: scope=all và scope=pick đều 403 dù tự gửi tham số; mặc định vẫn xem được chi nhánh đang làm', async () => {
      expect((await getDaily(viewerToken, '?scope=all')).status).toBe(403);
      expect((await getDaily(viewerToken, `?scope=pick&branchIds=${branchB}`)).status).toBe(403);
      const own = await getDaily(viewerToken);
      expect(own.status).toBe(200);
      expect(own.body.data.branches).toHaveLength(1);
      expect(own.body.data.branches[0].branchId).toBe(branchA);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào', async () => {
      const res = await getDaily(adminToken, '?scope=pick');
      expect([400, 422]).toContain(res.status);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0; không đọc được chi nhánh của công ty này (404)', async () => {
      const d = (await getDaily(tenantBAdminToken)).body.data;
      expect(d.totals.visits.received).toBe(0);
      expect(d.totals.collection.netAmount).toBe(0);
      expect(d.totals.recognized.total).toBe(0);
      expect(d.branches[0].shifts).toEqual([]);
      expect((await getDaily(tenantBAdminToken, `?scope=pick&branchIds=${branchA}`)).status).toBe(404);
    });
  });

  describe('xuất Excel', () => {
    async function readSheets(buffer: Buffer): Promise<ExcelJS.Workbook> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      return wb;
    }

    it('một chi nhánh: một sheet "Báo cáo ngày"; số khớp màn hình; ghi nhật ký xuất', async () => {
      const res = await h.download('/api/v1/reports/daily/export', adminToken);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain(`bao-cao-ngay-${today}.xlsx`);
      const wb = await readSheets(res.body as Buffer);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['Báo cáo ngày']);
      const text = wb.worksheets[0]!.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|');
      expect(text).toContain('Thực thu');
      expect(text).toContain('450000');
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'daily_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('daily_report_export');
      expect(JSON.stringify(audit?.afterJson)).toContain(branchA);
    });

    it('nhiều chi nhánh: sheet "Tổng hợp" rồi mỗi chi nhánh một sheet', async () => {
      const res = await h.download('/api/v1/reports/daily/export?scope=all', adminToken);
      expect(res.status).toBe(200);
      const wb = await readSheets(res.body as Buffer);
      expect(wb.worksheets).toHaveLength(3);
      expect(wb.worksheets[0]!.name).toBe('Tổng hợp');
      expect(wb.worksheets[2]!.name).toBe('Chi nhánh B báo cáo ngày');
    });

    it('thiếu quyền → 403, không ghi nhật ký xuất mới', async () => {
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'daily_report.exported' } });
      expect((await h.download('/api/v1/reports/daily/export', receptionistToken)).status).toBe(403);
      expect((await h.download('/api/v1/reports/daily/export?scope=all', viewerToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'daily_report.exported' } })).toBe(before);
    });
  });
});
