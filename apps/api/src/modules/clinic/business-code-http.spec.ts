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
 * HTTP e2e cho "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, `/api/v1/clinic-settings/
 * code-templates`) — 7 loại mã nghiệp vụ, khuôn mẫu tự cấu hình được theo tenant.
 */
describe('HTTP e2e — /api/v1/clinic-settings/code-templates', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-bct-${roleName}-${randomUUID()}`;
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

    fixture = await createTwoTenantFixture(privileged, 'BusinessCodeTemplate e2e');
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
    const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings/code-templates');
    expect(res.status).toBe(401);
  });

  it('vai trò không có clinic_config.read (receptionist) → 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings/code-templates').set(authed(receptionistToken));
    expect(res.status).toBe(403);
  });

  it('tenant chưa cấu hình gì → 7 loại mã đúng khuôn mặc định, KHÔNG locked, số bắt đầu = 1', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings/code-templates').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(7);

    const patient = res.body.data.items.find((i: { codeType: string }) => i.codeType === 'PATIENT');
    expect(patient).toMatchObject({
      prefix: 'BN',
      template: 'BN[Năm 2 số][Tháng][Số đếm]',
      counterDigits: 6,
      startingValue: 1,
      locked: false,
    });
    expect(patient.exampleNextCode).toMatch(/^BN\d{4}\d{6}$/);

    const employment = res.body.data.items.map((i: { codeType: string }) => i.codeType).sort();
    expect(employment).toEqual(['APPOINTMENT_BOOKING', 'CASHIER_SHIFT', 'DEPARTMENT', 'EMPLOYEE', 'ENCOUNTER', 'INVOICE', 'PATIENT'].sort());
  });

  it('PATCH sửa khuôn mẫu — thiếu [Số đếm] → 400 BUSINESS_CODE_TEMPLATE_INVALID', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/clinic-settings/code-templates/DEPARTMENT')
      .set(authed(clinicAdminToken))
      .send({ template: 'KP[Năm 2 số]', counterDigits: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BUSINESS_CODE_TEMPLATE_INVALID');
  });

  it('PATCH sửa khuôn mẫu — token lạ → 400 BUSINESS_CODE_TEMPLATE_INVALID', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/clinic-settings/code-templates/DEPARTMENT')
      .set(authed(clinicAdminToken))
      .send({ template: 'KP[Không hợp lệ][Số đếm]', counterDigits: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BUSINESS_CODE_TEMPLATE_INVALID');
  });

  it('vai trò không có clinic_config.update (receptionist) → 403', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/clinic-settings/code-templates/DEPARTMENT')
      .set(authed(receptionistToken))
      .send({ template: 'KP[Số đếm]', counterDigits: 6 });
    expect(res.status).toBe(403);
  });

  it('PATCH hợp lệ (DEPARTMENT, chưa dùng lần nào) — đổi khuôn + số bắt đầu → 200, GET phản ánh đúng', async () => {
    const patched = await request(app.getHttpServer())
      .patch('/api/v1/clinic-settings/code-templates/DEPARTMENT')
      .set(authed(clinicAdminToken))
      .send({ template: 'KP[Năm 4 số][Tháng][Ngày][Số đếm]', counterDigits: 4, startingValue: 500 });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      template: 'KP[Năm 4 số][Tháng][Ngày][Số đếm]',
      counterDigits: 4,
      startingValue: 500,
      locked: false,
    });

    const listed = await request(app.getHttpServer()).get('/api/v1/clinic-settings/code-templates').set(authed(clinicAdminToken));
    const department = listed.body.data.items.find((i: { codeType: string }) => i.codeType === 'DEPARTMENT');
    expect(department.template).toBe('KP[Năm 4 số][Tháng][Ngày][Số đếm]');
    expect(department.exampleNextCode).toMatch(/^KP\d{4}\d{2}\d{2}\d{4}$/);
  });

  it('tạo Khoa/Phòng thật → mã đúng khuôn tuần tự vừa cấu hình, bắt đầu đúng số 500 (số bắt đầu cấu hình ở trên)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/departments')
      .set(authed(clinicAdminToken))
      .send({ name: 'Khoa Nội tổng quát' });
    expect(created.status).toBe(200);
    expect(created.body.data.code).toMatch(/^KP\d{4}\d{2}\d{2}0500$/);
  });

  it('sau khi đã phát sinh mã đầu tiên — DEPARTMENT chuyển locked=true, PATCH kèm startingValue → 409', async () => {
    const listed = await request(app.getHttpServer()).get('/api/v1/clinic-settings/code-templates').set(authed(clinicAdminToken));
    const department = listed.body.data.items.find((i: { codeType: string }) => i.codeType === 'DEPARTMENT');
    expect(department.locked).toBe(true);

    const res = await request(app.getHttpServer())
      .patch('/api/v1/clinic-settings/code-templates/DEPARTMENT')
      .set(authed(clinicAdminToken))
      .send({ template: 'KP[Số đếm]', counterDigits: 6, startingValue: 999 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUSINESS_CODE_TEMPLATE_STARTING_VALUE_LOCKED');
  });

  it('vẫn sửa được khuôn mẫu (không kèm startingValue) dù đã locked — chỉ khoá riêng "Số bắt đầu đếm"', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/clinic-settings/code-templates/DEPARTMENT')
      .set(authed(clinicAdminToken))
      .send({ template: 'KP-[Số đếm]', counterDigits: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ template: 'KP-[Số đếm]', counterDigits: 5, locked: true, startingValue: 500 });
  });

  it('cách ly tenant — tenant B chưa đụng gì vẫn thấy khuôn mặc định + KHÔNG locked cho DEPARTMENT (không lẫn cấu hình/trạng thái tenant A)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/clinic-settings/code-templates').set(authed(tenantBAdminToken));
    const department = res.body.data.items.find((i: { codeType: string }) => i.codeType === 'DEPARTMENT');
    expect(department).toMatchObject({ template: 'KP[Năm 2 số][Tháng][Số đếm]', counterDigits: 6, startingValue: 1, locked: false });
  });
});
