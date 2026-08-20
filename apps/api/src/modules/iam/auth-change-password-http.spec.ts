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

/**
 * HTTP e2e cho `POST /api/v1/auth/change-password` (mở rộng ADM-01 — bắt buộc đổi mật khẩu ở
 * lần đăng nhập đầu, dùng chung endpoint cho đổi mật khẩu tự nguyện sau này). Chỉ `JwtAuthGuard`
 * — mọi vai trò tự phục vụ được, không cần `user_account.manage`.
 */
describe('HTTP e2e — POST /api/v1/auth/change-password', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  function refreshCookieFrom(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies?.find((c) => c.startsWith('refresh_token='));
    if (!cookie) throw new Error('Không thấy cookie refresh_token trong response — kiểm tra lại test.');
    return cookie;
  }

  async function createUser(mustChangePassword: boolean) {
    const username = `e2e-changepw-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId: fixture.tenantA.id,
        username,
        passwordHash,
        fullName: 'Người dùng đổi mật khẩu',
        mustChangePassword,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return { userId: user.id, username };
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

    fixture = await createTwoTenantFixture(privileged, 'AuthChangePassword e2e');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: password, newPassword: 'New@12345' });
    expect(res.status).toBe(401);
  });

  it('mustChangePassword=true lúc login → me trả đúng cờ; đổi đúng mật khẩu → 200, cờ về false, phiên khác bị thu hồi, đăng nhập lại bằng mật khẩu mới', async () => {
    const { username } = await createUser(true);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password });
    expect(login.status).toBe(200);
    expect(login.body.data.user.mustChangePassword).toBe(true);
    const oldRefreshCookie = refreshCookieFrom(login);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.body.data.mustChangePassword).toBe(true);

    const newPassword = 'New@12345';
    const changed = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ currentPassword: password, newPassword });
    expect(changed.status).toBe(200);
    expect(changed.body.data.success).toBe(true);

    const refreshAfter = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', oldRefreshCookie);
    expect(refreshAfter.status).toBe(401);

    const loginOld = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password });
    expect(loginOld.status).toBe(401);

    const loginNew = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password: newPassword });
    expect(loginNew.status).toBe(200);
    expect(loginNew.body.data.user.mustChangePassword).toBe(false);
  });

  it('sai currentPassword → 401 AUTH_INVALID_CREDENTIALS, không đổi gì', async () => {
    const { username } = await createUser(false);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ currentPassword: 'Sai@Mat123', newPassword: 'New@12345' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

    const stillOldPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password });
    expect(stillOldPassword.status).toBe(200);
  });

  it('newPassword quá ngắn (< 8 ký tự) → 400 VALIDATION_ERROR', async () => {
    const { username } = await createUser(false);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ currentPassword: password, newPassword: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
