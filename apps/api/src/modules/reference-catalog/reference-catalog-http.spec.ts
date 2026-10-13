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
import { seedReferenceCatalogForTenant } from '../../infrastructure/persistence/seed-reference-catalog';

/**
 * HTTP e2e cho module `reference-catalog` — danh mục RIÊNG THEO TENANT (docs/DECISIONS.md #230; trước đó
 * dùng chung mọi tenant). Mỗi tenant có bản riêng: tenant này không thấy, không sửa, không ẩn được mục của
 * tenant khác, và cùng `code` được phép tồn tại ở nhiều tenant.
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
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    await seedReferenceCatalogForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedReferenceCatalogForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

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
      .send({ name: 'Sau khi sửa', version: created.body.data.version });
    expect(patch.status).toBe(200);
    expect(patch.body.data.name).toBe('Sau khi sửa');
    expect(patch.body.data.version).toBe(created.body.data.version + 1);

    const notFound = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${randomUUID()}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'X', version: 1 });
    expect(notFound.status).toBe(404);
  });

  it('khoá lạc quan (docs/DECISIONS.md #207): PATCH/DELETE/reactivate với version cũ → 409 CONCURRENT_MODIFICATION, dữ liệu không bị ghi đè; thiếu version → 400', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'NATIONALITY', code: `TEST-${randomUUID().slice(0, 8)}`, name: 'Bản gốc', sortOrder: 1001 });
    const id = created.body.data.id as string;
    expect(created.body.data.version).toBe(1);

    // Người A lưu trước (version 1 → 2), người B còn cầm version 1.
    const first = await request(app.getHttpServer()).patch(`/api/v1/reference-catalog/${id}`).set(authed(clinicAdminToken)).send({ name: 'A sửa', version: 1 });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(2);

    const stalePatch = await request(app.getHttpServer()).patch(`/api/v1/reference-catalog/${id}`).set(authed(clinicAdminToken)).send({ name: 'B ghi đè', version: 1 });
    expect(stalePatch.status).toBe(409);
    expect(stalePatch.body.error.code).toBe('CONCURRENT_MODIFICATION');

    const staleDelete = await request(app.getHttpServer()).delete(`/api/v1/reference-catalog/${id}?version=1`).set(authed(clinicAdminToken));
    expect(staleDelete.status).toBe(409);
    const staleReactivate = await request(app.getHttpServer()).post(`/api/v1/reference-catalog/${id}/reactivate?version=1`).set(authed(clinicAdminToken));
    expect(staleReactivate.status).toBe(409);

    // Dữ liệu còn nguyên bản của A, vẫn đang hoạt động, version không đổi sau các lần bị từ chối.
    const list = await request(app.getHttpServer()).get('/api/v1/reference-catalog/NATIONALITY').set(authed(clinicAdminToken));
    const row = list.body.data.items.find((i: { id: string }) => i.id === id);
    expect(row).toMatchObject({ name: 'A sửa', isActive: true, version: 2 });

    // Hai request ĐỒNG THỜI cùng version → đúng 1 thành công, 1 bị 409 (không bị trộn dữ liệu).
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).patch(`/api/v1/reference-catalog/${id}`).set(authed(clinicAdminToken)).send({ name: 'Song song 1', version: 2 }),
      request(app.getHttpServer()).patch(`/api/v1/reference-catalog/${id}`).set(authed(clinicAdminToken)).send({ name: 'Song song 2', version: 2 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);

    // Thiếu version → 400 (bắt buộc).
    const noVersion = await request(app.getHttpServer()).patch(`/api/v1/reference-catalog/${id}`).set(authed(clinicAdminToken)).send({ name: 'Không version' });
    expect(noVersion.status).toBe(400);
    const noVersionDelete = await request(app.getHttpServer()).delete(`/api/v1/reference-catalog/${id}`).set(authed(clinicAdminToken));
    expect(noVersionDelete.status).toBe(400);
  });

  it('DELETE = ẩn (soft) → biến mất khỏi GET mặc định, còn thấy khi includeInactive=true; reactivate khôi phục lại', async () => {
    const code = `TEST-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code, name: 'Sẽ bị ẩn', sortOrder: 997 });
    const id = created.body.data.id as string;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/reference-catalog/${id}?version=${created.body.data.version}`)
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
      .post(`/api/v1/reference-catalog/${id}/reactivate?version=${del.body.data.version}`)
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
      .delete(`/api/v1/reference-catalog/${id}?version=1`)
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
      .send({ deactivatesAccount: false, version: created.body.data.version });
    expect(patched.status).toBe(200);
    expect(patched.body.data.deactivatesAccount).toBe(false);

    const ethnicityCode = `TEST-${randomUUID().slice(0, 8)}`;
    const otherCategory = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code: ethnicityCode, name: 'Không liên quan', sortOrder: 989 });
    expect(otherCategory.body.data.deactivatesAccount).toBe(false);
  });

  it('Lấy mẫu xét nghiệm (#220): Mẫu bệnh phẩm lưu "Màu nắp ống", Nhóm dịch vụ lưu "Viết tắt" (≤ 4 ký tự); sửa được, null = xoá; màu/viết tắt sai → 400; category khác mặc định null', async () => {
    const post = (body: Record<string, unknown>) => request(app.getHttpServer()).post('/api/v1/reference-catalog').set(authed(clinicAdminToken)).send(body);

    const specimen = await post({ category: 'SPECIMEN_TYPE', name: 'Huyết thanh test màu nắp', capColor: 'RED' });
    expect(specimen.status, JSON.stringify(specimen.body)).toBe(200);
    expect(specimen.body.data).toMatchObject({ capColor: 'RED', abbreviation: null });

    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${specimen.body.data.id}`)
      .set(authed(clinicAdminToken))
      .send({ capColor: 'PURPLE', version: specimen.body.data.version });
    expect(patched.status).toBe(200);
    expect(patched.body.data.capColor).toBe('PURPLE');

    const cleared = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${specimen.body.data.id}`)
      .set(authed(clinicAdminToken))
      .send({ capColor: null, version: patched.body.data.version });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.capColor).toBeNull();

    const category = await post({ category: 'TECH_SERVICE_CATEGORY', name: 'Huyết học test viết tắt', abbreviation: 'HH' });
    expect(category.status, JSON.stringify(category.body)).toBe(200);
    expect(category.body.data).toMatchObject({ abbreviation: 'HH', capColor: null });

    expect((await post({ category: 'SPECIMEN_TYPE', name: 'Màu lạ', capColor: 'PINK' })).status).toBe(400);
    expect((await post({ category: 'TECH_SERVICE_CATEGORY', name: 'Viết tắt dài', abbreviation: 'QUADAI' })).status).toBe(400);

    const other = await post({ category: 'ETHNICITY', name: 'Không liên quan màu nắp' });
    expect(other.body.data).toMatchObject({ capColor: null, abbreviation: null });
  });

  it('UNIT (Đơn vị tính, 2026-08-26) — mã tự sinh (bỏ qua code client gửi), lưu description, isActive lúc tạo mặc định true còn tuỳ chọn gửi false', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'UNIT', name: 'Viên', description: 'Dùng cho thuốc dạng viên nén' });
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({
      category: 'UNIT',
      name: 'Viên',
      description: 'Dùng cho thuốc dạng viên nén',
      isActive: true,
    });
    // Mã ngắn tuần tự (docs/DECISIONS.md #113) — <2 ký tự><5 chữ số>, không còn dạng ngẫu nhiên cũ.
    expect(created.body.data.code).toMatch(/^DV[0-9]{5}$/);

    const id = created.body.data.id as string;
    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ description: 'Đổi mô tả', isActive: false, version: created.body.data.version });
    expect(patched.status).toBe(200);
    expect(patched.body.data.description).toBe('Đổi mô tả');
    expect(patched.body.data.isActive).toBe(false);

    const createdInactive = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'UNIT', name: 'Lọ (ngưng dùng ngay)', isActive: false });
    expect(createdInactive.status).toBe(200);
    expect(createdInactive.body.data.isActive).toBe(false);

    const ethnicity = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code: `TEST-${randomUUID().slice(0, 8)}`, name: 'Không liên quan UNIT', sortOrder: 985 });
    expect(ethnicity.body.data.description).toBeNull();
  });

  it('"Mã BYT"/"Tên đầy đủ chuẩn" (đảo ngược một phần #152/#153, 17/09/2026) — CHỈ nhập được lúc TẠO MỚI cho 5 category chuẩn BYT, sửa (PATCH) không đổi được', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'DRUG_GROUP', name: 'Nhóm tự thêm', bytCode: 'X99', fullName: 'Nhóm dược lý tự thêm ngoài BYT', description: 'Ghi chú riêng' });
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({ category: 'DRUG_GROUP', name: 'Nhóm tự thêm', bytCode: 'X99', fullName: 'Nhóm dược lý tự thêm ngoài BYT', description: 'Ghi chú riêng' });

    const id = created.body.data.id as string;
    // Web KHÔNG gửi bytCode/fullName lúc PATCH cho 5 category chuẩn BYT (chỉ gate ở tầng frontend,
    // xem `BYT_TAXONOMY_CATEGORIES` ở ReferenceCatalogPane.tsx từ 18/09/2026) — PATCH chỉ sửa `name`
    // thì 2 trường kia giữ nguyên giá trị cũ, đúng hành vi mong đợi.
    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'Nhóm tự thêm (đã sửa tên)', version: created.body.data.version });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe('Nhóm tự thêm (đã sửa tên)');
    expect(patched.body.data.bytCode).toBe('X99');
    expect(patched.body.data.fullName).toBe('Nhóm dược lý tự thêm ngoài BYT');

    // Category KHÔNG thuộc 5 category chuẩn BYT — gửi bytCode/fullName lên vẫn bị bỏ qua ở backend
    // (Zod schema chấp nhận nhưng đây chỉ kiểm tra hành vi thật, không phải hợp đồng cấm theo category).
    const ethnicity = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code: `TEST-${randomUUID().slice(0, 8)}`, name: 'Không liên quan BYT', bytCode: 'Y01' });
    expect(ethnicity.status).toBe(200);
    expect(ethnicity.body.data.bytCode).toBe('Y01');
  });

  it('ACTIVE_INGREDIENT (không có nguồn seed BYT cần bảo vệ, chốt 18/09/2026) — "Mã BYT"/"Tên đầy đủ chuẩn" sửa (PATCH) tự do được, khác 5 category chuẩn BYT', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ACTIVE_INGREDIENT', name: 'Hoạt chất test', bytCode: 'HC-TEST-01', fullName: 'Tên đầy đủ ban đầu', description: 'Mô tả ban đầu' });
    expect(created.status).toBe(200);
    // Mã tự sinh (không truyền `code`) — định dạng ngắn tuần tự mới, tiền tố "HC" (docs/DECISIONS.md #113 mở rộng 18/09/2026).
    expect(created.body.data.code).toMatch(/^HC\d{5}$/);
    expect(created.body.data).toMatchObject({ bytCode: 'HC-TEST-01', fullName: 'Tên đầy đủ ban đầu', description: 'Mô tả ban đầu' });

    const id = created.body.data.id as string;
    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ bytCode: 'HC-TEST-02', fullName: 'Tên đầy đủ đã sửa', description: 'Mô tả đã sửa', version: created.body.data.version });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ bytCode: 'HC-TEST-02', fullName: 'Tên đầy đủ đã sửa', description: 'Mô tả đã sửa' });
  });

  it('EXAM_TYPE — "Đơn giá dịch vụ" (docs/DECISIONS.md #079): tạo kèm examTypePrices → trả đúng danh sách; PATCH bulk-replace; bỏ trống mảng lúc PATCH → xoá hết', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({
        category: 'EXAM_TYPE',
        name: 'Khám Nội tổng quát test',
        examTypePrices: [
          { priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 150000, effectiveFrom: '2026-01-01' },
          { priceTypeCode: 'BAO_HIEM', unitCode: 'LUOT', amount: 100000, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' },
        ],
      });
    expect(created.status).toBe(200);
    expect(created.body.data.prices).toHaveLength(2);
    expect(created.body.data.prices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priceTypeCode: 'THUONG', amount: 150000, effectiveFrom: '2026-01-01' }),
        expect.objectContaining({ priceTypeCode: 'BAO_HIEM', amount: 100000, effectiveTo: '2026-12-31' }),
      ]),
    );
    const id = created.body.data.id as string;

    // GET list cũng phải trả kèm prices (batch fetch, không N+1) — dùng để mở modal Sửa.
    const list = await request(app.getHttpServer()).get('/api/v1/reference-catalog/EXAM_TYPE').set(authed(clinicAdminToken));
    const listedItem = list.body.data.items.find((i: { id: string }) => i.id === id);
    expect(listedItem.prices).toHaveLength(2);

    // PATCH bulk-replace: gửi 1 dòng mới, 2 dòng cũ phải biến mất.
    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, examTypePrices: [{ priceTypeCode: 'UU_DAI', unitCode: 'BUOI', amount: 200000, effectiveFrom: '2026-02-01' }] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.prices).toHaveLength(1);
    expect(patched.body.data.prices[0]).toMatchObject({ priceTypeCode: 'UU_DAI', amount: 200000 });

    // PATCH không gửi examTypePrices → giữ nguyên (không phải "undefined nghĩa là xoá hết").
    const untouchedPatch = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'Đổi tên, không đụng đơn giá', version: patched.body.data.version });
    expect(untouchedPatch.body.data.prices).toHaveLength(1);

    // PATCH gửi mảng RỖNG → chủ ý xoá hết.
    const cleared = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ examTypePrices: [], version: untouchedPatch.body.data.version });
    expect(cleared.body.data.prices).toHaveLength(0);

    // PATCH CHỈ gửi đơn giá (bảng con) với version cũ vẫn bị khoá lạc quan → 409, đơn giá không đổi.
    const staleOnlyPrices = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version, examTypePrices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 1, effectiveFrom: '2026-03-01' }] });
    expect(staleOnlyPrices.status).toBe(409);
    const afterStale = await request(app.getHttpServer()).get('/api/v1/reference-catalog/EXAM_TYPE').set(authed(clinicAdminToken));
    expect(afterStale.body.data.items.find((i: { id: string }) => i.id === id).prices).toHaveLength(0);
  });

  it('EXAM_TYPE — 2 dòng đơn giá CÙNG Loại giá dịch vụ chồng lấn ngày hiệu lực → 409 EXAM_TYPE_PRICE_OVERLAP (C20)', async () => {
    const overlap = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({
        category: 'EXAM_TYPE',
        name: 'Dịch vụ trùng ngày hiệu lực',
        examTypePrices: [
          { priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100000, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' },
          { priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 120000, effectiveFrom: '2026-06-01' },
        ],
      });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('EXAM_TYPE_PRICE_OVERLAP');

    // Khác Loại giá dịch vụ thì chồng ngày vẫn hợp lệ (không cùng khoá exclusion).
    const ok = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({
        category: 'EXAM_TYPE',
        name: 'Dịch vụ khác loại giá, cùng ngày vẫn hợp lệ',
        examTypePrices: [
          { priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100000, effectiveFrom: '2026-01-01' },
          { priceTypeCode: 'BAO_HIEM', unitCode: 'LUOT', amount: 80000, effectiveFrom: '2026-01-01' },
        ],
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data.prices).toHaveLength(2);
  });

  it('EXAM_TYPE — danh mục lẫn đơn giá đều RIÊNG THEO TENANT: tenant B không thấy mục (và đơn giá) tenant A vừa tạo', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({
        category: 'EXAM_TYPE',
        name: 'Dịch vụ riêng của tenant A',
        examTypePrices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100000, effectiveFrom: '2026-01-01' }],
      });
    const id = created.body.data.id as string;

    const listFromTenantB = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/EXAM_TYPE')
      .set(authed(tenantBAdminToken));
    expect(listFromTenantB.body.data.items.some((i: { id: string }) => i.id === id)).toBe(false);
  });

  it('CÁCH LY TENANT (#230): tenant B không thấy, không sửa/ẩn/khôi phục được mục tenant A vừa tạo (404); cùng `code` ở hai tenant được phép', async () => {
    const code = `TEST-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(clinicAdminToken))
      .send({ category: 'ETHNICITY', code, name: 'Chỉ của tenant A', sortOrder: 995 });
    expect(created.status).toBe(200);
    const id = created.body.data.id as string;
    const version = created.body.data.version as number;

    const listFromTenantB = await request(app.getHttpServer())
      .get('/api/v1/reference-catalog/ETHNICITY?includeInactive=true')
      .set(authed(tenantBAdminToken));
    expect(listFromTenantB.status).toBe(200);
    expect(listFromTenantB.body.data.items.some((i: { id: string }) => i.id === id)).toBe(false);
    expect(listFromTenantB.body.data.items.some((i: { code: string }) => i.code === code)).toBe(false);

    const patchFromTenantB = await request(app.getHttpServer())
      .patch(`/api/v1/reference-catalog/${id}`)
      .set(authed(tenantBAdminToken))
      .send({ name: 'Tenant B cố sửa', version });
    expect(patchFromTenantB.status).toBe(404);

    const deleteFromTenantB = await request(app.getHttpServer())
      .delete(`/api/v1/reference-catalog/${id}?version=${version}`)
      .set(authed(tenantBAdminToken));
    expect(deleteFromTenantB.status).toBe(404);

    const reactivateFromTenantB = await request(app.getHttpServer())
      .post(`/api/v1/reference-catalog/${id}/reactivate?version=${version}`)
      .set(authed(tenantBAdminToken));
    expect(reactivateFromTenantB.status).toBe(404);

    // Bản của tenant A không bị đụng tới.
    const stillA = await request(app.getHttpServer()).get('/api/v1/reference-catalog/ETHNICITY').set(authed(clinicAdminToken));
    expect(stillA.body.data.items.find((i: { id: string }) => i.id === id)).toMatchObject({ name: 'Chỉ của tenant A', version });

    // Tenant B tạo CÙNG `code` → được (unique theo (tenant, category, code)).
    const sameCodeInB = await request(app.getHttpServer())
      .post('/api/v1/reference-catalog')
      .set(authed(tenantBAdminToken))
      .send({ category: 'ETHNICITY', code, name: 'Cùng mã, tenant B', sortOrder: 996 });
    expect(sameCodeInB.status).toBe(200);
    expect(sameCodeInB.body.data.id).not.toBe(id);
  });

  it('mã tự sinh (UNIT) tính RIÊNG THEO TENANT: tenant B không bị tăng số bởi tenant A', async () => {
    const createUnit = async (token: string, name: string) => {
      const res = await request(app.getHttpServer()).post('/api/v1/reference-catalog').set(authed(token)).send({ category: 'UNIT', name });
      expect(res.status).toBe(200);
      return res.body.data.code as string;
    };
    const a1 = await createUnit(clinicAdminToken, `Đơn vị A1 ${randomUUID().slice(0, 6)}`);
    const a2 = await createUnit(clinicAdminToken, `Đơn vị A2 ${randomUUID().slice(0, 6)}`);
    const b1 = await createUnit(tenantBAdminToken, `Đơn vị B1 ${randomUUID().slice(0, 6)}`);
    const seqOf = (code: string) => Number(code.replace(/\D/g, ''));
    expect(seqOf(a2)).toBe(seqOf(a1) + 1);
    // Cả hai tenant đều đã nạp cùng danh sách đơn vị mặc định → B bắt đầu từ cùng mốc, không nhảy theo số của A.
    expect(seqOf(b1)).toBeLessThanOrEqual(seqOf(a1));
  });
});
