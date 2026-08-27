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
 * HTTP e2e cho phần "hồ sơ nhân sự" + tự động vô hiệu hoá theo Trạng thái làm việc + module
 * `department` (mở rộng ADM-01, 2026-08-20) — TÁCH RIÊNG khỏi `user-account-http.spec.ts` dù cùng
 * domain, vì `user-account-http.spec.ts` đã dùng gần hết ngưỡng `ThrottlerGuard` cho
 * `/auth/login` (10 request/phút/IP, `IamModule`) với các test đổi vai trò/vô hiệu hoá/đặt lại
 * mật khẩu (mỗi test đăng nhập lại 1-3 lần để lấy refresh cookie thật) — thêm test đăng nhập vào
 * CÙNG file/app instance đó sẽ đụng ngưỡng (xác nhận thật qua chạy test: 429 TOO_MANY_REQUESTS).
 * App instance riêng ở đây có bucket throttle riêng, không tranh chấp.
 */
describe('HTTP e2e — /api/v1/users (hồ sơ nhân sự + Trạng thái làm việc), /api/v1/departments', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const staffPassword = 'Staff@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string, password = 'Admin@12345') {
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

  async function roleId(tenantId: string, roleName: string): Promise<string> {
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    return role.id;
  }

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

  async function createEmploymentStatus(name: string, deactivatesAccount: boolean): Promise<string> {
    const code = `E2E-${randomUUID().slice(0, 8)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'EMPLOYMENT_STATUS', code, name, sortOrder: 900, deactivatesAccount });
    expect(res.status).toBe(200);
    return code;
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

    fixture = await createTwoTenantFixture(privileged, 'UserAccountHrProfile e2e');
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

  /** Mở rộng ADM-01 (2026-08-20) — hồ sơ nhân sự + tự động vô hiệu hoá theo Trạng thái làm việc. */
  describe('hồ sơ nhân sự + tự động vô hiệu hoá theo Trạng thái làm việc', () => {
    it('tạo tài khoản đủ hồ sơ nhân sự → employeeCode tự sinh đúng khuôn NV<yyMM><seq>, lưu đúng field', async () => {
      const username = `e2e-hr-${randomUUID()}`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(authed(clinicAdminToken))
        .send({
          username,
          password: staffPassword,
          fullName: 'Nhân sự đủ hồ sơ',
          displayName: 'Nhân sự đủ hồ sơ',
          phone: '0900000000',
          email: 'nhansu@example.com',
          dob: '1990-05-20',
          gender: 'female',
          licenseIssuedAt: '2015-01-10',
          licenseIssuedPlace: 'Sở Y tế TP.HCM',
          canSignMedicalRecord: true,
          mustChangePassword: true,
          roleIds: [await roleId(fixture.tenantA.id, 'nurse')],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.employeeCode).toMatch(/^NV\d{4}\d{6}$/);
      expect(res.body.data.phone).toBe('0900000000');
      expect(res.body.data.email).toBe('nhansu@example.com');
      expect(res.body.data.dob).toBe('1990-05-20');
      expect(res.body.data.gender).toBe('female');
      expect(res.body.data.licenseIssuedAt).toBe('2015-01-10');
      expect(res.body.data.licenseIssuedPlace).toBe('Sở Y tế TP.HCM');
      expect(res.body.data.canSignMedicalRecord).toBe(true);
      expect(res.body.data.mustChangePassword).toBe(true);
    });

    it('tạo tài khoản với Trạng thái làm việc tự-vô-hiệu-hoá (không isActive tường minh) → isActive=false ngay từ đầu, không lỗi', async () => {
      const resignedCode = await createEmploymentStatus('Nghỉ việc (tạo mới)', true);
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(authed(clinicAdminToken))
        .send({
          username: `e2e-resigned-${randomUUID()}`,
          password: staffPassword,
          fullName: 'Nhân sự nghỉ việc từ đầu',
          displayName: 'Nhân sự nghỉ việc từ đầu',
          employmentStatusCode: resignedCode,
          roleIds: [await roleId(fixture.tenantA.id, 'nurse')],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
    });

    it('đổi Trạng thái làm việc sang nhóm tự-vô-hiệu-hoá → isActive tự false, THU HỒI phiên đang mở', async () => {
      const username = `e2e-deact-${randomUUID()}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(authed(clinicAdminToken))
        .send({
          username,
          password: staffPassword,
          fullName: 'Sắp nghỉ việc',
          displayName: 'Sắp nghỉ việc',
          roleIds: [await roleId(fixture.tenantA.id, 'nurse')],
        });
      const userId = created.body.data.id as string;

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: fixture.tenantA.id, username, password: staffPassword });
      expect(login.status).toBe(200);
      const oldRefreshCookie = refreshCookieFrom(login);

      const resignedCode = await createEmploymentStatus('Nghỉ việc (đổi sau)', true);
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(authed(clinicAdminToken))
        .send({ employmentStatusCode: resignedCode, version: await currentVersion(clinicAdminToken, userId) });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);

      const refreshAfter = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', oldRefreshCookie);
      expect(refreshAfter.status).toBe(401);
    });

    it('cố ép isActive:true trong khi Trạng thái làm việc vẫn tự-vô-hiệu-hoá → 409 ACCOUNT_CANNOT_REACTIVATE_WHILE_RESIGNED', async () => {
      const resignedCode = await createEmploymentStatus('Nghỉ việc (chặn kích hoạt lại)', true);
      const username = `e2e-noreact-${randomUUID()}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(authed(clinicAdminToken))
        .send({
          username,
          password: staffPassword,
          fullName: 'Đã nghỉ việc',
          displayName: 'Đã nghỉ việc',
          employmentStatusCode: resignedCode,
          roleIds: [await roleId(fixture.tenantA.id, 'nurse')],
        });
      const userId = created.body.data.id as string;
      expect(created.body.data.isActive).toBe(false);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}`)
        .set(authed(clinicAdminToken))
        .send({ isActive: true, version: await currentVersion(clinicAdminToken, userId) });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ACCOUNT_CANNOT_REACTIVATE_WHILE_RESIGNED');
    });

    it('Trạng thái làm việc không tự-vô-hiệu-hoá (ví dụ "Đang làm") → không ảnh hưởng isActive', async () => {
      const activeCode = await createEmploymentStatus('Đang làm (test)', false);
      const username = `e2e-active-${randomUUID()}`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(authed(clinicAdminToken))
        .send({
          username,
          password: staffPassword,
          fullName: 'Đang làm việc',
          displayName: 'Đang làm việc',
          employmentStatusCode: activeCode,
          roleIds: [await roleId(fixture.tenantA.id, 'nurse')],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
    });
  });

  /** Mở rộng ADM-01 — Khoa/Phòng (module `department`, lần đầu có API thật). */
  describe('/api/v1/departments', () => {
    it('clinic_admin tạo phòng ban → 200; GET danh sách thấy đúng', async () => {
      const name = `Khoa Test ${randomUUID().slice(0, 8)}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set(authed(clinicAdminToken))
        .send({ name });
      expect(created.status).toBe(200);
      expect(created.body.data.name).toBe(name);

      const list = await request(app.getHttpServer()).get('/api/v1/departments').set(authed(clinicAdminToken));
      expect(list.status).toBe(200);
      expect(list.body.data.items.some((d: { id: string }) => d.id === created.body.data.id)).toBe(true);
    });

    it('cách ly tenant: tenant B không thấy phòng ban vừa tạo ở tenant A', async () => {
      const name = `Khoa Riêng Tenant A ${randomUUID().slice(0, 8)}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set(authed(clinicAdminToken))
        .send({ name });

      const listFromTenantB = await request(app.getHttpServer())
        .get('/api/v1/departments')
        .set(authed(tenantBAdminToken));
      expect(listFromTenantB.body.data.items.some((d: { id: string }) => d.id === created.body.data.id)).toBe(false);
    });

    it('receptionist (không có user_account.manage) tạo phòng ban → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set(authed(receptionistToken))
        .send({ name: 'Không được phép' });
      expect(res.status).toBe(403);
    });

    it('PATCH đổi tên/ẩn phòng ban → 200, version tăng; version cũ → 409; tenant B PATCH phòng ban tenant A → 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set(authed(clinicAdminToken))
        .send({ name: `Khoa Test PATCH ${randomUUID().slice(0, 8)}` });
      const id = created.body.data.id as string;
      expect(created.body.data.isActive).toBe(true);

      const renamed = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Đã đổi tên', isActive: false, version: created.body.data.version });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.name).toBe('Đã đổi tên');
      expect(renamed.body.data.isActive).toBe(false);
      expect(renamed.body.data.version).toBe(created.body.data.version + 1);

      const staleVersion = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Không áp dụng', version: created.body.data.version });
      expect(staleVersion.status).toBe(409);
      expect(staleVersion.body.error.code).toBe('CONCURRENT_MODIFICATION');

      const crossTenant = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${id}`)
        .set(authed(tenantBAdminToken))
        .send({ name: 'Không được phép', version: renamed.body.data.version });
      expect(crossTenant.status).toBe(404);
    });
  });

  /** Redesign form "Thêm tài khoản" sang 3-tab (docs/DECISIONS.md #082) — chữ ký + Phòng khám mặc định + vô hiệu hoá nhanh. */
  describe('redesign 3-tab (#082): chữ ký, Phòng khám mặc định, vô hiệu hoá/kích hoạt lại', () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

    async function createRoom(name: string): Promise<{ id: string }> {
      const res = await request(app.getHttpServer()).post('/api/v1/rooms').set(authed(clinicAdminToken)).send({ name });
      expect(res.status).toBe(200);
      return { id: res.body.data.id as string };
    }

    async function createAccount(overrides: Record<string, unknown> = {}) {
      const username = `e2e-tab-${randomUUID()}`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(authed(clinicAdminToken))
        .send({
          username,
          password: staffPassword,
          fullName: 'Tài khoản 3-tab',
          displayName: 'Tài khoản 3-tab',
          roleIds: [await roleId(fixture.tenantA.id, 'nurse')],
          ...overrides,
        });
      expect(res.status).toBe(200);
      return res.body.data as { id: string; version: number; signatureUrl: string | null; defaultRoomId: string | null };
    }

    it('tạo tài khoản kèm defaultRoomId hợp lệ → lưu đúng, signatureUrl null khi chưa upload', async () => {
      const room = await createRoom(`Phòng mặc định ${randomUUID().slice(0, 8)}`);
      const created = await createAccount({ defaultRoomId: room.id });
      expect(created.defaultRoomId).toBe(room.id);
      expect(created.signatureUrl).toBeNull();
    });

    it('upload chữ ký PNG hợp lệ → 200, signatureUrl khác null, đọc được thật đúng content-type; sai định dạng (JPG) → 400 USER_ACCOUNT_INVALID_SIGNATURE', async () => {
      const created = await createAccount();

      const badFormat = await request(app.getHttpServer())
        .post(`/api/v1/users/${created.id}/signature`)
        .set(authed(clinicAdminToken))
        .field('version', String(created.version))
        .attach('file', jpegBytes, 'signature.jpg');
      expect(badFormat.status).toBe(400);
      expect(badFormat.body.error.code).toBe('USER_ACCOUNT_INVALID_SIGNATURE');

      const ok = await request(app.getHttpServer())
        .post(`/api/v1/users/${created.id}/signature`)
        .set(authed(clinicAdminToken))
        .field('version', String(created.version))
        .attach('file', pngBytes, 'signature.png');
      expect(ok.status).toBe(200);
      expect(ok.body.data.signatureUrl).toBeTruthy();
      expect(ok.body.data.version).toBe(created.version + 1);

      const fileRes = await request(app.getHttpServer()).get(ok.body.data.signatureUrl);
      expect(fileRes.status).toBe(200);
      expect(fileRes.headers['content-type']).toContain('image/png');
    });

    it('cách ly tenant: tenant B upload chữ ký cho tài khoản tenant A → 404', async () => {
      const created = await createAccount();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${created.id}/signature`)
        .set(authed(tenantBAdminToken))
        .field('version', String(created.version))
        .attach('file', pngBytes, 'signature.png');
      expect(res.status).toBe(404);
    });

    it('vô hiệu hoá nhanh (PATCH isActive:false không kèm field khác) → 200, THU HỒI phiên đang mở; kích hoạt lại → 200', async () => {
      const username = `e2e-qd-${randomUUID()}`;
      const created = await createAccount({ username });

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: fixture.tenantA.id, username, password: staffPassword });
      expect(login.status).toBe(200);
      const oldRefreshCookie = refreshCookieFrom(login);

      // Đăng nhập thành công cũng tăng version của user_account (reset failedLoginCount) — đọc
      // lại version hiện tại thay vì dùng `created.version`, cùng lý do đã ghi ở
      // `user-account-http.spec.ts`.
      const deactivated = await request(app.getHttpServer())
        .patch(`/api/v1/users/${created.id}`)
        .set(authed(clinicAdminToken))
        .send({ isActive: false, version: await currentVersion(clinicAdminToken, created.id) });
      expect(deactivated.status).toBe(200);
      expect(deactivated.body.data.isActive).toBe(false);

      const refreshAfter = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', oldRefreshCookie);
      expect(refreshAfter.status).toBe(401);

      const reactivated = await request(app.getHttpServer())
        .patch(`/api/v1/users/${created.id}`)
        .set(authed(clinicAdminToken))
        .send({ isActive: true, version: deactivated.body.data.version });
      expect(reactivated.status).toBe(200);
      expect(reactivated.body.data.isActive).toBe(true);
    });
  });
});
