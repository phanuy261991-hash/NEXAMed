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

/** HTTP e2e cho module `drug` (Sprint 4, S4-03) — danh mục thuốc THEO TENANT, "Trường hợp A" đã chốt (không kho, không giá bán). */
describe('HTTP e2e — /api/v1/drugs', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-drug-${roleName}-${randomUUID()}`;
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

  async function createDrug(token: string, overrides: Partial<{ code: string; name: string }> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(token))
      .send({
        code: overrides.code ?? `DRG-${randomUUID().slice(0, 8)}`,
        name: overrides.name ?? 'Paracetamol 500mg',
        activeIngredient: 'Paracetamol',
        unit: 'Viên',
        concentration: '500mg',
      });
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

    fixture = await createTwoTenantFixture(privileged, 'Drug e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/drugs');
    expect(res.status).toBe(401);
  });

  it('clinic_admin tạo thuốc mới → 201/200, đủ trường', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Augmentin 1g' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Augmentin 1g');
    expect(res.body.data.activeIngredient).toBe('Paracetamol');
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.version).toBe(1);
  });

  it('trùng mã thuốc trong cùng tenant → 409 DRUG_DUPLICATE_CODE', async () => {
    const code = `DRG-DUP-${randomUUID().slice(0, 8)}`;
    await createDrug(clinicAdminToken, { code });
    const res = await createDrug(clinicAdminToken, { code });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DRUG_DUPLICATE_CODE');
  });

  it('bác sĩ (drug.read) tìm thuốc theo tên không dấu/phân biệt hoa thường → khớp', async () => {
    await createDrug(clinicAdminToken, { name: 'Cefixim 200mg' });
    const res = await request(app.getHttpServer()).get('/api/v1/drugs').query({ q: 'cefixim' }).set(authed(doctorToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items.some((d: { name: string }) => d.name === 'Cefixim 200mg')).toBe(true);
  });

  it('receptionist (drug.read) xem được danh sách nhưng không tạo được thuốc (thiếu drug.manage) → 403', async () => {
    const listRes = await request(app.getHttpServer()).get('/api/v1/drugs').set(authed(receptionistToken));
    expect(listRes.status).toBe(200);

    const createRes = await createDrug(receptionistToken);
    expect(createRes.status).toBe(403);
  });

  it('clinic_admin ẩn thuốc (isActive=false) qua PATCH → mặc định không còn trong danh sách, includeInactive=true vẫn thấy', async () => {
    const created = await createDrug(clinicAdminToken, { name: 'Thuốc ẩn e2e' });
    const drugId = created.body.data.id as string;

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/drugs/${drugId}`)
      .set(authed(clinicAdminToken))
      .send({ isActive: false, version: 1 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.isActive).toBe(false);
    expect(patchRes.body.data.version).toBe(2);

    const defaultList = await request(app.getHttpServer()).get('/api/v1/drugs').set(authed(doctorToken));
    expect(defaultList.body.data.items.some((d: { id: string }) => d.id === drugId)).toBe(false);

    const includeInactiveList = await request(app.getHttpServer()).get('/api/v1/drugs').query({ includeInactive: 'true' }).set(authed(doctorToken));
    expect(includeInactiveList.body.data.items.some((d: { id: string }) => d.id === drugId)).toBe(true);
  });

  it('version cũ → 409 CONCURRENT_MODIFICATION', async () => {
    const created = await createDrug(clinicAdminToken);
    const drugId = created.body.data.id as string;
    await request(app.getHttpServer()).patch(`/api/v1/drugs/${drugId}`).set(authed(clinicAdminToken)).send({ name: 'Đổi tên lần 1', version: 1 });

    const res = await request(app.getHttpServer()).patch(`/api/v1/drugs/${drugId}`).set(authed(clinicAdminToken)).send({ name: 'Đổi tên lần 2', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });

  it('cách ly tenant — tenant B không thấy/sửa được thuốc tenant A (404)', async () => {
    const created = await createDrug(clinicAdminToken);
    const drugId = created.body.data.id as string;

    const listRes = await request(app.getHttpServer()).get('/api/v1/drugs').set(authed(tenantBAdminToken));
    expect(listRes.body.data.items.some((d: { id: string }) => d.id === drugId)).toBe(false);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/drugs/${drugId}`)
      .set(authed(tenantBAdminToken))
      .send({ name: 'Sửa từ tenant khác', version: 1 });
    expect(patchRes.status).toBe(404);
  });
});
