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
import { seedGeo } from '../../infrastructure/persistence/seed-geo';

/**
 * HTTP e2e cho module `geo` (danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống, read-only —
 * docs/DECISIONS.md #038). Cùng bản chất `reference_catalog`: bảng KHÔNG có `tenant_id`, nên
 * "cách ly tenant" ở đây có nghĩa NGƯỢC LẠI — xác nhận có chủ đích 2 tenant cùng thấy đúng một
 * danh mục chung, không phải cách ly. Quyền dùng lại `patient.read` (không thêm permission mới,
 * xem comment trong geo.controller.ts).
 */
describe('HTTP e2e — /api/v1/geo', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let systemAdminToken: string;
  let tenantBReceptionistToken: string;
  let onlyCatalogReadToken: string;
  let noPermissionToken: string;

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

  /** Vai trò TUỲ BIẾN chỉ có đúng các quyền cho trước (phạm vi toàn bộ) — để kiểm `/geo/*` nhận `reference_catalog.read` mà KHÔNG cần `patient.read`. */
  async function createUserWithCustomPermissions(tenantId: string, permissionKeys: string[]) {
    const roleName = `geo-custom-${randomUUID()}`;
    const role = await privileged.role.create({ data: { tenantId, name: roleName, isSystemDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const catalog = await privileged.permission.findMany({ select: { id: true, module: true, action: true } });
    const rows = permissionKeys.map((key) => {
      const p = catalog.find((c) => `${c.module}.${c.action}` === key);
      if (!p) throw new Error(`permission chưa seed: ${key}`);
      return { tenantId, roleId: role.id, permissionId: p.id, dataScope: 'global' as const, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR };
    });
    if (rows.length > 0) await privileged.rolePermission.createMany({ data: rows });
    return createUserWithRole(tenantId, roleName);
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

    fixture = await createTwoTenantFixture(privileged, 'Geo e2e');
    await seedPermissionCatalog(privileged);
    await seedGeo(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    systemAdminToken = await createUserWithRole(fixture.tenantA.id, 'system_admin');
    tenantBReceptionistToken = await createUserWithRole(fixture.tenantB.id, 'receptionist');
    onlyCatalogReadToken = await createUserWithCustomPermissions(fixture.tenantA.id, ['reference_catalog.read']);
    noPermissionToken = await createUserWithCustomPermissions(fixture.tenantA.id, []);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/geo/provinces');
    expect(res.status).toBe(401);
  });

  it('GET /geo/provinces đúng 34 tỉnh/thành theo sortOrder, Hà Nội đầu tiên', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/geo/provinces').set(authed(receptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(34);
    expect(res.body.data.items[0]).toMatchObject({ code: '1', name: 'Thành phố Hà Nội' });
  });

  it('GET /geo/wards?provinceCode=1 chỉ trả phường/xã thuộc Hà Nội (126 dòng)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/geo/wards?provinceCode=1')
      .set(authed(receptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(126);
    expect(res.body.data.items.every((w: { provinceCode: string }) => w.provinceCode === '1')).toBe(true);
  });

  it('GET /geo/wards?provinceCode= (tỉnh không tồn tại) → 200, danh sách rỗng, không lỗi', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/geo/wards?provinceCode=999')
      .set(authed(receptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
  });

  it('GET /geo/wards không kèm provinceCode → toàn bộ 3321 dòng (dựng bảng tra code→tên)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/geo/wards').set(authed(receptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(3321);
  });

  it('vai trò KHÔNG có patient.read lẫn reference_catalog.read → 403 PERMISSION_DENIED (cả tỉnh lẫn phường/xã)', async () => {
    for (const path of ['/api/v1/geo/provinces', '/api/v1/geo/wards?provinceCode=1']) {
      const res = await request(app.getHttpServer()).get(path).set(authed(noPermissionToken));
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    }
  });

  it('vai trò CHỈ có reference_catalog.read (không có patient.read) → 200 (người quản danh mục/mẫu in không cần đọc hồ sơ bệnh nhân, #263)', async () => {
    const provinces = await request(app.getHttpServer()).get('/api/v1/geo/provinces').set(authed(onlyCatalogReadToken));
    expect(provinces.status).toBe(200);
    expect(provinces.body.data.items).toHaveLength(34);
    const wards = await request(app.getHttpServer()).get('/api/v1/geo/wards?provinceCode=1').set(authed(onlyCatalogReadToken));
    expect(wards.status).toBe(200);
    expect(wards.body.data.items).toHaveLength(126);
  });

  it('quyền thay thế KHÔNG mở các route khác: reference_catalog.read không đọc được danh sách bệnh nhân', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/patients').set(authed(onlyCatalogReadToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('system_admin mặc định (có reference_catalog.read từ #260, không có patient.read) → 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/geo/provinces').set(authed(systemAdminToken));
    expect(res.status).toBe(200);
  });

  it('không có chủ đích cách ly tenant — tenant B thấy đúng cùng danh mục toàn hệ thống', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/geo/provinces')
      .set(authed(tenantBReceptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(34);
  });
});
