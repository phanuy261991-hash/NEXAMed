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
 * HTTP e2e cho `GET/PATCH /api/v1/users/me` — menu avatar "Thông tin tài khoản" (popup tự xem/sửa
 * hồ sơ của chính mình). TÁCH RIÊNG khỏi `user-account-http.spec.ts` (app instance/throttle bucket
 * riêng) — cùng lý do đã ghi ở `user-account-hr-profile-http.spec.ts`: file kia đã dùng gần hết
 * ngưỡng `ThrottlerGuard` cho `/auth/login` (10 request/phút/IP).
 *
 * Không có test cách ly tenant kiểu "tenant B gọi id tenant A → 404" như các module khác
 * (.claude/docs/multi-tenancy.md) — route này KHÔNG nhận `id` từ bất kỳ đâu ngoài token đã xác
 * thực (`req.user.userId`/`tenantId`), nên không tồn tại đường nào để một tenant chạm dữ liệu của
 * tenant khác qua route này, khác hẳn `GET/PATCH /users/:id` (nhận id từ URL).
 */
describe('HTTP e2e — /api/v1/users/me (tự xem/sửa hồ sơ cá nhân)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const staffPassword = 'Staff@12345';

  async function createUserWithRole(tenantId: string, roleName: string, password = staffPassword) {
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
    return { userId: user.id as string, token: login.body.data.accessToken as string };
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

    fixture = await createTwoTenantFixture(privileged, 'UserAccount me e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('vai trò KHÔNG có user_account.read (bác sĩ) vẫn GET được hồ sơ của chính mình', async () => {
    const { token } = await createUserWithRole(fixture.tenantA.id, 'doctor');
    const res = await request(app.getHttpServer()).get('/api/v1/users/me').set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.data.username).toMatch(/^e2e-doctor-/);
  });

  it('sửa đúng 4 trường liên hệ → 200, phản ánh đúng trên GET tiếp theo', async () => {
    const { userId, token } = await createUserWithRole(fixture.tenantA.id, 'doctor');
    const before = await request(app.getHttpServer()).get('/api/v1/users/me').set(authed(token));

    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set(authed(token))
      .send({ phone: '0909123456', email: 'me@example.com', dob: '1990-01-01', gender: 'male', version: before.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('0909123456');
    expect(res.body.data.email).toBe('me@example.com');
    expect(res.body.data.dob).toBe('1990-01-01');
    expect(res.body.data.gender).toBe('male');
    expect(res.body.data.id).toBe(userId);
  });

  it('gửi kèm trường ngoài phạm vi (roleIds/isActive) → bị bỏ qua hoàn toàn, không đổi gì', async () => {
    const { token } = await createUserWithRole(fixture.tenantA.id, 'doctor');
    const before = await request(app.getHttpServer()).get('/api/v1/users/me').set(authed(token));

    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set(authed(token))
      .send({ phone: '0900000000', isActive: false, roleIds: [], version: before.body.data.version });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.roleNames).toEqual(before.body.data.roleNames);
  });

  it('version không khớp → 409 CONCURRENT_MODIFICATION', async () => {
    const { token } = await createUserWithRole(fixture.tenantA.id, 'doctor');
    const res = await request(app.getHttpServer()).patch('/api/v1/users/me').set(authed(token)).send({ phone: '0911111111', version: 999 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });
});