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
import { seedReferenceCatalog } from '../../infrastructure/persistence/seed-reference-catalog';

/**
 * HTTP e2e cho module `reference-catalog` (danh mục dùng chung toàn hệ thống — docs/DECISIONS.md,
 * đảo ngược #034 phần ethnicity/nationality). Khác mọi module khác đã có test: bảng KHÔNG có
 * `tenant_id`, nên "cách ly tenant" ở đây có nghĩa NGƯỢC LẠI — xác nhận có chủ đích 2 tenant CÙNG
 * thấy/sửa được một danh mục chung (giống `permission`), không phải cách ly.
 */
describe('HTTP e2e — /api/v1/reference-catalog', () => {
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

    fixture = await createTwoTenantFixture(privileged, 'ReferenceCatalog e2e');
    await seedPermissionCatalog(privileged);
    await seedReferenceCatalog(privileged);
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

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/reference-catalog/ETHNICITY');
    expect(res.status).toBe(401);
  });

  it('category không hợp lệ → 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/NOT_A_CATEGORY')
      .set(authed(clinicAdminToken));
    expect(res.status).toBe(400);
  });

  it('GET đúng 54 dân tộc theo thứ tự sortOrder, Kinh đầu tiên', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/reference-catalog/ETHNICITY').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(54);
    expect(res.body.data.items[0]).toMatchObject({ code: '1', name: 'Kinh' });
  });

  it('GET đúng 30 quốc tịch, Việt Nam đầu tiên', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/NATIONALITY')
      .set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(30);
    expect(res.body.data.items[0]).toMatchObject({ code: 'VNM', name: 'Việt Nam' });
  });

  it('receptionist (chỉ có reference_catalog.read) GET được nhưng POST/PATCH/DELETE → 403 PERMISSION_DENIED', async () => {
    const get = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/ETHNICITY')
      .set(authed(receptionistToken));
    expect(get.status).toBe(200);

    const post = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(receptionistToken))
      .send({ category: 'ETHNICITY', code: 'X', name: 'Không được phép', sortOrder: 999 });
    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('clinic_admin tạo mục mới → 200; trùng (category, code) → 409', async () => {
    const code = `TEST-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code, name: 'Dân tộc test', sortOrder: 999 });
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({ category: 'ETHNICITY', code, name: 'Dân tộc test', isActive: true });

    const dup = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code, name: 'Trùng mã', sortOrder: 998 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('REFERENCE_CATALOG_DUPLICATE_CODE');
  });

  it('PATCH sửa tên → 200; PATCH id không tồn tại → 404', async () => {
    const code = `TEST-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'NATIONALITY', code, name: 'Trước khi sửa', sortOrder: 1000 });
    const id = created.body.data.id as string;

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'Sau khi sửa' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.name).toBe('Sau khi sửa');

    const notFound = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${randomUUID()}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'X' });
    expect(notFound.status).toBe(404);
  });

  it('DELETE = ẩn (soft) → biến mất khỏi GET mặc định, còn thấy khi includeInactive=true; reactivate khôi phục lại', async () => {
    const code = `TEST-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code, name: 'Sẽ bị ẩn', sortOrder: 997 });
    const id = created.body.data.id as string;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken));
    expect(del.status).toBe(200);
    expect(del.body.data.isActive).toBe(false);

    const listDefault = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/ETHNICITY')
      .set(authed(clinicAdminToken));
    expect(listDefault.body.data.items.some((i: { id: string }) => i.id === id)).toBe(false);

    const listAll = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/ETHNICITY?includeInactive=true')
      .set(authed(clinicAdminToken));
    expect(listAll.body.data.items.some((i: { id: string }) => i.id === id)).toBe(true);

    const reactivate = await request(app.getHttpServer())
      .post(`/api/v1/reference-catalog/${id}/reactivate`)
      .set(authed(clinicAdminToken));
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.data.isActive).toBe(true);

    const listAfterReactivate = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/ETHNICITY')
      .set(authed(clinicAdminToken));
    expect(listAfterReactivate.body.data.items.some((i: { id: string }) => i.id === id)).toBe(true);
  });

  it('receptionist DELETE/reactivate → 403 (chỉ có read, không có manage)', async () => {
    const code = `TEST-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'NATIONALITY', code, name: 'Test quyền', sortOrder: 996 });
    const id = created.body.data.id as string;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/reference-catalog/${id}`)
      .set(authed(receptionistToken));
    expect(del.status).toBe(403);
  });

  it('deactivatesAccount (mở rộng ADM-01, chỉ EMPLOYMENT_STATUS) — tạo/sửa lưu đúng, mặc định false với category khác', async () => {
    const statusCode = `TEST-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'EMPLOYMENT_STATUS', code: statusCode, name: 'Nghỉ việc test', sortOrder: 990, deactivatesAccount: true });
    expect(created.status).toBe(200);
    expect(created.body.data.deactivatesAccount).toBe(true);

    const id = created.body.data.id as string;
    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ deactivatesAccount: false });
    expect(patched.status).toBe(200);
    expect(patched.body.data.deactivatesAccount).toBe(false);

    const ethnicityCode = `TEST-${randomUUID().slice(0, 8)}`;
    const otherCategory = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code: ethnicityCode, name: 'Không liên quan', sortOrder: 989 });
    expect(otherCategory.body.data.deactivatesAccount).toBe(false);
  });

  it('không có chủ đích cách ly tenant — tenant B thấy và sửa được đúng dữ liệu tenant A vừa tạo (danh mục toàn hệ thống, giống permission)', async () => {
    const code = `TEST-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code, name: 'Dùng chung mọi tenant', sortOrder: 995 });
    const id = created.body.data.id as string;

    const listFromTenantB = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/ETHNICITY')
      .set(authed(tenantBAdminToken));
    expect(listFromTenantB.body.data.items.some((i: { id: string }) => i.id === id)).toBe(true);

    const patchFromTenantB = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(tenantBAdminToken))
      .send({ name: 'Sửa bởi tenant B' });
    expect(patchFromTenantB.status).toBe(200);
    expect(patchFromTenantB.body.data.name).toBe('Sửa bởi tenant B');
  });
});
