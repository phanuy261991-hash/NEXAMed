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
 * HTTP e2e cho module `iam` phần quản lý tài khoản (S2-07, ADM-01) — cùng khuôn với
 * `patient-http.spec.ts`/`appointment-http.spec.ts`. Trọng tâm riêng của module này: đổi vai trò
 * hoặc vô hiệu hoá tài khoản phải thu hồi THẬT phiên đang mở (.claude/docs/security-audit.md,
 * docs/DECISIONS.md #019) — xác minh bằng cách đăng nhập lấy refresh cookie thật, thao tác admin,
 * rồi thử refresh lại bằng cookie cũ.
 */
describe('HTTP e2e — /api/v1/users', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const adminPassword = 'Admin@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string, password = adminPassword) {
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

  /**
   * Đăng nhập thành công cũng tăng `version` của `user_account` (reset `failedLoginCount`, xem
   * `UserAccountAuthRepository.recordSuccessfulLogin` — mọi UPDATE đều tăng version theo
   * .claude/docs/data-model.md). Test dưới đây cần đăng nhập lại nhiều lần để lấy refresh cookie
   * mới, nên đọc version hiện tại qua GET ngay trước mỗi PATCH thay vì đếm tay — tránh test giòn
   * theo đúng số lần đăng nhập.
   */
  async function currentVersion(token: string, id: string): Promise<number> {
    const res = await request(app.getHttpServer()).get(`/api/v1/users/${id}`).set(authed(token));
    return res.body.data.version as number;
  }

  function refreshCookieFrom(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies?.find((c) => c.startsWith('refresh_token='));
    if (!cookie) throw new Error('Không thấy cookie refresh_token trong response — kiểm tra lại test.');
    return cookie;
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

    fixture = await createTwoTenantFixture(privileged, 'UserAccount e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  const staffPassword = 'Staff@12345';

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it('vai trò không có user_account.manage (receptionist) → 403 PERMISSION_DENIED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set(authed(receptionistToken))
      .send({ username: `x-${randomUUID()}`, password: staffPassword, fullName: 'X', roleNames: ['nurse'] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('thiếu trường bắt buộc (password) → 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set(authed(clinicAdminToken))
      .send({ username: `x-${randomUUID()}`, fullName: 'X', roleNames: ['nurse'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('vòng đời một tài khoản', () => {
    const username = `e2e-staff-${randomUUID()}`;
    let userId: string;

    it('clinic_admin tạo tài khoản hợp lệ → 200, không lộ mật khẩu/hash, đúng vai trò', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(authed(clinicAdminToken))
        .send({ username, password: staffPassword, fullName: 'Nhân viên E2E', roleNames: ['nurse'] });

      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe(username);
      expect(res.body.data.roleNames).toEqual(['nurse']);
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.passwordHash).toBeUndefined();
      expect(res.body.data.password).toBeUndefined();
      userId = res.body.data.id;

      const row = await privileged.userAccount.findUniqueOrThrow({ where: { id: userId } });
      expect(row.passwordHash).not.toBe(staffPassword);
    });

    it('trùng username trong cùng tenant → 409 USER_ACCOUNT_DUPLICATE_USERNAME', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(authed(clinicAdminToken))
        .send({ username, password: staffPassword, fullName: 'Trùng tên', roleNames: ['nurse'] });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('USER_ACCOUNT_DUPLICATE_USERNAME');
    });

    it('GET danh sách → thấy tài khoản vừa tạo', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users').set(authed(clinicAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.items.some((u: { id: string }) => u.id === userId)).toBe(true);
    });

    it('GET :id → đúng chi tiết; tenant B không thấy được → 404', async () => {
      const ok = await request(app.getHttpServer()).get(`/api/v1/users/${userId}`).set(authed(clinicAdminToken));
      expect(ok.status).toBe(200);
      expect(ok.body.data.fullName).toBe('Nhân viên E2E');

      const crossTenant = await request(app.getHttpServer()).get(`/api/v1/users/${userId}`).set(authed(tenantBAdminToken));
      expect(crossTenant.status).toBe(404);
    });

    it('PATCH :id sửa fullName (không đổi vai trò) → 200, version tăng, roleNames giữ nguyên', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(authed(clinicAdminToken))
        .send({ fullName: 'Tên đã sửa', version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBe('Tên đã sửa');
      expect(res.body.data.roleNames).toEqual(['nurse']);
      expect(res.body.data.version).toBe(2);
    });

    it('PATCH :id với version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(authed(clinicAdminToken))
        .send({ fullName: 'Không áp dụng', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('đổi vai trò (PATCH roleNames) → 200, cập nhật đúng, THU HỒI phiên đang mở (refresh cũ bị từ chối)', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: fixture.tenantA.id, username, password: staffPassword });
      expect(login.status).toBe(200);
      const oldRefreshCookie = refreshCookieFrom(login);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(authed(clinicAdminToken))
        .send({ roleNames: ['nurse', 'receptionist'], version: await currentVersion(clinicAdminToken, userId) });

      expect(res.status).toBe(200);
      expect(res.body.data.roleNames.sort()).toEqual(['nurse', 'receptionist']);

      const refreshAfter = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', oldRefreshCookie);
      expect(refreshAfter.status).toBe(401);
    });

    it('gán lại đúng vai trò đã từng gỡ trước đó không lỗi (partial unique index đúng như kỳ vọng)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(authed(clinicAdminToken))
        .send({ roleNames: ['nurse'], version: await currentVersion(clinicAdminToken, userId) });

      expect(res.status).toBe(200);
      expect(res.body.data.roleNames).toEqual(['nurse']);
    });

    it('vô hiệu hoá tài khoản (isActive=false) → 200, THU HỒI phiên đang mở, đăng nhập lại bị chặn', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: fixture.tenantA.id, username, password: staffPassword });
      expect(login.status).toBe(200);
      const oldRefreshCookie = refreshCookieFrom(login);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(authed(clinicAdminToken))
        .send({ isActive: false, version: await currentVersion(clinicAdminToken, userId) });
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);

      const refreshAfter = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', oldRefreshCookie);
      expect(refreshAfter.status).toBe(401);

      const loginAfter = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: fixture.tenantA.id, username, password: staffPassword });
      expect(loginAfter.status).toBe(403);
      expect(loginAfter.body.error.code).toBe('AUTH_ACCOUNT_DISABLED');
    });

    it('kích hoạt lại (isActive=true) để phục vụ test đặt lại mật khẩu bên dưới', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(authed(clinicAdminToken))
        .send({ isActive: true, version: await currentVersion(clinicAdminToken, userId) });
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
    });

    it('đặt lại mật khẩu → 200, mật khẩu cũ không dùng được nữa, mật khẩu mới dùng được, THU HỒI phiên cũ', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: fixture.tenantA.id, username, password: staffPassword });
      expect(login.status).toBe(200);
      const oldRefreshCookie = refreshCookieFrom(login);

      const newPassword = 'NewStaff@98765';
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${userId}/reset-password`)
        .set(authed(clinicAdminToken))
        .send({ newPassword, version: await currentVersion(clinicAdminToken, userId) });
      expect(res.status).toBe(200);

      const refreshAfter = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', oldRefreshCookie);
      expect(refreshAfter.status).toBe(401);

      const loginOldPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: fixture.tenantA.id, username, password: staffPassword });
      expect(loginOldPassword.status).toBe(401);

      const loginNewPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: fixture.tenantA.id, username, password: newPassword });
      expect(loginNewPassword.status).toBe(200);
    });
  });
});
