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
 * HTTP e2e cho "Ca làm việc" (docs/DECISIONS.md #101, `/api/v1/work-shifts`) — bảng RIÊNG theo
 * tenant (khác `reference_catalog` toàn hệ thống), cùng khuôn `clinic_config.*` như
 * `floor-exam-station-http.spec.ts`.
 */
describe('HTTP e2e — /api/v1/work-shifts', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

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
    return login.body.data.accessToken as string;
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  const validPayload = {
    name: 'Ca sáng',
    startTime: '07:30',
    endTime: '12:00',
    color: 'blue',
    restStartTime: '09:30',
    restEndTime: '09:45',
    restMinutes: 15,
    standardWorkMinutes: 240,
  };

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

    fixture = await createTwoTenantFixture(privileged, 'WorkShift e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/work-shifts');
    expect(res.status).toBe(401);
  });

  it('vai trò không có clinic_config.update (receptionist) → 403', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/work-shifts').set(authed(receptionistToken)).send(validPayload);
    expect(res.status).toBe(403);
  });

  it('clinic_admin tạo ca hợp lệ → 200, mã tự sinh, GET danh sách thấy ca vừa tạo', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/work-shifts').set(authed(clinicAdminToken)).send(validPayload);
    expect(created.status).toBe(200);
    expect(created.body.data.name).toBe('Ca sáng');
    expect(created.body.data.code).toMatch(/^WO-[0-9A-F]{8}$/);
    expect(created.body.data.color).toBe('blue');
    expect(created.body.data.restMinutes).toBe(15);
    expect(created.body.data.standardWorkMinutes).toBe(240);
    expect(created.body.data.isActive).toBe(true);

    const list = await request(app.getHttpServer()).get('/api/v1/work-shifts').set(authed(clinicAdminToken));
    expect(list.body.data.items.some((s: { id: string }) => s.id === created.body.data.id)).toBe(true);
  });

  it('tạo ca không có giờ nghỉ (tuỳ chọn) → 200, các trường giờ nghỉ null', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/work-shifts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Ca chiều', startTime: '13:00', endTime: '17:00', color: 'amber' });
    expect(res.status).toBe(200);
    expect(res.body.data.restStartTime).toBeNull();
    expect(res.body.data.restEndTime).toBeNull();
    expect(res.body.data.restMinutes).toBeNull();
  });

  it('endTime không sau startTime → 422 WORK_SHIFT_INVALID_TIME_RANGE', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/work-shifts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Ca sai giờ', startTime: '12:00', endTime: '08:00', color: 'rose' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WORK_SHIFT_INVALID_TIME_RANGE');
  });

  it('giờ nghỉ nằm ngoài khoảng ca → 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/work-shifts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Ca giờ nghỉ sai', startTime: '08:00', endTime: '12:00', color: 'purple', restStartTime: '13:00', restEndTime: '13:15' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WORK_SHIFT_INVALID_TIME_RANGE');
  });

  it('sai định dạng giờ (không phải HH:mm) → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/work-shifts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Ca sai định dạng', startTime: '7:30', endTime: '12:00', color: 'blue' });
    expect(res.status).toBe(400);
  });

  it('PATCH sửa giờ/màu/ẩn → 200, version tăng; version cũ → 409', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/work-shifts').set(authed(clinicAdminToken)).send(validPayload);
    const id = created.body.data.id as string;

    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/work-shifts/${id}`)
      .set(authed(clinicAdminToken))
      .send({ startTime: '08:00', color: 'teal', isActive: false, version: 1 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.startTime).toBe('08:00');
    expect(patched.body.data.color).toBe('teal');
    expect(patched.body.data.isActive).toBe(false);
    expect(patched.body.data.version).toBe(2);

    const stale = await request(app.getHttpServer())
      .patch(`/api/v1/work-shifts/${id}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'x', version: 1 });
    expect(stale.status).toBe(409);
  });

  it('PATCH đổi startTime khiến endTime hiện có không còn hợp lệ → 422', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/work-shifts').set(authed(clinicAdminToken)).send(validPayload);
    const id = created.body.data.id as string;

    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/work-shifts/${id}`)
      .set(authed(clinicAdminToken))
      .send({ startTime: '13:00', version: 1 });
    expect(patched.status).toBe(422);
    expect(patched.body.error.code).toBe('WORK_SHIFT_INVALID_TIME_RANGE');
  });

  it('cách ly tenant: tenant B không thấy ca tenant A; sửa ca tenant A → 404', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/work-shifts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Ca riêng tư A', startTime: '06:00', endTime: '10:00', color: 'slate' });
    const id = created.body.data.id as string;

    const list = await request(app.getHttpServer()).get('/api/v1/work-shifts').set(authed(tenantBAdminToken));
    expect(list.body.data.items.some((s: { id: string }) => s.id === id)).toBe(false);

    const patch = await request(app.getHttpServer()).patch(`/api/v1/work-shifts/${id}`).set(authed(tenantBAdminToken)).send({ name: 'x', version: 1 });
    expect(patch.status).toBe(404);
  });
});
