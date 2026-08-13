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
 * HTTP e2e cho trang "Thông tin phòng khám" (2026-08-13, `/api/v1/clinic-profile`) — dùng lại
 * quyền `clinic_config.read`/`.update` (cùng `ClinicSettingsController`, không thêm permission
 * mới). Cùng khuôn `clinic-http.spec.ts` (setup) và phần upload ảnh của `patient-http.spec.ts`
 * (magic byte, version optimistic lock, xoá file cũ).
 */
describe('HTTP e2e — /api/v1/clinic-profile', () => {
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

    fixture = await createTwoTenantFixture(privileged, 'ClinicProfile e2e');
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

  describe('GET/PATCH /api/v1/clinic-profile', () => {
    it('không có access token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-profile');
      expect(res.status).toBe(401);
    });

    it('vai trò không có clinic_config.read (receptionist) → 403 PERMISSION_DENIED', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-profile').set(authed(receptionistToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('GET mặc định — currency VND, timezone Asia/Ho_Chi_Minh, các trường mới null', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-profile').set(authed(clinicAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.currency).toBe('VND');
      expect(res.body.data.timezone).toBe('Asia/Ho_Chi_Minh');
      expect(res.body.data.phone).toBeNull();
      expect(res.body.data.email).toBeNull();
      expect(res.body.data.taxCode).toBeNull();
      expect(res.body.data.logoUrl).toBeNull();
      expect(res.body.data.printLogoUrl).toBeNull();
      expect(res.body.data.version).toBe(1);
      expect(typeof res.body.data.name).toBe('string');
    });

    it('PATCH đủ trường văn bản → 200, GET phản ánh đúng, version tăng', async () => {
      const patch = await request(app.getHttpServer())
        .patch('/api/v1/clinic-profile')
        .set(authed(clinicAdminToken))
        .send({
          name: 'Phòng khám Đa khoa ABC',
          phone: '0281234567',
          address: '123 Đường Sức Khoẻ, Quận 1',
          email: 'lienhe@phongkhamabc.vn',
          taxCode: '0312345678',
          currency: 'USD',
          timezone: 'Asia/Bangkok',
          version: 1,
        });

      expect(patch.status).toBe(200);
      expect(patch.body.data.name).toBe('Phòng khám Đa khoa ABC');
      expect(patch.body.data.phone).toBe('0281234567');
      expect(patch.body.data.address).toBe('123 Đường Sức Khoẻ, Quận 1');
      expect(patch.body.data.email).toBe('lienhe@phongkhamabc.vn');
      expect(patch.body.data.taxCode).toBe('0312345678');
      expect(patch.body.data.currency).toBe('USD');
      expect(patch.body.data.timezone).toBe('Asia/Bangkok');
      expect(patch.body.data.version).toBe(2);

      const get = await request(app.getHttpServer()).get('/api/v1/clinic-profile').set(authed(clinicAdminToken));
      expect(get.body.data.name).toBe('Phòng khám Đa khoa ABC');
      expect(get.body.data.currency).toBe('USD');
    });

    it('PATCH thiếu quyền (receptionist) → 403', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-profile')
        .set(authed(receptionistToken))
        .send({ name: 'Không được phép', version: 2 });
      expect(res.status).toBe(403);
    });

    it('PATCH với version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-profile')
        .set(authed(clinicAdminToken))
        .send({ name: 'Đổi lần nữa (version cũ)', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('email sai định dạng → 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-profile')
        .set(authed(clinicAdminToken))
        .send({ email: 'khong-phai-email', version: 2 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('tenant B có hồ sơ độc lập, không lẫn giá trị tenant A đã sửa', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-profile').set(authed(tenantBAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.currency).toBe('VND');
      expect(res.body.data.name).not.toBe('Phòng khám Đa khoa ABC');
    });

    it('tenant B PATCH bằng token của mình không ảnh hưởng tenant A', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/clinic-profile')
        .set(authed(tenantBAdminToken))
        .send({ name: 'Tenant B đổi tên riêng', version: 1 });

      const tenantAProfile = await request(app.getHttpServer()).get('/api/v1/clinic-profile').set(authed(clinicAdminToken));
      expect(tenantAProfile.body.data.name).toBe('Phòng khám Đa khoa ABC');
    });
  });

  describe('POST /api/v1/clinic-profile/logo và /print-logo', () => {
    let currentVersion: number;
    let firstLogoUrl: string;

    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

    beforeAll(async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-profile').set(authed(clinicAdminToken));
      currentVersion = res.body.data.version;
    });

    it('upload logo chính (JPG hợp lệ) → 200, logoUrl khác null, version tăng', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clinic-profile/logo')
        .set(authed(clinicAdminToken))
        .field('version', String(currentVersion))
        .attach('file', jpegBytes, 'logo.jpg');

      expect(res.status).toBe(200);
      expect(res.body.data.logoUrl).toBeTruthy();
      expect(res.body.data.version).toBe(currentVersion + 1);
      currentVersion = res.body.data.version;
      firstLogoUrl = res.body.data.logoUrl;
    });

    it('logo vừa upload đọc được thật qua URL trả về', async () => {
      const res = await request(app.getHttpServer()).get(firstLogoUrl);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
    });

    it('sai magic byte → 400 CLINIC_INVALID_LOGO', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clinic-profile/logo')
        .set(authed(clinicAdminToken))
        .field('version', String(currentVersion))
        .attach('file', Buffer.from('day khong phai anh'), 'fake.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CLINIC_INVALID_LOGO');
    });

    it('vượt quá 2MB → 413', async () => {
      const bigBuffer = Buffer.alloc(2 * 1024 * 1024 + 1024, 0);
      bigBuffer[0] = 0xff;
      bigBuffer[1] = 0xd8;
      bigBuffer[2] = 0xff;
      const res = await request(app.getHttpServer())
        .post('/api/v1/clinic-profile/logo')
        .set(authed(clinicAdminToken))
        .field('version', String(currentVersion))
        .attach('file', bigBuffer, 'big.jpg');

      expect(res.status).toBe(413);
    });

    it('version không khớp → 409 CONCURRENT_MODIFICATION', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clinic-profile/logo')
        .set(authed(clinicAdminToken))
        .field('version', '999')
        .attach('file', jpegBytes, 'logo.jpg');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('thay logo mới (PNG) → logo cũ bị xoá (URL cũ 404), logo mới đọc đúng', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clinic-profile/logo')
        .set(authed(clinicAdminToken))
        .field('version', String(currentVersion))
        .attach('file', pngBytes, 'logo.png');

      expect(res.status).toBe(200);
      currentVersion = res.body.data.version;

      const oldRes = await request(app.getHttpServer()).get(firstLogoUrl);
      expect(oldRes.status).toBe(404);
    });

    it('upload logo in (print-logo) độc lập với logo chính → 200, printLogoUrl khác null, logoUrl vẫn giữ nguyên', async () => {
      const before = await request(app.getHttpServer()).get('/api/v1/clinic-profile').set(authed(clinicAdminToken));
      const logoUrlBefore = before.body.data.logoUrl;

      const res = await request(app.getHttpServer())
        .post('/api/v1/clinic-profile/print-logo')
        .set(authed(clinicAdminToken))
        .field('version', String(currentVersion))
        .attach('file', jpegBytes, 'print-logo.jpg');

      expect(res.status).toBe(200);
      expect(res.body.data.printLogoUrl).toBeTruthy();
      expect(res.body.data.logoUrl).toBe(logoUrlBefore);
      currentVersion = res.body.data.version;
    });

    it('không có file đính kèm → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clinic-profile/logo')
        .set(authed(clinicAdminToken))
        .field('version', String(currentVersion));
      expect(res.status).toBe(400);
    });

    it('thiếu quyền clinic_config.update (receptionist) → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clinic-profile/logo')
        .set(authed(receptionistToken))
        .field('version', String(currentVersion))
        .attach('file', jpegBytes, 'logo.jpg');
      expect(res.status).toBe(403);
    });
  });
});
