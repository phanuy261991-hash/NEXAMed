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
 * HTTP e2e — "Đổi ca" (#225): đổi 2 ca cho nhau, chỉ người nhận xác nhận, chặn khi ca chưa duyệt/có lịch hẹn/có đơn
 * nghỉ/quá hạn, chấm số "mới chưa xem" của quản lý. Đồng hồ giả (chỉ `Date`) ghim giữa tháng 8/2026.
 */
describe('HTTP e2e — đổi ca', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let docAToken: string;
  let docAId: string;
  let docBToken: string;
  let docBId: string;
  let tenantBAdminToken: string;
  let morningId: string;
  let afternoonId: string;
  const ids: Record<string, string> = {};

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

  /** Quản lý xếp ca cho nhân viên (scope global) → trả id ca đăng ký. */
  async function assign(userId: string, workShiftId: string, workDate: string): Promise<string> {
    const res = await api().post('/api/v1/work-shift-assignments').set(authed(adminToken)).send({ userId, workShiftId, workDate });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  function swap(token: string, requesterAssignmentId: string, counterpartAssignmentId: string, note?: string) {
    return api().post('/api/v1/shift-swaps').set(authed(token)).send({ requesterAssignmentId, counterpartAssignmentId, note });
  }

  async function submitAndApprove(token: string, month: string) {
    const submitted = await api().post('/api/v1/work-shift-assignments/submissions/submit').set(authed(token)).send({ month });
    expect(submitted.status).toBe(200);
    const approved = await api()
      .post(`/api/v1/work-shift-assignments/submissions/${submitted.body.data.id}/approve`)
      .set(authed(adminToken))
      .send({ version: submitted.body.data.version });
    expect(approved.status).toBe(200);
  }

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

    fixture = await createTwoTenantFixture(privileged, 'ShiftSwap e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const a = await createUserWithRole(fixture.tenantA.id, 'doctor');
    docAToken = a.token;
    docAId = a.userId;
    const b = await createUserWithRole(fixture.tenantA.id, 'doctor');
    docBToken = b.token;
    docBId = b.userId;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    const morning = await api().post('/api/v1/work-shifts').set(authed(adminToken)).send({ name: 'Ca Sáng', startTime: '07:00', endTime: '11:00', color: 'blue' });
    morningId = morning.body.data.id;
    const afternoon = await api().post('/api/v1/work-shifts').set(authed(adminToken)).send({ name: 'Ca Chiều', startTime: '13:00', endTime: '17:00', color: 'teal' });
    afternoonId = afternoon.body.data.id;

    // Quản lý xếp ca tháng 9 (tháng sau tháng giả lập 8/2026).
    ids.aMorning10 = await assign(docAId, morningId, '2026-09-10');
    ids.aAfternoon11 = await assign(docAId, afternoonId, '2026-09-11');
    ids.bAfternoon10 = await assign(docBId, afternoonId, '2026-09-10');
    ids.bMorning12 = await assign(docBId, morningId, '2026-09-12');
  });

  afterAll(async () => {
    vi.useRealTimers();
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('tháng chưa được duyệt → chưa đổi ca được (409 SHIFT_SWAP_BLOCKED); sau khi cả hai được duyệt thì đổi được', async () => {
    const blocked = await swap(docAToken, ids.aMorning10!, ids.bAfternoon10!);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('SHIFT_SWAP_BLOCKED');
    expect(blocked.body.error.message).toContain('chưa được duyệt');

    await submitAndApprove(docAToken, '2026-09');
    await submitAndApprove(docBToken, '2026-09');
  });

  it('gửi yêu cầu: PENDING, người nhận thấy trong chấm số; danh sách đồng nghiệp + ca có cờ đổi được; quản lý thấy "mới"', async () => {
    const created = await swap(docAToken, ids.aMorning10!, ids.bAfternoon10!, 'Em có việc gia đình sáng 10/9.');
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({
      requesterId: docAId,
      counterpartId: docBId,
      status: 'PENDING',
      canCancel: true,
      canRespond: false,
      note: 'Em có việc gia đình sáng 10/9.',
    });
    expect(created.body.data.requesterAssignment).toMatchObject({ workDate: '2026-09-10', workShiftName: 'Ca Sáng' });
    expect(created.body.data.counterpartAssignment).toMatchObject({ workDate: '2026-09-10', workShiftName: 'Ca Chiều' });
    ids.swap1 = created.body.data.id;
    ids.swap1Version = created.body.data.version;

    const incoming = await api().get('/api/v1/shift-swaps/incoming-count').set(authed(docBToken));
    expect(incoming.body.data.count).toBe(1);
    const colleagues = await api().get('/api/v1/shift-swaps/colleagues').set(authed(docAToken));
    expect(colleagues.body.data.items.some((c: { userId: string }) => c.userId === docBId)).toBe(true);
    const candidates = await api().get(`/api/v1/shift-swaps/colleagues/${docBId}/assignments`).set(authed(docAToken));
    const byId = new Map<string, { swappable: boolean; blockedReason: string | null }>(candidates.body.data.items.map((i: { assignmentId: string }) => [i.assignmentId, i as never]));
    expect(byId.get(ids.bAfternoon10!)?.swappable).toBe(false); // đang trong yêu cầu đổi ca chờ
    expect(byId.get(ids.bMorning12!)?.swappable).toBe(true);

    const unseen = await api().get('/api/v1/shift-swaps/unseen-count').set(authed(adminToken));
    expect(unseen.body.data.count).toBe(1);
    const denied = await api().get('/api/v1/shift-swaps/unseen-count').set(authed(docAToken));
    expect(denied.status).toBe(403);
  });

  it('nhân viên đã nghỉ việc (tài khoản vô hiệu hoá) không còn trong danh sách đồng nghiệp đổi ca', async () => {
    const leaver = await createUserWithRole(fixture.tenantA.id, 'doctor');
    await assign(leaver.userId, morningId, '2026-09-14');
    const before = await api().get('/api/v1/shift-swaps/colleagues').set(authed(docAToken));
    expect(before.body.data.items.some((c: { userId: string }) => c.userId === leaver.userId)).toBe(true);

    await privileged.userAccount.update({ where: { id: leaver.userId }, data: { isActive: false } });
    const after = await api().get('/api/v1/shift-swaps/colleagues').set(authed(docAToken));
    expect(after.body.data.items.some((c: { userId: string }) => c.userId === leaver.userId)).toBe(false);
    const candidates = await api().get(`/api/v1/shift-swaps/colleagues/${leaver.userId}/assignments`).set(authed(docAToken));
    expect(candidates.body.data.items).toHaveLength(0);
  });

  it('trùng yêu cầu cùng ca → 409; chỉ người nhận xác nhận/từ chối, chỉ người gửi huỷ (403)', async () => {
    const dup = await swap(docAToken, ids.aMorning10!, ids.bMorning12!);
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toContain('yêu cầu đổi ca khác');

    const wrongAccept = await api().post(`/api/v1/shift-swaps/${ids.swap1}/accept`).set(authed(docAToken)).send({ version: ids.swap1Version });
    expect(wrongAccept.status).toBe(403);
    expect(wrongAccept.body.error.code).toBe('SHIFT_SWAP_NOT_ALLOWED_ACTOR');
    const wrongCancel = await api().post(`/api/v1/shift-swaps/${ids.swap1}/cancel`).set(authed(docBToken)).send({ version: ids.swap1Version });
    expect(wrongCancel.status).toBe(403);
  });

  it('người nhận xác nhận → 2 ca đổi chủ ngay, yêu cầu ACCEPTED; ca mới nhân viên không tự xoá; quản lý thấy "mới" rồi đánh dấu đã xem', async () => {
    const accepted = await api().post(`/api/v1/shift-swaps/${ids.swap1}/accept`).set(authed(docBToken)).send({ version: ids.swap1Version });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('ACCEPTED');

    const rows = await privileged.workShiftAssignment.findMany({ where: { workDate: new Date('2026-09-10'), deletedAt: null }, orderBy: { userId: 'asc' } });
    const byUser = new Map(rows.map((r) => [r.userId, r.workShiftId]));
    expect(byUser.get(docAId)).toBe(afternoonId); // A nhận ca chiều của B
    expect(byUser.get(docBId)).toBe(morningId); // B nhận ca sáng của A

    const mine = await api().get('/api/v1/work-shift-assignments').query({ from: '2026-09-10', to: '2026-09-10' }).set(authed(docAToken));
    expect(mine.body.data.items[0]).toMatchObject({ canEdit: false });
    const del = await api().delete(`/api/v1/work-shift-assignments/${mine.body.data.items[0].id}`).set(authed(docAToken)).send({ version: 1 });
    expect(del.status).toBe(409);

    const again = await api().post(`/api/v1/shift-swaps/${ids.swap1}/accept`).set(authed(docBToken)).send({ version: accepted.body.data.version });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SHIFT_SWAP_INVALID_STATUS');

    const list = await api().get('/api/v1/shift-swaps').set(authed(adminToken));
    expect(list.body.data.items[0]).toMatchObject({ id: ids.swap1, status: 'ACCEPTED', isNewForManager: true });
    const seen = await api().post('/api/v1/shift-swaps/mark-seen').set(authed(adminToken)).send({});
    expect(seen.status).toBe(200);
    const unseen = await api().get('/api/v1/shift-swaps/unseen-count').set(authed(adminToken));
    expect(unseen.body.data.count).toBe(0);
  });

  it('ca đang có lịch hẹn → chặn (cả khi gửi, kèm số lịch hẹn); có đơn xin nghỉ trong ca → chặn', async () => {
    // B có lịch hẹn 08:00 ngày 12/9 (trong ca sáng 07:00–11:00).
    const appt = await api()
      .post('/api/v1/appointments')
      .set(authed(adminToken))
      .send({ doctorId: docBId, fullName: 'Khách thử', phone: '0900000001', scheduledAt: '2026-09-12T01:00:00.000Z', durationMinutes: 15, source: 'phone' });
    expect(appt.status).toBe(200);

    const check = await api().get(`/api/v1/shift-swaps/assignments/${ids.bMorning12}/check`);
    expect(check.status).toBe(401);
    const blocked = await swap(docAToken, ids.aAfternoon11!, ids.bMorning12!);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('1 lịch hẹn');

    // A xin nghỉ ca chiều 11/9 (đơn chờ duyệt cũng chặn).
    const leave = await api().post('/api/v1/leave-requests').set(authed(docAToken)).send({ leaveDate: '2026-09-11', workShiftId: afternoonId, reason: 'Việc riêng' });
    expect(leave.status).toBe(200);
    const ownCheck = await api().get(`/api/v1/shift-swaps/assignments/${ids.aAfternoon11}/check`).set(authed(docAToken));
    expect(ownCheck.body.data).toMatchObject({ swappable: false });
    expect(ownCheck.body.data.blockedReason).toContain('đơn xin nghỉ');
    const other = await api().get(`/api/v1/shift-swaps/assignments/${ids.aAfternoon11}/check`).set(authed(docBToken));
    expect(other.status).toBe(404);
  });

  it('từ chối kèm lý do; người gửi huỷ khi chưa xác nhận; sau đó huỷ/từ chối lại → 409', async () => {
    ids.aMorning14 = await assign(docAId, morningId, '2026-09-14');
    ids.bMorning15 = await assign(docBId, morningId, '2026-09-15');
    ids.aMorning16 = await assign(docAId, morningId, '2026-09-16');
    ids.bAfternoon17 = await assign(docBId, afternoonId, '2026-09-17');

    const first = await swap(docAToken, ids.aMorning14!, ids.bMorning15!);
    expect(first.status).toBe(200);
    const declined = await api()
      .post(`/api/v1/shift-swaps/${first.body.data.id}/decline`)
      .set(authed(docBToken))
      .send({ version: first.body.data.version, reason: 'Em đã có lịch khám ngoài' });
    expect(declined.status).toBe(200);
    expect(declined.body.data).toMatchObject({ status: 'DECLINED', declineReason: 'Em đã có lịch khám ngoài' });
    const cancelAfter = await api().post(`/api/v1/shift-swaps/${first.body.data.id}/cancel`).set(authed(docAToken)).send({ version: declined.body.data.version });
    expect(cancelAfter.status).toBe(409);

    const second = await swap(docAToken, ids.aMorning16!, ids.bAfternoon17!);
    expect(second.status).toBe(200);
    const cancelled = await api().post(`/api/v1/shift-swaps/${second.body.data.id}/cancel`).set(authed(docAToken)).send({ version: second.body.data.version });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const declineAfter = await api().post(`/api/v1/shift-swaps/${second.body.data.id}/decline`).set(authed(docBToken)).send({ version: cancelled.body.data.version });
    expect(declineAfter.status).toBe(409);
  });

  it('quá hạn (ngày của ca đã tới) → hiển thị EXPIRED và không xác nhận được (409 SHIFT_SWAP_EXPIRED)', async () => {
    const req = await swap(docAToken, ids.aMorning16!, ids.bAfternoon17!);
    expect(req.status).toBe(200);
    // Giả lập "ngày của ca đã tới": kéo ca của người gửi về quá khứ (trước ngày hôm nay giả lập 15/8).
    await privileged.workShiftAssignment.update({ where: { id: ids.aMorning16! }, data: { workDate: new Date('2026-08-10') } });

    const list = await api().get('/api/v1/shift-swaps').query({ status: 'EXPIRED' }).set(authed(adminToken));
    expect(list.body.data.items.some((i: { id: string; status: string }) => i.id === req.body.data.id && i.status === 'EXPIRED')).toBe(true);
    const accept = await api().post(`/api/v1/shift-swaps/${req.body.data.id}/accept`).set(authed(docBToken)).send({ version: req.body.data.version });
    expect(accept.status).toBe(409);
    expect(accept.body.error.code).toBe('SHIFT_SWAP_EXPIRED');
  });

  it('phạm vi xem: nhân viên chỉ thấy yêu cầu liên quan mình; cách ly tenant', async () => {
    const mine = await api().get('/api/v1/shift-swaps').set(authed(docAToken));
    expect(mine.body.data.items.length).toBeGreaterThan(0);
    expect(mine.body.data.items.every((i: { requesterId: string; counterpartId: string }) => i.requesterId === docAId || i.counterpartId === docAId)).toBe(true);

    const listB = await api().get('/api/v1/shift-swaps').set(authed(tenantBAdminToken));
    expect(listB.body.data.items).toHaveLength(0);
    const acceptB = await api().post(`/api/v1/shift-swaps/${ids.swap1}/accept`).set(authed(tenantBAdminToken)).send({ version: 1 });
    expect(acceptB.status).toBe(404);
  });
});
