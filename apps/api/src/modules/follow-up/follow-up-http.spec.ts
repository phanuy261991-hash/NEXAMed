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
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';

/**
 * HTTP e2e — trang "Hẹn tái khám" (`/api/v1/follow-ups`, docs/DECISIONS.md #285). Dữ liệu dựng bằng Prisma đặc quyền với ngày tương đối so với HÔM NAY (giờ VN). Trọng tâm: quy tắc tab/trạng thái
 * (quá hạn 30 ngày, sắp tới 7 ngày, đã quay lại), loại hẹn chưa ký/đã ghi "không tái khám", phân trang, phạm vi `personal` của bác sĩ, ẩn chẩn đoán với người không có `encounter.read_clinical`,
 * nhật ký nhắc (ghi, audit, 404 ngoài phạm vi), cô lập chi nhánh/công ty, xuất Excel và khớp với số trên Tổng quan lễ tân.
 */
describe('HTTP e2e — Hẹn tái khám (/api/v1/follow-ups)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let receptionistToken: string;
  let adminToken: string;
  let doctor1Token: string;
  let doctor2Token: string;
  let nurseToken: string;
  let tenantBToken: string;
  let branchA: string;
  let branchB: string;
  let d1Id: string;
  let d2Id: string;
  const enc: Record<string, string> = {};

  const today = getVietnamDateString();
  const ago = (days: number) => addDaysToDateString(today, -days)!;
  const ahead = (days: number) => addDaysToDateString(today, days)!;
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };

  async function makePatient(tag: string): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-FU-${tag}-${n}`, fullName: `Bệnh nhân Hẹn ${tag}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return patient.id;
  }

  async function makeEncounter(patientId: string, status: 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED', checkedInAt: Date, doctorId: string | null, branchId = branchA) {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    return privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        patientId,
        doctorId,
        departmentId: department.id,
        encounterNo: `LK-FU-${randomUUID().slice(0, 10)}`,
        status,
        checkedInAt,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  /** Lượt khám gốc đã hoàn tất + kế hoạch điều trị hẹn tái khám. Trả mã lượt khám. */
  async function makeFollowUp(tag: string, opts: { daysAgo: number; due: string; doctorId: string | null; signed?: boolean; branchId?: string; laterEncounter?: { status: 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED'; when: Date } }): Promise<string> {
    const patientId = await makePatient(tag);
    const e = await makeEncounter(patientId, 'COMPLETED', at(ago(opts.daysAgo), '09:00'), opts.doctorId, opts.branchId);
    await privileged.encounterTreatmentPlan.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId: e.id,
        directions: ['FOLLOW_UP'],
        followUpDate: new Date(opts.due),
        signedAt: opts.signed === false ? null : new Date(),
        signedBy: opts.signed === false ? null : SYSTEM_TEST_ACTOR,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    if (opts.laterEncounter) await makeEncounter(patientId, opts.laterEncounter.status, opts.laterEncounter.when, opts.doctorId, opts.branchId);
    enc[tag] = e.id;
    return e.id;
  }

  const list = (token: string, query: Record<string, string | number> = {}) => http().get('/api/v1/follow-ups').query(query).set(authed(token));
  const names = (res: { body: { data: { items: Array<{ patientName: string }> } } }) => res.body.data.items.map((i) => i.patientName.replace('Bệnh nhân Hẹn ', ''));

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

    fixture = await createTwoTenantFixture(privileged, 'Follow-up e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged); // chẩn đoán chính cần danh mục ICD-10 (FK)
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZFU2', name: 'Chi nhánh B hẹn tái khám', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'fu-recep', [branchA]);
    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'fu-admin', [branchA]);
    const doctor1 = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'fu-doc1', [branchA]);
    const doctor2 = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'fu-doc2', [branchA]);
    const nurse = await h.createUser(fixture.tenantA.id, { name: 'nurse' }, 'fu-nurse', [branchA]);
    const receptionistB = await h.createUser(fixture.tenantB.id, { name: 'receptionist' }, 'fu-recepB');
    d1Id = doctor1.id;
    d2Id = doctor2.id;
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    doctor1Token = await h.login(fixture.tenantA.id, doctor1.username);
    doctor2Token = await h.login(fixture.tenantA.id, doctor2.username);
    nurseToken = await h.login(fixture.tenantA.id, nurse.username);
    tenantBToken = await h.login(fixture.tenantB.id, receptionistB.username);

    await makeFollowUp('Alpha', { daysAgo: 5, due: today, doctorId: d1Id }); // chờ đến hôm nay
    await makeFollowUp('Beta', { daysAgo: 7, due: today, doctorId: d1Id, laterEncounter: { status: 'CHECKED_IN', when: at(today, '08:00') } }); // đã đến hôm nay
    await makeFollowUp('Gamma', { daysAgo: 20, due: ago(3), doctorId: d2Id }); // quá hạn
    await makeFollowUp('Delta', { daysAgo: 20, due: ago(3), doctorId: d2Id, laterEncounter: { status: 'COMPLETED', when: at(ago(2), '09:00') } }); // đã quay lại → không quá hạn
    await makeFollowUp('Epsilon', { daysAgo: 3, due: ahead(3), doctorId: d1Id }); // sắp tới
    await makeFollowUp('Zeta', { daysAgo: 3, due: ahead(10), doctorId: d1Id }); // xa hơn 7 ngày → chỉ "Tất cả"
    await makeFollowUp('Eta', { daysAgo: 50, due: ago(40), doctorId: d2Id }); // quá 30 ngày → chỉ "Tất cả"
    await makeFollowUp('Theta', { daysAgo: 5, due: today, doctorId: d1Id, signed: false }); // chưa ký → loại
    await makeFollowUp('Iota', { daysAgo: 5, due: today, doctorId: d1Id }); // sẽ bị ghi "không tái khám" → loại
    await makeFollowUp('Kappa', { daysAgo: 5, due: today, doctorId: d1Id, branchId: branchB }); // chi nhánh B → loại
    await privileged.followUpReminder.create({ data: { tenantId: fixture.tenantA.id, encounterId: enc.Iota!, result: 'NOT_RETURNING', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });

    // Chẩn đoán chính của Alpha (để kiểm quyền xem nội dung lâm sàng).
    const icd = await privileged.icd10Catalog.findFirstOrThrow();
    await privileged.diagnosis.create({ data: { tenantId: fixture.tenantA.id, encounterId: enc.Alpha!, icd10Code: icd.code, type: 'PRIMARY', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    (globalThis as { __fuIcdName?: string }).__fuIcdName = icd.nameVi;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('chưa đăng nhập → 401; lễ tân, quản trị, bác sĩ → 200; điều dưỡng (không có follow_up.read) → 403', async () => {
      expect((await http().get('/api/v1/follow-ups')).status).toBe(401);
      for (const t of [receptionistToken, adminToken, doctor1Token]) expect((await list(t)).status).toBe(200);
      expect((await list(nurseToken)).status).toBe(403);
    });

    it('chỉ lễ tân và quản trị ghi được lần nhắc; bác sĩ → 403', async () => {
      const body = { result: 'REACHED' };
      expect((await http().post(`/api/v1/follow-ups/${enc.Alpha}/reminders`).send(body).set(authed(doctor1Token))).status).toBe(403);
      expect((await http().post(`/api/v1/follow-ups/${enc.Alpha}/reminders`).send(body)).status).toBe(401);
    });
  });

  describe('tab và trạng thái (lễ tân)', () => {
    it('số từng tab: hôm nay 2 (kể cả đã đến), quá hạn 1, sắp tới 1 — không tính chưa ký, "không tái khám", chi nhánh B, ngoài cửa sổ', async () => {
      const res = await list(receptionistToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.counts).toEqual({ today: 2, overdue: 1, upcoming: 1 });
    });

    it('tab hôm nay: Alpha chờ đến, Beta đã đến', async () => {
      const res = await list(receptionistToken, { tab: 'today' });
      const byName = Object.fromEntries(res.body.data.items.map((i: { patientName: string; status: string }) => [i.patientName.replace('Bệnh nhân Hẹn ', ''), i.status]));
      expect(byName).toEqual({ Alpha: 'DUE_TODAY', Beta: 'ARRIVED' });
    });

    it('tab quá hạn: chỉ Gamma (Delta đã quay lại, Eta quá 30 ngày); tab sắp tới: chỉ Epsilon (Zeta xa hơn 7 ngày)', async () => {
      expect(names(await list(receptionistToken, { tab: 'overdue' }))).toEqual(['Gamma']);
      expect((await list(receptionistToken, { tab: 'overdue' })).body.data.items[0].status).toBe('OVERDUE');
      expect(names(await list(receptionistToken, { tab: 'upcoming' }))).toEqual(['Epsilon']);
      expect((await list(receptionistToken, { tab: 'upcoming' })).body.data.items[0].status).toBe('UPCOMING');
    });

    it('tab tất cả: 7 hẹn, mới nhất trước; có hẹn đã quay lại và ngoài cửa sổ', async () => {
      const res = await list(receptionistToken, { tab: 'all' });
      expect(res.body.data.items).toHaveLength(7);
      const dates = res.body.data.items.map((i: { followUpDate: string }) => i.followUpDate);
      expect(dates).toEqual([...dates].sort().reverse());
      expect(names(res)).toEqual(expect.arrayContaining(['Zeta', 'Epsilon', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Eta']));
      expect(res.body.data.items.find((i: { patientName: string }) => i.patientName.endsWith('Delta')).status).toBe('ARRIVED');
    });

    it('mỗi dòng có đủ thông tin: mã BN, SĐT, ngày khám gốc, bác sĩ', async () => {
      const item = (await list(receptionistToken, { tab: 'today' })).body.data.items.find((i: { patientName: string }) => i.patientName.endsWith('Alpha'));
      expect(item).toMatchObject({ encounterId: enc.Alpha, sourceDate: ago(5), doctorId: d1Id, reminderCount: 0, lastReminder: null });
      expect(item.patientCode).toMatch(/^BN-FU-Alpha-/);
      expect(item.phone).toMatch(/^09\d{8}$/);
      expect(typeof item.doctorName).toBe('string');
    });
  });

  describe('tìm kiếm, lọc, phân trang', () => {
    it('tìm theo tên không dấu, theo mã BN và theo số điện thoại', async () => {
      expect(names(await list(receptionistToken, { tab: 'all', q: 'alpha' }))).toEqual(['Alpha']);
      expect(names(await list(receptionistToken, { tab: 'all', q: 'BN-FU-Beta' }))).toEqual(['Beta']);
      const phone = (await list(receptionistToken, { tab: 'all', q: 'gamma' })).body.data.items[0].phone as string;
      expect(names(await list(receptionistToken, { tab: 'all', q: phone }))).toEqual(['Gamma']);
      expect(names(await list(receptionistToken, { tab: 'all', q: 'khong-co-ai' }))).toEqual([]);
    });

    it('lọc theo bác sĩ; số tab cũng theo bộ lọc', async () => {
      const res = await list(receptionistToken, { tab: 'all', doctorId: d2Id });
      expect(names(res).sort()).toEqual(['Delta', 'Eta', 'Gamma']);
      expect(res.body.data.counts).toEqual({ today: 0, overdue: 1, upcoming: 0 });
    });

    it('phân trang theo con trỏ: không trùng, không sót; con trỏ sai → 400', async () => {
      const first = await list(receptionistToken, { tab: 'all', limit: 3 });
      expect(first.body.data.items).toHaveLength(3);
      expect(first.body.data.nextCursor).toBeTruthy();
      const second = await list(receptionistToken, { tab: 'all', limit: 3, cursor: first.body.data.nextCursor });
      const third = await list(receptionistToken, { tab: 'all', limit: 3, cursor: second.body.data.nextCursor });
      const all = [...names(first), ...names(second), ...names(third)];
      expect(all).toHaveLength(7);
      expect(new Set(all).size).toBe(7);
      expect(third.body.data.nextCursor).toBeNull();
      expect((await list(receptionistToken, { tab: 'all', cursor: 'khong-phai-con-tro' })).status).toBe(400);
    });
  });

  describe('phạm vi bác sĩ (personal) và quyền xem nội dung lâm sàng', () => {
    it('bác sĩ 1 chỉ thấy hẹn của lượt khám do mình khám; bác sĩ 2 chỉ thấy phần của mình', async () => {
      const r1 = await list(doctor1Token);
      expect(r1.body.data.counts).toEqual({ today: 2, overdue: 0, upcoming: 1 });
      expect(names(await list(doctor1Token, { tab: 'all' })).sort()).toEqual(['Alpha', 'Beta', 'Epsilon', 'Zeta']);
      const r2 = await list(doctor2Token);
      expect(r2.body.data.counts).toEqual({ today: 0, overdue: 1, upcoming: 0 });
    });

    it('chẩn đoán chính chỉ gửi cho người có encounter.read_clinical (bác sĩ, quản trị); lễ tân nhận null', async () => {
      const icdName = (globalThis as { __fuIcdName?: string }).__fuIcdName;
      const pick = (res: { body: { data: { items: Array<{ patientName: string; diagnosisName: string | null }> } } }) => res.body.data.items.find((i) => i.patientName.endsWith('Alpha'))!.diagnosisName;
      expect(pick(await list(receptionistToken, { tab: 'today' }))).toBeNull();
      expect(pick(await list(doctor1Token, { tab: 'today' }))).toBe(icdName);
      expect(pick(await list(adminToken, { tab: 'today' }))).toBe(icdName);
    });
  });

  describe('nhật ký nhắc', () => {
    it('ghi lần nhắc: thấy trong lịch sử (người ghi, thời điểm do máy chủ), số lần và lần gần nhất ở danh sách; có audit không chứa ghi chú', async () => {
      const post = (result: string, note?: string) => http().post(`/api/v1/follow-ups/${enc.Alpha}/reminders`).send({ result, note }).set(authed(receptionistToken));
      const a = await post('NO_ANSWER', 'Gọi 2 lần không bắt máy');
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      const b = await post('REACHED');
      expect(b.status).toBe(200);

      const history = await http().get(`/api/v1/follow-ups/${enc.Alpha}/reminders`).set(authed(receptionistToken));
      expect(history.status).toBe(200);
      expect(history.body.data.items).toHaveLength(2);
      expect(history.body.data.items.map((i: { result: string }) => i.result)).toEqual(['REACHED', 'NO_ANSWER']);
      expect(history.body.data.items[1]).toMatchObject({ note: 'Gọi 2 lần không bắt máy' });
      expect(history.body.data.items[0].byName.length).toBeGreaterThan(0);

      const item = (await list(receptionistToken, { tab: 'today' })).body.data.items.find((i: { patientName: string }) => i.patientName.endsWith('Alpha'));
      expect(item.reminderCount).toBe(2);
      expect(item.lastReminder).toMatchObject({ result: 'REACHED' });

      const audits = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'follow_up_reminder.created' } });
      expect(audits.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audits.map((x) => x.afterJson))).not.toContain('bắt máy');
    });

    it('kết quả "Bệnh nhân không tái khám" làm hẹn biến khỏi mọi tab và khỏi số đếm', async () => {
      const before = (await list(receptionistToken)).body.data.counts;
      const res = await http().post(`/api/v1/follow-ups/${enc.Epsilon}/reminders`).send({ result: 'NOT_RETURNING' }).set(authed(receptionistToken));
      expect(res.status).toBe(200);
      expect((await list(receptionistToken)).body.data.counts).toEqual({ ...before, upcoming: before.upcoming - 1 });
      expect(names(await list(receptionistToken, { tab: 'all' }))).not.toContain('Epsilon');
    });

    it('dữ liệu sai → 400; lượt khám không có hẹn / chi nhánh khác / ngoài phạm vi bác sĩ / công ty khác → 404', async () => {
      const post = (id: string, token: string, body: object = { result: 'REACHED' }) => http().post(`/api/v1/follow-ups/${id}/reminders`).send(body).set(authed(token));
      expect((await post(enc.Gamma!, receptionistToken, { result: 'KHONG_HOP_LE' })).status).toBe(400);
      expect((await post(enc.Gamma!, receptionistToken, { result: 'REACHED', note: 'x'.repeat(1001) })).status).toBe(400);
      expect((await post(enc.Theta!, receptionistToken)).status).toBe(404); // chưa ký
      expect((await post(enc.Kappa!, receptionistToken)).status).toBe(404); // chi nhánh B
      expect((await post(randomUUID(), receptionistToken)).status).toBe(404);
      expect((await post(enc.Gamma!, tenantBToken)).status).toBe(404); // công ty khác
      expect((await http().get(`/api/v1/follow-ups/${enc.Alpha}/reminders`).set(authed(doctor2Token))).status).toBe(404); // bác sĩ 2 không được xem hẹn của bác sĩ 1
      expect((await http().get(`/api/v1/follow-ups/${enc.Alpha}/reminders`).set(authed(doctor1Token))).status).toBe(200);
    });
  });

  describe('xuất Excel', () => {
    it('xuất đúng bộ lọc: 200, đúng loại tệp, có nội dung; chưa đăng nhập → 401; điều dưỡng → 403; ghi audit', async () => {
      const res = await http().get('/api/v1/follow-ups/export').query({ tab: 'all' }).set(authed(receptionistToken)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect((res.body as Buffer).length).toBeGreaterThan(1000);
      expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      expect((await http().get('/api/v1/follow-ups/export')).status).toBe(401);
      expect((await http().get('/api/v1/follow-ups/export').set(authed(nurseToken))).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'follow_up.exported' } })).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cô lập công ty và khớp Tổng quan lễ tân', () => {
    it('lễ tân công ty khác thấy danh sách rỗng', async () => {
      const res = await list(tenantBToken, { tab: 'all' });
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.counts).toEqual({ today: 0, overdue: 0, upcoming: 0 });
    });

    it('số "hẹn hôm nay" và "quá hạn chưa đến" trên Tổng quan lễ tân khớp số tab của trang này', async () => {
      const counts = (await list(receptionistToken)).body.data.counts;
      const dash = await http().get('/api/v1/reports/dashboard/reception').set(authed(receptionistToken));
      expect(dash.status).toBe(200);
      expect(dash.body.data.followUp.dueToday).toBe(counts.today);
      expect(dash.body.data.followUp.overdueNotArrived).toBe(counts.overdue);
    });
  });

  describe('công tắc "Dùng Hẹn tái khám" (followUpEnabled)', () => {
    const setEnabled = (token: string, enabled: boolean) => http().patch('/api/v1/clinic-settings').set(authed(token)).send({ followUpEnabled: enabled });
    const flag = (token: string) => http().get('/api/v1/clinic-settings/follow-up-enabled').set(authed(token));

    it('mặc định BẬT: mọi vai trò (kể cả không có clinic_config.read) đọc được cờ; cài đặt của quản trị trả followUpEnabled = true', async () => {
      for (const t of [receptionistToken, doctor1Token, nurseToken]) {
        const res = await flag(t);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ enabled: true });
      }
      expect((await http().get('/api/v1/clinic-settings').set(authed(adminToken))).body.data.followUpEnabled).toBe(true);
    });

    it('chỉ quản trị bật/tắt được (lễ tân → 403); chưa đăng nhập → 401', async () => {
      expect((await setEnabled(receptionistToken, false)).status).toBe(403);
      expect((await http().get('/api/v1/clinic-settings/follow-up-enabled')).status).toBe(401);
      expect((await flag(receptionistToken)).body.data.enabled).toBe(true);
    });

    it('TẮT: cả 4 API của trang bị từ chối 409 FOLLOW_UP_DISABLED, API khác vẫn chạy, công ty khác không bị ảnh hưởng; BẬT lại thì dùng được', async () => {
      const remindersBefore = await privileged.followUpReminder.count({ where: { tenantId: fixture.tenantA.id, encounterId: enc.Alpha! } });
      try {
        expect((await setEnabled(adminToken, false)).status).toBe(200);
        expect((await flag(receptionistToken)).body.data).toEqual({ enabled: false });
        expect((await http().get('/api/v1/clinic-settings').set(authed(adminToken))).body.data.followUpEnabled).toBe(false);

        const denied = [
          await list(receptionistToken),
          await http().get(`/api/v1/follow-ups/${enc.Alpha}/reminders`).set(authed(receptionistToken)),
          await http().post(`/api/v1/follow-ups/${enc.Alpha}/reminders`).send({ result: 'REACHED' }).set(authed(receptionistToken)),
          await http().get('/api/v1/follow-ups/export').query({ tab: 'all' }).set(authed(receptionistToken)),
        ];
        for (const res of denied) {
          expect(res.status).toBe(409);
          expect(res.body.error.code).toBe('FOLLOW_UP_DISABLED');
        }
        // Không có lần nhắc nào được ghi khi tắt.
        expect(await privileged.followUpReminder.count({ where: { tenantId: fixture.tenantA.id, encounterId: enc.Alpha! } })).toBe(remindersBefore);
        // Tổng quan lễ tân vẫn tải được (web tự ẩn khối), công ty khác vẫn dùng bình thường.
        expect((await http().get('/api/v1/reports/dashboard/reception').set(authed(receptionistToken))).status).toBe(200);
        expect((await list(tenantBToken, { tab: 'all' })).status).toBe(200);
        expect((await flag(tenantBToken)).body.data.enabled).toBe(true);
      } finally {
        expect((await setEnabled(adminToken, true)).status).toBe(200);
      }
      expect((await list(receptionistToken)).status).toBe(200);
    });
  });
});
