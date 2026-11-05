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
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — nhóm báo cáo "Khám bệnh và vận hành" (`/reports/operations/*`, docs/DECISIONS.md #287). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong tháng 09/2026
 * (đã qua, nên kết quả không đổi theo ngày chạy). Tháng 09/2026 bắt đầu bằng Thứ Ba nên 07/09 là Thứ Hai, 13/09 là Chủ nhật. Trọng tâm: số liệu từng tab đúng định nghĩa; Sổ khám bệnh (lọc,
 * phân trang theo khoá, thành tiền sau chiết khấu); phạm vi nhiều chi nhánh cần `company_report.read`; cô lập CHI NHÁNH và CÔNG TY; chỉ quản lý (quyền `operations_report.read`) xem được; Excel + nhật ký.
 */
describe('HTTP e2e — Khám bệnh và vận hành (/api/v1/reports/operations)', () => {
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
  let docA: string;
  let docB: string;
  let icdPrimary: { code: string; nameVi: string };
  let icdOther: { code: string; nameVi: string };
  const encounters: Record<string, string> = {};

  const SEP = 'from=2026-09-01&to=2026-09-30';
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const get = (token: string, path: string, query = SEP) => http().get(`/api/v1/reports/operations/${path}?${query}`).set(authed(token));

  async function makePatient(tag: string, opts: { name?: string; dob?: string; gender?: string } = {}): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: {
        tenantId: fixture.tenantA.id,
        patientCode: `BN-OP-${tag}-${n}`,
        fullName: opts.name ?? `Bệnh nhân vận hành ${tag}`,
        dob: new Date(opts.dob ?? '1990-01-01'),
        gender: opts.gender ?? 'other',
        phone: `09${String(n).padStart(8, '0').slice(-8)}`,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return patient.id;
  }

  async function makeEncounter(
    tag: string,
    checkedInAt: Date,
    opts: { patientId?: string; status?: 'CHECKED_IN' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'; startedAt?: Date | null; doctorId?: string | null; branchId?: string; cancelReason?: string } = {},
  ): Promise<string> {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const e = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId: opts.patientId ?? (await makePatient(tag)),
        doctorId: opts.doctorId === undefined ? null : opts.doctorId,
        departmentId: department.id,
        encounterNo: `LK-OP-${randomUUID().slice(0, 10)}`,
        status: opts.status ?? 'COMPLETED',
        checkedInAt,
        startedAt: opts.startedAt ?? null,
        cancelReason: opts.cancelReason ?? null,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    encounters[tag] = e.id;
    return e.id;
  }

  async function makeInvoice(encounterId: string, opts: { status: 'UNPAID' | 'PAID' | 'CANCELLED'; total: number; lineNames: string[]; discountPercent?: number }) {
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        invoiceNo: `PT-OP-${randomUUID().slice(0, 10)}`,
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
  }

  async function makeAppointment(opts: { source: 'phone' | 'online' | 'walk_in'; status: 'SCHEDULED' | 'CONVERTED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED'; doctorId: string; date: string; branchId?: string; cancelReason?: string }) {
    return privileged.appointment.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        doctorId: opts.doctorId,
        bookingCode: `LH-OP-${randomUUID().slice(0, 8)}`,
        fullName: 'Khách vận hành',
        phone: '0900000000',
        scheduledAt: at(opts.date, '09:00'),
        durationMinutes: 15,
        status: opts.status,
        source: opts.source,
        cancelReason: opts.cancelReason ?? null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  async function makeFollowUp(tag: string, opts: { due: string; doctorId: string; signed?: boolean; laterEncounter?: boolean; notReturning?: boolean }) {
    const patientId = await makePatient(tag);
    const e = await makeEncounter(tag, at('2026-08-10', '09:00'), { patientId, doctorId: opts.doctorId });
    await privileged.encounterTreatmentPlan.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId: e,
        directions: ['FOLLOW_UP'],
        followUpDate: new Date(opts.due),
        signedAt: opts.signed === false ? null : new Date(),
        signedBy: opts.signed === false ? null : SYSTEM_TEST_ACTOR,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    if (opts.laterEncounter) await makeEncounter(`${tag}-later`, at('2026-08-25', '09:00'), { patientId, doctorId: opts.doctorId });
    if (opts.notReturning) await privileged.followUpReminder.create({ data: { tenantId: fixture.tenantA.id, encounterId: e, result: 'NOT_RETURNING', remindedAt: new Date('2026-09-10T03:00:00Z'), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return e;
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

    fixture = await createTwoTenantFixture(privileged, 'Operations report e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZOP2', name: 'Chi nhánh B vận hành', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'op-admin', [branchA]);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    // Vai trò xem được báo cáo vận hành nhưng KHÔNG có `company_report.read`: chỉ xem chi nhánh đang làm.
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-van-hanh-chi-nhanh', [['operations_report', 'read']]);
    const viewer = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'op-viewer', [branchA]);
    viewerToken = await h.login(fixture.tenantA.id, viewer.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'op-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'op-doctor', [branchA]);
    docA = doctor.id;
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    docB = (await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'op-doctor2', [branchA])).id;
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'op-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    icdPrimary = await privileged.icd10Catalog.findFirstOrThrow({ orderBy: { code: 'asc' } });
    // Mã thứ hai KHÔNG bắt đầu bằng mã thứ nhất (lọc theo tiền tố sẽ khớp cả hai nếu là mã con).
    icdOther = await privileged.icd10Catalog.findFirstOrThrow({ where: { NOT: { code: { startsWith: icdPrimary.code } } }, orderBy: { code: 'asc' } });

    // ── Lượt khám chi nhánh A, tháng 09/2026 ──
    // V1: Thứ Hai 07/09 09:05, chờ 15 phút, nữ sinh 01/05/1990 (36 tuổi), thu 300.000 "Khám nội".
    const p1 = await makePatient('v1', { name: 'Nguyễn Thị Ánh Nguyệt', dob: '1990-05-01', gender: 'female' });
    const v1 = await makeEncounter('v1', at('2026-09-07', '09:05'), { patientId: p1, doctorId: docA, startedAt: at('2026-09-07', '09:20') });
    await makeInvoice(v1, { status: 'PAID', total: 300_000, lineNames: ['Khám nội'] });
    await privileged.diagnosis.create({ data: { tenantId: fixture.tenantA.id, encounterId: v1, icd10Code: icdPrimary.code, type: 'PRIMARY', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    // V2: Thứ Hai 07/09 09:40, chờ 40 phút; phiếu CHƯA THU 600.000 giảm 10% = 540.000 (3 dịch vụ).
    const v2 = await makeEncounter('v2', at('2026-09-07', '09:40'), { doctorId: docA, startedAt: at('2026-09-07', '10:20') });
    await makeInvoice(v2, { status: 'UNPAID', total: 600_000, lineNames: ['Khám nội', 'Công thức máu', 'Siêu âm'], discountPercent: 10 });
    await privileged.diagnosis.create({ data: { tenantId: fixture.tenantA.id, encounterId: v2, icd10Code: icdOther.code, type: 'PRIMARY', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    // V3: Thứ Hai 14/09 10:10, chờ 5 phút, bác sĩ B, phiếu đã huỷ và chưa có chẩn đoán.
    const v3 = await makeEncounter('v3', at('2026-09-14', '10:10'), { doctorId: docB, startedAt: at('2026-09-14', '10:15') });
    // Mỗi lượt khám chỉ có một phiếu: phiếu ĐÃ HUỶ không được tính vào thành tiền và không đưa dịch vụ vào cột "Dịch vụ".
    await makeInvoice(v3, { status: 'CANCELLED', total: 999_000, lineNames: ['Dịch vụ đã huỷ'] });
    // V4: Chủ nhật 13/09 14:00, chờ 50 phút, bác sĩ B.
    await makeEncounter('v4', at('2026-09-13', '14:00'), { doctorId: docB, startedAt: at('2026-09-13', '14:50') });
    // V5 huỷ (có lý do), V6 không đến (chưa gán bác sĩ), V7 còn đang chờ — không vào sổ khám, không đo thời gian chờ.
    await makeEncounter('v5', at('2026-09-07', '08:00'), { status: 'CANCELLED', doctorId: docA, cancelReason: 'Khách bận' });
    await makeEncounter('v6', at('2026-09-08', '08:30'), { status: 'NO_SHOW', doctorId: null });
    await makeEncounter('v7', at('2026-09-08', '11:00'), { status: 'CHECKED_IN', doctorId: docA });
    // V8: chi nhánh B, Thứ Hai 07/09 09:10, chờ 2 phút — chỉ thấy khi gộp chi nhánh.
    await makeEncounter('v8', at('2026-09-07', '09:10'), { branchId: branchB, doctorId: docA, startedAt: at('2026-09-07', '09:12') });

    // ── Lịch hẹn tháng 09/2026 ──
    await makeAppointment({ source: 'phone', status: 'SCHEDULED', doctorId: docA, date: '2026-09-10' });
    await makeAppointment({ source: 'online', status: 'CONVERTED', doctorId: docA, date: '2026-09-10' });
    await makeAppointment({ source: 'walk_in', status: 'CANCELLED', doctorId: docB, date: '2026-09-11', cancelReason: ' khách  bận ' });
    await makeAppointment({ source: 'phone', status: 'NO_SHOW', doctorId: docB, date: '2026-09-11' });
    await makeAppointment({ source: 'phone', status: 'CONVERTED', doctorId: docA, date: '2026-09-12' });
    await makeAppointment({ source: 'online', status: 'CONVERTED', doctorId: docA, date: '2026-09-12', branchId: branchB });

    // ── Hẹn tái khám (lượt gốc tháng 08/2026, ngày hẹn trong 09/2026 hoặc rất xa) ──
    await makeFollowUp('f1', { due: '2026-09-20', doctorId: docA, laterEncounter: true });
    await makeFollowUp('f2', { due: '2026-09-21', doctorId: docA });
    await makeFollowUp('f3', { due: '2026-09-22', doctorId: docB, notReturning: true });
    await makeFollowUp('f4', { due: '2026-09-23', doctorId: docB, signed: false });
    await makeFollowUp('f5', { due: '2099-01-10', doctorId: docA });
    await privileged.followUpReminder.create({ data: { tenantId: fixture.tenantA.id, encounterId: encounters.f2!, result: 'REACHED', remindedAt: new Date('2026-09-15T03:00:00Z'), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền và kiểm tra đầu vào', () => {
    it('chưa đăng nhập → 401; lễ tân và bác sĩ → 403; quản trị và vai trò có operations_report.read → 200, cho cả 6 báo cáo', async () => {
      for (const path of ['visit-book', 'peak-hours', 'waiting', 'cancellations', 'follow-ups', 'booking-sources']) {
        expect((await http().get(`/api/v1/reports/operations/${path}?${SEP}`)).status, path).toBe(401);
        expect((await get(receptionistToken, path)).status, path).toBe(403);
        expect((await get(doctorToken, path)).status, path).toBe(403);
        expect((await get(adminToken, path)).status, path).toBe(200);
        expect((await get(viewerToken, path)).status, path).toBe(200);
      }
    });

    it('khoảng ngày sai: ngược, quá 366 ngày, ngày không có thật, thiếu tham số → lỗi kiểm tra đầu vào, không phải 500', async () => {
      for (const q of ['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-09-01', 'from=2026-02-31&to=2026-03-01', 'from=2026-09-01']) {
        const res = await get(adminToken, 'peak-hours', q);
        expect([400, 422], q).toContain(res.status);
      }
    });

    it('con trỏ phân trang hỏng → 400', async () => {
      expect((await get(adminToken, 'visit-book', `${SEP}&cursor=khong-hop-le`)).status).toBe(400);
    });
  });

  describe('Sổ khám bệnh', () => {
    it('chỉ lượt ĐÃ HOÀN TẤT của chi nhánh đang làm, mới nhất trước; tuổi tại ngày khám, giới, chẩn đoán chính, bác sĩ', async () => {
      const res = await get(adminToken, 'visit-book');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.total).toBe(4);
      expect(d.branchCount).toBe(1);
      expect(d.nextCursor).toBeNull();
      expect(d.items.map((r: { encounterId: string }) => r.encounterId)).toEqual([encounters.v3, encounters.v4, encounters.v2, encounters.v1]);
      const v1 = d.items[3];
      expect(v1).toMatchObject({ patientName: 'Nguyễn Thị Ánh Nguyệt', gender: 'female', ageYears: 36, visitDate: '2026-09-07', diagnosisCode: icdPrimary.code, diagnosisName: icdPrimary.nameVi, branchId: branchA });
      expect(typeof v1.doctorName).toBe('string');
    });

    it('thành tiền = dueAmount sau chiết khấu của phiếu CHƯA HUỶ; dịch vụ không lặp; lượt chỉ có phiếu đã huỷ = 0', async () => {
      const items = (await get(adminToken, 'visit-book')).body.data.items as Array<{ encounterId: string; amount: number; services: string[]; diagnosisCode: string | null }>;
      const byId = new Map(items.map((i) => [i.encounterId, i]));
      expect(byId.get(encounters.v1!)).toMatchObject({ amount: 300_000, services: ['Khám nội'] });
      expect(byId.get(encounters.v2!)).toMatchObject({ amount: 540_000, services: ['Khám nội', 'Công thức máu', 'Siêu âm'] });
      expect(byId.get(encounters.v3!)).toMatchObject({ amount: 0, services: [], diagnosisCode: null });
    });

    it('phân trang theo khoá: hai trang không trùng, không sót; tổng giữ nguyên', async () => {
      const first = (await get(adminToken, 'visit-book', `${SEP}&limit=2`)).body.data;
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeTruthy();
      const second = (await get(adminToken, 'visit-book', `${SEP}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).body.data;
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      expect(second.total).toBe(4);
      const ids = [...first.items, ...second.items].map((r: { encounterId: string }) => r.encounterId);
      expect(new Set(ids).size).toBe(4);
    });

    it('lọc theo bác sĩ, theo mã ICD-10 chẩn đoán chính (khớp tiền tố, không phân biệt hoa thường) và tìm theo tên không dấu', async () => {
      const byDoctor = (await get(adminToken, 'visit-book', `${SEP}&doctorId=${docB}`)).body.data;
      expect(byDoctor.total).toBe(2);
      expect(byDoctor.items.map((r: { encounterId: string }) => r.encounterId)).toEqual([encounters.v3, encounters.v4]);
      const byIcd = (await get(adminToken, 'visit-book', `${SEP}&icd10Code=${icdPrimary.code.toLowerCase()}`)).body.data;
      expect(byIcd.items.map((r: { encounterId: string }) => r.encounterId)).toEqual([encounters.v1]);
      const byPrefix = (await get(adminToken, 'visit-book', `${SEP}&icd10Code=${icdPrimary.code.slice(0, 1)}`)).body.data;
      expect(byPrefix.total).toBeGreaterThanOrEqual(1);
      const bySearch = (await get(adminToken, 'visit-book', `${SEP}&q=nguyet`)).body.data;
      expect(bySearch.items.map((r: { encounterId: string }) => r.encounterId)).toEqual([encounters.v1]);
    });

    it('ngày khám theo giờ Việt Nam: lượt 23:30 ngày 30/09 thuộc 30/09, lượt 00:10 ngày 01/10 không lọt vào tháng 09', async () => {
      await makeEncounter('edge-late', at('2026-09-30', '23:30'), { doctorId: docA, startedAt: at('2026-09-30', '23:40') });
      await makeEncounter('edge-next', at('2026-10-01', '00:10'), { doctorId: docA, startedAt: at('2026-10-01', '00:20') });
      const items = (await get(adminToken, 'visit-book')).body.data.items as Array<{ encounterId: string; visitDate: string }>;
      expect(items[0]).toMatchObject({ encounterId: encounters['edge-late'], visitDate: '2026-09-30' });
      expect(items.some((i) => i.encounterId === encounters['edge-next'])).toBe(false);
    });
  });

  describe('Giờ cao điểm', () => {
    it('bản đồ nhiệt thứ × giờ: chỉ lượt đã tiếp nhận (không huỷ/không đến), giờ cao điểm, thứ ít khách nhất', async () => {
      const r = (await get(adminToken, 'peak-hours', 'from=2026-09-01&to=2026-09-12')).body.data;
      expect(r.hours).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      // 01–12/09 chi nhánh A: V1, V2 (Thứ Hai 9h), V7 (Thứ Ba 11h) — V5/V6 huỷ/không đến không tính, V4 và V3 nằm sau 12/09.
      expect(r.totalVisits).toBe(3);
      const mon = r.days[0];
      expect(mon.isoDow).toBe(1);
      expect(mon.counts[r.hours.indexOf(9)]).toBe(2);
      expect(r.days[1].counts[r.hours.indexOf(11)]).toBe(1);
      expect(r.peak).toEqual({ isoDow: 1, hour: 9, count: 2 });
      expect(r.quietestDay.total).toBe(0);
    });

    it('cả tháng: tổng 5 lượt (4 hoàn tất + 1 đang chờ), Chủ nhật 14h có 1 lượt', async () => {
      const r = (await get(adminToken, 'peak-hours', 'from=2026-09-01&to=2026-09-29')).body.data;
      expect(r.totalVisits).toBe(5);
      expect(r.days[6].counts[r.hours.indexOf(14)]).toBe(1);
      expect(r.days[6].total).toBe(1);
    });

    it('kèm thời gian chờ theo khung giờ và phân bố, khớp tab Thời gian chờ', async () => {
      const r = (await get(adminToken, 'peak-hours', 'from=2026-09-01&to=2026-09-29')).body.data;
      expect(r.waiting.measuredCount).toBe(4);
      expect(r.waiting.slots.map((s: { label: string }) => s.label)).toEqual(['07–09h', '09–11h', '11–13h', '13–15h', '15–17h', '17–19h']);
      expect(r.waiting.distribution.map((d: { count: number }) => d.count)).toEqual([1, 1, 0, 1, 1]);
      const w = (await get(adminToken, 'waiting', 'from=2026-09-01&to=2026-09-29')).body.data;
      expect(w.summary).toEqual(r.waiting);
    });

    it('kỳ không có lượt nào: không có giờ cao điểm, không lỗi chia cho 0', async () => {
      const r = (await get(adminToken, 'peak-hours', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(r.totalVisits).toBe(0);
      expect(r.peak).toBeNull();
      expect(r.quietestDay).toBeNull();
      expect(r.waiting).toMatchObject({ measuredCount: 0, averageMinutes: null, over30Percent: null, slots: [] });
    });
  });

  describe('Thời gian chờ', () => {
    it('trung bình, chờ quá 30 phút, chờ lâu nhất; chỉ lượt có giờ vào khám', async () => {
      const w = (await get(adminToken, 'waiting', 'from=2026-09-01&to=2026-09-29')).body.data;
      // 15 + 40 + 5 + 50 = 110 phút / 4 lượt = 27,5 → 28 phút; quá 30 phút: 40 và 50 → 2 lượt = 50%.
      expect(w.summary).toMatchObject({ measuredCount: 4, averageMinutes: 28, over30Count: 2, over30Percent: 50 });
      expect(w.maxMinutes).toBe(50);
    });

    it('theo bác sĩ và theo ngày', async () => {
      const w = (await get(adminToken, 'waiting', 'from=2026-09-01&to=2026-09-29')).body.data;
      expect(w.byDoctor).toHaveLength(2);
      for (const d of w.byDoctor) expect(d).toMatchObject({ visits: 2, averageMinutes: 28, over30Count: 1, over30Percent: 50 });
      expect(w.byDay.map((d: { date: string; visits: number }) => [d.date, d.visits])).toEqual([
        ['2026-09-07', 2],
        ['2026-09-13', 1],
        ['2026-09-14', 1],
      ]);
    });
  });

  describe('Huỷ và không đến', () => {
    it('lượt khám và lịch hẹn tách riêng; lý do huỷ gộp không phân biệt hoa thường/dấu cách thừa', async () => {
      const c = (await get(adminToken, 'cancellations', 'from=2026-09-01&to=2026-09-29')).body.data;
      expect(c.encounters).toEqual({ total: 7, cancelled: 1, noShow: 1 });
      expect(c.appointments).toEqual({ total: 5, cancelled: 1, noShow: 1, rescheduled: 0 });
      expect(c.reasons).toEqual([{ reason: 'Khách bận', encounterCount: 1, appointmentCount: 1 }]);
    });

    it('theo bác sĩ và theo ngày; bác sĩ chưa gán được gọi đúng tên', async () => {
      const c = (await get(adminToken, 'cancellations', 'from=2026-09-01&to=2026-09-29')).body.data;
      const none = c.byDoctor.find((d: { doctorId: string | null }) => d.doctorId === null);
      expect(none).toMatchObject({ doctorName: 'Chưa gán bác sĩ', encounterNoShow: 1 });
      const docACounts = c.byDoctor.find((d: { doctorId: string | null }) => d.doctorId === docA);
      expect(docACounts).toMatchObject({ encounterCancelled: 1, appointmentCancelled: 0 });
      expect(c.byDay.map((d: { date: string }) => d.date)).toEqual(['2026-09-07', '2026-09-08', '2026-09-11']);
    });
  });

  describe('Tái khám', () => {
    it('hẹn trong kỳ: đã đến (có lượt khám sau), quá hạn chưa đến, không tái khám tách riêng; kế hoạch chưa ký không tính', async () => {
      const f = (await get(adminToken, 'follow-ups')).body.data;
      expect(f.summary).toEqual({ total: 2, arrived: 1, overdue: 1, pending: 0, notReturning: 1, arrivalPercent: 50 });
      const byDoctor = new Map((f.byDoctor as Array<{ doctorId: string; total: number; arrived: number; overdue: number }>).map((d) => [d.doctorId, d]));
      expect(byDoctor.get(docA)).toMatchObject({ total: 2, arrived: 1, overdue: 1, arrivalPercent: 50 });
      expect(byDoctor.has(docB)).toBe(false);
    });

    it('hẹn ở tương lai là "còn chờ", không tính vào tỉ lệ đến', async () => {
      const f = (await get(adminToken, 'follow-ups', 'from=2099-01-01&to=2099-01-31')).body.data;
      expect(f.summary).toMatchObject({ total: 1, arrived: 0, overdue: 0, pending: 1, arrivalPercent: null });
    });

    it('các lần nhắc trong kỳ theo kết quả', async () => {
      const f = (await get(adminToken, 'follow-ups')).body.data;
      const byResult = Object.fromEntries((f.reminders as Array<{ result: string; count: number }>).map((r) => [r.result, r.count]));
      expect(byResult).toEqual({ REACHED: 1, NOT_RETURNING: 1 });
    });
  });

  describe('Nguồn đặt lịch', () => {
    it('theo nguồn: tổng, đã đến, huỷ, không đến; tỉ lệ đến; nguồn nhiều nhất; không lẫn chi nhánh B', async () => {
      const b = (await get(adminToken, 'booking-sources')).body.data;
      expect(b).toMatchObject({ total: 5, arrived: 2, arrivalPercent: 40, topSource: 'phone' });
      const bySource = Object.fromEntries((b.sources as Array<{ source: string }>).map((s) => [s.source, s]));
      expect(bySource.phone).toMatchObject({ total: 3, arrived: 1, pending: 1, noShow: 1, arrivalPercent: 33.3 });
      expect(bySource.online).toMatchObject({ total: 1, arrived: 1, arrivalPercent: 100 });
      expect(bySource.walk_in).toMatchObject({ total: 1, cancelled: 1, arrivalPercent: 0 });
    });
  });

  describe('phạm vi chi nhánh', () => {
    it('quản trị: scope=all gộp chi nhánh B; mặc định chỉ chi nhánh đang làm', async () => {
      const own = (await get(adminToken, 'visit-book')).body.data;
      const all = (await get(adminToken, 'visit-book', `${SEP}&scope=all`)).body.data;
      expect(own.branchCount).toBe(1);
      expect(all.branchCount).toBe(2);
      expect(all.total).toBe(own.total + 1);
      expect(all.items.some((r: { branchId: string; branchName: string }) => r.branchId === branchB && r.branchName === 'Chi nhánh B vận hành')).toBe(true);
      const heat = (await get(adminToken, 'peak-hours', `from=2026-09-01&to=2026-09-12&scope=all`)).body.data;
      expect(heat.totalVisits).toBe(4);
      const sources = (await get(adminToken, 'booking-sources', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(sources).toMatchObject({ total: 1, arrived: 1, topSource: 'online' });
    });

    it('thiếu company_report.read: scope=all và scope=pick đều 403 dù tự gửi tham số', async () => {
      for (const path of ['visit-book', 'peak-hours', 'waiting', 'cancellations', 'follow-ups', 'booking-sources']) {
        expect((await get(viewerToken, path, `${SEP}&scope=all`)).status, path).toBe(403);
        expect((await get(viewerToken, path, `${SEP}&scope=pick&branchIds=${branchB}`)).status, path).toBe(403);
      }
      const own = await get(viewerToken, 'visit-book');
      expect(own.status).toBe(200);
      expect(own.body.data.branchCount).toBe(1);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào', async () => {
      expect([400, 422]).toContain((await get(adminToken, 'peak-hours', `${SEP}&scope=pick`)).status);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0 ở cả 6 báo cáo; không đọc được chi nhánh của công ty này (404)', async () => {
      expect((await get(tenantBAdminToken, 'visit-book')).body.data).toMatchObject({ total: 0, items: [] });
      expect((await get(tenantBAdminToken, 'peak-hours')).body.data.totalVisits).toBe(0);
      expect((await get(tenantBAdminToken, 'waiting')).body.data.summary.measuredCount).toBe(0);
      expect((await get(tenantBAdminToken, 'cancellations')).body.data.encounters.total).toBe(0);
      expect((await get(tenantBAdminToken, 'follow-ups', 'from=2026-01-01&to=2099-12-31'.replace('2099-12-31', '2026-12-31'))).body.data.summary.total).toBe(0);
      expect((await get(tenantBAdminToken, 'booking-sources')).body.data.total).toBe(0);
      expect((await get(tenantBAdminToken, 'visit-book', `${SEP}&scope=pick&branchIds=${branchA}`)).status).toBe(404);
    });
  });

  describe('xuất Excel', () => {
    async function readSheet(buffer: Buffer): Promise<{ names: string[]; text: string }> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const text = wb.worksheets.map((s) => s.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|')).join('\n');
      return { names: wb.worksheets.map((s) => s.name), text };
    }

    it('Sổ khám bệnh: số dòng và thành tiền khớp màn hình; không ghi từ khoá tìm vào nhật ký', async () => {
      const res = await h.download(`/api/v1/reports/operations/visit-book/export?${SEP}&q=nguyet`, adminToken);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('so-kham-benh-2026-09-01-2026-09-30.xlsx');
      const sheet = await readSheet(res.body as Buffer);
      expect(sheet.names).toEqual(['Sổ khám bệnh']);
      expect(sheet.text).toContain('Nguyễn Thị Ánh Nguyệt');
      expect(sheet.text).toContain('300000');
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'operations_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('operations_report_export');
      const after = JSON.stringify(audit?.afterJson);
      expect(after).toContain('visit_book');
      expect(after).toContain(branchA);
      expect(after).not.toContain('nguyet');
    });

    it('5 báo cáo tổng hợp xuất được, tên sheet đúng, có số khớp màn hình', async () => {
      const cases: Array<[string, string, string]> = [
        ['peak-hours', 'Giờ cao điểm', 'Lượt khám theo thứ và giờ tiếp nhận'],
        ['waiting', 'Thời gian chờ', 'Theo bác sĩ'],
        ['cancellations', 'Huỷ và không đến', 'Khách bận'],
        ['follow-ups', 'Tái khám', 'Các lần nhắc trong kỳ'],
        ['booking-sources', 'Nguồn đặt lịch', 'Điện thoại'],
      ];
      for (const [path, sheetName, expected] of cases) {
        const res = await h.download(`/api/v1/reports/operations/${path}/export?${SEP}`, adminToken);
        expect(res.status, path).toBe(200);
        const sheet = await readSheet(res.body as Buffer);
        expect(sheet.names, path).toEqual([sheetName]);
        expect(sheet.text.toUpperCase(), path).toContain(expected.toUpperCase());
      }
    });

    it('thiếu quyền → 403 và không ghi nhật ký xuất mới; scope=all khi thiếu company_report.read → 403', async () => {
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'operations_report.exported' } });
      expect((await h.download(`/api/v1/reports/operations/visit-book/export?${SEP}`, receptionistToken)).status).toBe(403);
      expect((await h.download(`/api/v1/reports/operations/peak-hours/export?${SEP}&scope=all`, viewerToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'operations_report.exported' } })).toBe(before);
    });
  });
});
