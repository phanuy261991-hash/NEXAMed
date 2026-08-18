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
 * HTTP e2e cho `/api/v1/roles*` (ADM-07 — vai trò tuỳ biến + ma trận phân quyền). Cùng khuôn
 * `reference-catalog-http.spec.ts`/`user-account-http.spec.ts`. Trọng tâm riêng: 5 vai trò hệ
 * thống bất biến tên (`RoleImmutableError`), ẩn vai trò còn tài khoản gán bị chặn
 * (`RoleInUseError`), ma trận luôn trả đủ toàn bộ danh mục permission kể cả quyền chưa cấp.
 */
describe('HTTP e2e — /api/v1/roles', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const adminPassword = 'Admin@12345';

  let clinicAdminToken: string;
  let doctorToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string, password = adminPassword) {
    const username = `e2e-role-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
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

  /** Đăng nhập thành công cũng tăng `version` của `user_account` — đọc version hiện tại thay vì đoán. */
  async function currentUserVersion(token: string, id: string): Promise<number> {
    const res = await request(app.getHttpServer()).get(`/api/v1/users/${id}`).set(authed(token));
    return res.body.data.version as number;
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

    fixture = await createTwoTenantFixture(privileged, 'Role e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    doctorToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/roles');
    expect(res.status).toBe(401);
  });

  it('vai trò không có role_permission.manage (doctor) → 403 PERMISSION_DENIED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(doctorToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('GET /roles → đủ 5 vai trò mặc định, isSystemDefault đúng', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    const names = res.body.data.items.map((r: { name: string }) => r.name).sort();
    expect(names).toEqual(['clinic_admin', 'doctor', 'nurse', 'receptionist', 'system_admin']);
    expect(res.body.data.items.every((r: { isSystemDefault: boolean }) => r.isSystemDefault)).toBe(true);
  });

  it('cách ly tenant: GET /roles tenant B không thấy vai trò của tenant A (không lẫn 5+5)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(tenantBAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(5);
  });

  it('đổi tên vai trò hệ thống → 422 ROLE_IMMUTABLE', async () => {
    const list = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
    const doctorRole = list.body.data.items.find((r: { name: string }) => r.name === 'doctor');

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/roles/${doctorRole.id}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'Bác sĩ chính', version: doctorRole.version });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ROLE_IMMUTABLE');
  });

  it('ẩn vai trò hệ thống → 422 ROLE_IMMUTABLE', async () => {
    const list = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
    const nurseRole = list.body.data.items.find((r: { name: string }) => r.name === 'nurse');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/roles/${nurseRole.id}/hide`)
      .set(authed(clinicAdminToken))
      .send({ version: nurseRole.version });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ROLE_IMMUTABLE');
  });

  it('GET /roles/:id/permissions của vai trò mặc định → đủ toàn bộ danh mục, scope đúng ma trận seed', async () => {
    const list = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
    const doctorRole = list.body.data.items.find((r: { name: string }) => r.name === 'doctor');

    const res = await request(app.getHttpServer()).get(`/api/v1/roles/${doctorRole.id}/permissions`).set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.role.name).toBe('doctor');
    // Ma trận trả ĐỦ toàn bộ danh mục permission (>=25), không chỉ những dòng doctor đã được cấp.
    expect(res.body.data.permissions.length).toBeGreaterThanOrEqual(25);

    const patientRead = res.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'read');
    expect(patientRead.dataScope).toBe('global');
    // doctor chưa từng được cấp patient.merge — quyền chưa cấp vẫn xuất hiện, scope 'none'.
    const patientMerge = res.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'merge');
    expect(patientMerge.dataScope).toBe('none');
  });

  describe('vai trò tuỳ biến', () => {
    let customRoleId: string;
    let customRoleVersion: number;
    const roleName = `Lễ tân trưởng ${randomUUID().slice(0, 8)}`;

    it('tạo vai trò tuỳ biến → 200, isSystemDefault=false, ma trận toàn "none"', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: roleName });
      expect(res.status).toBe(200);
      expect(res.body.data.isSystemDefault).toBe(false);
      customRoleId = res.body.data.id;
      customRoleVersion = res.body.data.version;

      const matrix = await request(app.getHttpServer()).get(`/api/v1/roles/${customRoleId}/permissions`).set(authed(clinicAdminToken));
      expect(matrix.body.data.permissions.every((p: { dataScope: string }) => p.dataScope === 'none')).toBe(true);
    });

    it('trùng tên vai trò trong cùng tenant → 409 ROLE_DUPLICATE_NAME', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: roleName });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROLE_DUPLICATE_NAME');
    });

    it('cùng tên vai trò khác tenant vẫn tạo được (unique theo tenant)', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(tenantBAdminToken)).send({ name: roleName });
      expect(res.status).toBe(200);
    });

    it('PUT ma trận → cấp một số quyền, GET lại đúng, quyền không gửi vẫn "none"', async () => {
      const catalog = await request(app.getHttpServer()).get(`/api/v1/roles/${customRoleId}/permissions`).set(authed(clinicAdminToken));
      const patientRead = catalog.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'read');
      const patientCreate = catalog.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'create');

      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${customRoleId}/permissions`)
        .set(authed(clinicAdminToken))
        .send({
          entries: [
            { permissionId: patientRead.permissionId, dataScope: 'global' },
            { permissionId: patientCreate.permissionId, dataScope: 'personal' },
          ],
        });
      expect(res.status).toBe(200);

      const readBack = res.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'read');
      const createBack = res.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'create');
      const updateBack = res.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'update');
      expect(readBack.dataScope).toBe('global');
      expect(createBack.dataScope).toBe('personal');
      expect(updateBack.dataScope).toBe('none');
    });

    it('PUT ma trận đổi một quyền đã cấp về "none" → xoá mềm dòng đó, GET lại đúng "none"', async () => {
      const catalog = await request(app.getHttpServer()).get(`/api/v1/roles/${customRoleId}/permissions`).set(authed(clinicAdminToken));
      const patientRead = catalog.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'read');
      expect(patientRead.dataScope).toBe('global');

      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${customRoleId}/permissions`)
        .set(authed(clinicAdminToken))
        .send({ entries: [{ permissionId: patientRead.permissionId, dataScope: 'none' }] });
      expect(res.status).toBe(200);

      const back = res.body.data.permissions.find((p: { module: string; action: string }) => p.module === 'patient' && p.action === 'read');
      expect(back.dataScope).toBe('none');
    });

    it('gán vai trò tuỳ biến này cho một tài khoản rồi ẩn → 409 ROLE_IN_USE', async () => {
      const staff = await createUserWithRole(fixture.tenantA.id, 'receptionist');
      const receptionistRole = await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: 'receptionist' } });

      const assign = await request(app.getHttpServer())
        .patch(`/api/v1/users/${staff.userId}`)
        .set(authed(clinicAdminToken))
        .send({ roleIds: [customRoleId], version: await currentUserVersion(clinicAdminToken, staff.userId) });
      expect(assign.status).toBe(200);

      const hide = await request(app.getHttpServer())
        .post(`/api/v1/roles/${customRoleId}/hide`)
        .set(authed(clinicAdminToken))
        .send({ version: customRoleVersion });
      expect(hide.status).toBe(409);
      expect(hide.body.error.code).toBe('ROLE_IN_USE');

      // Gỡ vai trò khỏi tài khoản để không chặn các test ẩn/đổi tên còn lại bên dưới.
      const unassign = await request(app.getHttpServer())
        .patch(`/api/v1/users/${staff.userId}`)
        .set(authed(clinicAdminToken))
        .send({ roleIds: [receptionistRole.id], version: await currentUserVersion(clinicAdminToken, staff.userId) });
      expect(unassign.status).toBe(200);
    });

    it('đổi tên vai trò tuỳ biến → 200, version tăng', async () => {
      const newName = `${roleName} (đổi tên)`;
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/roles/${customRoleId}`)
        .set(authed(clinicAdminToken))
        .send({ name: newName, version: customRoleVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe(newName);
      customRoleVersion = res.body.data.version;
    });

    it('đổi tên với version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/roles/${customRoleId}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Tên khác', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('cách ly tenant: tenant B không sửa/ẩn được vai trò tuỳ biến của tenant A → 404', async () => {
      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/roles/${customRoleId}`)
        .set(authed(tenantBAdminToken))
        .send({ name: 'Chiếm quyền', version: customRoleVersion });
      expect(patch.status).toBe(404);

      const hide = await request(app.getHttpServer())
        .post(`/api/v1/roles/${customRoleId}/hide`)
        .set(authed(tenantBAdminToken))
        .send({ version: customRoleVersion });
      expect(hide.status).toBe(404);
    });

    it('ẩn vai trò tuỳ biến không còn ai gán → 200; GET /roles không còn thấy nữa', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/roles/${customRoleId}/hide`)
        .set(authed(clinicAdminToken))
        .send({ version: customRoleVersion });
      expect(res.status).toBe(200);

      const list = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
      expect(list.body.data.items.some((r: { id: string }) => r.id === customRoleId)).toBe(false);
    });

    it('tạo lại đúng tên vai trò đã ẩn trước đó không lỗi (partial unique index đúng như kỳ vọng)', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: roleName });
      expect(res.status).toBe(200);
    });
  });
});