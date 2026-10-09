import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — "Duyệt đăng ký ca theo tháng" (#225): nhân viên đăng ký tháng sau ở Nháp, gửi duyệt cả tháng, quản lý
 * duyệt/trả lại; ca bị khoá khi đã gửi/duyệt. Đồng hồ giả (chỉ `Date`) ghim giữa tháng 8/2026 → tháng 9 = "tháng sau".
 */
describe('HTTP e2e — duyệt đăng ký ca theo tháng', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBToken: string;
  let doctorBUserId: string;
  let tenantBAdminToken: string;
  let morningId: string;
  let afternoonId: string;
  let submissionId: string;
  let submissionVersion: number;

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
  const register = (token: string, workShiftId: string, workDate: string) =>
    api().post('/api/v1/work-shift-assignments').set(authed(token)).send({ workShiftId, workDate });

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-15T03:00:00Z') });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'ScheduleSubmission e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const dA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = dA.token;
    doctorAUserId = dA.userId;
    const dB = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorBToken = dB.token;
    doctorBUserId = dB.userId;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    const morning = await api().post('/api/v1/work-shifts').set(authed(adminToken)).send({ name: 'Ca Sáng', startTime: '07:00', endTime: '11:00', color: 'blue' });
    morningId = morning.body.data.id;
    const afternoon = await api().post('/api/v1/work-shifts').set(authed(adminToken)).send({ name: 'Ca Chiều', startTime: '13:00', endTime: '17:00', color: 'teal' });
    afternoonId = afternoon.body.data.id;
  });

  afterAll(async () => {
    vi.useRealTimers();
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('chưa đăng ký ca nào → gửi duyệt 422 SCHEDULE_SUBMISSION_EMPTY; tháng hiện tại → 409 MONTH_NOT_OPEN', async () => {
    const empty = await api().post('/api/v1/work-shift-assignments/submissions/submit').set(authed(doctorAToken)).send({ month: '2026-09' });
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe('SCHEDULE_SUBMISSION_EMPTY');

    const current = await api().post('/api/v1/work-shift-assignments/submissions/submit').set(authed(doctorAToken)).send({ month: '2026-08' });
    expect(current.status).toBe(409);
    expect(current.body.error.code).toBe('WORK_SHIFT_ASSIGNMENT_MONTH_NOT_OPEN');
  });

  it('nhân viên đăng ký tháng sau (Nháp) rồi Gửi duyệt cả tháng → SUBMITTED, đếm đúng số ca/giờ', async () => {
    expect((await register(doctorAToken, morningId, '2026-09-10')).status).toBe(200);
    expect((await register(doctorAToken, morningId, '2026-09-11')).status).toBe(200);
    expect((await register(doctorAToken, afternoonId, '2026-09-11')).status).toBe(200);

    const res = await api().post('/api/v1/work-shift-assignments/submissions/submit').set(authed(doctorAToken)).send({ month: '2026-09' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ userId: doctorAUserId, month: '2026-09', status: 'SUBMITTED', shiftCount: 3, totalMinutes: 720, returnReason: null });
    submissionId = res.body.data.id;
    submissionVersion = res.body.data.version;

    const again = await api().post('/api/v1/work-shift-assignments/submissions/submit').set(authed(doctorAToken)).send({ month: '2026-09' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SCHEDULE_SUBMISSION_INVALID_STATUS');
  });

  it('sau khi gửi: nhân viên không thêm/xoá/sao chép được (409 SUBMISSION_LOCKED), canEdit=false; quản lý vẫn xếp được', async () => {
    const add = await register(doctorAToken, afternoonId, '2026-09-12');
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe('WORK_SHIFT_ASSIGNMENT_SUBMISSION_LOCKED');

    const list = await api().get('/api/v1/work-shift-assignments').query({ from: '2026-09-01', to: '2026-09-30' }).set(authed(doctorAToken));
    const items = list.body.data.items as { id: string; canEdit: boolean }[];
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.canEdit === false)).toBe(true);

    const del = await api().delete(`/api/v1/work-shift-assignments/${items[0]!.id}`).set(authed(doctorAToken)).send({ version: 1 });
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('WORK_SHIFT_ASSIGNMENT_SUBMISSION_LOCKED');

    const admin = await api().post('/api/v1/work-shift-assignments').set(authed(adminToken)).send({ workShiftId: afternoonId, workDate: '2026-09-12', userId: doctorAUserId });
    expect(admin.status).toBe(200);
  });

  it('chỉ người có quyền duyệt xem bảng cả phòng; nhân viên chỉ thấy của mình; chấm số chờ duyệt', async () => {
    await register(doctorBToken, morningId, '2026-09-14'); // B chưa gửi → chưa có dòng

    const own = await api().get('/api/v1/work-shift-assignments/submissions').query({ userId: doctorBUserId }).set(authed(doctorAToken));
    expect(own.status).toBe(200);
    expect(own.body.data.items.every((i: { userId: string }) => i.userId === doctorAUserId)).toBe(true);

    const all = await api().get('/api/v1/work-shift-assignments/submissions').query({ month: '2026-09', status: 'SUBMITTED' }).set(authed(adminToken));
    expect(all.body.data.items).toHaveLength(1);
    expect(all.body.data.items[0]).toMatchObject({ id: submissionId, shiftCount: 4 });

    const count = await api().get('/api/v1/work-shift-assignments/submissions/pending-count').set(authed(adminToken));
    expect(count.body.data.count).toBe(1);
    const denied = await api().get('/api/v1/work-shift-assignments/submissions/pending-count').set(authed(doctorAToken));
    expect(denied.status).toBe(403);
  });

  it('nhân viên không duyệt/trả lại được (403); trả lại bắt buộc lý do → về Nháp, nhân viên thấy lý do và sửa lại được', async () => {
    const denied = await api().post(`/api/v1/work-shift-assignments/submissions/${submissionId}/approve`).set(authed(doctorAToken)).send({ version: submissionVersion });
    expect(denied.status).toBe(403);

    const noReason = await api().post(`/api/v1/work-shift-assignments/submissions/${submissionId}/return`).set(authed(adminToken)).send({ version: submissionVersion, reason: ' ' });
    expect(noReason.status).toBe(400);

    const returned = await api()
      .post(`/api/v1/work-shift-assignments/submissions/${submissionId}/return`)
      .set(authed(adminToken))
      .send({ version: submissionVersion, reason: 'Thiếu bác sĩ trực chiều thứ 6' });
    expect(returned.status).toBe(200);
    expect(returned.body.data).toMatchObject({ status: 'DRAFT', returnReason: 'Thiếu bác sĩ trực chiều thứ 6' });

    const mine = await api().get('/api/v1/work-shift-assignments/submissions').query({ month: '2026-09' }).set(authed(doctorAToken));
    expect(mine.body.data.items[0]).toMatchObject({ status: 'DRAFT', returnReason: 'Thiếu bác sĩ trực chiều thứ 6' });

    const returnedFilter = await api().get('/api/v1/work-shift-assignments/submissions').query({ status: 'RETURNED' }).set(authed(adminToken));
    expect(returnedFilter.body.data.items).toHaveLength(1);

    // Về Nháp: tự sửa lại được (ca do chính mình tạo; ca quản lý vừa xếp 12/9 thì không xoá được).
    const list = await api().get('/api/v1/work-shift-assignments').query({ from: '2026-09-10', to: '2026-09-10' }).set(authed(doctorAToken));
    const own10 = list.body.data.items[0] as { id: string; canEdit: boolean };
    expect(own10.canEdit).toBe(true);
    const del = await api().delete(`/api/v1/work-shift-assignments/${own10.id}`).set(authed(doctorAToken)).send({ version: 1 });
    expect(del.status).toBe(200);
    expect((await register(doctorAToken, morningId, '2026-09-15')).status).toBe(200);
  });

  it('gửi lại → xoá lý do trả lại; duyệt → APPROVED, ghi người duyệt; duyệt/gửi lại khi đã duyệt → 409; sau duyệt vẫn khoá', async () => {
    const resubmit = await api().post('/api/v1/work-shift-assignments/submissions/submit').set(authed(doctorAToken)).send({ month: '2026-09' });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data).toMatchObject({ status: 'SUBMITTED', returnReason: null });

    const approved = await api()
      .post(`/api/v1/work-shift-assignments/submissions/${submissionId}/approve`)
      .set(authed(adminToken))
      .send({ version: resubmit.body.data.version });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.decidedByName).toBeTruthy();

    const again = await api()
      .post(`/api/v1/work-shift-assignments/submissions/${submissionId}/approve`)
      .set(authed(adminToken))
      .send({ version: approved.body.data.version });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SCHEDULE_SUBMISSION_INVALID_STATUS');

    const add = await register(doctorAToken, afternoonId, '2026-09-20');
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe('WORK_SHIFT_ASSIGNMENT_SUBMISSION_LOCKED');
  });

  it('công tắc tự đăng ký TẮT → gửi duyệt 403; cách ly tenant: tenant khác không thấy/không duyệt được', async () => {
    await api().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ allowStaffSelfScheduleEnabled: false });
    const off = await api().post('/api/v1/work-shift-assignments/submissions/submit').set(authed(doctorBToken)).send({ month: '2026-09' });
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('WORK_SHIFT_ASSIGNMENT_SELF_SCHEDULE_DISABLED');
    await api().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ allowStaffSelfScheduleEnabled: true });

    const listB = await api().get('/api/v1/work-shift-assignments/submissions').set(authed(tenantBAdminToken));
    expect(listB.body.data.items).toHaveLength(0);
    const approveB = await api()
      .post(`/api/v1/work-shift-assignments/submissions/${submissionId}/approve`)
      .set(authed(tenantBAdminToken))
      .send({ version: 1 });
    expect(approveB.status).toBe(404);
  });
});
