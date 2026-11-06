import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { getVietnamDateString, overdueDays, vietnamDayStartUtc } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — trang báo cáo "Bệnh nhân" (`/reports/patients/*`, docs/DECISIONS.md #287). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong tháng 09/2026 (đã qua, nên kết quả
 * không đổi theo ngày chạy). Trọng tâm: bệnh nhân mới/cũ tính trên TOÀN CÔNG TY (lượt trước ở chi nhánh khác vẫn làm bệnh nhân thành "cũ"), khoảng cách theo NGÀY lịch Việt Nam (lượt 23:30 và
 * 00:10 sát nửa đêm), chỉ lượt đã tiếp nhận; tuổi tính đến ngày cuối kỳ (đúng sinh nhật); địa bàn; hẹn tái khám quá hạn chưa quay lại (ký rồi, đúng hướng, ngày hẹn trong kỳ và đã qua);
 * phạm vi nhiều chi nhánh cần `company_report.read`; cô lập CHI NHÁNH và CÔNG TY; chỉ quản lý (`patient_report.read`) xem được; Excel + nhật ký.
 */
describe('HTTP e2e — Bệnh nhân (/api/v1/reports/patients)', () => {
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
  const code: Record<string, string> = {};
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const provA = `ZZ${tag}A`;
  const provB = `ZZ${tag}B`;
  const wardA1 = `ZZ${tag}A1`;
  const wardA2 = `ZZ${tag}A2`;
  const wardB1 = `ZZ${tag}B1`;

  const SEP = 'from=2026-09-01&to=2026-09-30';
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const get = (token: string, path: string, query = SEP) => http().get(`/api/v1/reports/patients/${path}?${query}`).set(authed(token));
  const today = getVietnamDateString(new Date());

  async function makePatient(key: string, opts: { gender: string; dob: string; province?: string; ward?: string }): Promise<string> {
    code[key] = `BN-${tag}-${key}`;
    const p = await privileged.patient.create({
      data: {
        tenantId: fixture.tenantA.id,
        patientCode: code[key],
        fullName: `Bệnh nhân ${key} ${tag}`,
        dob: new Date(opts.dob),
        gender: opts.gender,
        phone: `09${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
        addressJson: opts.province ? { province: opts.province, ...(opts.ward ? { ward: opts.ward } : {}) } : undefined,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return p.id;
  }

  async function makeEncounter(patientId: string, opts: { at: Date; branchId?: string; status?: 'COMPLETED' | 'CANCELLED' | 'SCHEDULED' }): Promise<string> {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const e = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId,
        departmentId: department.id,
        encounterNo: `LK-PT-${randomUUID().slice(0, 10)}`,
        status: opts.status ?? 'COMPLETED',
        checkedInAt: opts.at,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return e.id;
  }

  async function makeFollowUp(encounterId: string, dueDate: string, opts: { signed?: boolean; directions?: string[] } = {}) {
    await privileged.encounterTreatmentPlan.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        directions: (opts.directions ?? ['FOLLOW_UP']) as never,
        followUpDate: new Date(dueDate),
        signedAt: opts.signed === false ? null : new Date(),
        signedBy: opts.signed === false ? null : SYSTEM_TEST_ACTOR,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  async function makeReminder(encounterId: string, result: 'REACHED' | 'NO_ANSWER' | 'CALL_BACK_LATER' | 'NOT_RETURNING', remindedAt: Date) {
    await privileged.followUpReminder.create({ data: { tenantId: fixture.tenantA.id, encounterId, result, remindedAt, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
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

    fixture = await createTwoTenantFixture(privileged, 'Patient report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZPT2', name: 'Chi nhánh B bệnh nhân', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'pt-admin', [branchA]);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-benh-nhan-chi-nhanh', [['patient_report', 'read']]);
    const viewer = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'pt-viewer', [branchA]);
    viewerToken = await h.login(fixture.tenantA.id, viewer.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'pt-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'pt-doctor', [branchA]);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'pt-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    // Địa giới dùng chung (không theo công ty) — mã riêng cho lần chạy này, dọn ở afterAll.
    await privileged.province.createMany({ data: [{ code: provA, name: 'Tỉnh Thử A' }, { code: provB, name: 'Tỉnh Thử B' }] });
    await privileged.ward.createMany({
      data: [
        { code: wardA1, name: 'Phường Thử A1', provinceCode: provA },
        { code: wardA2, name: 'Phường Thử A2', provinceCode: provA },
        { code: wardB1, name: 'Phường Thử B1', provinceCode: provB },
      ],
    });

    // P1: mới, 1 lượt (10/09), nữ, sinh 01/03/2026 → dưới 1 tuổi. Có kế hoạch tái khám CHƯA KÝ (không tính).
    const p1 = await makePatient('P1', { gender: 'female', dob: '2026-03-01', province: provA, ward: wardA1 });
    const p1e = await makeEncounter(p1, { at: at('2026-09-10', '09:00') });
    await makeFollowUp(p1e, '2026-09-15', { signed: false });
    // P2: mới, 2 lượt (05/09, 20/09), nam, sinh 2024 → 2 tuổi. Hẹn tái khám ở lượt 05/09 nhưng ĐÃ QUAY LẠI ngày 20/09 (không tính).
    const p2 = await makePatient('P2', { gender: 'male', dob: '2024-01-01', province: provA, ward: wardA1 });
    const p2e = await makeEncounter(p2, { at: at('2026-09-05', '09:00') });
    await makeEncounter(p2, { at: at('2026-09-20', '09:00') });
    await makeFollowUp(p2e, '2026-09-12');
    // P3: cũ (lượt trước 25/08 → cách 18 ngày), 1 lượt 12/09, nữ 1990 → 36 tuổi. Hẹn tái khám 20/09, chưa nhắc.
    const p3 = await makePatient('P3', { gender: 'female', dob: '1990-05-05', province: provA, ward: wardA2 });
    await makeEncounter(p3, { at: at('2026-08-25', '09:00') });
    const p3e = await makeEncounter(p3, { at: at('2026-09-12', '09:00') });
    await makeFollowUp(p3e, '2026-09-20');
    // P4: cũ (lượt trước 01/03 → cách 186 ngày), 3 lượt 03–05/09, nam 1990. Hẹn tái khám 26/09 ở lượt cuối, đã nhắc 2 lần (cuối: liên lạc được).
    const p4 = await makePatient('P4', { gender: 'male', dob: '1990-05-05', province: provB, ward: wardB1 });
    await makeEncounter(p4, { at: at('2026-03-01', '09:00') });
    await makeEncounter(p4, { at: at('2026-09-03', '09:00') });
    await makeEncounter(p4, { at: at('2026-09-04', '09:00') });
    const p4e = await makeEncounter(p4, { at: at('2026-09-05', '09:00') });
    await makeFollowUp(p4e, '2026-09-26');
    await makeReminder(p4e, 'NO_ANSWER', at('2026-09-27', '09:00'));
    await makeReminder(p4e, 'REACHED', at('2026-09-28', '09:00'));
    // P5: cũ nhờ lượt 31/08 ở CHI NHÁNH B (cách 20 ngày), 1 lượt ở chi nhánh A 20/09, giới "khác", sinh 1950, chưa ghi địa chỉ. Hẹn tái khám sau kỳ (ngoài khoảng).
    const p5 = await makePatient('P5', { gender: 'other', dob: '1950-01-01' });
    await makeEncounter(p5, { at: at('2026-08-31', '09:00'), branchId: branchB });
    const p5e = await makeEncounter(p5, { at: at('2026-09-20', '09:00') });
    await makeFollowUp(p5e, '2026-10-15');
    // P6: chỉ có lượt ĐÃ HUỶ và lượt CHỜ KHÁM CHƯA TIẾP NHẬN → không tính là có khám.
    const p6 = await makePatient('P6', { gender: 'male', dob: '1985-01-01' });
    await makeEncounter(p6, { at: at('2026-09-11', '09:00'), status: 'CANCELLED' });
    await makeEncounter(p6, { at: at('2026-09-11', '10:00'), status: 'SCHEDULED' });
    // P7: mới, 1 lượt 18/09 nhưng ở chi nhánh B — chỉ thấy khi gộp. Hẹn tái khám 18/09.
    const p7 = await makePatient('P7', { gender: 'female', dob: '2000-01-01', province: provB });
    const p7e = await makeEncounter(p7, { at: at('2026-09-18', '09:00'), branchId: branchB });
    await makeFollowUp(p7e, '2026-09-18');
    // P9: cũ, lượt trước 23:30 ngày 31/08 và lượt 00:10 ngày 01/09 (giờ VN, cách 1 ngày lịch dù cùng ngày UTC). Sinh 01/10/1980 → ngày 30/09/2026 mới 45 tuổi.
    // Hẹn tái khám 07/09 và đã ghi "Bệnh nhân không tái khám".
    const p9 = await makePatient('P9', { gender: 'female', dob: '1980-10-01' });
    await makeEncounter(p9, { at: at('2026-08-31', '23:30') });
    const p9e = await makeEncounter(p9, { at: at('2026-09-01', '00:10') });
    await makeFollowUp(p9e, '2026-09-07');
    await makeReminder(p9e, 'NOT_RETURNING', at('2026-09-10', '09:00'));
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.ward.deleteMany({ where: { code: { in: [wardA1, wardA2, wardB1] } } });
    await privileged.province.deleteMany({ where: { code: { in: [provA, provB] } } });
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền và kiểm tra đầu vào', () => {
    it('chưa đăng nhập → 401; lễ tân và bác sĩ → 403; quản trị và vai trò có patient_report.read → 200, cho cả 3 báo cáo', async () => {
      for (const path of ['new-returning', 'demographics', 'not-returning']) {
        expect((await http().get(`/api/v1/reports/patients/${path}?${SEP}`)).status, path).toBe(401);
        expect((await get(receptionistToken, path)).status, path).toBe(403);
        expect((await get(doctorToken, path)).status, path).toBe(403);
        expect((await get(adminToken, path)).status, path).toBe(200);
        expect((await get(viewerToken, path)).status, path).toBe(200);
      }
    });

    it('khoảng ngày sai → lỗi kiểm tra đầu vào, không phải 500', async () => {
      for (const q of ['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-09-01', 'from=2026-02-31&to=2026-03-01', 'from=2026-09-01']) {
        for (const path of ['new-returning', 'demographics', 'not-returning']) expect([400, 422], `${path} ${q}`).toContain((await get(adminToken, path, q)).status);
      }
    });
  });

  describe('Bệnh nhân mới và cũ', () => {
    it('mới/cũ tính trên toàn công ty, chỉ lượt đã tiếp nhận; số lượt, tỉ lệ, phân bố số lượt và khoảng cách theo ngày lịch Việt Nam', async () => {
      const res = await get(adminToken, 'new-returning');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.branchCount).toBe(1);
      expect(d.summary).toEqual({ patients: 6, newPatients: 2, returningPatients: 4, visits: 9, visitsPerPatient: 1.5, returningPercent: 66.7 });
      expect(d.frequency.map((f: { patients: number }) => f.patients)).toEqual([4, 1, 1, 0]);
      expect(d.frequency.map((f: { label: string }) => f.label)).toEqual(['1 lượt', '2 lượt', '3 lượt', 'Từ 4 lượt']);
      // P3 (18 ngày), P5 (20 ngày), P9 (1 ngày lịch) → "Trong 30 ngày"; P4 (186 ngày) → "181–365 ngày".
      expect(d.gap.map((g: { patients: number }) => g.patients)).toEqual([3, 0, 0, 1, 0]);
      expect(d.byMonth).toEqual([{ month: '2026-09', patients: 6, newPatients: 2, returningPatients: 4, visits: 9 }]);
    });

    it('kỳ nhiều tháng: tháng trống vẫn hiện; lượt 23:30 ngày 31/08 thuộc tháng 8 theo giờ Việt Nam', async () => {
      const d = (await get(adminToken, 'new-returning', 'from=2026-08-01&to=2026-10-31')).body.data;
      expect(d.byMonth.map((m: { month: string }) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
      const aug = d.byMonth[0];
      // Tháng 8 ở chi nhánh A: P3 (25/08, lượt đầu), P9 (23:30 31/08, lượt đầu). Lượt P5 31/08 ở chi nhánh B không tính.
      expect(aug).toMatchObject({ patients: 2, newPatients: 2, visits: 2 });
      expect(d.byMonth[2]).toEqual({ month: '2026-10', patients: 0, newPatients: 0, returningPatients: 0, visits: 0 });
    });

    it('kỳ không có lượt khám → mọi số 0, tỉ lệ null', async () => {
      const d = (await get(adminToken, 'new-returning', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(d.summary).toEqual({ patients: 0, newPatients: 0, returningPatients: 0, visits: 0, visitsPerPatient: null, returningPercent: null });
      expect(d.frequency.every((f: { patients: number }) => f.patients === 0)).toBe(true);
    });
  });

  describe('Tuổi, giới và địa bàn', () => {
    it('tuổi tính đến ngày cuối kỳ (đúng sinh nhật), giới, địa bàn; bệnh nhân chỉ huỷ/chưa tiếp nhận không tính', async () => {
      const d = (await get(adminToken, 'demographics')).body.data;
      expect(d.patients).toBe(6);
      expect(d.genders).toEqual({ male: 2, female: 3, other: 1 });
      const band = (key: string) => d.ageBands.find((b: { key: string }) => b.key === key);
      expect(band('under1')).toMatchObject({ female: 1, total: 1 });
      expect(band('1-5')).toMatchObject({ male: 1, total: 1 });
      // P3 36 tuổi, P4 36 tuổi, P9 45 tuổi (sinh 01/10/1980, mới tròn 46 vào 01/10/2026).
      expect(band('31-45')).toMatchObject({ male: 1, female: 2, total: 3 });
      expect(band('46-60')).toMatchObject({ total: 0 });
      expect(band('over60')).toMatchObject({ other: 1, total: 1 });
      expect(d.unknownAge).toBe(0);
      expect(d.provinces).toEqual([
        { code: provA, name: 'Tỉnh Thử A', provinceName: '', patients: 3 },
        { code: provB, name: 'Tỉnh Thử B', provinceName: '', patients: 1 },
      ]);
      expect(d.unknownProvince).toBe(2);
      expect(d.wards).toEqual([
        { code: wardA1, name: 'Phường Thử A1', provinceName: 'Tỉnh Thử A', patients: 2 },
        { code: wardA2, name: 'Phường Thử A2', provinceName: 'Tỉnh Thử A', patients: 1 },
        { code: wardB1, name: 'Phường Thử B1', provinceName: 'Tỉnh Thử B', patients: 1 },
      ]);
    });

    it('kỳ không có lượt khám → rỗng', async () => {
      const d = (await get(adminToken, 'demographics', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(d).toMatchObject({ patients: 0, provinces: [], wards: [], unknownProvince: 0, unknownAge: 0 });
    });
  });

  describe('Bệnh nhân không quay lại', () => {
    it('chỉ hẹn ĐÃ KÝ, đúng hướng, ngày hẹn trong kỳ và đã qua, chưa có lượt khám sau đó; quá hạn lâu nhất trước; đếm lần nhắc', async () => {
      const res = await get(adminToken, 'not-returning');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.items.map((r: { patientCode: string }) => r.patientCode)).toEqual([code.P9, code.P3, code.P4]);
      const byCode = (c: string) => d.items.find((r: { patientCode: string }) => r.patientCode === c);
      expect(byCode(code.P9!)).toMatchObject({ dueDate: '2026-09-07', visitDate: '2026-09-01', reminderCount: 1, lastReminderResult: 'NOT_RETURNING', overdueDays: overdueDays('2026-09-07', today) });
      expect(byCode(code.P3!)).toMatchObject({ dueDate: '2026-09-20', visitDate: '2026-09-12', reminderCount: 0, lastReminderResult: null, overdueDays: overdueDays('2026-09-20', today) });
      expect(byCode(code.P4!)).toMatchObject({ dueDate: '2026-09-26', reminderCount: 2, lastReminderResult: 'REACHED' });
      expect(typeof byCode(code.P3!).phone).toBe('string');
      const avg = Math.round((overdueDays('2026-09-07', today) + overdueDays('2026-09-20', today) + overdueDays('2026-09-26', today)) / 3);
      expect(d.summary).toEqual({ patients: 3, reminded: 2, markedNotReturning: 1, avgOverdueDays: avg });
      expect(d.totalCount).toBe(3);
    });

    it('hẹn chưa đến hạn (ngày hẹn sau hôm nay) không phải "không quay lại"', async () => {
      const [yy, mm, dd] = today.split('-').map(Number);
      const plus = (days: number) => new Date(Date.UTC(yy!, mm! - 1, dd! + days)).toISOString().slice(0, 10);
      const pid = await makePatient('P10', { gender: 'male', dob: '1992-02-02' });
      const e = await makeEncounter(pid, { at: at('2026-07-14', '09:00') });
      await makeFollowUp(e, plus(10));
      const d = (await get(adminToken, 'not-returning', `from=${plus(-30)}&to=${plus(30)}`)).body.data;
      expect(d.items.some((r: { patientCode: string }) => r.patientCode === code.P10)).toBe(false);
    });
  });

  describe('phạm vi nhiều chi nhánh', () => {
    it('chi nhánh đang làm chỉ thấy số của mình; gộp mới thấy bệnh nhân ở chi nhánh B (có company_report.read)', async () => {
      const own = (await get(adminToken, 'new-returning')).body.data;
      expect(own.summary.patients).toBe(6);
      const all = (await get(adminToken, 'new-returning', `${SEP}&scope=all`)).body.data;
      expect(all.branchCount).toBeGreaterThanOrEqual(2);
      expect(all.summary).toMatchObject({ patients: 7, newPatients: 3, visits: 10 });
      const pickB = (await get(adminToken, 'new-returning', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(pickB.summary).toMatchObject({ patients: 1, newPatients: 1, returningPatients: 0, visits: 1 });
      const nr = (await get(adminToken, 'not-returning', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(nr.items.map((r: { patientCode: string }) => r.patientCode)).toEqual([code.P7]);
      expect(nr.items[0].branchName).toBe('Chi nhánh B bệnh nhân');
    });

    it('thiếu company_report.read: scope=all và scope=pick đều 403 dù tự gửi tham số', async () => {
      for (const path of ['new-returning', 'demographics', 'not-returning']) {
        expect((await get(viewerToken, path, `${SEP}&scope=all`)).status, path).toBe(403);
        expect((await get(viewerToken, path, `${SEP}&scope=pick&branchIds=${branchB}`)).status, path).toBe(403);
      }
      expect((await get(viewerToken, 'new-returning')).body.data.summary.patients).toBe(6);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào', async () => {
      expect([400, 422]).toContain((await get(adminToken, 'new-returning', `${SEP}&scope=pick`)).status);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0 ở cả 3 báo cáo; không đọc được chi nhánh của công ty này (404)', async () => {
      expect((await get(tenantBAdminToken, 'new-returning')).body.data.summary).toMatchObject({ patients: 0, visits: 0 });
      expect((await get(tenantBAdminToken, 'demographics')).body.data).toMatchObject({ patients: 0, provinces: [], wards: [] });
      expect((await get(tenantBAdminToken, 'not-returning')).body.data).toMatchObject({ items: [], totalCount: 0 });
      expect((await get(tenantBAdminToken, 'new-returning', `${SEP}&scope=pick&branchIds=${branchA}`)).status).toBe(404);
    });
  });

  describe('xuất Excel', () => {
    async function readSheet(buffer: Buffer): Promise<{ names: string[]; text: string }> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const text = wb.worksheets.map((s) => s.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|')).join('\n');
      return { names: wb.worksheets.map((s) => s.name), text };
    }

    it('3 báo cáo xuất được, tên sheet đúng, số khớp màn hình', async () => {
      const cases: Array<[string, string, string[]]> = [
        ['new-returning', 'Bệnh nhân mới và cũ', ['09/2026', 'Từ 4 lượt', 'Trên 1 năm']],
        ['demographics', 'Tuổi, giới và địa bàn', ['Tỉnh Thử A', 'Phường Thử A1', '31–45 tuổi']],
        ['not-returning', 'Bệnh nhân không quay lại', [code.P9!, code.P3!, code.P4!, 'Bệnh nhân không tái khám', 'Chưa nhắc']],
      ];
      for (const [path, sheetName, expected] of cases) {
        const res = await h.download(`/api/v1/reports/patients/${path}/export?${SEP}`, adminToken);
        expect(res.status, path).toBe(200);
        expect(res.headers['content-type'], path).toContain('spreadsheetml');
        const sheet = await readSheet(res.body as Buffer);
        expect(sheet.names, path).toEqual([sheetName]);
        for (const token of expected) expect(sheet.text, `${path} ${token}`).toContain(token);
      }
    });

    it('ghi nhật ký xuất đúng chi nhánh đã đọc; thiếu quyền → 403 và không ghi nhật ký mới', async () => {
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'patient_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('patient_report_export');
      expect(JSON.stringify(audit?.afterJson)).toContain(branchA);
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'patient_report.exported' } });
      expect((await h.download(`/api/v1/reports/patients/not-returning/export?${SEP}`, doctorToken)).status).toBe(403);
      expect((await h.download(`/api/v1/reports/patients/new-returning/export?${SEP}&scope=all`, viewerToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'patient_report.exported' } })).toBe(before);
    });
  });
});
