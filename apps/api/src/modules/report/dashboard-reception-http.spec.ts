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
import { DashboardService } from './dashboard.service';

/**
 * HTTP e2e — Trang Tổng quan của LỄ TÂN (`GET /reports/dashboard/reception`, docs/DECISIONS.md #284). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong ngày. Các con số được
 * kiểm bằng cách gọi `DashboardService` với `now` cố định (14:30) để kết quả không phụ thuộc đồng hồ thật; HTTP kiểm phân quyền, hình dạng phản hồi và cô lập công ty.
 */
describe('HTTP e2e — Trang Tổng quan lễ tân (/api/v1/reports/dashboard/reception)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let receptionistToken: string;
  let adminToken: string;
  let doctorToken: string;
  let tenantBReceptionistToken: string;
  let branchA: string;
  let branchB: string;
  let d1: { id: string; name: string };
  let d2: { id: string; name: string };

  const today = getVietnamDateString();
  const yesterday = addDaysToDateString(today, -1)!;
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const NOW = at(today, '14:30');
  const ago = (days: number) => addDaysToDateString(today, -days)!;

  async function makePatient(tag: string, dob = '1990-01-01'): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-LT-${tag}-${n}`, fullName: `Bệnh nhân lễ tân ${tag}`, dob: new Date(dob), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return patient.id;
  }

  async function makeEncounter(patientId: string, status: 'CHECKED_IN' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED', checkedInAt: Date, opts: { branchId?: string; receptionTypeCode?: string; doctorId?: string } = {}) {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    return privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId,
        doctorId: opts.doctorId ?? null,
        departmentId: department.id,
        encounterNo: `LK-LT-${randomUUID().slice(0, 10)}`,
        status,
        checkedInAt,
        receptionTypeCode: opts.receptionTypeCode ?? null,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  async function makeAppointment(hhmm: string, status: 'SCHEDULED' | 'CONVERTED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED', doctorId: string, opts: { date?: string; branchId?: string; patientId?: string; name?: string } = {}) {
    return privileged.appointment.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        doctorId,
        patientId: opts.patientId ?? null,
        bookingCode: `LH-LT-${randomUUID().slice(0, 8)}`,
        fullName: opts.name ?? `Khách ${hhmm}`,
        phone: '0900000000',
        scheduledAt: at(opts.date ?? today, hhmm),
        durationMinutes: 15,
        status,
        source: 'phone',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  async function makePlan(encounterId: string, followUpDate: string, opts: { signed?: boolean } = {}) {
    return privileged.encounterTreatmentPlan.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        directions: ['FOLLOW_UP'],
        followUpDate: new Date(followUpDate),
        signedAt: opts.signed === false ? null : new Date(),
        signedBy: opts.signed === false ? null : SYSTEM_TEST_ACTOR,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  const getReception = (token: string) => http().get('/api/v1/reports/dashboard/reception').set(authed(token));
  const viaService = (tenantId: string, branchId: string) => app.get(DashboardService, { strict: false }).getReceptionDashboard({ tenantId, branchId }, NOW);

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

    fixture = await createTwoTenantFixture(privileged, 'Dashboard reception e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZLT2', name: 'Chi nhánh B lễ tân', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'lt-recep', [branchA]);
    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'lt-admin', [branchA]);
    const doctor1 = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'lt-doc1', [branchA]);
    const doctor2 = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'lt-doc2', [branchA]);
    const receptionistB = await h.createUser(fixture.tenantB.id, { name: 'receptionist' }, 'lt-recepB');
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    doctorToken = await h.login(fixture.tenantA.id, doctor1.username);
    tenantBReceptionistToken = await h.login(fixture.tenantB.id, receptionistB.username);
    const nameOf = async (id: string) => {
      const u = await privileged.userAccount.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, id } });
      return u.displayName ?? u.fullName;
    };
    d1 = { id: doctor1.id, name: await nameOf(doctor1.id) };
    d2 = { id: doctor2.id, name: await nameOf(doctor2.id) };

    // Lịch hẹn hôm nay: 2 đã đến, 4 chưa đến; huỷ / không đến / đã dời KHÔNG tính.
    const year = Number(today.slice(0, 4));
    const adultPatient = await makePatient('adult', `${year - 30}-01-01`);
    await makeAppointment('09:00', 'CONVERTED', d1.id);
    await makeAppointment('09:30', 'CONVERTED', d1.id);
    await makeAppointment('14:00', 'SCHEDULED', d1.id, { patientId: adultPatient, name: 'Khách có hồ sơ' });
    await makeAppointment('15:15', 'SCHEDULED', d2.id);
    await makeAppointment('15:30', 'SCHEDULED', d1.id);
    await makeAppointment('16:00', 'SCHEDULED', d2.id);
    await makeAppointment('10:00', 'CANCELLED', d1.id);
    await makeAppointment('11:00', 'NO_SHOW', d1.id);
    await makeAppointment('11:30', 'RESCHEDULED', d1.id);
    await makeAppointment('09:00', 'SCHEDULED', d1.id, { date: yesterday });
    await makeAppointment('15:00', 'SCHEDULED', d1.id, { branchId: branchB });

    // Nghỉ phép: d2 nghỉ 14:00–18:00 ĐÃ DUYỆT (tính); d1 đơn CHỜ DUYỆT (không tính); chi nhánh B không liên quan.
    const leave = (userId: string, status: string, branchId = branchA) =>
      privileged.leaveRequest.create({
        data: { tenantId: fixture.tenantA.id, branchId, userId, leaveDate: new Date(today), workShiftId: null, startMinute: 840, endMinute: 1080, status, reason: 'Nghỉ phép e2e', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    await leave(d2.id, 'APPROVED');
    await leave(d1.id, 'PENDING');

    // Lượt khám hôm nay theo Loại tiếp nhận.
    const p2 = await makePatient('p2');
    const p3 = await makePatient('p3');
    await makeEncounter(await makePatient('e1'), 'COMPLETED', at(today, '09:10'), { receptionTypeCode: 'RT_NEW', doctorId: d1.id });
    await makeEncounter(p2, 'CHECKED_IN', at(today, '13:50'), { receptionTypeCode: 'RT_NEW', doctorId: d1.id });
    await makeEncounter(p3, 'IN_CONSULTATION', at(today, '13:40'), { receptionTypeCode: 'RT_RETURN', doctorId: d1.id });
    await makeEncounter(await makePatient('e4'), 'CHECKED_IN', at(today, '14:05'));
    await makeEncounter(await makePatient('e5'), 'CANCELLED', at(today, '08:00'), { receptionTypeCode: 'RT_NEW' });
    await makeEncounter(await makePatient('eb'), 'CHECKED_IN', at(today, '10:00'), { branchId: branchB, receptionTypeCode: 'RT_NEW' });

    // Hẹn tái khám.
    const p1 = await makePatient('f1');
    const p4 = await makePatient('f4');
    const p5 = await makePatient('f5');
    const p6 = await makePatient('f6');
    await makePlan((await makeEncounter(p1, 'COMPLETED', at(ago(5), '09:00'))).id, today); // đến hạn hôm nay, chưa quay lại
    await makePlan((await makeEncounter(p2, 'COMPLETED', at(ago(7), '09:00'))).id, today); // đến hạn hôm nay, ĐÃ quay lại (lượt khám 13:50 hôm nay)
    await makePlan((await makeEncounter(p3, 'COMPLETED', at(ago(20), '09:00'))).id, ago(3)); // p3 đã có lượt khám sau (hôm nay) nên KHÔNG quá hạn
    await makePlan((await makeEncounter(p4, 'COMPLETED', at(ago(20), '09:00'))).id, ago(3)); // quá hạn, chưa quay lại
    await makeEncounter(p4, 'CANCELLED', at(ago(2), '09:00')); // lượt huỷ không tính là đã quay lại
    await makePlan((await makeEncounter(p5, 'COMPLETED', at(ago(50), '09:00'))).id, ago(40)); // ngoài cửa sổ 30 ngày
    await makePlan((await makeEncounter(p6, 'COMPLETED', at(ago(5), '09:00'))).id, today, { signed: false }); // chưa ký
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('chưa đăng nhập → 401; lễ tân → 200; chủ phòng khám và bác sĩ (không có dashboard.reception) → 403', async () => {
      expect((await http().get('/api/v1/reports/dashboard/reception')).status).toBe(401);
      const ok = await getReception(receptionistToken);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.hourly).toHaveLength(24);
      expect((await getReception(adminToken)).status).toBe(403);
      expect((await getReception(doctorToken)).status).toBe(403);
    });
  });

  describe('số liệu hôm nay (now cố định 14:30)', () => {
    it('lịch hẹn: 2 đã đến + 4 chưa đến; không tính huỷ/không đến/đã dời, hôm qua, chi nhánh B', async () => {
      const d = await viaService(fixture.tenantA.id, branchA);
      expect(d.date).toBe(today);
      expect(d.appointments).toEqual({ total: 6, arrived: 2, notArrived: 4 });
      expect(d.hourly[9]).toEqual({ hour: 9, arrived: 2, notArrived: 0 });
      expect(d.hourly[14]).toEqual({ hour: 14, arrived: 0, notArrived: 1 });
      expect(d.hourly[15]).toEqual({ hour: 15, arrived: 0, notArrived: 2 });
      expect(d.hourly.reduce((s, x) => s + x.arrived + x.notArrived, 0)).toBe(6);
    });

    it('lịch hẹn sắp tới: chưa đến từ 14:00, sớm trước, tên + tuổi + bác sĩ; lịch của bác sĩ nghỉ được đánh dấu', async () => {
      const d = await viaService(fixture.tenantA.id, branchA);
      expect(d.upcoming.items.map((i) => i.scheduledAt)).toEqual([at(today, '14:00'), at(today, '15:15'), at(today, '15:30'), at(today, '16:00')].map((x) => x.toISOString()));
      expect(d.upcoming.moreCount).toBe(0);
      expect(d.upcoming.items[0]).toMatchObject({ patientName: 'Khách có hồ sơ', age: 30, doctorName: d1.name, doctorOnLeave: false });
      expect(d.upcoming.items[1]).toMatchObject({ doctorName: d2.name, doctorOnLeave: true, age: null });
      expect(d.upcoming.items.map((i) => i.doctorOnLeave)).toEqual([false, true, false, true]);
    });

    it('bác sĩ nghỉ: chỉ đơn ĐÃ DUYỆT; 2 lịch chưa đến của bác sĩ nghỉ trùng khung 14:00–18:00', async () => {
      const d = await viaService(fixture.tenantA.id, branchA);
      expect(d.leaveAlerts).toEqual([{ doctorName: d2.name, startMinute: 840, endMinute: 1080, appointmentCount: 2 }]);
    });

    it('Loại tiếp nhận: 2 khám mới (không tính huỷ, không tính chi nhánh B) + 1 tái khám', async () => {
      const d = await viaService(fixture.tenantA.id, branchA);
      expect(d.reception).toEqual({ newCount: 1 + 1, returnCount: 1 });
    });

    it('hàng đợi: 2 chờ (kể cả lượt chưa có bác sĩ) + 1 đang khám; waiting khớp tổng cột Chờ', async () => {
      const d = await viaService(fixture.tenantA.id, branchA);
      expect(d.queue.totalWaiting).toBe(2);
      expect(d.queue.totalInProgress).toBe(1);
      expect(d.waiting).toBe(2);
      expect(d.queue.rows.some((r) => r.doctorName === null && r.waiting === 1)).toBe(true);
    });

    it('hẹn tái khám: đến hạn 2 (1 đã quay lại); quá hạn 1 — bỏ phiếu chưa ký, ngoài 30 ngày, và người đã quay lại; lượt huỷ không tính là quay lại', async () => {
      const d = await viaService(fixture.tenantA.id, branchA);
      expect(d.followUp).toEqual({ dueToday: 2, arrivedToday: 1, overdueNotArrived: 1, overdueWithinDays: 30 });
    });

    it('chi nhánh B của cùng công ty thấy số riêng, không lẫn chi nhánh A', async () => {
      const d = await viaService(fixture.tenantA.id, branchB);
      expect(d.appointments).toEqual({ total: 1, arrived: 0, notArrived: 1 });
      expect(d.reception.newCount).toBe(1);
      expect(d.leaveAlerts).toEqual([]);
      expect(d.followUp).toMatchObject({ dueToday: 0, overdueNotArrived: 0 });
    });
  });

  describe('cô lập công ty', () => {
    it('lễ tân công ty khác thấy số 0', async () => {
      const res = await getReception(tenantBReceptionistToken);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.appointments).toEqual({ total: 0, arrived: 0, notArrived: 0 });
      expect(d.upcoming).toEqual({ items: [], moreCount: 0 });
      expect(d.leaveAlerts).toEqual([]);
      expect(d.followUp).toMatchObject({ dueToday: 0, arrivedToday: 0, overdueNotArrived: 0 });
      expect(d.queue.rows).toEqual([]);
    });
  });
});
