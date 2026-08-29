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
 * HTTP e2e cho module `clinic` (S2-07, ADM-02 trừ mẫu in) — cùng khuôn với các spec HTTP e2e
 * khác từ S2. `room` và `clinic-settings` dùng chung permission `clinic_config.*` (xem
 * packages/shared/src/clinic.ts).
 */
describe('HTTP e2e — /api/v1/rooms và /api/v1/clinic-settings', () => {
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

    fixture = await createTwoTenantFixture(privileged, 'Clinic e2e');
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

  describe('/api/v1/rooms', () => {
    it('không có access token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/rooms');
      expect(res.status).toBe(401);
    });

    it('vai trò không có clinic_config.update (receptionist) → 403 PERMISSION_DENIED', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set(authed(receptionistToken))
        .send({ name: 'Phòng khám 1' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('clinic_admin tạo phòng → 200; GET danh sách thấy phòng vừa tạo (không phân trang)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set(authed(clinicAdminToken))
        .send({ name: 'Phòng khám 1' });

      expect(created.status).toBe(200);
      expect(created.body.data.name).toBe('Phòng khám 1');
      expect(created.body.data.isActive).toBe(true);
      expect(created.body.data.version).toBe(1);

      const list = await request(app.getHttpServer()).get('/api/v1/rooms').set(authed(clinicAdminToken));
      expect(list.status).toBe(200);
      expect(list.body.data.items.some((r: { id: string }) => r.id === created.body.data.id)).toBe(true);
    });

    it('PATCH sửa tên + khoá phòng (isActive=false) → 200, version tăng', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set(authed(clinicAdminToken))
        .send({ name: 'Phòng tạm' });
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/rooms/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Phòng đã đổi tên', isActive: false, version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Phòng đã đổi tên');
      expect(res.body.data.isActive).toBe(false);
      expect(res.body.data.version).toBe(2);
    });

    it('PATCH với version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set(authed(clinicAdminToken))
        .send({ name: 'Phòng khác' });
      const id = created.body.data.id as string;

      await request(app.getHttpServer())
        .patch(`/api/v1/rooms/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Đổi lần 1', version: 1 });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/rooms/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Đổi lần 2 (dùng version cũ)', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('tenant B không thấy phòng của tenant A trong danh sách; sửa phòng tenant A → 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set(authed(clinicAdminToken))
        .send({ name: 'Phòng riêng tư tenant A' });
      const id = created.body.data.id as string;

      const list = await request(app.getHttpServer()).get('/api/v1/rooms').set(authed(tenantBAdminToken));
      expect(list.status).toBe(200);
      expect(list.body.data.items.some((r: { id: string }) => r.id === id)).toBe(false);

      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/rooms/${id}`)
        .set(authed(tenantBAdminToken))
        .send({ name: 'Không được phép', version: 1 });
      expect(patch.status).toBe(404);
    });
  });

  describe('/api/v1/clinic-settings', () => {
    it('không có access token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings');
      expect(res.status).toBe(401);
    });

    it('vai trò không có clinic_config.read (receptionist) → 403 PERMISSION_DENIED', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(receptionistToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('GET lúc chưa cấu hình → slotDurationMinutes mặc định 15, businessHours null, overdueWaitWarningMinutes mặc định 30', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(tenantBAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.slotDurationMinutes).toBe(15);
      expect(res.body.data.businessHours).toBeNull();
      expect(res.body.data.overdueWaitWarningMinutes).toBe(30);
    });

    it('PATCH overdueWaitWarningMinutes → 200, GET phản ánh đúng giá trị mới, độc lập với tenant khác', async () => {
      const patch = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ overdueWaitWarningMinutes: 45 });
      expect(patch.status).toBe(200);
      expect(patch.body.data.overdueWaitWarningMinutes).toBe(45);

      const get = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(clinicAdminToken));
      expect(get.body.data.overdueWaitWarningMinutes).toBe(45);

      const tenantBGet = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(tenantBAdminToken));
      expect(tenantBGet.body.data.overdueWaitWarningMinutes).toBe(30);
    });

    it('overdueWaitWarningMinutes ngoài khoảng 1-240 → 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ overdueWaitWarningMinutes: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET lúc chưa cấu hình → noShowAutoEnabled mặc định false, noShowThresholdMinutes mặc định 60 (S5-07, APP-05)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(tenantBAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.noShowAutoEnabled).toBe(false);
      expect(res.body.data.noShowThresholdMinutes).toBe(60);
    });

    it('PATCH noShowAutoEnabled + noShowThresholdMinutes → 200, GET phản ánh đúng giá trị mới, độc lập với tenant khác', async () => {
      const patch = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ noShowAutoEnabled: true, noShowThresholdMinutes: 90 });
      expect(patch.status).toBe(200);
      expect(patch.body.data.noShowAutoEnabled).toBe(true);
      expect(patch.body.data.noShowThresholdMinutes).toBe(90);

      const get = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(clinicAdminToken));
      expect(get.body.data.noShowAutoEnabled).toBe(true);
      expect(get.body.data.noShowThresholdMinutes).toBe(90);

      const tenantBGet = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(tenantBAdminToken));
      expect(tenantBGet.body.data.noShowAutoEnabled).toBe(false);
      expect(tenantBGet.body.data.noShowThresholdMinutes).toBe(60);
    });

    it('noShowThresholdMinutes ngoài khoảng 1-1440 → 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ noShowThresholdMinutes: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH slotDurationMinutes → 200, GET phản ánh đúng giá trị mới', async () => {
      const patch = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ slotDurationMinutes: 20 });
      expect(patch.status).toBe(200);
      expect(patch.body.data.slotDurationMinutes).toBe(20);

      const get = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(clinicAdminToken));
      expect(get.body.data.slotDurationMinutes).toBe(20);
    });

    it('PATCH businessHours → 200, round-trip đúng cấu trúc theo ngày trong tuần', async () => {
      const businessHours = {
        monday: { open: '08:00', close: '17:00' },
        tuesday: { open: '08:00', close: '17:00' },
        wednesday: { open: '08:00', close: '17:00' },
        thursday: { open: '08:00', close: '17:00' },
        friday: { open: '08:00', close: '17:00' },
        saturday: { open: '08:00', close: '12:00' },
        sunday: null,
      };

      const patch = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ businessHours });
      expect(patch.status).toBe(200);
      expect(patch.body.data.businessHours).toEqual(businessHours);
      // slotDurationMinutes không gửi trong request này — phải giữ nguyên giá trị đã đặt ở test trước.
      expect(patch.body.data.slotDurationMinutes).toBe(20);
    });

    it('giờ sai định dạng (không phải HH:mm) → 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/clinic-settings')
        .set(authed(clinicAdminToken))
        .send({ businessHours: { monday: { open: '8h', close: '17:00' } } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('cấu hình của tenant A và tenant B độc lập nhau', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(tenantBAdminToken));
      expect(res.status).toBe(200);
      // tenant B chưa từng PATCH — vẫn phải là mặc định, không lẫn giá trị 20 của tenant A.
      expect(res.body.data.slotDurationMinutes).toBe(15);
    });
  });

  describe('/api/v1/clinic-settings/deferred-payment-enabled (Thu ngân cơ bản, Sprint 5/6)', () => {
    it('không có access token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings/deferred-payment-enabled');
      expect(res.status).toBe(401);
    });

    it('lễ tân (KHÔNG có clinic_config.read) → vẫn 200 (tự-phục vụ, đúng khuôn GET /appointments/doctors #030)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings/deferred-payment-enabled').set(authed(receptionistToken));
      expect(res.status).toBe(200);
      expect(typeof res.body.data.enabled).toBe('boolean');
    });

    it('mặc định false khi chưa cấu hình, PATCH bật lên → GET tự-phục vụ phản ánh đúng ngay', async () => {
      const before = await request(app.getHttpServer()).get('/api/v1/clinic-settings/deferred-payment-enabled').set(authed(tenantBAdminToken));
      expect(before.body.data.enabled).toBe(false);

      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ deferredPaymentEnabled: true });

      const after = await request(app.getHttpServer()).get('/api/v1/clinic-settings/deferred-payment-enabled').set(authed(receptionistToken));
      expect(after.body.data.enabled).toBe(true);
    });

    it('tenant B độc lập — bật ở tenant A không ảnh hưởng tenant B', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings/deferred-payment-enabled').set(authed(tenantBAdminToken));
      expect(res.body.data.enabled).toBe(false);
    });
  });
});
