import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * HTTP e2e cho "Đăng ký ca làm việc" (Giai đoạn 2 của #101, `/api/v1/work-shift-assignments`) —
 * MỌI nhân viên tự đăng ký (scope personal), clinic_admin xem/sửa/xoá toàn bộ (scope global).
 */
describe('HTTP e2e — /api/v1/work-shift-assignments', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBToken: string;
  let doctorBUserId: string;
  let tenantBAdminToken: string;
  let shiftMorningId: string;
  let shiftAfternoonId: string;

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

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
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

    fixture = await createTwoTenantFixture(privileged, 'WorkShiftAssignment e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    const admin = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    clinicAdminToken = admin.token;
    const dA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = dA.token;
    doctorAUserId = dA.userId;
    const dB = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorBToken = dB.token;
    doctorBUserId = dB.userId;
    const tenantBAdmin = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
    tenantBAdminToken = tenantBAdmin.token;

    const morning = await request(app.getHttpServer())
      .post('/api/v1/work-shifts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Ca Sáng', startTime: '07:00', endTime: '11:00', color: 'blue' });
    shiftMorningId = morning.body.data.id;
    const afternoon = await request(app.getHttpServer())
      .post('/api/v1/work-shifts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Ca Chiều', startTime: '13:00', endTime: '17:00', color: 'teal' });
    shiftAfternoonId = afternoon.body.data.id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/work-shift-assignments').query({ from: '2026-09-01', to: '2026-09-30' });
    expect(res.status).toBe(401);
  });

  it('bác sĩ (scope personal) tự đăng ký ca cho chính mình → 200, canEdit=true (đúng hôm nay)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments')
      .set(authed(doctorAToken))
      .send({ workShiftId: shiftMorningId, workDate: '2026-09-10' });
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(doctorAUserId);
    expect(res.body.data.workDate).toBe('2026-09-10');
    expect(res.body.data.workShiftName).toBe('Ca Sáng');
    expect(res.body.data.canEdit).toBe(true);
  });

  it('bác sĩ gửi kèm userId của người khác (scope personal) — vẫn bị ép tạo cho chính mình', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments')
      .set(authed(doctorAToken))
      .send({ workShiftId: shiftAfternoonId, workDate: '2026-09-10', userId: doctorBUserId });
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(doctorAUserId);
  });

  it('đăng ký trùng đúng 1 ca/ngày → 409 WORK_SHIFT_ASSIGNMENT_DUPLICATE', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments')
      .set(authed(doctorAToken))
      .send({ workShiftId: shiftMorningId, workDate: '2026-09-10' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WORK_SHIFT_ASSIGNMENT_DUPLICATE');
  });

  it('GET (scope personal) chỉ thấy ca của chính mình, không thấy của bác sĩ khác', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments')
      .set(authed(doctorBToken))
      .send({ workShiftId: shiftMorningId, workDate: '2026-09-10' });

    const list = await request(app.getHttpServer())
      .get('/api/v1/work-shift-assignments')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set(authed(doctorAToken));
    expect(list.status).toBe(200);
    expect(list.body.data.items.every((i: { userId: string }) => i.userId === doctorAUserId)).toBe(true);
    expect(list.body.data.items.length).toBe(2);
  });

  it('bulk-apply nhiều ngày cùng 1 ca — bỏ qua ngày đã có sẵn', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments/bulk')
      .set(authed(doctorAToken))
      .send({ workShiftId: shiftMorningId, workDates: ['2026-09-10', '2026-09-11', '2026-09-12'] });
    expect(res.status).toBe(200);
    // 2026-09-10 đã có sẵn (test trước) → bỏ qua; 11 và 12 mới → tạo.
    expect(res.body.data.createdCount).toBe(2);
    expect(res.body.data.skippedCount).toBe(1);
  });

  it('sao chép tuần — chỉ điền vào ngày còn trống ở đích, bỏ qua ngày đã có sẵn', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments/copy')
      .set(authed(doctorAToken))
      .send({ mode: 'week', fromWeekStart: '2026-09-07', toWeekStart: '2026-09-14' });
    expect(first.status).toBe(200);
    // Nguồn tuần 07-13/09 của doctorA có 4 dòng đã đăng ký (10/09: Sáng+Chiều, 11/09: Sáng, 12/09:
    // Sáng) → cả 4 copy sang tuần sau (14-20/09), đích trống hoàn toàn.
    expect(first.body.data.createdCount).toBe(4);
    expect(first.body.data.skippedCount).toBe(0);

    const second = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments/copy')
      .set(authed(doctorAToken))
      .send({ mode: 'week', fromWeekStart: '2026-09-07', toWeekStart: '2026-09-14' });
    expect(second.status).toBe(200);
    expect(second.body.data.createdCount).toBe(0);
    expect(second.body.data.skippedCount).toBe(4);
  });

  it('tự xoá ca đăng ký TRONG hôm nay → 200; xoá lại (đã bị xoá, coi như không tồn tại) → 404', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments')
      .set(authed(doctorAToken))
      .send({ workShiftId: shiftAfternoonId, workDate: '2026-09-20' });
    const id = created.body.data.id as string;

    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/work-shift-assignments/${id}`)
      .set(authed(doctorAToken))
      .send({ version: 1 });
    expect(removed.status).toBe(200);

    // Đã soft-delete xong (deletedAt khác null) — `findById()` lọc `deletedAt: null` nên bản ghi
    // "không còn tồn tại" theo đúng ngữ nghĩa mọi entity soft-delete khác trong hệ thống, không
    // phải xung đột version thật (đó là kịch bản 2 request THẬT SỰ đồng thời, khác test tuần tự này).
    const again = await request(app.getHttpServer())
      .delete(`/api/v1/work-shift-assignments/${id}`)
      .set(authed(doctorAToken))
      .send({ version: 1 });
    expect(again.status).toBe(404);
  });

  it('tự xoá ca đăng ký từ HÔM QUA (khoá) → 409 WORK_SHIFT_ASSIGNMENT_LOCKED; clinic_admin (global) vẫn xoá được', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments')
      .set(authed(doctorAToken))
      .send({ workShiftId: shiftMorningId, workDate: '2026-09-21' });
    const id = created.body.data.id as string;

    // Không có API nào set `createdAt` giả lập ngày cũ — set thẳng qua Prisma client đặc quyền
    // (đúng ngoại lệ đã ghi trong plan: chỉ cột hệ thống không có đường API nào set được).
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await privileged.workShiftAssignment.update({ where: { id }, data: { createdAt: yesterday } });

    const selfDelete = await request(app.getHttpServer())
      .delete(`/api/v1/work-shift-assignments/${id}`)
      .set(authed(doctorAToken))
      .send({ version: 1 });
    expect(selfDelete.status).toBe(409);
    expect(selfDelete.body.error.code).toBe('WORK_SHIFT_ASSIGNMENT_LOCKED');

    const adminDelete = await request(app.getHttpServer())
      .delete(`/api/v1/work-shift-assignments/${id}`)
      .set(authed(clinicAdminToken))
      .send({ version: 1 });
    expect(adminDelete.status).toBe(200);
  });

  it('clinic_admin (scope global) GET không lọc userId thấy ca của NHIỀU bác sĩ; canEdit luôn true', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/work-shift-assignments')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set(authed(clinicAdminToken));
    expect(list.status).toBe(200);
    const userIds = new Set(list.body.data.items.map((i: { userId: string }) => i.userId));
    expect(userIds.has(doctorAUserId)).toBe(true);
    expect(userIds.has(doctorBUserId)).toBe(true);
    expect(list.body.data.items.every((i: { canEdit: boolean }) => i.canEdit === true)).toBe(true);
  });

  it('cách ly tenant: tenant B không thấy ca tenant A; xoá ca tenant A → 404', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments')
      .set(authed(doctorAToken))
      .send({ workShiftId: shiftMorningId, workDate: '2026-09-25' });
    const id = created.body.data.id as string;

    const list = await request(app.getHttpServer())
      .get('/api/v1/work-shift-assignments')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set(authed(tenantBAdminToken));
    expect(list.body.data.items.some((i: { id: string }) => i.id === id)).toBe(false);

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/work-shift-assignments/${id}`)
      .set(authed(tenantBAdminToken))
      .send({ version: 1 });
    expect(del.status).toBe(404);
  });
});
