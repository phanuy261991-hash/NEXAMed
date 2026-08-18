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
 * HTTP e2e cho "Tầng"/"Bàn khám-Ghế" (docs/DECISIONS.md #055, `/api/v1/floors`,
 * `/api/v1/exam-stations`) — cùng khuôn `clinic-http.spec.ts` (`clinic_config.*`).
 */
describe('HTTP e2e — /api/v1/floors, /api/v1/exam-stations, room.floorId/examStationCount', () => {
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

    fixture = await createTwoTenantFixture(privileged, 'FloorExamStation e2e');
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

  describe('/api/v1/floors', () => {
    it('không có access token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/floors');
      expect(res.status).toBe(401);
    });

    it('vai trò không có clinic_config.update (receptionist) → 403', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/floors').set(authed(receptionistToken)).send({ name: 'Tầng 1' });
      expect(res.status).toBe(403);
    });

    it('clinic_admin tạo tầng → 200; GET danh sách thấy tầng vừa tạo', async () => {
      const created = await request(app.getHttpServer()).post('/api/v1/floors').set(authed(clinicAdminToken)).send({ name: 'Tầng 1' });
      expect(created.status).toBe(200);
      expect(created.body.data.name).toBe('Tầng 1');
      expect(created.body.data.isActive).toBe(true);

      const list = await request(app.getHttpServer()).get('/api/v1/floors').set(authed(clinicAdminToken));
      expect(list.body.data.items.some((f: { id: string }) => f.id === created.body.data.id)).toBe(true);
    });

    it('PATCH sửa tên/khoá tầng → 200, version tăng; version cũ → 409', async () => {
      const created = await request(app.getHttpServer()).post('/api/v1/floors').set(authed(clinicAdminToken)).send({ name: 'Tầng tạm' });
      const id = created.body.data.id as string;

      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/floors/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Tầng đã đổi', isActive: false, version: 1 });
      expect(patched.status).toBe(200);
      expect(patched.body.data.version).toBe(2);

      const stale = await request(app.getHttpServer())
        .patch(`/api/v1/floors/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Đổi lần nữa', version: 1 });
      expect(stale.status).toBe(409);
    });

    it('cách ly tenant: tenant B không thấy tầng tenant A; sửa tầng tenant A → 404', async () => {
      const created = await request(app.getHttpServer()).post('/api/v1/floors').set(authed(clinicAdminToken)).send({ name: 'Tầng riêng tư A' });
      const id = created.body.data.id as string;

      const list = await request(app.getHttpServer()).get('/api/v1/floors').set(authed(tenantBAdminToken));
      expect(list.body.data.items.some((f: { id: string }) => f.id === id)).toBe(false);

      const patch = await request(app.getHttpServer()).patch(`/api/v1/floors/${id}`).set(authed(tenantBAdminToken)).send({ name: 'x', version: 1 });
      expect(patch.status).toBe(404);
    });
  });

  describe('room.floorId + /api/v1/exam-stations', () => {
    it('tạo phòng kèm floorId hợp lệ → 200, GET danh sách phòng trả đúng floorName + examStationCount=0', async () => {
      const floor = await request(app.getHttpServer()).post('/api/v1/floors').set(authed(clinicAdminToken)).send({ name: 'Tầng cho phòng' });
      const floorId = floor.body.data.id as string;

      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set(authed(clinicAdminToken))
        .send({ name: 'Phòng có tầng', floorId });
      expect(room.status).toBe(200);
      expect(room.body.data.floorId).toBe(floorId);
      expect(room.body.data.floorName).toBe('Tầng cho phòng');
      expect(room.body.data.examStationCount).toBe(0);

      const list = await request(app.getHttpServer()).get('/api/v1/rooms').set(authed(clinicAdminToken));
      const found = list.body.data.items.find((r: { id: string }) => r.id === room.body.data.id);
      expect(found.floorName).toBe('Tầng cho phòng');
    });

    it('tạo phòng không gửi floorId → 200, floorId/floorName null (tầng luôn tùy chọn)', async () => {
      const room = await request(app.getHttpServer()).post('/api/v1/rooms').set(authed(clinicAdminToken)).send({ name: 'Phòng không tầng' });
      expect(room.status).toBe(200);
      expect(room.body.data.floorId).toBeNull();
      expect(room.body.data.floorName).toBeNull();
    });

    it('roomId không tồn tại → 404 khi tạo bàn khám; thiếu query roomId → 400 khi list', async () => {
      const notFound = await request(app.getHttpServer())
        .post('/api/v1/exam-stations')
        .set(authed(clinicAdminToken))
        .send({ roomId: randomUUID(), name: 'Ghế 1' });
      expect(notFound.status).toBe(404);

      const badQuery = await request(app.getHttpServer()).get('/api/v1/exam-stations').set(authed(clinicAdminToken));
      expect(badQuery.status).toBe(400);
    });

    it('tạo 2 bàn khám cho 1 phòng → 200; GET theo roomId trả đúng 2; danh sách phòng có examStationCount=2', async () => {
      const room = await request(app.getHttpServer()).post('/api/v1/rooms').set(authed(clinicAdminToken)).send({ name: 'Phòng nhiều ghế' });
      const roomId = room.body.data.id as string;

      await request(app.getHttpServer()).post('/api/v1/exam-stations').set(authed(clinicAdminToken)).send({ roomId, name: 'Ghế 1' });
      const station2 = await request(app.getHttpServer()).post('/api/v1/exam-stations').set(authed(clinicAdminToken)).send({ roomId, name: 'Ghế 2' });
      expect(station2.status).toBe(200);
      expect(station2.body.data.roomId).toBe(roomId);

      const stations = await request(app.getHttpServer()).get(`/api/v1/exam-stations?roomId=${roomId}`).set(authed(clinicAdminToken));
      expect(stations.body.data.items).toHaveLength(2);

      const rooms = await request(app.getHttpServer()).get('/api/v1/rooms').set(authed(clinicAdminToken));
      const found = rooms.body.data.items.find((r: { id: string }) => r.id === roomId);
      expect(found.examStationCount).toBe(2);
    });

    it('PATCH đổi tên/khoá bàn khám → 200, version tăng; version cũ → 409', async () => {
      const room = await request(app.getHttpServer()).post('/api/v1/rooms').set(authed(clinicAdminToken)).send({ name: 'Phòng test patch ghế' });
      const created = await request(app.getHttpServer())
        .post('/api/v1/exam-stations')
        .set(authed(clinicAdminToken))
        .send({ roomId: room.body.data.id, name: 'Ghế A' });
      const id = created.body.data.id as string;

      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/exam-stations/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Ghế A đã đổi', isActive: false, version: 1 });
      expect(patched.status).toBe(200);
      expect(patched.body.data.version).toBe(2);

      const stale = await request(app.getHttpServer())
        .patch(`/api/v1/exam-stations/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'x', version: 1 });
      expect(stale.status).toBe(409);
    });

    it('cách ly tenant: bàn khám của phòng tenant A không thấy được từ tenant B (roomId khác tenant → 404 khi list rỗng an toàn, PATCH → 404)', async () => {
      const room = await request(app.getHttpServer()).post('/api/v1/rooms').set(authed(clinicAdminToken)).send({ name: 'Phòng cách ly tenant' });
      const created = await request(app.getHttpServer())
        .post('/api/v1/exam-stations')
        .set(authed(clinicAdminToken))
        .send({ roomId: room.body.data.id, name: 'Ghế cách ly' });
      const id = created.body.data.id as string;

      const listFromB = await request(app.getHttpServer()).get(`/api/v1/exam-stations?roomId=${room.body.data.id}`).set(authed(tenantBAdminToken));
      expect(listFromB.status).toBe(200);
      expect(listFromB.body.data.items).toHaveLength(0);

      const patchFromB = await request(app.getHttpServer()).patch(`/api/v1/exam-stations/${id}`).set(authed(tenantBAdminToken)).send({ name: 'x', version: 1 });
      expect(patchFromB.status).toBe(404);
    });
  });
});
