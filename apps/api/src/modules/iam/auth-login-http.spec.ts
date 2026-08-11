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
 * Test HTTP e2e thật đầu tiên của dự án (S1-07) — boot toàn bộ `AppModule` qua
 * `@nestjs/testing` (đúng những gì `main.ts` wire: prefix `/api/v1`, cookie-parser,
 * `ResponseInterceptor`, `DomainExceptionFilter`) rồi gọi qua HTTP thật bằng supertest, khác
 * với `auth.spec.ts` (S1-04) gọi thẳng `AuthService`, bỏ qua controller/guard/interceptor/filter.
 * Dùng làm **template** cho endpoint nghiệp vụ đầu tiên ở S2: cách dựng app, cách dùng
 * `createTwoTenantFixture`, cách xác minh response envelope `{data,meta}`/`{error}`.
 */
describe('HTTP e2e — POST /api/v1/auth/login (cách ly tenant qua toàn bộ stack HTTP thật)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';
  const username = `e2e-doctor-${randomUUID()}`;

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

    fixture = await createTwoTenantFixture(privileged, 'HTTP e2e');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId: fixture.tenantA.id,
        username,
        passwordHash,
        fullName: 'Bác sĩ E2E',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });

    // Gán vai trò 'nurse' — xác minh login/`/auth/me` trả đúng roles (S1-08, docs/DECISIONS.md #022).
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    const nurseRole = await privileged.role.findFirstOrThrow({
      where: { tenantId: fixture.tenantA.id, name: 'nurse' },
    });
    await privileged.userRole.create({
      data: {
        tenantId: fixture.tenantA.id,
        userId: user.id,
        roleId: nurseRole.id,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('đúng thông tin, đúng tenant → 200, đúng response envelope {data,meta}', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.user.roles).toEqual(['nurse']);
    expect(res.body.meta).toEqual({});
  });

  it('GET /api/v1/auth/me: có access token hợp lệ → trả đúng danh tính + vai trò', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password });

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe(username);
    expect(res.body.data.roles).toEqual(['nurse']);
  });

  it('GET /api/v1/auth/me: không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('đúng username/password nhưng khai báo nhầm sang tenant B → 401, không lộ tồn tại xuyên tenant', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantB.id, username, password });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('body sai định dạng (thiếu password) → 400 VALIDATION_ERROR qua DomainExceptionFilter', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
