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
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';

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
  let doctorBUserId: string;
  let doctorCToken: string;
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

  /** "Hàng đợi ảo" (#064) — Khoa mới, dùng riêng cho từng test để tránh chồng chéo trạng thái. */
  async function createDepartment(tenantId: string, name: string) {
    const department = await privileged.department.create({
      data: { tenantId, name, isActive: true, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return department.id as string;
  }

  async function assignDepartment(userId: string, departmentId: string) {
    await privileged.userAccount.update({ where: { id: userId }, data: { departmentId } });
  }

  /**
   * Tạo thẳng lượt khám vào hàng chờ chung của 1 Khoa (`POST /reception/direct`, routing "theo
   * Khoa" — `doctorId` bỏ trống) — không qua `appointment`, đơn giản hơn `checkInFreshEncounter()`
   * cho các test "Nhận ca".
   */
  async function registerPoolEncounter(hour: number, departmentId: string) {
    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e (pool)', dob: '1990-01-01', gender: 'female', phone: '0933444555', nationalId: randomNationalId() });
    const patient = patientRes.body.data as { id: string };

    const res = await request(app.getHttpServer())
      .post('/api/v1/reception/direct')
      .set(authed(receptionistToken))
      .send({
        patientId: patient.id,
        departmentId,
        checkedInAt: isoAt(hour, 0),
        examTypeCode: 'KT',
        examTypeName: 'Khám thường',
        examTypePrice: 150_000,
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    return res.body.data as { id: string; doctorId: string | null; departmentId: string };
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
        // checkInRequestSchema (docs/DECISIONS.md #044) giờ bắt buộc kèm loại khám; thiết kế lại
        // "Tiếp nhận bệnh nhân" (mockup đã duyệt) thêm bắt buộc Loại tiếp nhận/Hình thức khám.
        // doctorId (docs/DECISIONS.md #064 — "Hàng đợi ảo") nay bắt buộc gửi tường minh.
        doctorId,
        examTypeCode: 'KT',
        examTypeName: 'Khám thường',
        examTypePrice: 150_000,
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
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
    // S3-05→07: PUT .../diagnoses cần icd10_catalog có dữ liệu thật (FK icd10Code), cùng cách
    // icd10-http.spec.ts tự seed cho riêng file test của nó (dữ liệu không seed sẵn toàn cục).
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    const doctorB = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorBToken = doctorB.token;
    doctorBUserId = doctorB.userId;
    doctorCToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
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

  describe('POST /api/v1/encounters/:id/start — "Nhận ca" (Hàng đợi ảo, #064 — ticket trong hàng chờ chung Khoa, doctorId=NULL)', () => {
    it('bác sĩ cùng Khoa nhận ca → 200, gán đúng doctorId + IN_CONSULTATION, set startedAt', async () => {
      const departmentId = await createDepartment(fixture.tenantA.id, 'Khoa Nội — nhận ca OK');
      await assignDepartment(doctorAUserId, departmentId);
      const ticket = await registerPoolEncounter(16, departmentId);
      expect(ticket.doctorId).toBeNull();

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${ticket.id}/start`).set(authed(doctorAToken)).send({ version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_CONSULTATION');
      expect(res.body.data.doctorId).toBe(doctorAUserId);
      expect(res.body.data.startedAt).not.toBeNull();
      expect(res.body.data.version).toBe(2);
    });

    it('2 bác sĩ cùng Khoa bấm nhận ca gần như đồng thời → đúng 1 thành công (200), 1 thua', async () => {
      const departmentId = await createDepartment(fixture.tenantA.id, 'Khoa Nội — race nhận ca');
      await assignDepartment(doctorAUserId, departmentId);
      await assignDepartment(doctorBUserId, departmentId);
      const ticket = await registerPoolEncounter(17, departmentId);

      const [first, second] = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/encounters/${ticket.id}/start`).set(authed(doctorAToken)).send({ version: 1 }),
        request(app.getHttpServer()).post(`/api/v1/encounters/${ticket.id}/start`).set(authed(doctorBToken)).send({ version: 1 }),
      ]);

      const winner = first.status === 200 ? first : second;
      const loser = first.status === 200 ? second : first;
      expect(winner.status).toBe(200);
      expect([doctorAUserId, doctorBUserId]).toContain(winner.body.data.doctorId);
      // Bên thua có 2 kết quả hợp lệ tuỳ thời điểm 2 transaction thật sự chồng lấn tới đâu (cùng
      // tinh thần "3 kết quả đều hợp lệ" ở appointment-http.spec.ts): nếu bên thua đọc ticket
      // TRƯỚC khi bên thắng commit xong, cả hai cùng vào nhánh "Nhận ca" và bên thua thua ngay ở
      // bước ghi có điều kiện (409 ENCOUNTER_ALREADY_CLAIMED, đúng thông điệp thân thiện cho UI);
      // nếu bên thua đọc ticket SAU khi bên thắng đã commit xong, `existing.doctorId` đã khác actor
      // ngay từ đầu nên rơi vào nhánh "ca của người khác" (404, giống hệt test "bác sĩ khác →
      // 404" ở trên) — cả hai đều đúng nghĩa "thua cuộc đua nhận ca", không phải bug.
      expect([404, 409]).toContain(loser.status);
      if (loser.status === 409) {
        expect(loser.body.error.code).toBe('ENCOUNTER_ALREADY_CLAIMED');
      }

      // Xác nhận thật ở DB: đúng 1 bác sĩ được gán, không có trạng thái nửa vời.
      const updated = await privileged.encounter.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(updated.doctorId).toBe(winner.body.data.doctorId);
      expect(updated.status).toBe('IN_CONSULTATION');
    });

    it('bác sĩ KHÁC Khoa với ticket → 404 (chặn nhận ca chéo Khoa)', async () => {
      const departmentX = await createDepartment(fixture.tenantA.id, 'Khoa Nội — chủ ticket');
      const departmentY = await createDepartment(fixture.tenantA.id, 'Khoa Ngoại — bác sĩ khác Khoa');
      await assignDepartment(doctorAUserId, departmentY);
      const ticket = await registerPoolEncounter(18, departmentX);

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${ticket.id}/start`).set(authed(doctorAToken)).send({ version: 1 });

      expect(res.status).toBe(404);
    });

    it('bác sĩ chưa gán Khoa nào (departmentId=null) → 404 (không nhận ca được, kể cả ticket cùng Khoa mặc định)', async () => {
      const departmentId = await createDepartment(fixture.tenantA.id, 'Khoa Nội — bác sĩ chưa gán Khoa');
      const ticket = await registerPoolEncounter(19, departmentId);
      // doctorC chưa từng được assignDepartment() — departmentId vẫn NULL.

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${ticket.id}/start`).set(authed(doctorCToken)).send({ version: 1 });

      expect(res.status).toBe(404);
    });

    it('lễ tân (không có encounter.update) không nhận ca được → 403', async () => {
      const departmentId = await createDepartment(fixture.tenantA.id, 'Khoa Nội — lễ tân không nhận ca');
      const ticket = await registerPoolEncounter(20, departmentId);

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${ticket.id}/start`).set(authed(receptionistToken)).send({ version: 1 });

      expect(res.status).toBe(403);
    });

    it('tenant B không nhận ca được ticket của tenant A → 404 (cách ly tenant)', async () => {
      const departmentId = await createDepartment(fixture.tenantA.id, 'Khoa Nội — cách ly tenant');
      const ticket = await registerPoolEncounter(21, departmentId);

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${ticket.id}/start`).set(authed(tenantBDoctorToken)).send({ version: 1 });

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

  /** Đưa 1 encounter mới vào IN_CONSULTATION (check-in + start), sẵn sàng cho test S3-05→07. */
  async function startedEncounter(hour: number, doctorId = doctorAUserId, doctorToken = doctorAToken) {
    const encounterId = await checkInFreshEncounter(hour, doctorId);
    await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    return encounterId;
  }

  describe('GET /api/v1/encounters/:id/consultation — S3-05', () => {
    it('gộp đúng encounter + bệnh nhân (dị ứng) + sinh hiệu null + tiền sử rỗng + chẩn đoán/ghi chú rỗng', async () => {
      const encounterId = await startedEncounter(16);

      const res = await request(app.getHttpServer()).get(`/api/v1/encounters/${encounterId}/consultation`).set(authed(doctorAToken));

      expect(res.status).toBe(200);
      expect(res.body.data.encounter.id).toBe(encounterId);
      expect(res.body.data.encounter.status).toBe('IN_CONSULTATION');
      expect(res.body.data.patient.fullName).toBe('Bệnh nhân e2e');
      expect(res.body.data.vitalSigns).toBeNull();
      expect(res.body.data.history).toEqual([]);
      expect(res.body.data.diagnoses).toEqual([]);
      expect(res.body.data.clinicalNote).toEqual({
        personalHistory: null,
        familyHistory: null,
        reasonForVisit: null,
        illnessProgress: null,
        preliminaryDiagnosis: null,
        generalExam: null,
        regionalExam: null,
        plan: null,
      });
    });

    it('tiền sử hiện đúng lần khám trước (kèm tên chẩn đoán chính), không gồm lượt khám hiện tại', async () => {
      const patientRes = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ fullName: 'Bệnh nhân tái khám', dob: '1985-05-05', gender: 'male', phone: '0977888999', nationalId: randomNationalId() });
      const patientId = patientRes.body.data.id as string;

      async function directEncounter(hour: number) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/reception/direct')
          .set(authed(receptionistToken))
          .send({
            patientId,
            doctorId: doctorAUserId,
            checkedInAt: isoAt(hour, 0, 17),
            examTypeCode: 'KT',
            examTypeName: 'Khám thường',
            examTypePrice: 150_000,
            receptionTypeCode: 'RT_NEW',
            examFormCode: 'EF_NORMAL',
          });
        return res.body.data.id as string;
      }

      const firstEncounterId = await directEncounter(8);
      await request(app.getHttpServer()).post(`/api/v1/encounters/${firstEncounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });
      await request(app.getHttpServer())
        .put(`/api/v1/encounters/${firstEncounterId}/diagnoses`)
        .set(authed(doctorAToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });
      await request(app.getHttpServer()).post(`/api/v1/encounters/${firstEncounterId}/complete`).set(authed(doctorAToken)).send({ version: 2 });

      const secondEncounterId = await directEncounter(9);
      await request(app.getHttpServer()).post(`/api/v1/encounters/${secondEncounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });

      const res = await request(app.getHttpServer()).get(`/api/v1/encounters/${secondEncounterId}/consultation`).set(authed(doctorAToken));

      expect(res.status).toBe(200);
      expect(res.body.data.history).toHaveLength(1);
      expect(res.body.data.history[0].encounterId).toBe(firstEncounterId);
      expect(res.body.data.history[0].primaryDiagnosisName).not.toBeNull();
    });

    it('bác sĩ khác cùng tenant xem được (encounter.read=global cho vai trò doctor, đúng ENC-01 "xem toàn bộ tiền sử") → 200', async () => {
      const encounterId = await startedEncounter(17);

      const res = await request(app.getHttpServer()).get(`/api/v1/encounters/${encounterId}/consultation`).set(authed(doctorBToken));

      expect(res.status).toBe(200);
      expect(res.body.data.encounter.id).toBe(encounterId);
    });

    it('tenant B → 404', async () => {
      const encounterId = await startedEncounter(18);

      const res = await request(app.getHttpServer()).get(`/api/v1/encounters/${encounterId}/consultation`).set(authed(tenantBDoctorToken));

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/encounters/:id/diagnoses — S3-07', () => {
    it('lưu đúng 1 PRIMARY + 1 SECONDARY → 200, trả kèm icd10Name', async () => {
      const encounterId = await startedEncounter(19);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(doctorAToken))
        .send({
          diagnoses: [
            { icd10Code: 'A00.0', type: 'PRIMARY' as const },
            { icd10Code: 'A00.1', type: 'SECONDARY' as const, note: 'Theo dõi thêm' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(2);
      const primary = res.body.data.items.find((d: { type: string }) => d.type === 'PRIMARY');
      expect(primary.icd10Code).toBe('A00.0');
      expect(primary.icd10Name).toEqual(expect.any(String));
    });

    it('không có PRIMARY → 400 VALIDATION_ERROR (Zod refine)', async () => {
      const encounterId = await startedEncounter(20);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(doctorAToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'SECONDARY' as const }] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('encounter chưa IN_CONSULTATION (còn CHECKED_IN) → 409 ENCOUNTER_NOT_IN_CONSULTATION', async () => {
      const encounterId = await checkInFreshEncounter(21);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(doctorAToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_NOT_IN_CONSULTATION');
    });

    it('bác sĩ khác (scope personal) → 404', async () => {
      const encounterId = await startedEncounter(22);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(doctorBToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });

      expect(res.status).toBe(404);
    });

    it('tenant B → 404', async () => {
      const encounterId = await startedEncounter(23);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(tenantBDoctorToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/encounters/:id/clinical-note — S3-07 (nhóm Tiền sử/Thăm khám, thay 4 mục SOAP cũ)', () => {
    type ClinicalNoteKey =
      | 'personalHistory'
      | 'familyHistory'
      | 'reasonForVisit'
      | 'illnessProgress'
      | 'preliminaryDiagnosis'
      | 'generalExam'
      | 'regionalExam'
      | 'plan';

    function clinicalNotePayload(overrides?: Partial<Record<ClinicalNoteKey, { content: string; version?: number }>>) {
      return {
        personalHistory: { content: '' },
        familyHistory: { content: '' },
        reasonForVisit: { content: 'Sốt 2 ngày' },
        illnessProgress: { content: '' },
        preliminaryDiagnosis: { content: 'Nghi viêm họng' },
        generalExam: { content: 'Nhiệt độ 38.5°C' },
        regionalExam: { content: '' },
        plan: { content: 'Kê kháng sinh, tái khám sau 3 ngày' },
        ...overrides,
      };
    }

    it('tạo mới cả 8 mục (chưa có version) → 200, mỗi mục version=1', async () => {
      const encounterId = await startedEncounter(0, doctorAUserId, doctorAToken);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/clinical-note`)
        .set(authed(doctorAToken))
        .send(clinicalNotePayload());

      expect(res.status).toBe(200);
      expect(res.body.data.reasonForVisit).toEqual({ content: 'Sốt 2 ngày', version: 1 });
      expect(res.body.data.plan).toEqual({ content: 'Kê kháng sinh, tái khám sau 3 ngày', version: 1 });
    });

    it('lưu lại đúng version → update thành công, version tăng lên 2', async () => {
      const encounterId = await startedEncounter(1);
      await request(app.getHttpServer()).put(`/api/v1/encounters/${encounterId}/clinical-note`).set(authed(doctorAToken)).send(clinicalNotePayload());

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/clinical-note`)
        .set(authed(doctorAToken))
        .send(
          clinicalNotePayload({
            personalHistory: { content: '', version: 1 },
            familyHistory: { content: '', version: 1 },
            reasonForVisit: { content: 'Sốt 3 ngày, ho thêm', version: 1 },
            illnessProgress: { content: '', version: 1 },
            preliminaryDiagnosis: { content: 'Nghi viêm họng', version: 1 },
            generalExam: { content: 'Nhiệt độ 38.5°C', version: 1 },
            regionalExam: { content: '', version: 1 },
            plan: { content: 'Kê kháng sinh, tái khám sau 3 ngày', version: 1 },
          }),
        );

      expect(res.status).toBe(200);
      expect(res.body.data.reasonForVisit).toEqual({ content: 'Sốt 3 ngày, ho thêm', version: 2 });
    });

    it('version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const encounterId = await startedEncounter(2);
      await request(app.getHttpServer()).put(`/api/v1/encounters/${encounterId}/clinical-note`).set(authed(doctorAToken)).send(clinicalNotePayload());
      const allV1: Record<ClinicalNoteKey, { content: string; version: number }> = {
        personalHistory: { content: 'x', version: 1 },
        familyHistory: { content: 'x', version: 1 },
        reasonForVisit: { content: 'x', version: 1 },
        illnessProgress: { content: 'x', version: 1 },
        preliminaryDiagnosis: { content: 'x', version: 1 },
        generalExam: { content: 'x', version: 1 },
        regionalExam: { content: 'x', version: 1 },
        plan: { content: 'x', version: 1 },
      };
      await request(app.getHttpServer()).put(`/api/v1/encounters/${encounterId}/clinical-note`).set(authed(doctorAToken)).send(clinicalNotePayload(allV1));

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/clinical-note`)
        .set(authed(doctorAToken))
        .send(clinicalNotePayload(allV1));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('encounter chưa IN_CONSULTATION → 409 ENCOUNTER_NOT_IN_CONSULTATION', async () => {
      const encounterId = await checkInFreshEncounter(3);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/clinical-note`)
        .set(authed(doctorAToken))
        .send(clinicalNotePayload());

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_NOT_IN_CONSULTATION');
    });

    it('bác sĩ khác (scope personal) → 404', async () => {
      const encounterId = await startedEncounter(16);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/clinical-note`)
        .set(authed(doctorBToken))
        .send(clinicalNotePayload());

      expect(res.status).toBe(404);
    });

    it('tenant B → 404', async () => {
      const encounterId = await startedEncounter(17);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/clinical-note`)
        .set(authed(tenantBDoctorToken))
        .send(clinicalNotePayload());

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/encounters/:id/complete — "Hoàn tất khám"', () => {
    it('chưa có chẩn đoán chính → 422 DIAGNOSIS_PRIMARY_REQUIRED', async () => {
      const encounterId = await startedEncounter(4);

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/complete`).set(authed(doctorAToken)).send({ version: 1 });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('DIAGNOSIS_PRIMARY_REQUIRED');
    });

    it('đã có đúng 1 chẩn đoán chính → 200, IN_CONSULTATION→COMPLETED, set completedAt', async () => {
      const encounterId = await startedEncounter(5);
      await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(doctorAToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });

      // startConsultation (POST .../start) đã tăng version 1→2 trước đó (startedEncounter helper).
      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/complete`).set(authed(doctorAToken)).send({ version: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.completedAt).not.toBeNull();
    });

    it('hoàn tất lần 2 (đã COMPLETED) → 409 ENCOUNTER_INVALID_TRANSITION', async () => {
      const encounterId = await startedEncounter(6);
      await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(doctorAToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });
      // version 2 (đúng version thật sau startConsultation) → hoàn tất thành công lần đầu.
      await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/complete`).set(authed(doctorAToken)).send({ version: 2 });

      // Gọi lại lần 2 — chặn bởi kiểm tra trạng thái (assertEncounterTransition) TRƯỚC khi tới bước
      // kiểm version, nên version gửi lên là gì cũng luôn 409 ENCOUNTER_INVALID_TRANSITION.
      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/complete`).set(authed(doctorAToken)).send({ version: 3 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_INVALID_TRANSITION');
    });

    it('version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const encounterId = await startedEncounter(7);
      await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(doctorAToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });

      const res = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/complete`).set(authed(doctorAToken)).send({ version: 999 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('bác sĩ khác (scope personal) → 404', async () => {
      const encounterId = await startedEncounter(9, doctorAUserId, doctorAToken);
      await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounterId}/diagnoses`)
        .set(authed(doctorAToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounterId}/complete`)
        .set(authed(doctorBToken))
        .send({ version: 2 });

      expect(res.status).toBe(404);
    });

    it('tenant B → 404', async () => {
      const encounterId = await startedEncounter(10, doctorAUserId, doctorAToken);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounterId}/complete`)
        .set(authed(tenantBDoctorToken))
        .send({ version: 1 });

      expect(res.status).toBe(404);
    });
  });
});
