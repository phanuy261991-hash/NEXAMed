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
 * HTTP e2e cho "phòng làm việc hôm nay" (docs/DECISIONS.md #054, `/api/v1/rooms/options`,
 * `/api/v1/rooms/my-session`) — endpoint TỰ-PHỤC VỤ, không `PermissionGuard`, khác hẳn
 * `clinic-http.spec.ts` (`/api/v1/rooms` CRUD cần `clinic_config.*`).
 */
describe('HTTP e2e — /api/v1/rooms/options, /api/v1/rooms/my-session', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let doctorAToken: string;
  let doctorAId: string;
  let receptionistToken: string;
  let tenantBDoctorToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId,
        username,
        passwordHash,
        fullName: `User ${roleName}`,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });

    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { token: login.body.data.accessToken as string, userId: user.id };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createRoom(tenantId: string, name: string): Promise<string> {
    const created = await privileged.room.create({
      data: { tenantId, name, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return created.id;
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

    fixture = await createTwoTenantFixture(privileged, 'DoctorRoomSession e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAId = doctorA.userId;
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist').then((u) => u.token);
    tenantBDoctorToken = await createUserWithRole(fixture.tenantB.id, 'doctor').then((u) => u.token);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401 (cả 3 endpoint)', async () => {
    const options = await request(app.getHttpServer()).get('/api/v1/rooms/options');
    expect(options.status).toBe(401);
    const getSession = await request(app.getHttpServer()).get('/api/v1/rooms/my-session');
    expect(getSession.status).toBe(401);
    const putSession = await request(app.getHttpServer()).put('/api/v1/rooms/my-session').send({ roomId: randomUUID() });
    expect(putSession.status).toBe(401);
  });

  it('vai trò KHÔNG có clinic_config.* (receptionist) vẫn gọi được — tự-phục vụ, không cần permission', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/rooms/options').set(authed(receptionistToken));
    expect(res.status).toBe(200);
  });

  it('GET my-session lúc chưa chọn phòng → null', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/rooms/my-session').set(authed(doctorAToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('roomId không tồn tại/không active → 404, không tạo phiên', async () => {
    const notFound = await request(app.getHttpServer())
      .put('/api/v1/rooms/my-session')
      .set(authed(doctorAToken))
      .send({ roomId: randomUUID() });
    expect(notFound.status).toBe(404);

    const inactiveRoomId = await createRoom(fixture.tenantA.id, 'Phòng ngưng dùng');
    await privileged.room.update({ where: { id: inactiveRoomId }, data: { isActive: false } });
    const inactive = await request(app.getHttpServer())
      .put('/api/v1/rooms/my-session')
      .set(authed(doctorAToken))
      .send({ roomId: inactiveRoomId });
    expect(inactive.status).toBe(404);

    const getSession = await request(app.getHttpServer()).get('/api/v1/rooms/my-session').set(authed(doctorAToken));
    expect(getSession.body.data).toBeNull();
  });

  it('roomId thuộc tenant khác → 404 (không lộ tồn tại xuyên tenant)', async () => {
    const roomB = await createRoom(fixture.tenantB.id, 'Phòng tenant B');
    const res = await request(app.getHttpServer()).put('/api/v1/rooms/my-session').set(authed(doctorAToken)).send({ roomId: roomB });
    expect(res.status).toBe(404);
  });

  it('chọn phòng hợp lệ → 200, GET phản ánh đúng; đổi phòng khác trong ngày → UPSERT tại chỗ (không tạo dòng mới)', async () => {
    const roomAId = await createRoom(fixture.tenantA.id, 'Phòng Nội 1');
    const set1 = await request(app.getHttpServer()).put('/api/v1/rooms/my-session').set(authed(doctorAToken)).send({ roomId: roomAId });
    expect(set1.status).toBe(200);
    expect(set1.body.data.roomId).toBe(roomAId);
    expect(set1.body.data.roomName).toBe('Phòng Nội 1');

    const get1 = await request(app.getHttpServer()).get('/api/v1/rooms/my-session').set(authed(doctorAToken));
    expect(get1.body.data.roomId).toBe(roomAId);

    const roomA2Id = await createRoom(fixture.tenantA.id, 'Phòng Nội 2');
    const set2 = await request(app.getHttpServer()).put('/api/v1/rooms/my-session').set(authed(doctorAToken)).send({ roomId: roomA2Id });
    expect(set2.status).toBe(200);
    expect(set2.body.data.roomId).toBe(roomA2Id);

    const get2 = await request(app.getHttpServer()).get('/api/v1/rooms/my-session').set(authed(doctorAToken));
    expect(get2.body.data.roomId).toBe(roomA2Id);

    const rows = await privileged.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM doctor_room_session WHERE doctor_id = ${doctorAId}::uuid AND deleted_at IS NULL
    `;
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('cách ly tenant: GET /rooms/options của tenant B không thấy phòng tenant A', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/rooms/options').set(authed(tenantBDoctorToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items.some((r: { name: string }) => r.name.startsWith('Phòng Nội'))).toBe(false);
  });

  it('GET /appointments/doctors kèm currentRoomName đúng cho bác sĩ đã chọn phòng, null cho bác sĩ chưa chọn', async () => {
    const doctorB = await createUserWithRole(fixture.tenantB.id, 'doctor');
    const roomB = await createRoom(fixture.tenantB.id, 'Phòng riêng B');

    const before = await request(app.getHttpServer()).get('/api/v1/appointments/doctors').set(authed(tenantBDoctorToken));
    const entryBefore = before.body.data.items.find((d: { id: string }) => d.id === doctorB.userId);
    expect(entryBefore.currentRoomName ?? null).toBeNull();

    await request(app.getHttpServer()).put('/api/v1/rooms/my-session').set(authed(doctorB.token)).send({ roomId: roomB });

    const after = await request(app.getHttpServer()).get('/api/v1/appointments/doctors').set(authed(tenantBDoctorToken));
    const entryAfter = after.body.data.items.find((d: { id: string }) => d.id === doctorB.userId);
    expect(entryAfter.currentRoomName).toBe('Phòng riêng B');
  });
});
