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

/** HTTP e2e — "Đơn thuốc mẫu" (Kho Thuốc GĐ5, PRD INV-05). */
describe('HTTP e2e — /api/v1/prescription-templates', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let doctorToken: string;
  let nurseToken: string;
  let receptionistToken: string;
  let tenantBDoctorToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-rxtpl-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createDrug(tenantId: string, name: string) {
    const drug = await privileged.drug.create({
      data: { tenantId, code: `DRG-${randomUUID().slice(0, 8)}`, name, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return drug.id as string;
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

    fixture = await createTwoTenantFixture(privileged, 'PrescriptionTemplate e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    nurseToken = await createUserWithRole(fixture.tenantA.id, 'nurse');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBDoctorToken = await createUserWithRole(fixture.tenantB.id, 'doctor');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/prescription-templates');
    expect(res.status).toBe(401);
  });

  it('bác sĩ tạo mẫu 2 dòng thuốc → 200, đọc lại đủ tên thuốc; điều dưỡng xem được nhưng không tạo được (thiếu manage) → 403', async () => {
    const drugA = await createDrug(fixture.tenantA.id, 'Paracetamol 500mg');
    const drugB = await createDrug(fixture.tenantA.id, 'Amoxicilin 500mg');

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/prescription-templates')
      .set(authed(doctorToken))
      .send({
        name: 'Phác đồ viêm hô hấp trên',
        items: [
          { drugId: drugA, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 5 },
          { drugId: drugB, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 5 },
        ],
      });
    expect(createRes.status).toBe(200);
    expect(createRes.body.data.name).toBe('Phác đồ viêm hô hấp trên');
    expect(createRes.body.data.items).toHaveLength(2);
    expect(createRes.body.data.items.map((i: { drugName: string }) => i.drugName).sort()).toEqual(['Amoxicilin 500mg', 'Paracetamol 500mg']);
    expect(createRes.body.data.isActive).toBe(true);
    expect(createRes.body.data.version).toBe(1);
    // quantity LUÔN do backend tính (docs/DECISIONS.md #196) = (1+0+0+0) × 5.
    expect(createRes.body.data.items.every((i: { quantity: number }) => i.quantity === 5)).toBe(true);

    const listRes = await request(app.getHttpServer()).get('/api/v1/prescription-templates').set(authed(nurseToken));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items.some((t: { name: string }) => t.name === 'Phác đồ viêm hô hấp trên')).toBe(true);

    const nurseCreateRes = await request(app.getHttpServer()).post('/api/v1/prescription-templates').set(authed(nurseToken)).send({ name: 'X', items: [{ drugId: drugA, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 1 }] });
    expect(nurseCreateRes.status).toBe(403);

    const receptionistListRes = await request(app.getHttpServer()).get('/api/v1/prescription-templates').set(authed(receptionistToken));
    expect(receptionistListRes.status).toBe(403);
  });

  it('tạo mẫu tham chiếu thuốc không tồn tại → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/prescription-templates')
      .set(authed(doctorToken))
      .send({ name: 'Mẫu lỗi', items: [{ drugId: randomUUID(), doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 1 }] });
    expect(res.status).toBe(400);
  });

  it('sửa mẫu — đổi tên + thay toàn bộ dòng thuốc (bulk-replace), version tăng; version cũ → 409', async () => {
    const drugA = await createDrug(fixture.tenantA.id, 'Cefixim 200mg');
    const drugB = await createDrug(fixture.tenantA.id, 'Loratadin 10mg');
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/prescription-templates')
      .set(authed(doctorToken))
      .send({ name: 'Mẫu sửa', items: [{ drugId: drugA, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 5 }] });
    const templateId = createRes.body.data.id as string;

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/prescription-templates/${templateId}`)
      .set(authed(doctorToken))
      .send({ name: 'Mẫu sửa v2', items: [{ drugId: drugB, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 5 }], version: 1 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe('Mẫu sửa v2');
    expect(updateRes.body.data.items).toHaveLength(1);
    expect(updateRes.body.data.items[0].drugName).toBe('Loratadin 10mg');
    expect(updateRes.body.data.version).toBe(2);

    const staleRes = await request(app.getHttpServer()).patch(`/api/v1/prescription-templates/${templateId}`).set(authed(doctorToken)).send({ name: 'X', version: 1 });
    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });

  it('"Xoá" = isActive:false qua PATCH → không còn trong danh sách', async () => {
    const drugA = await createDrug(fixture.tenantA.id, 'Domperidon 10mg');
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/prescription-templates')
      .set(authed(doctorToken))
      .send({ name: 'Mẫu sẽ ẩn', items: [{ drugId: drugA, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 3 }] });
    const templateId = createRes.body.data.id as string;

    const hideRes = await request(app.getHttpServer()).patch(`/api/v1/prescription-templates/${templateId}`).set(authed(doctorToken)).send({ isActive: false, version: 1 });
    expect(hideRes.status).toBe(200);
    expect(hideRes.body.data.isActive).toBe(false);

    const listRes = await request(app.getHttpServer()).get('/api/v1/prescription-templates').set(authed(doctorToken));
    expect(listRes.body.data.items.some((t: { id: string }) => t.id === templateId)).toBe(false);

    // `includeInactive` (docs/DECISIONS.md #196) — trang quản lý "Đơn thuốc mẫu" trong Quản trị cần
    // thấy cả mẫu đã ẩn để "Kích hoạt lại".
    const includeInactiveRes = await request(app.getHttpServer()).get('/api/v1/prescription-templates?includeInactive=true').set(authed(doctorToken));
    expect(includeInactiveRes.status).toBe(200);
    expect(includeInactiveRes.body.data.items.some((t: { id: string }) => t.id === templateId)).toBe(true);
  });

  it('cách ly tenant — bác sĩ tenant B không thấy mẫu của tenant A', async () => {
    const drugA = await createDrug(fixture.tenantA.id, 'Vitamin C 500mg');
    await request(app.getHttpServer())
      .post('/api/v1/prescription-templates')
      .set(authed(doctorToken))
      .send({ name: 'Mẫu riêng tenant A', items: [{ drugId: drugA, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 3 }] });

    const listRes = await request(app.getHttpServer()).get('/api/v1/prescription-templates').set(authed(tenantBDoctorToken));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items.some((t: { name: string }) => t.name === 'Mẫu riêng tenant A')).toBe(false);
  });
});
