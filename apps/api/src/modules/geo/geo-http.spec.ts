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

    fixture = await createTwoTenantFixture(privileged, 'Geo e2e');
    await seedPermissionCatalog(privileged);
    await seedGeo(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    systemAdminToken = await createUserWithRole(fixture.tenantA.id, 'system_admin');
    tenantBReceptionistToken = await createUserWithRole(fixture.tenantB.id, 'receptionist');
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

  it('system_admin (patient.read = none) → 403 PERMISSION_DENIED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/geo/provinces').set(authed(systemAdminToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('không có chủ đích cách ly tenant — tenant B thấy đúng cùng danh mục toàn hệ thống', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/geo/provinces')
      .set(authed(tenantBReceptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(34);
  });
});
