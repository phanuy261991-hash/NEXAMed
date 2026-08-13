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
 * HTTP e2e cho `encounter.controller.ts` (Sprint 3) — 2 transition: "Bắt đầu khám"
 * (CHECKED_IN→IN_CONSULTATION) và "bỏ về" (CHECKED_IN→CANCELLED). Tạo encounter (check-in) không
 * thuộc phạm vi file này — xem `reception-http.spec.ts`.
 */
describe('HTTP e2e — /api/v1/encounters', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBToken: string;
  let tenantBReceptionistToken: string;
  let tenantBDoctorToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-encounter-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function isoAt(hour: number, minute: number, day = 28) {
    return new Date(Date.UTC(2026, 7, day, hour, minute, 0)).toISOString();
  }

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  /** Tạo appointment + patient + check-in — trả về encounterId CHECKED_IN sẵn sàng cho test transition. */
  async function checkInFreshEncounter(hour: number, doctorId = doctorAUserId) {
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId, fullName: 'Khách e2e', phone: '0911222333', scheduledAt: isoAt(hour, 0), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };

    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e', dob: '1990-01-01', gender: 'female', phone: '0933444555', nationalId: randomNationalId() });
    const patient = patientRes.body.data as { id: string };

    const checkInRes = await request(app.getHttpServer())
      .post('/api/v1/reception/check-in')
      .set(authed(receptionistToken))
      .send({
        appointmentId: appointment.id,
        patientId: patient.id,
        version: appointment.version,
        // checkInRequestSchema (docs/DECISIONS.md #044) giờ bắt buộc kèm loại khám.
        examTypeCode: 'KT',
        examTypeName: 'Khám thường',
        examTypePrice: 150_000,
      });
    return checkInRes.body.data.id as string;
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

    fixture = await createTwoTenantFixture(privileged, 'Encounter e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    doctorBToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBReceptionistToken = (await createUserWithRole(fixture.tenantB.id, 'receptionist')).token;
    tenantBDoctorToken = (await createUserWithRole(fixture.tenantB.id, 'doctor')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('POST /api/v1/encounters/:id/start — "Bắt đầu khám"', () => {
    it('bác sĩ phụ trách chính → 200, CHECKED_IN→IN_CONSULTATION, set startedAt', async () => {
      const encounterId = await checkInFreshEncounter(8);

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_CONSULTATION');
      expect(res.body.data.startedAt).not.toBeNull();
      expect(res.body.data.version).toBe(2);
    });

    it('gọi start lần 2 (đã IN_CONSULTATION) → 409 ENCOUNTER_INVALID_TRANSITION', async () => {
      const encounterId = await checkInFreshEncounter(8);
      await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorAToken)).send({ version: 2 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_INVALID_TRANSITION');
    });

    it('bác sĩ khác (không phụ trách, scope personal) → 404', async () => {
      const encounterId = await checkInFreshEncounter(9);

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorBToken)).send({ version: 1 });

      expect(res.status).toBe(404);
    });

    it('vai trò không có encounter.update (receptionist) → 403', async () => {
      const encounterId = await checkInFreshEncounter(10);

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(receptionistToken)).send({ version: 1 });

      expect(res.status).toBe(403);
    });

    it('tenant B không bắt đầu khám được lượt khám của tenant A → 404 (dùng token bác sĩ tenant B — có encounter.update thật, receptionist thì không có quyền này ở bất kỳ tenant nào)', async () => {
      const encounterId = await checkInFreshEncounter(11);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounterId}/start`)
        .set(authed(tenantBDoctorToken))
        .send({ version: 1 });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/encounters/:id/cancel — "bỏ về"', () => {
    it('thiếu cancelReason → 400 VALIDATION_ERROR', async () => {
      const encounterId = await checkInFreshEncounter(12);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounterId}/cancel`)
        .set(authed(receptionistToken))
        .send({ version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('receptionist bỏ về có lý do → 200, CHECKED_IN→CANCELLED', async () => {
      const encounterId = await checkInFreshEncounter(13);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounterId}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Khách bỏ về không chờ được', version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('bỏ về encounter đã IN_CONSULTATION → 409 ENCOUNTER_INVALID_TRANSITION', async () => {
      const encounterId = await checkInFreshEncounter(14);
      await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounterId}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Không hợp lệ nữa', version: 2 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_INVALID_TRANSITION');
    });

    it('tenant B không "bỏ về" được lượt khám của tenant A → 404', async () => {
      const encounterId = await checkInFreshEncounter(15);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounterId}/cancel`)
        .set(authed(tenantBReceptionistToken))
        .send({ cancelReason: 'x', version: 1 });

      expect(res.status).toBe(404);
    });
  });
});
