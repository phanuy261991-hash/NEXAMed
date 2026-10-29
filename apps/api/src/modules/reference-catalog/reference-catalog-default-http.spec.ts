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
import { isDefaultFlagViolation } from './reference-catalog.service';

interface CatalogItem {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  version: number;
}

/**
 * HTTP e2e cho Loại giá dịch vụ MẶC ĐỊNH (docs/DECISIONS.md #268): Tiếp nhận tự chọn sẵn mức mặc định của phòng khám.
 * Tối đa MỘT mục mặc định/công ty, chỉ category PRICE_TYPE, mục đã ẩn không thể là mặc định, công ty đang có Loại giá thì KHÔNG bị tự đánh dấu.
 */
describe('HTTP e2e — Loại giá dịch vụ mặc định (reference_catalog.is_default)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminA: string;
  let adminB: string;

  async function createAdmin(tenantId: string): Promise<string> {
    const username = `e2e-admin-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: 'Admin', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: 'clinic_admin' } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  async function priceTypes(token: string): Promise<CatalogItem[]> {
    const res = await http().get('/api/v1/reference-catalog/PRICE_TYPE?includeInactive=true').set(authed(token));
    expect(res.status).toBe(200);
    return res.body.data.items as CatalogItem[];
  }

  async function createPriceType(token: string, name: string, extra: Record<string, unknown> = {}): Promise<CatalogItem> {
    const res = await http()
      .post('/api/v1/reference-catalog')
      .set(authed(token))
      .send({ category: 'PRICE_TYPE', code: `PT-${randomUUID().slice(0, 8)}`, name, sortOrder: 5, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as CatalogItem;
  }

  const defaults = (items: CatalogItem[]) => items.filter((i) => i.isDefault);

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

    fixture = await createTwoTenantFixture(privileged, 'LoaiGiaMacDinh e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    await seedReferenceCatalogForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedReferenceCatalogForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminA = await createAdmin(fixture.tenantA.id);
    adminB = await createAdmin(fixture.tenantB.id);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('công ty mới (chưa có Loại giá nào) được nạp sẵn "Thường" làm mặc định', async () => {
    const items = await priceTypes(adminA);
    const thuong = items.find((i) => i.code === 'THUONG');
    expect(thuong).toMatchObject({ name: 'Thường', isDefault: true, isActive: true });
    expect(defaults(items)).toHaveLength(1);
  });

  it('KHÔNG hồi tố: công ty đang có Loại giá mà chưa ai đánh dấu thì nạp seed lại cũng không tự đánh dấu', async () => {
    // Giả lập công ty đang chạy: có Loại giá (mã KHÁC "THUONG", nên nếu seed hồi tố thì sẽ phải CHÈN MỚI một dòng THUONG mặc định) nhưng chưa tích mặc định.
    await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantB.id, category: 'PRICE_TYPE' }, data: { isDefault: false, code: 'LOAI_CU', name: 'Loại cũ' } });
    await seedReferenceCatalogForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    const items = await priceTypes(adminB);
    expect(items.map((i) => i.code)).toEqual(['LOAI_CU']);
    expect(defaults(items)).toHaveLength(0);
  });

  it('đặt mục khác làm mặc định → mục cũ tự bỏ cờ, công ty luôn chỉ có MỘT mặc định, version của cả hai đều tăng', async () => {
    const before = await priceTypes(adminA);
    const thuong = before.find((i) => i.code === 'THUONG')!;
    const vip = await createPriceType(adminA, 'Khám VIP');
    expect(vip.isDefault).toBe(false);

    const res = await http().patch(`/api/v1/reference-catalog/${vip.id}`).set(authed(adminA)).send({ version: vip.version, isDefault: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: vip.id, isDefault: true, version: vip.version + 1 });

    const after = await priceTypes(adminA);
    expect(defaults(after).map((i) => i.id)).toEqual([vip.id]);
    const thuongAfter = after.find((i) => i.id === thuong.id)!;
    expect(thuongAfter.isDefault).toBe(false);
    expect(thuongAfter.version).toBe(thuong.version + 1);
  });

  it('tạo mới kèm isDefault=true → mặc định cũ tự bỏ cờ', async () => {
    const created = await createPriceType(adminA, 'Khám ngoài giờ', { isDefault: true });
    expect(created.isDefault).toBe(true);
    const items = await priceTypes(adminA);
    expect(defaults(items).map((i) => i.id)).toEqual([created.id]);
  });

  it('PATCH isDefault=false → công ty không còn mặc định nào', async () => {
    const items = await priceTypes(adminA);
    const current = defaults(items)[0]!;
    const res = await http().patch(`/api/v1/reference-catalog/${current.id}`).set(authed(adminA)).send({ version: current.version, isDefault: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isDefault).toBe(false);
    expect(defaults(await priceTypes(adminA))).toHaveLength(0);
  });

  it('chỉ category PRICE_TYPE mới đặt được mặc định → 422 REFERENCE_CATALOG_DEFAULT_NOT_ALLOWED (tạo mới và sửa)', async () => {
    const create = await http()
      .post('/api/v1/reference-catalog')
      .set(authed(adminA))
      .send({ category: 'ETHNICITY', code: `X-${randomUUID().slice(0, 6)}`, name: 'Dân tộc thử', sortOrder: 900, isDefault: true });
    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe('REFERENCE_CATALOG_DEFAULT_NOT_ALLOWED');

    const other = await http()
      .post('/api/v1/reference-catalog')
      .set(authed(adminA))
      .send({ category: 'ETHNICITY', code: `Y-${randomUUID().slice(0, 6)}`, name: 'Dân tộc thử 2', sortOrder: 901 });
    expect(other.status).toBe(200);
    const patch = await http().patch(`/api/v1/reference-catalog/${other.body.data.id}`).set(authed(adminA)).send({ version: other.body.data.version, isDefault: true });
    expect(patch.status).toBe(422);
    expect(patch.body.error.code).toBe('REFERENCE_CATALOG_DEFAULT_NOT_ALLOWED');
  });

  it('mục đã ẩn không thể là mặc định (cả khi vừa ẩn vừa đặt trong cùng một lần sửa)', async () => {
    const hidden = await createPriceType(adminA, 'Mức đã ẩn', { isActive: false });
    const direct = await http().patch(`/api/v1/reference-catalog/${hidden.id}`).set(authed(adminA)).send({ version: hidden.version, isDefault: true });
    expect(direct.status).toBe(422);
    expect(direct.body.error.code).toBe('REFERENCE_CATALOG_DEFAULT_NOT_ALLOWED');

    const live = await createPriceType(adminA, 'Mức đang dùng');
    const both = await http().patch(`/api/v1/reference-catalog/${live.id}`).set(authed(adminA)).send({ version: live.version, isDefault: true, isActive: false });
    expect(both.status).toBe(422);
    expect(both.body.error.code).toBe('REFERENCE_CATALOG_DEFAULT_NOT_ALLOWED');

    const createHidden = await http()
      .post('/api/v1/reference-catalog')
      .set(authed(adminA))
      .send({ category: 'PRICE_TYPE', code: `PT-${randomUUID().slice(0, 8)}`, name: 'Tạo ẩn + mặc định', sortOrder: 5, isDefault: true, isActive: false });
    expect(createHidden.status).toBe(422);
  });

  it('ẩn mục đang là mặc định → cờ mặc định mất theo (không còn mục ẩn nào là mặc định)', async () => {
    const item = await createPriceType(adminA, 'Sắp ẩn', { isDefault: true });
    expect(defaults(await priceTypes(adminA)).map((i) => i.id)).toEqual([item.id]);

    const hide = await http().delete(`/api/v1/reference-catalog/${item.id}?version=${item.version}`).set(authed(adminA));
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);
    expect(hide.body.data).toMatchObject({ isActive: false, isDefault: false });
    expect(defaults(await priceTypes(adminA))).toHaveLength(0);

    // Khôi phục không tự bật lại cờ mặc định.
    const restored = await http().post(`/api/v1/reference-catalog/${item.id}/reactivate?version=${hide.body.data.version}`).set(authed(adminA));
    expect(restored.status).toBe(200);
    expect(restored.body.data.isDefault).toBe(false);
  });

  it('ẩn bằng PATCH isActive=false trên mục đang mặc định cũng bỏ cờ', async () => {
    const item = await createPriceType(adminA, 'Ẩn qua PATCH', { isDefault: true });
    const res = await http().patch(`/api/v1/reference-catalog/${item.id}`).set(authed(adminA)).send({ version: item.version, isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isActive: false, isDefault: false });
  });

  it('cô lập công ty: đặt mặc định ở công ty A không đụng mặc định của công ty B', async () => {
    // B đặt "Thường" làm mặc định (bước trước đã gỡ cờ).
    const bItems = await priceTypes(adminB);
    const bThuong = bItems.find((i) => i.code === 'LOAI_CU')!;
    const setB = await http().patch(`/api/v1/reference-catalog/${bThuong.id}`).set(authed(adminB)).send({ version: bThuong.version, isDefault: true });
    expect(setB.status).toBe(200);

    const aNew = await createPriceType(adminA, 'Mặc định của A', { isDefault: true });
    expect(aNew.isDefault).toBe(true);

    const bAfter = await priceTypes(adminB);
    expect(defaults(bAfter).map((i) => i.id)).toEqual([bThuong.id]);
    // Công ty A không thấy / không sửa được mục của B.
    const cross = await http().patch(`/api/v1/reference-catalog/${bThuong.id}`).set(authed(adminA)).send({ version: bThuong.version + 1, isDefault: false });
    expect(cross.status).toBe(404);
  });

  it('khoá lạc quan: đặt mặc định với version cũ → 409 CONCURRENT_MODIFICATION và mặc định cũ KHÔNG bị bỏ cờ', async () => {
    const current = defaults(await priceTypes(adminA))[0]!;
    const target = await createPriceType(adminA, 'Version cũ');
    const stale = await http().patch(`/api/v1/reference-catalog/${target.id}`).set(authed(adminA)).send({ version: target.version + 5, isDefault: true });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');

    const after = await priceTypes(adminA);
    expect(defaults(after).map((i) => i.id)).toEqual([current.id]);
  });

  it('hai người đặt hai mức mặc định gần như CÙNG LÚC → không bao giờ 500 và công ty luôn chỉ còn MỘT mặc định', async () => {
    // Hai yêu cầu có thể nối tiếp (người sau thắng, cả hai 200) hoặc chồng nhau (người sau bị 409): cả hai đều đúng, KHÔNG được có 500 hay hai mặc định.
    for (let round = 0; round < 3; round += 1) {
      const x = await createPriceType(adminA, `Đua X${round}`);
      const y = await createPriceType(adminA, `Đua Y${round}`);
      const [rx, ry] = await Promise.all([
        http().patch(`/api/v1/reference-catalog/${x.id}`).set(authed(adminA)).send({ version: x.version, isDefault: true }),
        http().patch(`/api/v1/reference-catalog/${y.id}`).set(authed(adminA)).send({ version: y.version, isDefault: true }),
      ]);
      for (const r of [rx, ry]) {
        expect([200, 409], JSON.stringify(r.body)).toContain(r.status);
        if (r.status === 409) expect(r.body.error.code).toBe('CONCURRENT_MODIFICATION');
      }
      expect(defaults(await priceTypes(adminA))).toHaveLength(1);
    }
  });

  it('nhận diện đúng lỗi Prisma THẬT từ DB: vi phạm "một mặc định" ≠ vi phạm trùng mã', async () => {
    const items = await priceTypes(adminA);
    const current = defaults(items)[0]!;
    const other = items.find((i) => !i.isDefault && i.isActive)!;

    const twoDefaults = await privileged.referenceCatalog.update({ where: { id: other.id }, data: { isDefault: true } }).catch((e: unknown) => e);
    expect(isDefaultFlagViolation(twoDefaults)).toBe(true);

    const dupCode = await privileged.referenceCatalog
      .create({ data: { tenantId: fixture.tenantA.id, category: 'PRICE_TYPE', code: current.code, name: 'Trùng mã', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })
      .catch((e: unknown) => e);
    expect(isDefaultFlagViolation(dupCode)).toBe(false);
    expect(isDefaultFlagViolation(new Error('khác'))).toBe(false);
  });

  it('ràng buộc DB chặn dữ liệu sai dù đi đường khác: hai mặc định cùng công ty / mặc định ở category khác / mặc định đã ẩn đều bị từ chối', async () => {
    const items = await priceTypes(adminA);
    const other = items.find((i) => !i.isDefault && i.isActive)!;
    await expect(privileged.referenceCatalog.update({ where: { id: other.id }, data: { isDefault: true } })).rejects.toThrow();

    const eth = await privileged.referenceCatalog.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, category: 'ETHNICITY' } });
    await expect(privileged.referenceCatalog.update({ where: { id: eth.id }, data: { isDefault: true } })).rejects.toThrow();

    await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'PRICE_TYPE' }, data: { isDefault: false } });
    await expect(privileged.referenceCatalog.update({ where: { id: other.id }, data: { isDefault: true, isActive: false } })).rejects.toThrow();
  });
});
