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
 * HTTP e2e cho module `reception` (Sprint 3, REC-01→03) — check-in tạo `encounter` thật + gắn
 * `patient` + chuyển `appointment` sang `CONVERTED`, atomic trong 1 transaction. Cùng khuôn
 * `appointment-http.spec.ts`/`patient-http.spec.ts`.
 */
describe('HTTP e2e — /api/v1/reception', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let nurseToken: string;
  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBUserId: string;
  let tenantBReceptionistToken: string;
  let tenantBDoctorId: string;
  let tenantBNurseToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-reception-${roleName}-${randomUUID()}`;
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
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function isoAt(hour: number, minute: number, day = 24) {
    return new Date(Date.UTC(2026, 7, day, hour, minute, 0)).toISOString();
  }

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  async function createAppointment(token: string, doctorId: string, scheduledAt: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(token))
      .send({ doctorId, fullName: 'Khách e2e', phone: '0911222333', scheduledAt, source: 'phone' as const });
    return res.body.data as { id: string; version: number; doctorId: string };
  }

  async function createPatient(token: string, overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(token))
      .send({
        fullName: 'Bệnh nhân e2e',
        dob: '1990-01-01',
        gender: 'female',
        phone: '0933444555',
        nationalId: randomNationalId(),
        ...overrides,
      });
    return res.body.data as { id: string };
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
   * `checkInRequestSchema` (`docs/DECISIONS.md` #044) giờ dùng chung biểu mẫu với
   * `registerReceptionRequestSchema` — bắt buộc kèm loại khám. `doctorId` (`docs/DECISIONS.md`
   * #064 — "Hàng đợi ảo") nay BẮT BUỘC gửi tường minh (server không còn tự suy từ
   * `appointment.doctorId`) — mặc định truyền đúng bác sĩ của lịch hẹn để giữ hành vi test cũ,
   * override sang `departmentId` (bỏ `doctorId`) ở test riêng cho nhánh "theo Khoa".
   */
  /** "Chỉ định dịch vụ khám" (docs/DECISIONS.md #080) — 1 dòng mặc định, test override bằng `services`. */
  function defaultServices() {
    return [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }];
  }

  function checkInPayload(appointmentId: string, patientId: string, version: number, doctorId: string, overrides: Record<string, unknown> = {}) {
    return {
      appointmentId,
      patientId,
      version,
      doctorId,
      services: defaultServices(),
      // Thiết kế lại "Tiếp nhận bệnh nhân" (mockup đã duyệt) — bắt buộc kèm Loại tiếp nhận/Hình thức khám.
      receptionTypeCode: 'RT_NEW',
      examFormCode: 'EF_NORMAL',
      ...overrides,
    };
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

    fixture = await createTwoTenantFixture(privileged, 'Reception e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    nurseToken = (await createUserWithRole(fixture.tenantA.id, 'nurse')).token;
    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    const doctorB = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorBUserId = doctorB.userId;
    const tenantBReceptionist = await createUserWithRole(fixture.tenantB.id, 'receptionist');
    tenantBReceptionistToken = tenantBReceptionist.token;
    const tenantBDoctor = await createUserWithRole(fixture.tenantB.id, 'doctor');
    tenantBDoctorId = tenantBDoctor.userId;
    tenantBNurseToken = (await createUserWithRole(fixture.tenantB.id, 'nurse')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('POST /api/v1/reception/check-in', () => {
    it('receptionist check-in lịch SCHEDULED → 200, tạo encounter CHECKED_IN + appointment chuyển CONVERTED gắn đúng patientId', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(8, 0));
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appointment.id, patient.id, appointment.version, doctorAUserId, { patientSourceCode: 'FB', pulse: 80, temperatureC: 37.2 }));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CHECKED_IN');
      expect(res.body.data.patientId).toBe(patient.id);
      expect(res.body.data.doctorId).toBe(doctorAUserId);
      expect(res.body.data.encounterNo).toMatch(/^LK\d{10}$/);
      expect(res.body.data.version).toBe(1);

      // Xác nhận thật ở DB: appointment đã CONVERTED + gắn đúng patientId (không phải chỉ response giả).
      const updatedAppointment = await privileged.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      expect(updatedAppointment.status).toBe('CONVERTED');
      expect(updatedAppointment.patientId).toBe(patient.id);
      const encounter = await privileged.encounter.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(encounter.insuranceSnapshot).toEqual({ selfPay: true });
      expect(encounter.patientSourceCode).toBe('FB');
      // "Chỉ định dịch vụ khám" (docs/DECISIONS.md #080) — lưu ở bảng con, không còn ở cột encounter.
      const serviceItem = await privileged.encounterServiceItem.findFirstOrThrow({ where: { encounterId: res.body.data.id } });
      expect(serviceItem.examTypeCode).toBe('KT');
      // Sinh hiệu nhập cùng lúc check-in phải tạo được dòng vital_sign tương ứng (docs/DECISIONS.md #044).
      const vitalSign = await privileged.vitalSign.findFirstOrThrow({ where: { encounterId: res.body.data.id } });
      expect(vitalSign.pulse).toBe(80);
      expect(vitalSign.temperatureDeciC).toBe(372);
    });

    it('check-in lịch không còn SCHEDULED (đã CANCELLED) → 409 APPOINTMENT_NOT_CANCELLABLE', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(8, 30));
      await request(app.getHttpServer())
        .post(`/api/v1/appointments/${appointment.id}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Đổi ý', version: 1 });
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appointment.id, patient.id, 2, doctorAUserId));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_CANCELLABLE');
    });

    it('hai request check-in TRÙNG một appointment gần như đồng thời → một 200, một 409 (thua cuộc đua)', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 0));
      const patient = await createPatient(receptionistToken);
      const payload = checkInPayload(appointment.id, patient.id, appointment.version, doctorAUserId);

      const [first, second] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/reception/check-in').set(authed(receptionistToken)).send(payload),
        request(app.getHttpServer()).post('/api/v1/reception/check-in').set(authed(receptionistToken)).send(payload),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const failed = first.status === 409 ? first : second;
      // 3 kết quả đều hợp lệ tuỳ thời điểm 2 transaction thật sự chồng lấn tới đâu: hai insert
      // encounter đụng nhau (ENCOUNTER_ALREADY_EXISTS), version appointment đã đổi giữa lúc đọc và
      // ghi (CONCURRENT_MODIFICATION), hoặc bên thua đọc appointment SAU khi bên thắng đã commit
      // xong (APPOINTMENT_NOT_CANCELLABLE, status đã là CONVERTED) — cả 3 đều đúng nghĩa "thua
      // cuộc đua check-in", không phải bug.
      expect(['ENCOUNTER_ALREADY_EXISTS', 'CONCURRENT_MODIFICATION', 'APPOINTMENT_NOT_CANCELLABLE']).toContain(failed.body.error.code);

      const encounterCount = await privileged.encounter.count({ where: { appointmentId: appointment.id } });
      expect(encounterCount).toBe(1);
    });

    it('patientId không tồn tại → 404', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 30));

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appointment.id, randomUUID(), appointment.version, doctorAUserId));

      expect(res.status).toBe(404);
    });

    it('version cũ → 409 CONCURRENT_MODIFICATION, không tạo encounter mồ côi (rollback cả transaction)', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(10, 0));
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appointment.id, patient.id, 999, doctorAUserId));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
      const encounterCount = await privileged.encounter.count({ where: { appointmentId: appointment.id } });
      expect(encounterCount).toBe(0);
    });

    it('bác sĩ không có encounter.create (chỉ receptionist/clinic_admin check-in được) → 403', async () => {
      const appointment = await createAppointment(receptionistToken, doctorBUserId, isoAt(10, 30));
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(doctorAToken))
        .send(checkInPayload(appointment.id, patient.id, appointment.version, doctorBUserId));

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('vai trò không có encounter.create (nurse) → 403 PERMISSION_DENIED', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(11, 0));
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(nurseToken))
        .send(checkInPayload(appointment.id, patient.id, appointment.version, doctorAUserId));

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('tenant B check-in lịch hẹn của tenant A → 404 (cách ly tenant)', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(11, 30));
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(tenantBReceptionistToken))
        .send(checkInPayload(appointment.id, patient.id, appointment.version, doctorAUserId));

      expect(res.status).toBe(404);
    });

    it('tenant B check-in lịch hẹn thật của tenant B nhưng patientId thuộc tenant A → 404 (không rò rỉ xuyên tenant)', async () => {
      const appointmentB = await createAppointment(tenantBReceptionistToken, tenantBDoctorId, isoAt(12, 0));
      const patientA = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(tenantBReceptionistToken))
        .send(checkInPayload(appointmentB.id, patientA.id, appointmentB.version, tenantBDoctorId));

      expect(res.status).toBe(404);
    });

    it('không truyền chiefComplaint → dùng appointment.reason làm mặc định', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send({ doctorId: doctorAUserId, fullName: 'Khách e2e', phone: '0911222333', reason: 'Đau bụng', scheduledAt: isoAt(12, 30), source: 'phone' as const });
      const appointment = created.body.data as { id: string; version: number };
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appointment.id, patient.id, appointment.version, doctorAUserId));

      expect(res.status).toBe(200);
      expect(res.body.data.chiefComplaint).toBe('Đau bụng');
    });
  });

  describe('POST /api/v1/reception/direct — "Tiếp nhận bệnh nhân" (tạo encounter trực tiếp, không qua appointment)', () => {
    function directPayload(patientId: string, doctorId: string, checkedInAt: string, overrides: Record<string, unknown> = {}) {
      return {
        patientId,
        doctorId,
        checkedInAt,
        services: defaultServices(),
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
        ...overrides,
      };
    }

    it('receptionist tạo → 200, encounter CHECKED_IN với appointmentId=null, snapshot đúng examType', async () => {
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(directPayload(patient.id, doctorAUserId, isoAt(8, 0, 28), { patientSourceCode: 'FB', chiefComplaint: 'Ho sốt' }));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CHECKED_IN');
      expect(res.body.data.appointmentId).toBeNull();
      expect(res.body.data.patientId).toBe(patient.id);
      expect(res.body.data.doctorId).toBe(doctorAUserId);
      expect(res.body.data.encounterNo).toMatch(/^LK\d{10}$/);

      const encounter = await privileged.encounter.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(encounter.appointmentId).toBeNull();
      expect(encounter.patientSourceCode).toBe('FB');
      const serviceItem = await privileged.encounterServiceItem.findFirstOrThrow({ where: { encounterId: res.body.data.id } });
      expect(serviceItem.examTypeCode).toBe('KT');
      expect(serviceItem.examTypeName).toBe('Khám thường');
      expect(serviceItem.examTypePrice).toBe(150_000n);
    });

    it('hồ sơ đã bị gộp (mergedIntoId khác null, S5-06 PAT-04) → 409 PATIENT_ALREADY_MERGED, không tạo được lượt khám mới', async () => {
      const source = await createPatient(receptionistToken);
      const target = await createPatient(receptionistToken);
      await privileged.patient.update({ where: { id: source.id }, data: { mergedIntoId: target.id } });

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(directPayload(source.id, doctorAUserId, isoAt(8, 3, 28)));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PATIENT_ALREADY_MERGED');
    });

    it('services[] nhiều dòng — 200, mỗi dòng lưu đúng trong encounter_service_item, dòng chưa có đơn giá vẫn lưu được với priceTypeCode/unitCode/examTypePrice=null', async () => {
      const patient = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(
          directPayload(patient.id, doctorAUserId, isoAt(8, 5, 28), {
            services: [
              { examTypeCode: 'KT', examTypeName: 'Khám thường', priceTypeCode: 'PT_SERVICE', unitCode: 'LUOT', examTypePrice: 150_000, quantity: 1 },
              { examTypeCode: 'SA', examTypeName: 'Siêu âm', quantity: 2 },
            ],
          }),
        );

      expect(res.status).toBe(200);
      const items = await privileged.encounterServiceItem.findMany({ where: { encounterId: res.body.data.id }, orderBy: { createdAt: 'asc' } });
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ examTypeCode: 'KT', priceTypeCode: 'PT_SERVICE', unitCode: 'LUOT', examTypePrice: 150_000n, quantity: 1 });
      expect(items[1]).toMatchObject({ examTypeCode: 'SA', priceTypeCode: null, unitCode: null, examTypePrice: null, quantity: 2 });
    });

    it('services rỗng → 400 (bắt buộc ít nhất 1 dịch vụ khám)', async () => {
      const patient = await createPatient(receptionistToken);
      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(directPayload(patient.id, doctorAUserId, isoAt(8, 10, 28), { services: [] }));

      expect(res.status).toBe(400);
    });

    it('không truyền patientSourceCode → lưu null, vẫn tạo thành công', async () => {
      const patient = await createPatient(receptionistToken);
      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(directPayload(patient.id, doctorAUserId, isoAt(8, 30, 28)));

      expect(res.status).toBe(200);
      const encounter = await privileged.encounter.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(encounter.patientSourceCode).toBeNull();
    });

    it('thiếu receptionTypeCode/examFormCode (thiết kế lại "Tiếp nhận bệnh nhân", mockup đã duyệt) → 400', async () => {
      const patient = await createPatient(receptionistToken);
      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(directPayload(patient.id, doctorAUserId, isoAt(8, 45, 28), { receptionTypeCode: undefined, examFormCode: undefined }));

      expect(res.status).toBe(400);
    });

    it('isPriority=true nhưng thiếu priorityReasonCode → 400; kèm đủ → 200, lưu đúng Ưu tiên khám/Loại giá dịch vụ/Đơn vị/Số lượng', async () => {
      const patient = await createPatient(receptionistToken);

      const missingReason = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(directPayload(patient.id, doctorAUserId, isoAt(9, 15, 28), { isPriority: true }));
      expect(missingReason.status).toBe(400);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(
          directPayload(patient.id, doctorAUserId, isoAt(9, 20, 28), {
            isPriority: true,
            priorityReasonCode: 'PR_ELDERLY',
            services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, priceTypeCode: 'PT_SERVICE', unitCode: 'LUOT', quantity: 2 }],
          }),
        );
      expect(res.status).toBe(200);
      const encounter = await privileged.encounter.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(encounter.isPriority).toBe(true);
      expect(encounter.priorityReasonCode).toBe('PR_ELDERLY');
      const serviceItem = await privileged.encounterServiceItem.findFirstOrThrow({ where: { encounterId: res.body.data.id } });
      expect(serviceItem.priceTypeCode).toBe('PT_SERVICE');
      expect(serviceItem.unitCode).toBe('LUOT');
      expect(serviceItem.quantity).toBe(2);
    });

    it('patientId không tồn tại → 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send(directPayload(randomUUID(), doctorAUserId, isoAt(9, 0, 28)));

      expect(res.status).toBe(404);
    });

    it('doctor/nurse không có encounter.create → 403', async () => {
      const patient = await createPatient(receptionistToken);

      const asDoctor = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(doctorAToken))
        .send(directPayload(patient.id, doctorAUserId, isoAt(9, 30, 28)));
      expect(asDoctor.status).toBe(403);

      const asNurse = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(nurseToken))
        .send(directPayload(patient.id, doctorAUserId, isoAt(9, 45, 28)));
      expect(asNurse.status).toBe(403);
    });

    it('tenant B tạo với patientId thuộc tenant A → 404 (không rò rỉ xuyên tenant)', async () => {
      const patientA = await createPatient(receptionistToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(tenantBReceptionistToken))
        .send(directPayload(patientA.id, tenantBDoctorId, isoAt(10, 0, 28)));

      expect(res.status).toBe(404);
    });
  });

  describe('Điều phối Bác sĩ/Khoa lúc Tiếp nhận ("Hàng đợi ảo", #064)', () => {
    function baseExam() {
      return {
        services: defaultServices(),
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      };
    }

    it('registerDirect theo Khoa (không doctorId) → 200, doctorId=null, departmentId đúng', async () => {
      const departmentId = await createDepartment(fixture.tenantA.id, 'Khoa Nội — direct theo Khoa');
      const patient = await createPatient(receptionistToken, { phone: '0933444600' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({ patientId: patient.id, departmentId, checkedInAt: isoAt(8, 0, 29), ...baseExam() });

      expect(res.status).toBe(200);
      expect(res.body.data.doctorId).toBeNull();
      expect(res.body.data.departmentId).toBe(departmentId);
    });

    it('registerDirect theo bác sĩ cụ thể — server TỰ SUY departmentId từ hồ sơ bác sĩ, bỏ qua departmentId client gửi kèm', async () => {
      const doctorDept = await createDepartment(fixture.tenantA.id, 'Khoa Nội — của bác sĩ');
      const spoofedDept = await createDepartment(fixture.tenantA.id, 'Khoa giả mạo — client cố gửi kèm');
      await assignDepartment(doctorAUserId, doctorDept);
      const patient = await createPatient(receptionistToken, { phone: '0933444601' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({ patientId: patient.id, doctorId: doctorAUserId, departmentId: spoofedDept, checkedInAt: isoAt(8, 15, 29), ...baseExam() });

      expect(res.status).toBe(200);
      expect(res.body.data.doctorId).toBe(doctorAUserId);
      expect(res.body.data.departmentId).toBe(doctorDept);
      expect(res.body.data.departmentId).not.toBe(spoofedDept);
    });

    it('bác sĩ chưa gán Khoa nào → departmentId fallback về Khoa mặc định ("Khoa chung") của tenant', async () => {
      const defaultDept = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
      const doctorNoDept = await createUserWithRole(fixture.tenantA.id, 'doctor');
      const patient = await createPatient(receptionistToken, { phone: '0933444602' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({ patientId: patient.id, doctorId: doctorNoDept.userId, checkedInAt: isoAt(8, 30, 29), ...baseExam() });

      expect(res.status).toBe(200);
      expect(res.body.data.departmentId).toBe(defaultDept.id);
    });

    it('registerDirect thiếu cả doctorId lẫn departmentId → 400 VALIDATION_ERROR', async () => {
      const patient = await createPatient(receptionistToken, { phone: '0933444603' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({ patientId: patient.id, checkedInAt: isoAt(8, 45, 29), ...baseExam() });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('checkIn theo Khoa (không doctorId) dù lịch hẹn gốc đã có bác sĩ → doctorId=null, departmentId theo Khoa đã chọn', async () => {
      const departmentId = await createDepartment(fixture.tenantA.id, 'Khoa Nội — check-in theo Khoa');
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 0, 29));
      const patient = await createPatient(receptionistToken, { phone: '0933444604' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send({ appointmentId: appointment.id, patientId: patient.id, version: appointment.version, departmentId, ...baseExam() });

      expect(res.status).toBe(200);
      expect(res.body.data.doctorId).toBeNull();
      expect(res.body.data.departmentId).toBe(departmentId);
    });

    it('checkIn theo bác sĩ KHÁC bác sĩ gốc của lịch hẹn — dùng đúng bác sĩ client chọn, không phải appointment.doctorId', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 15, 29));
      const patient = await createPatient(receptionistToken, { phone: '0933444605' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send({ appointmentId: appointment.id, patientId: patient.id, version: appointment.version, doctorId: doctorBUserId, ...baseExam() });

      expect(res.status).toBe(200);
      expect(res.body.data.doctorId).toBe(doctorBUserId);
    });

    it('checkIn thiếu cả doctorId lẫn departmentId → 400 VALIDATION_ERROR', async () => {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 30, 29));
      const patient = await createPatient(receptionistToken, { phone: '0933444606' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send({ appointmentId: appointment.id, patientId: patient.id, version: appointment.version, ...baseExam() });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/reception/list', () => {
    // `checkIn()` (không nhận checkedInAt tuỳ chỉnh) luôn set checked_in_at = new Date() (giờ hệ
    // thống thật lúc test chạy) — KHÔNG dùng `isoAt(..., targetDay)` để lọc `date` cho các case
    // check-in-từ-lịch-hẹn (khác `POST /reception/direct` ở trên, có `checkedInAt` tuỳ ý). Không
    // truyền `date` → server tự mặc định "hôm nay", đúng lúc encounter vừa được tạo.
    it('CHỈ encounter đã tiếp nhận trong ngày (không gộp lịch hẹn SCHEDULED chưa tới), sắp theo giờ tiếp nhận', async () => {
      const targetDay = 25;
      const scheduled = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 0, targetDay));
      const toCheckIn = await createAppointment(receptionistToken, doctorAUserId, isoAt(8, 0, targetDay));
      const patient = await createPatient(receptionistToken);
      await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(toCheckIn.id, patient.id, toCheckIn.version, doctorAUserId));

      const res = await request(app.getHttpServer()).get('/api/v1/reception/list').set(authed(receptionistToken));

      expect(res.status).toBe(200);
      const items = res.body.data.items as Array<{ appointmentId: string | null; status: string }>;
      // Lịch hẹn 9h CHƯA check-in không được xuất hiện — chỉ encounter đã tiếp nhận.
      expect(items.find((i) => i.appointmentId === scheduled.id)).toBeUndefined();
      const encounterItem = items.find((i) => i.appointmentId === toCheckIn.id);
      expect(encounterItem).toMatchObject({ status: 'CHECKED_IN' });
    });

    it('trả đúng "Người tiếp nhận" (encounter.createdBy resolve tên) cho cả 2 luồng check-in và tiếp nhận trực tiếp', async () => {
      // Không dùng isoAt(..., targetDay) cho checkedInAt ở đây — GET /reception/list không truyền
      // `date` sẽ mặc định lọc "hôm nay" (giờ hệ thống thật), cùng lý do check-in() luôn tự đặt
      // checked_in_at = new Date() (ghi chú ở test đầu tiên của describe này).
      const targetDay = 25;
      const patient1 = await createPatient(receptionistToken, { phone: '0933444558' });
      const appt = await createAppointment(receptionistToken, doctorAUserId, isoAt(11, 0, targetDay));
      const checkedIn = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appt.id, patient1.id, appt.version, doctorAUserId));

      const patient2 = await createPatient(receptionistToken, { phone: '0933444559' });
      const directRes = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({
          patientId: patient2.id,
          doctorId: doctorAUserId,
          checkedInAt: new Date().toISOString(),
          services: defaultServices(),
          receptionTypeCode: 'RT_NEW',
          examFormCode: 'EF_NORMAL',
        });

      const res = await request(app.getHttpServer()).get('/api/v1/reception/list').set(authed(receptionistToken));
      const items = res.body.data.items as Array<{ encounterId: string; receivedByName: string | null }>;
      expect(items.find((i) => i.encounterId === checkedIn.body.data.id)?.receivedByName).toBe('User receptionist');
      expect(items.find((i) => i.encounterId === (directRes.body.data as { id: string }).id)?.receivedByName).toBe('User receptionist');
    });

    it('bác sĩ có encounter.read=global (không đổi, giữ nguyên PRD ENC-01) — không truyền doctorId thì thấy CỦA CẢ 2 bác sĩ', async () => {
      const targetDay = 26;
      const patient = await createPatient(receptionistToken);
      const apptA = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 0, targetDay));
      const apptB = await createAppointment(receptionistToken, doctorBUserId, isoAt(9, 30, targetDay));
      await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(apptA.id, patient.id, apptA.version, doctorAUserId));
      const patient2 = await createPatient(receptionistToken, { phone: '0933444556' });
      await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(apptB.id, patient2.id, apptB.version, doctorBUserId));

      const res = await request(app.getHttpServer()).get('/api/v1/reception/list').set(authed(doctorAToken));

      const items = res.body.data.items as Array<{ doctorId: string }>;
      const doctorIds = new Set(items.map((i) => i.doctorId));
      expect(doctorIds.has(doctorAUserId)).toBe(true);
      expect(doctorIds.has(doctorBUserId)).toBe(true);
    });

    it('truyền doctorId (trang "Hàng đợi khám") — lọc đúng chỉ 1 bác sĩ dù scope global', async () => {
      const patient = await createPatient(receptionistToken, { phone: '0933444557' });
      const appt = await createAppointment(receptionistToken, doctorAUserId, isoAt(10, 0, 26));
      await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appt.id, patient.id, appt.version, doctorAUserId));

      const res = await request(app.getHttpServer())
        .get('/api/v1/reception/list')
        .query({ doctorId: doctorAUserId })
        .set(authed(doctorAToken));

      const items = res.body.data.items as Array<{ doctorId: string }>;
      expect(items.every((i) => i.doctorId === doctorAUserId)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it('nurse (đã đổi personal→global) đọc được danh sách', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/reception/list').set(authed(nurseToken));
      expect(res.status).toBe(200);
    });

    it('tenant B không thấy danh sách của tenant A', async () => {
      const targetDay = 27;
      const patient = await createPatient(receptionistToken);
      const appt = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 0, targetDay));
      const created = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appt.id, patient.id, appt.version, doctorAUserId));

      const res = await request(app.getHttpServer()).get('/api/v1/reception/list').set(authed(tenantBReceptionistToken));

      const items = res.body.data.items as Array<{ encounterId: string }>;
      expect(items.find((i) => i.encounterId === created.body.data.id)).toBeUndefined();
    });

    it('includeDepartmentPool=true ("Hàng đợi khám", #064) — bác sĩ thấy "của tôi" ∪ "hàng chờ chung Khoa mình", KHÔNG thấy pool Khoa khác', async () => {
      // Không truyền `date` (mặc định "hôm nay") — checkIn() luôn set checkedInAt=new Date() thật
      // (không nhận tuỳ chỉnh), nên mọi mốc thời gian trong test này đều dùng "bây giờ" cho nhất
      // quán, thay vì isoAt(..., targetDay) như các test registerDirect thuần ở trên.
      const myDept = await createDepartment(fixture.tenantA.id, 'Khoa Nội — pool của tôi');
      const otherDept = await createDepartment(fixture.tenantA.id, 'Khoa Ngoại — pool Khoa khác');
      await assignDepartment(doctorAUserId, myDept);

      const patientMine = await createPatient(receptionistToken, { phone: '0933444610' });
      const appt = await createAppointment(receptionistToken, doctorAUserId, isoAt(9, 0));
      const mine = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appt.id, patientMine.id, appt.version, doctorAUserId));

      const patientPoolMine = await createPatient(receptionistToken, { phone: '0933444611' });
      const poolMine = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({
          patientId: patientPoolMine.id,
          departmentId: myDept,
          checkedInAt: new Date().toISOString(),
          services: defaultServices(),
          receptionTypeCode: 'RT_NEW',
          examFormCode: 'EF_NORMAL',
        });

      const patientPoolOther = await createPatient(receptionistToken, { phone: '0933444612' });
      const poolOther = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({
          patientId: patientPoolOther.id,
          departmentId: otherDept,
          checkedInAt: new Date().toISOString(),
          services: defaultServices(),
          receptionTypeCode: 'RT_NEW',
          examFormCode: 'EF_NORMAL',
        });

      // `doctor.encounter.read = global` (PRD ENC-01 — xem toàn bộ tiền sử, kể cả lượt khám bác sĩ
      // khác phụ trách), nên trang "Hàng đợi khám" LUÔN tự truyền `doctorId=chính mình` tường minh
      // (không dựa vào data_scope=personal) — đúng hành vi `ReceptionDoctorQueuePage.tsx` hiện có.
      const res = await request(app.getHttpServer())
        .get('/api/v1/reception/list')
        .query({ doctorId: doctorAUserId, includeDepartmentPool: 'true' })
        .set(authed(doctorAToken));

      expect(res.status).toBe(200);
      const ids = (res.body.data.items as Array<{ encounterId: string }>).map((i) => i.encounterId);
      expect(ids).toContain(mine.body.data.id);
      expect(ids).toContain(poolMine.body.data.id);
      expect(ids).not.toContain(poolOther.body.data.id);
    });

    it('includeDepartmentPool bỏ trống (mặc định false) — bác sĩ KHÔNG thấy hàng chờ chung dù cùng Khoa (giữ nguyên hành vi cũ)', async () => {
      const myDept = await createDepartment(fixture.tenantA.id, 'Khoa Nội — không cờ pool');
      await assignDepartment(doctorAUserId, myDept);

      const patientPool = await createPatient(receptionistToken, { phone: '0933444613' });
      const pool = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({
          patientId: patientPool.id,
          departmentId: myDept,
          checkedInAt: new Date().toISOString(),
          services: defaultServices(),
          receptionTypeCode: 'RT_NEW',
          examFormCode: 'EF_NORMAL',
        });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reception/list')
        .query({ doctorId: doctorAUserId })
        .set(authed(doctorAToken));

      const ids = (res.body.data.items as Array<{ encounterId: string }>).map((i) => i.encounterId);
      expect(ids).not.toContain(pool.body.data.id);
    });

    it('lễ tân ("Danh sách tiếp nhận", không truyền doctorId) — thấy CẢ ticket hàng chờ chung (không lọc theo bác sĩ)', async () => {
      const dept = await createDepartment(fixture.tenantA.id, 'Khoa Nội — lễ tân thấy pool');
      const patientPool = await createPatient(receptionistToken, { phone: '0933444614' });
      const pool = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({
          patientId: patientPool.id,
          departmentId: dept,
          checkedInAt: new Date().toISOString(),
          services: defaultServices(),
          receptionTypeCode: 'RT_NEW',
          examFormCode: 'EF_NORMAL',
        });

      const res = await request(app.getHttpServer()).get('/api/v1/reception/list').set(authed(receptionistToken));

      const ids = (res.body.data.items as Array<{ encounterId: string }>).map((i) => i.encounterId);
      expect(ids).toContain(pool.body.data.id);
    });

    it('Thu ngân cơ bản (Sprint 5/6) — queueView=true ("Hàng đợi khám") ẩn ticket chưa thu tiền và không được phép nợ; "Danh sách tiếp nhận" (queueView bỏ trống) vẫn thấy đủ', async () => {
      const dept = await createDepartment(fixture.tenantA.id, 'Khoa Nội — queueView');
      await assignDepartment(doctorAUserId, dept);
      const patient = await createPatient(receptionistToken, { phone: '0933444620' });
      const unpaid = await request(app.getHttpServer())
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({
          patientId: patient.id,
          doctorId: doctorAUserId,
          checkedInAt: new Date().toISOString(),
          services: defaultServices(),
          receptionTypeCode: 'RT_NEW',
          examFormCode: 'EF_NORMAL',
        });
      const encounterId = unpaid.body.data.id as string;

      const queueRes = await request(app.getHttpServer())
        .get('/api/v1/reception/list')
        .query({ doctorId: doctorAUserId, queueView: 'true' })
        .set(authed(doctorAToken));
      expect((queueRes.body.data.items as Array<{ encounterId: string }>).map((i) => i.encounterId)).not.toContain(encounterId);

      const listRes = await request(app.getHttpServer()).get('/api/v1/reception/list').set(authed(receptionistToken));
      expect((listRes.body.data.items as Array<{ encounterId: string }>).map((i) => i.encounterId)).toContain(encounterId);

      // Thu tiền xong → xuất hiện lại trong "Hàng đợi khám" ngay (không cần thao tác gì khác).
      await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${encounterId}/pay`)
        .set(authed(receptionistToken))
        .send({ method: 'CASH', version: 1 });
      const queueAfterPay = await request(app.getHttpServer())
        .get('/api/v1/reception/list')
        .query({ doctorId: doctorAUserId, queueView: 'true' })
        .set(authed(doctorAToken));
      expect((queueAfterPay.body.data.items as Array<{ encounterId: string }>).map((i) => i.encounterId)).toContain(encounterId);
    });
  });

  describe('POST /api/v1/reception/encounters/:encounterId/vital-signs', () => {
    async function checkInFreshEncounter(hour: number) {
      const appointment = await createAppointment(receptionistToken, doctorAUserId, isoAt(hour, 0));
      const patient = await createPatient(receptionistToken, { dob: '1990-01-01' });
      const res = await request(app.getHttpServer())
        .post('/api/v1/reception/check-in')
        .set(authed(receptionistToken))
        .send(checkInPayload(appointment.id, patient.id, appointment.version, doctorAUserId));
      return res.body.data.id as string;
    }

    it('nurse nhập sinh hiệu hợp lệ → 200, lưu đúng, không cảnh báo khi trong ngưỡng', async () => {
      const encounterId = await checkInFreshEncounter(13);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/reception/encounters/${encounterId}/vital-signs`)
        .set(authed(nurseToken))
        .send({ pulse: 75, temperatureC: 37.0, spo2: 98 });

      expect(res.status).toBe(200);
      expect(res.body.data.pulse).toBe(75);
      expect(res.body.data.temperatureC).toBe(37.0);
      expect(res.body.data.warnings).toEqual([]);
    });

    it('mạch ngoài ngưỡng người lớn (150) → vẫn lưu 200, kèm warnings out_of_range', async () => {
      const encounterId = await checkInFreshEncounter(14);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/reception/encounters/${encounterId}/vital-signs`)
        .set(authed(nurseToken))
        .send({ pulse: 150 });

      expect(res.status).toBe(200);
      expect(res.body.data.warnings).toHaveLength(1);
      expect(res.body.data.warnings[0]).toMatchObject({ field: 'pulse', kind: 'out_of_range' });
    });

    it('không chỉ số nào → 400 VALIDATION_ERROR', async () => {
      const encounterId = await checkInFreshEncounter(15);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/reception/encounters/${encounterId}/vital-signs`)
        .set(authed(nurseToken))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('đã bắt đầu khám (IN_CONSULTATION) — vẫn cho nhập, bác sĩ bổ sung/đo lại ngay trong màn khám (2026-08-20)', async () => {
      const encounterId = await checkInFreshEncounter(16);
      await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/reception/encounters/${encounterId}/vital-signs`)
        .set(authed(nurseToken))
        .send({ pulse: 75 });

      expect(res.status).toBe(200);
      expect(res.body.data.pulse).toBe(75);
    });

    it('encounter đã "bỏ về" (CANCELLED) → 409 ENCOUNTER_NOT_CHECKED_IN', async () => {
      const encounterId = await checkInFreshEncounter(18);
      await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounterId}/cancel`)
        .set(authed(doctorAToken))
        .send({ cancelReason: 'Bệnh nhân bỏ về', version: 1 });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/reception/encounters/${encounterId}/vital-signs`)
        .set(authed(nurseToken))
        .send({ pulse: 75 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_NOT_CHECKED_IN');
    });

    it('tenant B không nhập được sinh hiệu cho encounter của tenant A → 404 (dùng token nurse tenant B — có vital_sign.create thật)', async () => {
      const encounterId = await checkInFreshEncounter(17);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/reception/encounters/${encounterId}/vital-signs`)
        .set(authed(tenantBNurseToken))
        .send({ pulse: 75 });

      expect(res.status).toBe(404);
    });
  });
});
