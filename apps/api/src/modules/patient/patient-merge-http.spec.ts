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
 * HTTP e2e cho `POST /api/v1/patients/merge` (S5-06, PAT-04) — gộp hồ sơ trùng. Trọng tâm: chuyển
 * đúng `encounter` sang hồ sơ đích, đặt `merged_into_id` ở hồ sơ nguồn (không xoá), chặn gộp lại
 * hồ sơ đã gộp, chỉ `clinic_admin` mới gộp được (permission `patient.merge` đã seed sẵn từ trước).
 * Lỗ hổng "ngừng cho tạo mới" (tạo encounter mới trên hồ sơ đã gộp) test riêng ở
 * `reception-http.spec.ts` (tái dùng fixture reception sẵn có, tránh dựng lại toàn bộ danh mục
 * Loại khám/Khoa chỉ để phục vụ 1 test case).
 */
describe('HTTP e2e — /api/v1/patients/merge', () => {
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

  let patientCounter = 0;
  async function createPatient(token: string) {
    patientCounter += 1;
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(token))
      .send({
        fullName: `Bệnh nhân gộp ${patientCounter}`,
        dob: '1995-01-01',
        gender: 'other',
        phone: `090${String(1000000 + patientCounter).padStart(7, '0')}`,
        // Bắt buộc từ 18 tuổi (docs/DECISIONS.md #036) — mỗi hồ sơ 1 số CCCD giả riêng, tránh
        // PATIENT_DUPLICATE_NATIONAL_ID giữa các lần gọi trong cùng file test.
        nationalId: `079${String(100000000 + patientCounter).padStart(9, '0')}`,
      });
    if (res.status !== 200) {
      throw new Error(`createPatient thất bại: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.data as { id: string; version: number };
  }

  async function createEncounterFor(tenantId: string, patientId: string) {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId, isDefault: true } });
    const seq = Math.floor(Math.random() * 1_000_000);
    return privileged.encounter.create({
      data: {
        tenantId,
        patientId,
        departmentId: department.id,
        encounterNo: `LK-MERGE-${seq}`,
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
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

    fixture = await createTwoTenantFixture(privileged, 'Patient merge e2e');
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
    const res = await request(app.getHttpServer()).post('/api/v1/patients/merge').send({ sourceId: randomUUID(), targetId: randomUUID() });
    expect(res.status).toBe(401);
  });

  it('vai trò không có patient.merge (receptionist) → 403 PERMISSION_DENIED', async () => {
    const source = await createPatient(receptionistToken);
    const target = await createPatient(receptionistToken);

    const res = await request(app.getHttpServer())
      .post('/api/v1/patients/merge')
      .set(authed(receptionistToken))
      .send({ sourceId: source.id, targetId: target.id });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('tự gộp chính nó (sourceId === targetId) → 400 VALIDATION_ERROR', async () => {
    const patient = await createPatient(receptionistToken);

    const res = await request(app.getHttpServer())
      .post('/api/v1/patients/merge')
      .set(authed(clinicAdminToken))
      .send({ sourceId: patient.id, targetId: patient.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('clinic_admin gộp hợp lệ → 200, chuyển đúng encounter sang đích, hồ sơ nguồn đặt mergedIntoId (không xoá)', async () => {
    const source = await createPatient(receptionistToken);
    const target = await createPatient(receptionistToken);
    const encounter = await createEncounterFor(fixture.tenantA.id, source.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/patients/merge')
      .set(authed(clinicAdminToken))
      .send({ sourceId: source.id, targetId: target.id });

    expect(res.status).toBe(200);
    expect(res.body.data.sourceId).toBe(source.id);
    expect(res.body.data.targetId).toBe(target.id);
    expect(res.body.data.movedEncounterCount).toBe(1);

    const movedEncounter = await privileged.encounter.findUniqueOrThrow({ where: { id: encounter.id } });
    expect(movedEncounter.patientId).toBe(target.id);

    const sourceAfter = await privileged.patient.findUniqueOrThrow({ where: { id: source.id } });
    expect(sourceAfter.mergedIntoId).toBe(target.id);
    expect(sourceAfter.deletedAt).toBeNull();

    const auditRow = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, entityId: source.id, action: 'patient.merged' } });
    expect(auditRow).not.toBeNull();
  });

  it('gộp lại hồ sơ NGUỒN đã bị gộp trước đó → 409 PATIENT_ALREADY_MERGED', async () => {
    const source = await createPatient(receptionistToken);
    const target = await createPatient(receptionistToken);
    const thirdParty = await createPatient(receptionistToken);

    const first = await request(app.getHttpServer())
      .post('/api/v1/patients/merge')
      .set(authed(clinicAdminToken))
      .send({ sourceId: source.id, targetId: target.id });
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer())
      .post('/api/v1/patients/merge')
      .set(authed(clinicAdminToken))
      .send({ sourceId: source.id, targetId: thirdParty.id });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('PATIENT_ALREADY_MERGED');
  });

  it('gộp lại hồ sơ ĐÍCH đã từng là nguồn của lần gộp khác → 409 PATIENT_ALREADY_MERGED', async () => {
    const source = await createPatient(receptionistToken);
    const target = await createPatient(receptionistToken);
    const anotherSource = await createPatient(receptionistToken);

    const first = await request(app.getHttpServer())
      .post('/api/v1/patients/merge')
      .set(authed(clinicAdminToken))
      .send({ sourceId: source.id, targetId: target.id });
    expect(first.status).toBe(200);

    // `source` giờ đã mergedIntoId != null — dùng nó làm targetId ở lần gộp khác phải bị chặn.
    const second = await request(app.getHttpServer())
      .post('/api/v1/patients/merge')
      .set(authed(clinicAdminToken))
      .send({ sourceId: anotherSource.id, targetId: source.id });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('PATIENT_ALREADY_MERGED');
  });

  it('cách ly tenant: tenant B gộp 2 hồ sơ của tenant A → 404, không thấy hồ sơ', async () => {
    const source = await createPatient(receptionistToken);
    const target = await createPatient(receptionistToken);

    const res = await request(app.getHttpServer())
      .post('/api/v1/patients/merge')
      .set(authed(tenantBAdminToken))
      .send({ sourceId: source.id, targetId: target.id });

    expect(res.status).toBe(404);
  });
});
