import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getVietnamDateString } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/** Ngày lịch VN cách hôm nay `n` ngày (n>=0) — đơn nghỉ chỉ nhận từ hôm nay trở đi. */
function dateAhead(n: number): string {
  const d = new Date(`${getVietnamDateString()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `HH:mm` giờ VN của ngày `date` → ISO UTC (VN = UTC+7). */
function vnTime(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00+07:00`).toISOString();
}

/**
 * HTTP e2e — "Đơn xin nghỉ" (#224): xin/ghi hộ/duyệt/từ chối/rút/huỷ, quy tắc ngày + ca + chồng lấn,
 * phân quyền personal/global, cách ly tenant, và tác động lên Lịch hẹn (chặn đặt/sửa/dời khi đã
 * duyệt, đơn chờ duyệt không chặn, cờ `doctorOnLeave`, `leaveByDoctorId`).
 */
describe('HTTP e2e — đơn xin nghỉ', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let adminUserId: string;
  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBToken: string;
  let doctorBUserId: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let morningId: string;
  let afternoonId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id, token: login.body.data.accessToken as string };
  }

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const api = () => request(app.getHttpServer());

  async function registerShift(userId: string, workShiftId: string, workDate: string) {
    const res = await api().post('/api/v1/work-shift-assignments').set(authed(adminToken)).send({ userId, workShiftId, workDate });
    expect(res.status).toBe(200);
  }

  function requestLeave(token: string, leaveDate: string, workShiftId: string | null, reason = 'Việc gia đình') {
    return api().post('/api/v1/leave-requests').set(authed(token)).send({ leaveDate, workShiftId, reason });
  }

  function book(doctorId: string, scheduledAt: string) {
    return api()
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId, fullName: 'Khách kiểm thử', phone: '0900000000', scheduledAt, durationMinutes: 15, source: 'phone' });
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

    fixture = await createTwoTenantFixture(privileged, 'LeaveRequest e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    const admin = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    adminToken = admin.token;
    adminUserId = admin.userId;
    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    const doctorB = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorBToken = doctorB.token;
    doctorBUserId = doctorB.userId;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    const morning = await api().post('/api/v1/work-shifts').set(authed(adminToken)).send({ name: 'Ca Sáng', startTime: '07:00', endTime: '11:00', color: 'blue' });
    morningId = morning.body.data.id;
    const afternoon = await api().post('/api/v1/work-shifts').set(authed(adminToken)).send({ name: 'Ca Chiều', startTime: '13:00', endTime: '17:00', color: 'teal' });
    afternoonId = afternoon.body.data.id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('quy tắc nhập', () => {
    const d = dateAhead(3);

    it('bác sĩ xin nghỉ ca sáng → PENDING, khung nghỉ = giờ của ca, tự rút được', async () => {
      await registerShift(doctorAUserId, morningId, d);
      await registerShift(doctorAUserId, afternoonId, d);
      const res = await requestLeave(doctorAToken, d, morningId);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        userId: doctorAUserId,
        leaveDate: d,
        workShiftName: 'Ca Sáng',
        startMinute: 420,
        endMinute: 660,
        isWholeDay: false,
        status: 'PENDING',
        filedOnBehalf: false,
        canWithdraw: true,
      });
    });

    it('ngày quá khứ → 422; ngày chưa đăng ký ca → 422; ca không nằm trong đăng ký → 422; thiếu lý do → 400', async () => {
      const past = await requestLeave(doctorAToken, dateAhead(-1), morningId);
      expect(past.status).toBe(422);
      expect(past.body.error.code).toBe('LEAVE_REQUEST_PAST_DATE');

      const noShiftDay = await requestLeave(doctorAToken, dateAhead(40), morningId);
      expect(noShiftDay.status).toBe(422);
      expect(noShiftDay.body.error.code).toBe('LEAVE_REQUEST_NO_SHIFT');

      const d2 = dateAhead(4);
      await registerShift(doctorAUserId, morningId, d2);
      const wrongShift = await requestLeave(doctorAToken, d2, afternoonId);
      expect(wrongShift.status).toBe(422);
      expect(wrongShift.body.error.code).toBe('LEAVE_REQUEST_NO_SHIFT');

      const noReason = await api().post('/api/v1/leave-requests').set(authed(doctorAToken)).send({ leaveDate: d2, workShiftId: morningId, reason: '  ' });
      expect(noReason.status).toBe(400);
    });

    it('đơn trùng/chồng khung giờ → 409; ca khác trong ngày vẫn xin được', async () => {
      const dup = await requestLeave(doctorAToken, d, morningId);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('LEAVE_REQUEST_OVERLAP');

      const wholeDay = await requestLeave(doctorAToken, d, null);
      expect(wholeDay.status).toBe(409);
      expect(wholeDay.body.error.code).toBe('LEAVE_REQUEST_OVERLAP');

      const afternoon = await requestLeave(doctorAToken, d, afternoonId);
      expect(afternoon.status).toBe(200);
    });

    it('cả ngày: khung 0–1440, cần ≥1 ca đăng ký', async () => {
      const d5 = dateAhead(5);
      await registerShift(doctorBUserId, morningId, d5);
      const res = await requestLeave(doctorBToken, d5, null);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ isWholeDay: true, workShiftId: null, workShiftName: null, startMinute: 0, endMinute: 1440 });
    });
  });

  describe('duyệt / từ chối / rút / huỷ', () => {
    it('người không có quyền duyệt → 403; admin không tự duyệt đơn của chính mình → 403 SELF_APPROVE', async () => {
      const d = dateAhead(6);
      await registerShift(doctorAUserId, morningId, d);
      const created = await requestLeave(doctorAToken, d, morningId);
      const { id, version } = created.body.data;

      const denied = await api().post(`/api/v1/leave-requests/${id}/approve`).set(authed(doctorBToken)).send({ version });
      expect(denied.status).toBe(403);

      await registerShift(adminUserId, morningId, d);
      const own = await requestLeave(adminToken, d, morningId);
      const self = await api().post(`/api/v1/leave-requests/${own.body.data.id}/approve`).set(authed(adminToken)).send({ version: own.body.data.version });
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('LEAVE_REQUEST_SELF_APPROVE');
    });

    it('từ chối bắt buộc lý do; sau khi từ chối xin lại được', async () => {
      const d = dateAhead(7);
      await registerShift(doctorAUserId, morningId, d);
      const created = await requestLeave(doctorAToken, d, morningId);
      const { id, version } = created.body.data;

      const noReason = await api().post(`/api/v1/leave-requests/${id}/reject`).set(authed(adminToken)).send({ version, reason: '' });
      expect(noReason.status).toBe(400);

      const rejected = await api().post(`/api/v1/leave-requests/${id}/reject`).set(authed(adminToken)).send({ version, reason: 'Thiếu bác sĩ trực' });
      expect(rejected.status).toBe(200);
      expect(rejected.body.data).toMatchObject({ status: 'REJECTED', decisionReason: 'Thiếu bác sĩ trực' });
      expect(rejected.body.data.decidedByName).toBeTruthy();

      const again = await requestLeave(doctorAToken, d, morningId);
      expect(again.status).toBe(200);
    });

    it('rút đơn: chỉ người gửi, chỉ khi chờ duyệt', async () => {
      const d = dateAhead(8);
      await registerShift(doctorAUserId, morningId, d);
      const created = await requestLeave(doctorAToken, d, morningId);
      const { id, version } = created.body.data;

      const notOwner = await api().post(`/api/v1/leave-requests/${id}/withdraw`).set(authed(doctorBToken)).send({ version });
      expect(notOwner.status).toBe(403);
      expect(notOwner.body.error.code).toBe('LEAVE_REQUEST_NOT_OWNER');

      const ok = await api().post(`/api/v1/leave-requests/${id}/withdraw`).set(authed(doctorAToken)).send({ version });
      expect(ok.status).toBe(200);
      expect(ok.body.data.status).toBe('WITHDRAWN');

      const twice = await api().post(`/api/v1/leave-requests/${id}/withdraw`).set(authed(doctorAToken)).send({ version: version + 1 });
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('LEAVE_REQUEST_INVALID_STATUS');
    });

    it('version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const d = dateAhead(9);
      await registerShift(doctorAUserId, morningId, d);
      const created = await requestLeave(doctorAToken, d, morningId);
      const stale = await api().post(`/api/v1/leave-requests/${created.body.data.id}/approve`).set(authed(adminToken)).send({ version: created.body.data.version + 5 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('ghi nghỉ hộ: duyệt luôn, cần quyền riêng', async () => {
      const d = dateAhead(10);
      await registerShift(doctorBUserId, morningId, d);
      const denied = await api().post('/api/v1/leave-requests/on-behalf').set(authed(doctorAToken)).send({ userId: doctorBUserId, leaveDate: d, workShiftId: morningId, reason: 'Ốm' });
      expect(denied.status).toBe(403);

      const ok = await api().post('/api/v1/leave-requests/on-behalf').set(authed(adminToken)).send({ userId: doctorBUserId, leaveDate: d, workShiftId: morningId, reason: 'Ốm' });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ userId: doctorBUserId, status: 'APPROVED', filedOnBehalf: true });
    });
  });

  describe('phạm vi xem + chấm số', () => {
    it('personal chỉ thấy đơn của mình (bỏ qua userId), global thấy cả phòng khám', async () => {
      const own = await api().get('/api/v1/leave-requests').query({ userId: doctorBUserId }).set(authed(doctorAToken));
      expect(own.status).toBe(200);
      expect(own.body.data.items.length).toBeGreaterThan(0);
      expect(own.body.data.items.every((i: { userId: string }) => i.userId === doctorAUserId)).toBe(true);

      const all = await api().get('/api/v1/leave-requests').set(authed(adminToken));
      const userIds = new Set(all.body.data.items.map((i: { userId: string }) => i.userId));
      expect(userIds.has(doctorAUserId)).toBe(true);
      expect(userIds.has(doctorBUserId)).toBe(true);
    });

    it('lọc theo trạng thái; pending-count chỉ cho người duyệt', async () => {
      const pending = await api().get('/api/v1/leave-requests').query({ status: 'PENDING' }).set(authed(adminToken));
      expect(pending.body.data.items.every((i: { status: string }) => i.status === 'PENDING')).toBe(true);

      const count = await api().get('/api/v1/leave-requests/pending-count').set(authed(adminToken));
      expect(count.status).toBe(200);
      expect(count.body.data.count).toBe(pending.body.data.items.length);

      const denied = await api().get('/api/v1/leave-requests/pending-count').set(authed(doctorAToken));
      expect(denied.status).toBe(403);
    });

    it('cách ly tenant: admin tenant khác không thấy lịch hẹn bị ảnh hưởng của đơn tenant này → 404', async () => {
      const list = await api().get('/api/v1/leave-requests').set(authed(adminToken));
      const id = list.body.data.items[0].id;
      const res = await api().get(`/api/v1/leave-requests/${id}/affected-appointments`).set(authed(tenantBAdminToken));
      expect(res.status).toBe(404);
      const listB = await api().get('/api/v1/leave-requests').set(authed(tenantBAdminToken));
      expect(listB.body.data.items).toHaveLength(0);
    });
  });

  describe('tác động lên Lịch hẹn', () => {
    const d = dateAhead(12);
    let morningLeave: { id: string; version: number };
    let earlyAppointmentId: string;
    let earlyAppointmentVersion: number;

    it('đơn CHỜ duyệt không chặn đặt lịch; lịch đặt sẵn chưa bị đánh dấu', async () => {
      await registerShift(doctorAUserId, morningId, d);
      await registerShift(doctorAUserId, afternoonId, d);
      const early = await book(doctorAUserId, vnTime(d, '08:00'));
      expect(early.status).toBe(200);
      earlyAppointmentId = early.body.data.id;
      earlyAppointmentVersion = early.body.data.version;

      const created = await requestLeave(doctorAToken, d, morningId);
      morningLeave = { id: created.body.data.id, version: created.body.data.version };

      const stillBookable = await book(doctorAUserId, vnTime(d, '09:00'));
      expect(stillBookable.status).toBe(200);

      const shifts = await api().get('/api/v1/appointments/doctor-work-shifts').query({ date: d }).set(authed(receptionistToken));
      expect(shifts.body.data.leaveByDoctorId[doctorAUserId]).toEqual([
        { status: 'PENDING', startMinute: 420, endMinute: 660, isWholeDay: false, workShiftName: 'Ca Sáng' },
      ]);

      const list = await api().get('/api/v1/appointments').query({ date: d }).set(authed(receptionistToken));
      expect(list.body.data.items.every((a: { doctorOnLeave?: boolean }) => a.doctorOnLeave === false)).toBe(true);
    });

    it('duyệt đơn → hiện 2 lịch hẹn bị ảnh hưởng; đặt MỚI vào khung nghỉ bị chặn, ngoài khung vẫn đặt được', async () => {
      const impactBefore = await api().get(`/api/v1/leave-requests/${morningLeave.id}/affected-appointments`).set(authed(adminToken));
      expect(impactBefore.body.data.items).toHaveLength(2);

      const approved = await api().post(`/api/v1/leave-requests/${morningLeave.id}/approve`).set(authed(adminToken)).send({ version: morningLeave.version });
      expect(approved.status).toBe(200);
      expect(approved.body.data).toMatchObject({ status: 'APPROVED', affectedAppointmentCount: 2 });
      morningLeave.version = approved.body.data.version;

      const blocked = await book(doctorAUserId, vnTime(d, '09:30'));
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('APPOINTMENT_DOCTOR_ON_LEAVE');

      const outside = await book(doctorAUserId, vnTime(d, '14:00'));
      expect(outside.status).toBe(200);

      // Lịch chồng lấn mép khung (10:55 + 15 phút lấn qua 11:00) cũng bị chặn; đúng 11:00 thì không.
      const edge = await book(doctorAUserId, vnTime(d, '10:50'));
      expect(edge.status).toBe(409);
      const justAfter = await book(doctorAUserId, vnTime(d, '11:00'));
      expect(justAfter.status).toBe(200);
    });

    it('lịch đã có trong khung nghỉ đã duyệt được đánh dấu doctorOnLeave; ngoài khung thì không', async () => {
      const list = await api().get('/api/v1/appointments').query({ date: d }).set(authed(receptionistToken));
      const byHour = new Map<string, boolean | undefined>(
        list.body.data.items.map((a: { scheduledAt: string; doctorOnLeave?: boolean }) => [a.scheduledAt, a.doctorOnLeave]),
      );
      expect(byHour.get(vnTime(d, '08:00'))).toBe(true);
      expect(byHour.get(vnTime(d, '09:00'))).toBe(true);
      expect(byHour.get(vnTime(d, '14:00'))).toBe(false);
      expect(byHour.get(vnTime(d, '11:00'))).toBe(false);

      const shifts = await api().get('/api/v1/appointments/doctor-work-shifts').query({ date: d }).set(authed(receptionistToken));
      expect(shifts.body.data.leaveByDoctorId[doctorAUserId][0].status).toBe('APPROVED');
    });

    it('xử lý bằng chức năng có sẵn: sửa vẫn trong khung nghỉ bị chặn, dời sang bác sĩ khác được', async () => {
      const edit = await api()
        .patch(`/api/v1/appointments/${earlyAppointmentId}`)
        .set(authed(receptionistToken))
        .send({ doctorId: doctorAUserId, scheduledAt: vnTime(d, '10:00'), durationMinutes: 15, version: earlyAppointmentVersion });
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('APPOINTMENT_DOCTOR_ON_LEAVE');

      const moved = await api()
        .post(`/api/v1/appointments/${earlyAppointmentId}/reschedule`)
        .set(authed(receptionistToken))
        .send({ doctorId: doctorBUserId, scheduledAt: vnTime(d, '08:00'), version: earlyAppointmentVersion });
      expect(moved.status).toBe(200);

      const impact = await api().get(`/api/v1/leave-requests/${morningLeave.id}/affected-appointments`).set(authed(adminToken));
      expect(impact.body.data.items).toHaveLength(1);
    });

    it('my-impact: bác sĩ thấy số lịch hẹn của mình trong khung sắp nghỉ', async () => {
      const res = await api().get('/api/v1/leave-requests/my-impact').query({ leaveDate: d, workShiftId: morningId }).set(authed(doctorAToken));
      expect(res.status).toBe(200);
      expect(res.body.data.affectedAppointmentCount).toBe(1);
    });

    it('huỷ đơn đã duyệt (bắt buộc lý do) → khung mở lại, đặt lịch được bình thường', async () => {
      const noReason = await api().post(`/api/v1/leave-requests/${morningLeave.id}/cancel`).set(authed(adminToken)).send({ version: morningLeave.version, reason: '' });
      expect(noReason.status).toBe(400);

      const cancelled = await api().post(`/api/v1/leave-requests/${morningLeave.id}/cancel`).set(authed(adminToken)).send({ version: morningLeave.version, reason: 'Bác sĩ đi làm lại' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', decisionReason: 'Bác sĩ đi làm lại' });

      const reopened = await book(doctorAUserId, vnTime(d, '09:30'));
      expect(reopened.status).toBe(200);

      const again = await api().post(`/api/v1/leave-requests/${morningLeave.id}/cancel`).set(authed(adminToken)).send({ version: cancelled.body.data.version, reason: 'x' });
      expect(again.status).toBe(409);
    });
  });
});
