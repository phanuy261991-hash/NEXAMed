import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { addDaysToVietnamDate, getVietnamDateString } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — "Phiên trước chưa đóng thì chưa được khám" + giờ nhắc đóng ca theo ca đã xếp (mockup duyệt 28/10/2026).
 * Mốc áp dụng (`tenant_setting.doctor_shift_close_enforced_from`) được dựng tay cho từng ca để có "ngày cũ" thật.
 */
describe('HTTP e2e — đóng ca ngày trước (doctor-shift-closure)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';
  const today = getVietnamDateString();
  const twoDaysAgo = addDaysToVietnamDate(today, -2);

  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBToken: string;
  let doctorBUserId: string;
  let receptionistToken: string;
  let tenantBDoctorToken: string;
  let tenantBReceptionistToken: string;
  let adminAToken: string;
  let branchAId: string;
  // Chi nhánh thứ 2 CÙNG công ty A (SaaS nhiều chi nhánh): người dùng chỉ được gán chi nhánh B.
  let branchBId: string;
  let doctorBranchBToken: string;
  let doctorBranchBUserId: string;
  let receptionistBranchBToken: string;

  async function createUserWithRole(tenantId: string, roleName: string, onlyBranchId?: string) {
    const username = `e2e-closure-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    if (onlyBranchId) {
      await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId: onlyBranchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function setEnforcedFrom(tenantId: string, date: string) {
    await privileged.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: 'doctor_shift_close_enforced_from' } },
      create: { tenantId, key: 'doctor_shift_close_enforced_from', valueJson: { date }, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      update: { valueJson: { date }, updatedBy: SYSTEM_TEST_ACTOR },
    });
  }

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  /** Check-in một lượt cho `doctorId`, đã thu tiền — trả về encounterId `CHECKED_IN` (cùng khuôn `doctor-availability-http.spec.ts`). */
  async function checkInFreshEncounter(hour: number, doctorId: string, token: string = receptionistToken) {
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(token))
      .send({ doctorId, fullName: 'Khách e2e đóng ca bù', phone: '0911777888', scheduledAt: new Date(Date.UTC(2026, 7, 28, hour, 0, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };
    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: 'Bệnh nhân e2e đóng ca bù', dob: '1990-01-01', gender: 'female', phone: '0933555666', nationalId: randomNationalId() });
    const patient = patientRes.body.data as { id: string };
    const checkInRes = await request(app.getHttpServer())
      .post('/api/v1/reception/check-in')
      .set(authed(token))
      .send({
        appointmentId: appointment.id,
        patientId: patient.id,
        version: appointment.version,
        doctorId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = checkInRes.body.data.id as string;
    await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(token)).send({ method: 'CASH', version: 1 });
    return encounterId;
  }

  function checkInFreshEncounterInBranch(token: string, doctorId: string) {
    return checkInFreshEncounter(11, doctorId, token);
  }

  /** Đếm bản ghi ENDED bằng SQL thô: cột enum Postgres `doctor_availability_status` không lọc được qua Prisma Client (repository cũng dùng SQL thô). */
  async function countEndedRows(tenantId: string, doctorId: string): Promise<number> {
    const rows = await privileged.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM doctor_availability WHERE tenant_id = ${tenantId}::uuid AND doctor_id = ${doctorId}::uuid AND status = 'ENDED'::doctor_availability_status AND deleted_at IS NULL`;
    return Number(rows[0]?.n ?? 0);
  }

  async function closingState(token: string) {
    const res = await request(app.getHttpServer()).get('/api/v1/doctor-availability/me/closing-state').set(authed(token));
    expect(res.status).toBe(200);
    return res.body.data as { pendingDays: Array<{ date: string; calledCount: number; completedCount: number; unprocessedCount: number; shifts: Array<{ startTime: string; endTime: string }> }>; todayClosingTime: string | null; todayClosingSource: string | null };
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

    fixture = await createTwoTenantFixture(privileged, 'Doctor shift closure e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    const doctorB = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorBToken = doctorB.token;
    doctorBUserId = doctorB.userId;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    tenantBDoctorToken = (await createUserWithRole(fixture.tenantB.id, 'doctor')).token;
    tenantBReceptionistToken = (await createUserWithRole(fixture.tenantB.id, 'receptionist')).token;
    branchAId = (await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id } })).id;

    // Chi nhánh B tạo qua HTTP bằng quản trị công ty A (token A cấp TRƯỚC khi có chi nhánh B vẫn là chi nhánh A).
    adminAToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const adminToken = adminAToken;
    const createdBranch = await request(app.getHttpServer()).post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh B e2e đóng ca', address: '1 Lê Lợi', phone: '0283777000' });
    expect(createdBranch.status, JSON.stringify(createdBranch.body)).toBe(200);
    branchBId = createdBranch.body.data.id as string;
    const doctorBranchB = await createUserWithRole(fixture.tenantA.id, 'doctor', branchBId);
    doctorBranchBToken = doctorBranchB.token;
    doctorBranchBUserId = doctorBranchB.userId;
    receptionistBranchBToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist', branchBId)).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('chưa đăng nhập → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/doctor-availability/me/closing-state');
    expect(res.status).toBe(401);
  });

  it('lần đầu hỏi: ghi mốc áp dụng = hôm nay, chưa có ngày nào bị tính; không có ca → giờ nhắc để giao diện dùng giờ đóng cửa', async () => {
    const state = await closingState(doctorAToken);
    expect(state).toEqual({ pendingDays: [], todayClosingTime: null, todayClosingSource: null });
    const setting = await privileged.tenantSetting.findUniqueOrThrow({ where: { tenantId_key: { tenantId: fixture.tenantA.id, key: 'doctor_shift_close_enforced_from' } } });
    expect(setting.valueJson).toEqual({ date: today });
  });

  it('ngày làm việc TRƯỚC mốc áp dụng không bị tính là chưa đóng', async () => {
    await setEnforcedFrom(fixture.tenantA.id, today);
    const oldId = await checkInFreshEncounter(8, doctorAUserId);
    await privileged.encounter.update({ where: { id: oldId }, data: { checkedInAt: new Date(Date.now() - 5 * 86_400_000) } });
    expect((await closingState(doctorAToken)).pendingDays).toEqual([]);
    // Dọn: trả lượt này về hàng chờ để các ca sau bắt đầu sạch.
    await privileged.encounter.update({ where: { id: oldId }, data: { doctorId: null } });
  });

  let oldEncounterId: string;
  let todayEncounterId: string;

  it('có lượt khám dở của ngày cũ (sau mốc) → pendingDays có đúng ngày đó kèm số liệu', async () => {
    await setEnforcedFrom(fixture.tenantA.id, addDaysToVietnamDate(today, -5));
    oldEncounterId = await checkInFreshEncounter(9, doctorAUserId);
    await privileged.encounter.update({ where: { id: oldEncounterId }, data: { checkedInAt: new Date(Date.now() - 2 * 86_400_000) } });
    const state = await closingState(doctorAToken);
    expect(state.pendingDays).toEqual([{ date: twoDaysAgo, calledCount: 0, completedCount: 0, unprocessedCount: 1, shifts: [] }]);
  });

  it('bác sĩ khác (không có dấu hiệu làm việc) không bị ảnh hưởng', async () => {
    expect((await closingState(doctorBToken)).pendingDays).toEqual([]);
  });

  it('còn ngày chưa đóng → "Bắt đầu khám" bị chặn 409 DOCTOR_SHIFT_NOT_CLOSED kèm ngày dd/mm/yyyy', async () => {
    todayEncounterId = await checkInFreshEncounter(10, doctorAUserId);
    const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${todayEncounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCTOR_SHIFT_NOT_CLOSED');
    const [year, month, day] = twoDaysAgo.split('-');
    expect(res.body.error.message).toContain(`${day}/${month}/${year}`);
    const untouched = await privileged.encounter.findUniqueOrThrow({ where: { id: todayEncounterId } });
    expect(untouched.status).toBe('CHECKED_IN');
  });

  it('bác sĩ khác đóng hộ → 404 (scope personal); bác sĩ của công ty khác → 404', async () => {
    const other = await request(app.getHttpServer()).post(`/api/v1/doctor-availability/${doctorAUserId}/close-pending`).set(authed(doctorBToken)).send({});
    expect(other.status).toBe(404);
    const crossTenant = await request(app.getHttpServer()).post(`/api/v1/doctor-availability/${doctorAUserId}/close-pending`).set(authed(tenantBDoctorToken)).send({});
    expect(crossTenant.status).toBe(404);
  });

  it('lễ tân thấy bác sĩ chưa đóng ca trên dải nhắc', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/doctor-availability/pending-closures').set(authed(receptionistToken));
    expect(res.status).toBe(200);
    const item = (res.body.data.items as Array<{ doctorId: string; days: Array<{ date: string }> }>).find((i) => i.doctorId === doctorAUserId);
    expect(item?.days.map((d) => d.date)).toEqual([twoDaysAgo]);
  });

  it('CÔ LẬP CHI NHÁNH: lễ tân/bác sĩ chi nhánh B không thấy và không đóng được ca của bác sĩ chi nhánh A', async () => {
    // Dải nhắc của lễ tân chi nhánh B chỉ liệt kê bác sĩ chi nhánh B — bác sĩ A (đang có ngày chưa đóng) không lộ ra.
    const board = await request(app.getHttpServer()).get('/api/v1/doctor-availability/pending-closures').set(authed(receptionistBranchBToken));
    expect(board.status).toBe(200);
    expect(board.body.data.items).toEqual([]);

    // Bác sĩ chi nhánh B: không bị tính ngày chưa đóng của chi nhánh A.
    expect((await closingState(doctorBranchBToken)).pendingDays).toEqual([]);

    // Lễ tân chi nhánh B "đóng hộ" bác sĩ A: máy chủ tính lại theo chi nhánh B → không có gì để đóng, không ghi gì cho bác sĩ A.
    const attempt = await request(app.getHttpServer()).post(`/api/v1/doctor-availability/${doctorAUserId}/close-pending`).set(authed(receptionistBranchBToken)).send({});
    expect(attempt.status).toBe(200);
    expect(attempt.body.data).toEqual({ closedDates: [], releasedEncounterCount: 0 });
    expect(await countEndedRows(fixture.tenantA.id, doctorAUserId)).toBe(0);
    const stillOpen = await privileged.encounter.findUniqueOrThrow({ where: { id: oldEncounterId } });
    expect(stillOpen.doctorId).toBe(doctorAUserId);

    // Bác sĩ B vẫn bị chặn riêng theo CHI NHÁNH CỦA MÌNH: lượt cũ của chi nhánh B tính cho chi nhánh B, không lan sang A.
    const branchBEncounter = await checkInFreshEncounterInBranch(receptionistBranchBToken, doctorBranchBUserId);
    await privileged.encounter.update({ where: { id: branchBEncounter }, data: { checkedInAt: new Date(Date.now() - 3 * 86_400_000) } });
    const stateB = await closingState(doctorBranchBToken);
    expect(stateB.pendingDays.map((d) => d.date)).toEqual([addDaysToVietnamDate(today, -3)]);
    expect((await closingState(doctorAToken)).pendingDays.map((d) => d.date)).toEqual([twoDaysAgo]);
    await privileged.encounter.update({ where: { id: branchBEncounter }, data: { doctorId: null } });
    await privileged.encounter.update({ where: { id: oldEncounterId }, data: { checkedInAt: new Date(Date.now() - 2 * 86_400_000) } });
  });

  it('CÔ LẬP CÔNG TY (SaaS): công ty B không thấy, không đóng, không đọc tổng hợp của bác sĩ công ty A; mốc áp dụng riêng từng công ty', async () => {
    const board = await request(app.getHttpServer()).get('/api/v1/doctor-availability/pending-closures').set(authed(tenantBReceptionistToken));
    expect(board.status).toBe(200);
    expect(board.body.data.items).toEqual([]);

    const close = await request(app.getHttpServer()).post(`/api/v1/doctor-availability/${doctorAUserId}/close-pending`).set(authed(tenantBReceptionistToken)).send({});
    expect(close.status).toBe(200);
    expect(close.body.data).toEqual({ closedDates: [], releasedEncounterCount: 0 });
    expect(await countEndedRows(fixture.tenantA.id, doctorAUserId)).toBe(0);

    const summary = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorAUserId}/shift-summary?date=${twoDaysAgo}`).set(authed(tenantBReceptionistToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({ doctorName: '', calledCount: 0, completedCount: 0, prescriptionCount: 0 });

    // Mốc áp dụng của công ty B do công ty B tự ghi (hôm nay), không thừa hưởng mốc đã lùi 5 ngày của công ty A.
    expect((await closingState(tenantBDoctorToken)).pendingDays).toEqual([]);
    const settingB = await privileged.tenantSetting.findUniqueOrThrow({ where: { tenantId_key: { tenantId: fixture.tenantB.id, key: 'doctor_shift_close_enforced_from' } } });
    expect(settingB.valueJson).toEqual({ date: today });
  });

  it('lễ tân đóng hộ (kể cả khi chính sách đóng hộ TẮT) → ghi ENDED cho ngày cũ, trả lượt dở của NGÀY CŨ về hàng chờ, KHÔNG đụng lượt hôm nay', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/doctor-availability/${doctorAUserId}/close-pending`)
      .set(authed(receptionistToken))
      .send({ reason: 'Bác sĩ nghỉ ốm, không đóng ca' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ closedDates: [twoDaysAgo], releasedEncounterCount: 1 });

    const old = await privileged.encounter.findUniqueOrThrow({ where: { id: oldEncounterId } });
    expect(old.doctorId).toBeNull();
    expect(old.status).toBe('CHECKED_IN');
    const fresh = await privileged.encounter.findUniqueOrThrow({ where: { id: todayEncounterId } });
    expect(fresh.doctorId).toBe(doctorAUserId);

    const ended = await privileged.doctorAvailability.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, doctorId: doctorAUserId, workDate: new Date(twoDaysAgo) } });
    expect(ended.status).toBe('ENDED');
    expect(ended.reason).toBe('Bác sĩ nghỉ ốm, không đóng ca');
    const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'doctor_availability.ended', entityId: doctorAUserId }, orderBy: { occurredAt: 'desc' } });
    expect(audit?.afterJson).toMatchObject({ workDate: twoDaysAgo, trigger: 'PENDING_CLOSURE', onBehalfOf: true });
  });

  it('đóng xong → hết chặn, bác sĩ bắt đầu khám bình thường; gọi đóng lại là no-op', async () => {
    expect((await closingState(doctorAToken)).pendingDays).toEqual([]);
    const start = await request(app.getHttpServer()).post(`/api/v1/encounters/${todayEncounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });
    expect(start.status).toBe(200);
    const again = await request(app.getHttpServer()).post(`/api/v1/doctor-availability/${doctorAUserId}/close-pending`).set(authed(doctorAToken)).send({});
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ closedDates: [], releasedEncounterCount: 0 });
  });

  it('ca đã xếp (không nghỉ phép) mà chưa đóng → tính; nghỉ phép cả ngày được duyệt → không tính; giờ nhắc hôm nay = giờ kết thúc ca cuối', async () => {
    const yesterday = addDaysToVietnamDate(today, -1);
    const shiftBase = { tenantId: fixture.tenantA.id, color: 'blue', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR };
    const morning = await privileged.workShift.create({ data: { ...shiftBase, name: 'Ca sáng e2e', code: `CS${randomUUID().slice(0, 6)}`, startTime: '07:30', endTime: '11:30' } });
    const afternoon = await privileged.workShift.create({ data: { ...shiftBase, name: 'Ca chiều e2e', code: `CC${randomUUID().slice(0, 6)}`, startTime: '13:30', endTime: '17:30' } });
    const assign = (workShiftId: string, workDate: string) =>
      privileged.workShiftAssignment.create({
        data: { tenantId: fixture.tenantA.id, branchId: branchAId, userId: doctorBUserId, workShiftId, workDate: new Date(workDate), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    await assign(morning.id, yesterday);
    await assign(morning.id, today);
    await assign(afternoon.id, today);

    const withShift = await closingState(doctorBToken);
    expect(withShift.pendingDays.map((d) => d.date)).toEqual([yesterday]);
    expect(withShift.pendingDays[0]!.shifts).toEqual([{ startTime: '07:30', endTime: '11:30' }]);
    expect(withShift.todayClosingTime).toBe('17:30');
    expect(withShift.todayClosingSource).toBe('SHIFT');

    await privileged.leaveRequest.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: branchAId,
        userId: doctorBUserId,
        leaveDate: new Date(yesterday),
        workShiftId: null,
        startMinute: 0,
        endMinute: 1440,
        status: 'APPROVED',
        reason: 'Nghỉ phép e2e',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    expect((await closingState(doctorBToken)).pendingDays).toEqual([]);

    await privileged.leaveRequest.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: branchAId,
        userId: doctorBUserId,
        leaveDate: new Date(today),
        workShiftId: null,
        startMinute: 0,
        endMinute: 1440,
        status: 'APPROVED',
        reason: 'Nghỉ phép hôm nay e2e',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const onLeave = await closingState(doctorBToken);
    expect(onLeave.todayClosingTime).toBeNull();
    expect(onLeave.todayClosingSource).toBe('LEAVE');
  });

  it('công tắc "Nhắc và bắt buộc đóng ca" (Cấu hình khám): mặc định BẬT; TẮT thì không chặn, không dải nhắc, không chip nhắc; BẬT lại thì mốc là ngày bật (không dồn ngày cũ)', async () => {
    const getSettings = () => request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(adminAToken));
    const putSetting = (value: boolean) => request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(adminAToken)).send({ requirePreviousShiftClosed: value });
    expect((await getSettings()).body.data.requirePreviousShiftClosed).toBe(true);
    const fourDaysAgo = addDaysToVietnamDate(today, -4);

    // Có ngày cũ chưa đóng + lượt hôm nay của bác sĩ A.
    await setEnforcedFrom(fixture.tenantA.id, addDaysToVietnamDate(today, -5));
    const oldId = await checkInFreshEncounter(12, doctorAUserId);
    await privileged.encounter.update({ where: { id: oldId }, data: { checkedInAt: new Date(Date.now() - 4 * 86_400_000) } });
    const todayId = await checkInFreshEncounter(13, doctorAUserId);
    expect((await closingState(doctorAToken)).pendingDays.map((d) => d.date)).toEqual([fourDaysAgo]);

    // TẮT: không còn ngày chưa đóng, không dải nhắc, bắt đầu khám được ngay; chưa đụng mốc áp dụng.
    expect((await putSetting(false)).status).toBe(200);
    expect((await getSettings()).body.data.requirePreviousShiftClosed).toBe(false);
    const whenOff = await closingState(doctorAToken);
    expect(whenOff.pendingDays).toEqual([]);
    expect(whenOff.todayClosingSource).toBe('DISABLED'); // cũng tắt chip nhắc đóng ca
    expect(whenOff.todayClosingTime).toBeNull();
    const board = await request(app.getHttpServer()).get('/api/v1/doctor-availability/pending-closures').set(authed(receptionistToken));
    expect(board.body.data.items).toEqual([]);
    const start = await request(app.getHttpServer()).post(`/api/v1/encounters/${todayId}/start`).set(authed(doctorAToken)).send({ version: 1 });
    expect(start.status).toBe(200);

    // Công tắc của công ty A không ảnh hưởng công ty B (SaaS).
    const settingsB = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed((await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token));
    expect(settingsB.body.data.requirePreviousShiftClosed).toBe(true);

    // BẬT lại: mốc áp dụng cũ vẫn là 5 ngày trước (đã dựng tay) nên ngày cũ lại hiện; công tắc chỉ điều khiển việc chặn.
    expect((await putSetting(true)).status).toBe(200);
    expect((await closingState(doctorAToken)).pendingDays.map((d) => d.date)).toEqual([fourDaysAgo]);
    await privileged.encounter.update({ where: { id: oldId }, data: { doctorId: null } });
  });

  it('tổng hợp một NGÀY CŨ: shift-summary?date= nhận ngày hợp lệ, từ chối định dạng sai', async () => {
    const ok = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorAUserId}/shift-summary?date=${twoDaysAgo}`).set(authed(doctorAToken));
    expect(ok.status).toBe(200);
    expect(ok.body.data.doctorId).toBe(doctorAUserId);
    const bad = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorAUserId}/shift-summary?date=hom-qua`).set(authed(doctorAToken));
    expect(bad.status).toBe(400);
  });
});
