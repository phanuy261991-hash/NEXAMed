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
 * HTTP e2e — Nhà cung cấp + Kho (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146). Dùng chung
 * `drug.read`/`drug.manage` (không permission mới), mã tự sinh ngắn tuần tự (NCC/KH).
 */
describe('HTTP e2e — /api/v1/suppliers, /api/v1/warehouses', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-pharmacy-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
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

    fixture = await createTwoTenantFixture(privileged, 'Pharmacy supplier/warehouse e2e');
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

  it('seedDefaultRolesForTenant tự tạo "Kho chính" mặc định cho mỗi tenant', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].name).toBe('Kho chính');
    expect(res.body.data.items[0].isDefault).toBe(true);
    expect(res.body.data.items[0].code).toMatch(/^KH\d{5}$/);
  });

  it('clinic_admin tạo Nhà cung cấp → mã tự sinh tiền tố NCC, không nhận mã từ client', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set(authed(clinicAdminToken))
      .send({ name: 'Công ty CP Dược Hậu Giang', taxCode: '1800156801', phone: '0292 3891 433' });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toMatch(/^NCC\d{5}$/);
    expect(res.body.data.name).toBe('Công ty CP Dược Hậu Giang');
    expect(res.body.data.isActive).toBe(true);
  });

  it('receptionist (drug.read) xem được danh sách nhưng không tạo được (thiếu drug.manage) → 403', async () => {
    const listRes = await request(app.getHttpServer()).get('/api/v1/suppliers').set(authed(receptionistToken));
    expect(listRes.status).toBe(200);

    const createRes = await request(app.getHttpServer()).post('/api/v1/suppliers').set(authed(receptionistToken)).send({ name: 'NCC lén lút' });
    expect(createRes.status).toBe(403);
  });

  it('tạo thêm Kho thứ hai đặt isDefault=true → Kho cũ tự mất cờ mặc định (đúng 1 kho mặc định)', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/warehouses').set(authed(clinicAdminToken)).send({ name: 'Tủ trực phòng khám 1', isDefault: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isDefault).toBe(true);
    expect(res.body.data.code).toMatch(/^KH\d{5}$/);

    const listRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    const defaults = listRes.body.data.items.filter((w: { isDefault: boolean }) => w.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('Tủ trực phòng khám 1');
  });

  it('version cũ khi sửa Nhà cung cấp → 409 CONCURRENT_MODIFICATION', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/suppliers').set(authed(clinicAdminToken)).send({ name: 'NCC version test' });
    const id = created.body.data.id as string;
    await request(app.getHttpServer()).patch(`/api/v1/suppliers/${id}`).set(authed(clinicAdminToken)).send({ name: 'Đổi tên lần 1', version: 1 });

    const res = await request(app.getHttpServer()).patch(`/api/v1/suppliers/${id}`).set(authed(clinicAdminToken)).send({ name: 'Đổi tên lần 2', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });

  it('cách ly tenant — tenant B không thấy/sửa được Nhà cung cấp lẫn Kho của tenant A (404)', async () => {
    const supplier = await request(app.getHttpServer()).post('/api/v1/suppliers').set(authed(clinicAdminToken)).send({ name: 'NCC cách ly tenant' });
    const supplierId = supplier.body.data.id as string;
    const warehouseList = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    const warehouseId = warehouseList.body.data.items[0].id as string;

    const supplierListB = await request(app.getHttpServer()).get('/api/v1/suppliers').set(authed(tenantBAdminToken));
    expect(supplierListB.body.data.items.some((s: { id: string }) => s.id === supplierId)).toBe(false);

    const patchSupplierB = await request(app.getHttpServer())
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set(authed(tenantBAdminToken))
      .send({ name: 'Sửa từ tenant khác', version: 1 });
    expect(patchSupplierB.status).toBe(404);

    const warehouseListB = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(tenantBAdminToken));
    expect(warehouseListB.body.data.items.some((w: { id: string }) => w.id === warehouseId)).toBe(false);

    const patchWarehouseB = await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${warehouseId}`)
      .set(authed(tenantBAdminToken))
      .send({ name: 'Sửa từ tenant khác', version: 1 });
    expect(patchWarehouseB.status).toBe(404);
  });
});
