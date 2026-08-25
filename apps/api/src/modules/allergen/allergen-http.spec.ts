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
 * HTTP e2e cho module `allergen` (danh mục "Dị nguyên" toàn hệ thống — docs/DECISIONS.md #069).
 * Cùng bản chất `reference-catalog-http.spec.ts`: bảng KHÔNG có `tenant_id`, nên "cách ly tenant"
 * ở đây có nghĩa NGƯỢC LẠI — xác nhận có chủ đích 2 tenant CÙNG thấy/sửa được một danh mục chung.
 */
describe('HTTP e2e — /api/v1/allergen-groups, /api/v1/allergens', () => {
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

  async function createGroup(token: string, name = `Nhóm test ${randomUUID().slice(0, 8)}`) {
    const res = await request(app.getHttpServer()).post('/api/v1/allergen-groups').set(authed(token)).send({ name });
    return res;
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

    fixture = await createTwoTenantFixture(privileged, 'Allergen e2e');
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

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/allergen-groups');
    expect(res.status).toBe(401);
  });

  describe('Nhóm dị nguyên', () => {
    it('clinic_admin tạo nhóm → 200, mã tự sinh đúng định dạng NDN-XXXXXXXX, không nhận code từ client', async () => {
      const res = await createGroup(clinicAdminToken, 'Nhóm hải sản');
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Nhóm hải sản');
      expect(res.body.data.code).toMatch(/^NDN-[0-9A-F]{8}$/);
      // Request không có field `code` — gửi kèm cũng bị Zod strip, không ảnh hưởng mã tự sinh.
      expect(res.body.data).not.toHaveProperty('allergenGroupId');
    });

    it('receptionist (chỉ có allergen_catalog.read) GET được nhưng POST → 403 PERMISSION_DENIED', async () => {
      const get = await request(app.getHttpServer()).get('/api/v1/allergen-groups').set(authed(receptionistToken));
      expect(get.status).toBe(200);

      const post = await createGroup(receptionistToken);
      expect(post.status).toBe(403);
      expect(post.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('PATCH sửa tên → 200; PATCH id không tồn tại → 404', async () => {
      const created = await createGroup(clinicAdminToken, 'Trước khi sửa');
      const id = created.body.data.id as string;

      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/allergen-groups/${id}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'Sau khi sửa' });
      expect(patch.status).toBe(200);
      expect(patch.body.data.name).toBe('Sau khi sửa');

      const notFound = await request(app.getHttpServer())
        .patch(`/api/v1/allergen-groups/${randomUUID()}`)
        .set(authed(clinicAdminToken))
        .send({ name: 'X' });
      expect(notFound.status).toBe(404);
    });

    it('DELETE = ẩn (soft) → biến mất khỏi GET mặc định, còn thấy khi includeInactive=true; reactivate khôi phục lại', async () => {
      const created = await createGroup(clinicAdminToken, 'Sẽ bị ẩn');
      const id = created.body.data.id as string;

      const del = await request(app.getHttpServer()).delete(`/api/v1/allergen-groups/${id}`).set(authed(clinicAdminToken));
      expect(del.status).toBe(200);
      expect(del.body.data.isActive).toBe(false);

      const listDefault = await request(app.getHttpServer()).get('/api/v1/allergen-groups').set(authed(clinicAdminToken));
      expect(listDefault.body.data.items.some((i: { id: string }) => i.id === id)).toBe(false);

      const listAll = await request(app.getHttpServer())
        .get('/api/v1/allergen-groups?includeInactive=true')
        .set(authed(clinicAdminToken));
      expect(listAll.body.data.items.some((i: { id: string }) => i.id === id)).toBe(true);

      const reactivate = await request(app.getHttpServer()).post(`/api/v1/allergen-groups/${id}/reactivate`).set(authed(clinicAdminToken));
      expect(reactivate.status).toBe(200);
      expect(reactivate.body.data.isActive).toBe(true);
    });
  });

  describe('Dị nguyên', () => {
    it('clinic_admin tạo dị nguyên thuộc nhóm → 200, mã tự sinh đúng định dạng DN-XXXXXXXX, kèm allergenGroupName', async () => {
      const group = await createGroup(clinicAdminToken, 'Nhóm thuốc');
      const groupId = group.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post('/api/v1/allergens')
        .set(authed(clinicAdminToken))
        .send({ allergenGroupId: groupId, name: 'Penicillin' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Penicillin');
      expect(res.body.data.code).toMatch(/^DN-[0-9A-F]{8}$/);
      expect(res.body.data.allergenGroupId).toBe(groupId);
      expect(res.body.data.allergenGroupName).toBe('Nhóm thuốc');
    });

    it('allergenGroupId không tồn tại → 422 ALLERGEN_GROUP_INVALID_REFERENCE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/allergens')
        .set(authed(clinicAdminToken))
        .send({ allergenGroupId: randomUUID(), name: 'Không hợp lệ' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ALLERGEN_GROUP_INVALID_REFERENCE');
    });

    it('thiếu allergenGroupId → 400 VALIDATION_ERROR (bắt buộc, khác department.departmentTypeId tuỳ chọn)', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/allergens').set(authed(clinicAdminToken)).send({ name: 'Thiếu nhóm' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH đổi sang nhóm khác → 200, allergenGroupName cập nhật theo', async () => {
      const groupA = await createGroup(clinicAdminToken, 'Nhóm A');
      const groupB = await createGroup(clinicAdminToken, 'Nhóm B');
      const created = await request(app.getHttpServer())
        .post('/api/v1/allergens')
        .set(authed(clinicAdminToken))
        .send({ allergenGroupId: groupA.body.data.id, name: 'Chuyển nhóm' });
      const id = created.body.data.id as string;

      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/allergens/${id}`)
        .set(authed(clinicAdminToken))
        .send({ allergenGroupId: groupB.body.data.id });
      expect(patch.status).toBe(200);
      expect(patch.body.data.allergenGroupId).toBe(groupB.body.data.id);
      expect(patch.body.data.allergenGroupName).toBe('Nhóm B');
    });

    it('DELETE = ẩn (soft) → biến mất khỏi GET mặc định; reactivate khôi phục lại', async () => {
      const group = await createGroup(clinicAdminToken);
      const created = await request(app.getHttpServer())
        .post('/api/v1/allergens')
        .set(authed(clinicAdminToken))
        .send({ allergenGroupId: group.body.data.id, name: 'Sẽ bị ẩn' });
      const id = created.body.data.id as string;

      const del = await request(app.getHttpServer()).delete(`/api/v1/allergens/${id}`).set(authed(clinicAdminToken));
      expect(del.status).toBe(200);
      expect(del.body.data.isActive).toBe(false);

      const listDefault = await request(app.getHttpServer()).get('/api/v1/allergens').set(authed(clinicAdminToken));
      expect(listDefault.body.data.items.some((i: { id: string }) => i.id === id)).toBe(false);

      const reactivate = await request(app.getHttpServer()).post(`/api/v1/allergens/${id}/reactivate`).set(authed(clinicAdminToken));
      expect(reactivate.status).toBe(200);
      expect(reactivate.body.data.isActive).toBe(true);
    });

    it('receptionist PATCH/DELETE → 403 (chỉ clinic_admin có allergen_catalog.manage)', async () => {
      const group = await createGroup(clinicAdminToken);
      const created = await request(app.getHttpServer())
        .post('/api/v1/allergens')
        .set(authed(clinicAdminToken))
        .send({ allergenGroupId: group.body.data.id, name: 'Sửa được bởi ai' });
      const id = created.body.data.id as string;

      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/allergens/${id}`)
        .set(authed(receptionistToken))
        .send({ name: 'Không được phép sửa' });
      expect(patch.status).toBe(403);
      expect(patch.body.error.code).toBe('PERMISSION_DENIED');

      const del = await request(app.getHttpServer()).delete(`/api/v1/allergens/${id}`).set(authed(receptionistToken));
      expect(del.status).toBe(403);
      expect(del.body.error.code).toBe('PERMISSION_DENIED');
    });

    // Sprint 5 — quyền tạo mới (KHÔNG sửa/ẩn) mở cho lễ tân/điều dưỡng/bác sĩ, để thêm dị nguyên
    // ngay lúc nhập Tiền sử mà không phải chờ clinic_admin (docs/DECISIONS.md).
    it('receptionist (chỉ có allergen_catalog.create, không có manage) POST tạo dị nguyên mới → 200', async () => {
      const group = await createGroup(clinicAdminToken, 'Nhóm cho lễ tân');
      const res = await request(app.getHttpServer())
        .post('/api/v1/allergens')
        .set(authed(receptionistToken))
        .send({ allergenGroupId: group.body.data.id, name: 'Do lễ tân thêm' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Do lễ tân thêm');
      expect(res.body.data.code).toMatch(/^DN-[0-9A-F]{8}$/);
    });
  });

  it('không có chủ đích cách ly tenant — tenant B thấy và sửa được đúng Nhóm dị nguyên/Dị nguyên tenant A vừa tạo (danh mục toàn hệ thống, giống reference_catalog)', async () => {
    const group = await createGroup(clinicAdminToken, 'Dùng chung mọi tenant');
    const groupId = group.body.data.id as string;

    const listGroupFromTenantB = await request(app.getHttpServer()).get('/api/v1/allergen-groups').set(authed(tenantBAdminToken));
    expect(listGroupFromTenantB.body.data.items.some((i: { id: string }) => i.id === groupId)).toBe(true);

    const patchFromTenantB = await request(app.getHttpServer())
      .patch(`/api/v1/allergen-groups/${groupId}`)
      .set(authed(tenantBAdminToken))
      .send({ name: 'Sửa bởi tenant B' });
    expect(patchFromTenantB.status).toBe(200);
    expect(patchFromTenantB.body.data.name).toBe('Sửa bởi tenant B');

    const allergenFromTenantB = await request(app.getHttpServer())
      .post('/api/v1/allergens')
      .set(authed(tenantBAdminToken))
      .send({ allergenGroupId: groupId, name: 'Tạo bởi tenant B' });
    expect(allergenFromTenantB.status).toBe(200);

    const listAllergenFromTenantA = await request(app.getHttpServer()).get('/api/v1/allergens').set(authed(clinicAdminToken));
    expect(
      listAllergenFromTenantA.body.data.items.some((i: { id: string }) => i.id === allergenFromTenantB.body.data.id),
    ).toBe(true);
  });
});
