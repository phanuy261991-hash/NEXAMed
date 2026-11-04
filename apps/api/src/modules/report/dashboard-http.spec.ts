import { randomUUID } from 'node:crypto';
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
import { resolveDashboardPeriod } from './dashboard.service';

/**
 * HTTP e2e — Trang Tổng quan của CHỦ PHÒNG KHÁM (`GET /reports/dashboard/owner`, docs/DECISIONS.md #279). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong ngày,
 * rồi đọc qua HTTP. Trọng tâm: số đúng (lượt khám, bệnh nhân khám lần đầu, thực thu = thu − hoàn, phiếu chưa thu sau chiết khấu, giờ cao điểm, hàng đợi),
 * cô lập CHI NHÁNH và CÔNG TY, và phân quyền (`dashboard.owner` chỉ clinic_admin).
 */
describe('HTTP e2e — Trang Tổng quan chủ phòng khám (/api/v1/reports/dashboard/owner)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let adminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let branchA: string;
  let branchB: string;
  let doctorId: string;

  const today = getVietnamDateString();
  const yesterday = addDaysToDateString(today, -1)!;
  /** Mốc `HH:MM` giờ Việt Nam của ngày `date`. */
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };

  async function makePatient(tag: string): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-DB-${tag}-${n}`, fullName: `Bệnh nhân tổng quan ${tag}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return patient.id;
  }

  async function makeEncounter(patientId: string, status: 'CHECKED_IN' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED', checkedInAt: Date, opts: { branchId?: string; doctorId?: string | null } = {}) {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    return privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId,
        doctorId: opts.doctorId === undefined ? null : opts.doctorId,
        departmentId: department.id,
        encounterNo: `LK-DB-${randomUUID().slice(0, 10)}`,
        status,
        checkedInAt,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  /** Phiếu thu một dòng dịch vụ khám; `payments` = các dòng thu/hoàn kèm thời điểm. */
  async function makeInvoice(
    encounterId: string,
    opts: { status: 'UNPAID' | 'PAID'; total: number; lineName?: string; discountPercent?: number; payments?: Array<{ type: 'PAYMENT' | 'REFUND'; amount: number; paidAt: Date }> },
  ) {
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        invoiceNo: `PT-DB-${randomUUID().slice(0, 10)}`,
        status: opts.status,
        totalAmount: BigInt(opts.total),
        discountType: opts.discountPercent ? 'PERCENT' : null,
        discountValue: opts.discountPercent ? BigInt(opts.discountPercent) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    if (opts.lineName) {
      const item = await privileged.encounterServiceItem.create({
        data: { tenantId: fixture.tenantA.id, encounterId, examTypeCode: 'KHAM', examTypeName: opts.lineName, examTypePrice: BigInt(opts.total), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      await privileged.invoiceLine.create({
        data: {
          tenantId: fixture.tenantA.id,
          invoiceId: invoice.id,
          sourceServiceItemId: item.id,
          examTypeCode: 'KHAM',
          examTypeName: opts.lineName,
          unitPrice: BigInt(opts.total),
          quantity: 1,
          lineTotal: BigInt(opts.total),
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
    }
    for (const p of opts.payments ?? []) {
      await privileged.payment.create({
        data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, method: 'CASH', type: p.type, amount: BigInt(p.amount), paidAt: p.paidAt, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    return invoice;
  }

  const getOwner = (token: string, period?: string) => http().get(`/api/v1/reports/dashboard/owner${period ? `?period=${period}` : ''}`).set(authed(token));

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

    fixture = await createTwoTenantFixture(privileged, 'Dashboard e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZDB2', name: 'Chi nhánh B tổng quan', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'db-admin', [branchA]);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'db-recep', [branchA]);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'db-adminB');
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'db-doctor', [branchA]);
    doctorId = doctor.id;
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    // Hôm nay (giờ VN): P1 khám 09:10 (lần đầu) rồi 09:40 (lần hai, không phải khám mới); P2 đã khám hôm qua nên hôm nay không phải khám mới; P3 khám lần đầu; P4 bị huỷ (không tính).
    const p1 = await makePatient('p1');
    const p2 = await makePatient('p2');
    const p3 = await makePatient('p3');
    const p4 = await makePatient('p4');
    const p5 = await makePatient('p5');

    const e0 = await makeEncounter(p2, 'COMPLETED', at(yesterday, '09:00'), { doctorId });
    await makeInvoice(e0.id, { status: 'PAID', total: 100_000, lineName: 'Khám hôm qua', payments: [{ type: 'PAYMENT', amount: 100_000, paidAt: at(yesterday, '09:30') }] });

    const e1 = await makeEncounter(p1, 'COMPLETED', at(today, '09:10'), { doctorId });
    await makeInvoice(e1.id, {
      status: 'PAID',
      total: 300_000,
      lineName: 'Khám nội tổng quát',
      payments: [
        { type: 'PAYMENT', amount: 300_000, paidAt: at(today, '09:30') },
        { type: 'REFUND', amount: 50_000, paidAt: at(today, '11:00') },
      ],
    });
    await makeEncounter(p1, 'CHECKED_IN', at(today, '09:40'), { doctorId });

    const e2 = await makeEncounter(p2, 'IN_CONSULTATION', at(today, '10:20'), { doctorId });
    await makeInvoice(e2.id, { status: 'UNPAID', total: 200_000, lineName: 'Khám nội tổng quát', discountPercent: 10 });

    const e3 = await makeEncounter(p3, 'CHECKED_IN', at(today, '10:50'));
    await makeInvoice(e3.id, { status: 'UNPAID', total: 100_000 });

    await makeEncounter(p4, 'CANCELLED', at(today, '08:00'));

    // Chi nhánh B của cùng công ty: KHÔNG được lọt vào số của chi nhánh A.
    const e5 = await makeEncounter(p5, 'CHECKED_IN', at(today, '10:00'), { branchId: branchB });
    await makeInvoice(e5.id, { status: 'PAID', total: 999_000, lineName: 'Khám chi nhánh B', payments: [{ type: 'PAYMENT', amount: 999_000, paidAt: at(today, '10:05') }] });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('chưa đăng nhập → 401; lễ tân (không có dashboard.owner) → 403; chủ phòng khám → 200', async () => {
      expect((await http().get('/api/v1/reports/dashboard/owner')).status).toBe(401);
      expect((await getOwner(receptionistToken)).status).toBe(403);
      expect((await getOwner(adminToken)).status).toBe(200);
    });

    it('kỳ lạ → 400', async () => {
      expect((await getOwner(adminToken, 'nam-nay')).status).toBe(400);
    });
  });

  describe('số liệu hôm nay', () => {
    it('lượt khám (không tính phiếu huỷ, không tính chi nhánh khác) kèm so với hôm qua', async () => {
      const res = await getOwner(adminToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.period).toMatchObject({ kind: 'today', from: today, to: today, compareFrom: yesterday, compareTo: yesterday });
      expect(d.encounters).toMatchObject({ value: 4, previous: 1, diff: 3, direction: 'up' });
      expect(d.encounters.series).toHaveLength(7);
      expect(d.encounters.series.at(-1)).toBe(4);
      expect(d.encounters.series.at(-2)).toBe(1);
    });

    it('bệnh nhân khám lần đầu: P1 (lượt đầu) và P3; lượt thứ hai của P1 và P2 (đã khám hôm qua) không tính', async () => {
      const d = (await getOwner(adminToken)).body.data;
      expect(d.newPatients.value).toBe(2);
      expect(d.newPatients.shareOfEncountersPercent).toBe(50);
    });

    it('lượt khám theo giờ giờ VN, đủ 24 giờ', async () => {
      const d = (await getOwner(adminToken)).body.data;
      expect(d.hourly).toHaveLength(24);
      expect(d.hourly.find((x: { hour: number }) => x.hour === 9)?.count).toBe(2);
      expect(d.hourly.find((x: { hour: number }) => x.hour === 10)?.count).toBe(2);
      expect(d.hourly.find((x: { hour: number }) => x.hour === 8)?.count).toBe(0); // lượt huỷ lúc 08:00 không tính
    });

    it('thực thu = tiền thu trừ tiền hoàn trong ngày thu, so với hôm qua; KHÔNG lẫn chi nhánh B', async () => {
      const d = (await getOwner(adminToken)).body.data;
      expect(d.collected).toMatchObject({ value: 250_000, previous: 100_000, diff: 150_000 });
      expect(d.collected.series.at(-1)).toBe(250_000);
      expect(d.collectedDaily).toHaveLength(7);
      expect(d.collectedDaily.at(-1)).toEqual({ date: today, amount: 250_000 });
    });

    it('thực thu theo nhóm: phiếu chỉ có dòng khám → toàn bộ vào "Khám bệnh", tổng khớp thực thu', async () => {
      const d = (await getOwner(adminToken)).body.data;
      const byGroup = Object.fromEntries(d.collectedByGroup.map((g: { group: string; amount: number }) => [g.group, g.amount]));
      expect(byGroup).toEqual({ EXAM: 250_000, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 });
      expect(d.collectedByGroup.reduce((s: number, g: { amount: number }) => s + g.amount, 0)).toBe(d.collected.value);
    });

    it('phiếu chưa thu: tiền SAU chiết khấu (200.000 giảm 10% = 180.000) + 100.000', async () => {
      const d = (await getOwner(adminToken)).body.data;
      expect(d.pending).toMatchObject({ invoiceCount: 2, amount: 280_000 });
      expect(d.needsAttention.unpaidInvoices).toEqual({ count: 2, amount: 280_000 });
    });

    it('dịch vụ dùng nhiều: gộp theo tên, đếm theo dòng; không lẫn hôm qua và chi nhánh B', async () => {
      const d = (await getOwner(adminToken)).body.data;
      expect(d.topServices.items).toEqual([{ name: 'Khám nội tổng quát', count: 2, amount: 500_000 }]);
      expect(d.topServices.totalAmount).toBe(500_000);
      expect(d.topServices.shareOfServiceAmountPercent).toBe(100);
    });

    it('hàng đợi: bác sĩ có 1 đang khám + 1 đang chờ; lượt chưa có bác sĩ gom thành hàng chờ chung; lượt đã xong/huỷ không có mặt', async () => {
      const d = (await getOwner(adminToken)).body.data;
      expect(d.queue.totalInProgress).toBe(1);
      expect(d.queue.totalWaiting).toBe(2);
      const withDoctor = d.queue.rows.find((r: { doctorName: string | null }) => r.doctorName !== null);
      const pool = d.queue.rows.find((r: { doctorName: string | null }) => r.doctorName === null);
      expect(withDoctor).toMatchObject({ inProgress: 1, waiting: 1 });
      expect(pool).toMatchObject({ inProgress: 0, waiting: 1 });
      expect(d.queue.doctorsInProgress).toBe(1);
      expect(d.queue.longestWaitMinutes === null || d.queue.longestWaitMinutes >= 0).toBe(true);
    });

    it('chưa có thuốc/ca mở → các khối cảnh báo trả 0, không lỗi', async () => {
      const d = (await getOwner(adminToken)).body.data;
      expect(d.needsAttention.openShifts).toEqual([]);
      expect(d.needsAttention.expiringBatches).toEqual({ count: 0, withinDays: 30 });
      expect(d.needsAttention.belowMinStockItems.count).toBe(0);
    });
  });

  describe('kỳ khác', () => {
    it('7 ngày: gộp hôm qua + hôm nay, kỳ trước rỗng → không có phần trăm', async () => {
      const d = (await getOwner(adminToken, 'week')).body.data;
      expect(d.encounters.value).toBe(5);
      expect(d.encounters.previous).toBe(0);
      expect(d.encounters.diffPercent).toBeNull();
      expect(d.collected.value).toBe(350_000);
    });

    it('tháng này: trả 200 và có đủ dữ liệu hôm nay (mùng 1 thì kỳ gồm đúng một ngày)', async () => {
      const res = await getOwner(adminToken, 'month');
      expect(res.status).toBe(200);
      expect(res.body.data.encounters.value).toBeGreaterThanOrEqual(4);
    });
  });

  describe('cô lập công ty', () => {
    it('chủ phòng khám công ty khác thấy số 0, không thấy dữ liệu của công ty này', async () => {
      const d = (await getOwner(tenantBAdminToken)).body.data;
      expect(d.encounters.value).toBe(0);
      expect(d.collected.value).toBe(0);
      expect(d.pending.invoiceCount).toBe(0);
      expect(d.topServices.items).toEqual([]);
      expect(d.queue.rows).toEqual([]);
    });
  });

  describe('resolveDashboardPeriod (thuần)', () => {
    it('hôm nay so hôm qua; 7 ngày so 7 ngày liền trước; tháng này so cùng khoảng ngày của tháng trước', () => {
      expect(resolveDashboardPeriod('today', '2026-11-04')).toMatchObject({ from: '2026-11-04', to: '2026-11-04', compareFrom: '2026-11-03', compareTo: '2026-11-03' });
      expect(resolveDashboardPeriod('week', '2026-11-04')).toMatchObject({ from: '2026-10-29', to: '2026-11-04', compareFrom: '2026-10-22', compareTo: '2026-10-28' });
      expect(resolveDashboardPeriod('month', '2026-03-31')).toMatchObject({ from: '2026-03-01', to: '2026-03-31', compareFrom: '2026-02-01', compareTo: '2026-02-28' });
    });
  });
});
