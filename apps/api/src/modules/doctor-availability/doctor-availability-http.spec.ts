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
 * HTTP e2e — "Tạm nghỉ / Đóng ca" của bác sĩ (`doctor-availability.controller.ts`). 2 công tắc
 * cấu hình (`allowEmergencyEndShift`/`allowReceptionistEndShift`) gate NGHIỆP VỤ THÊM ngoài RBAC —
 * xem docstring `DoctorAvailabilityService`.
 */
describe('HTTP e2e — /api/v1/doctor-availability', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBToken: string;
  let doctorBUserId: string;
  let receptionistToken: string;
  let clinicAdminToken: string;
  let tenantBDoctorToken: string;
  let tenantBDoctorUserId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-avail-${roleName}-${randomUUID()}`;
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

  async function setPolicy(tenantId: string, value: { allowEmergencyEndShift?: boolean; allowReceptionistEndShift?: boolean }) {
    if (value.allowEmergencyEndShift !== undefined) {
      await privileged.tenantSetting.upsert({
        where: { tenantId_key: { tenantId, key: 'allow_emergency_end_shift' } },
        create: { tenantId, key: 'allow_emergency_end_shift', valueJson: value.allowEmergencyEndShift, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
        update: { valueJson: value.allowEmergencyEndShift, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    if (value.allowReceptionistEndShift !== undefined) {
      await privileged.tenantSetting.upsert({
        where: { tenantId_key: { tenantId, key: 'allow_receptionist_end_shift' } },
        create: { tenantId, key: 'allow_receptionist_end_shift', valueJson: value.allowReceptionistEndShift, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
        update: { valueJson: value.allowReceptionistEndShift, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
  }

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  function isoAt(hour: number, minute: number, day = 28) {
    return new Date(Date.UTC(2026, 7, day, hour, minute, 0)).toISOString();
  }

  /** Tạo appointment + patient + check-in cho `doctorId`, thu tiền ngay (không bị gate thanh toán) — trả về encounterId `CHECKED_IN`. */
  async function checkInFreshEncounter(hour: number, doctorId: string) {
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId, fullName: 'Khách e2e đóng ca', phone: '0911777888', scheduledAt: isoAt(hour, 0), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };

    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e đóng ca', dob: '1990-01-01', gender: 'female', phone: '0933555666', nationalId: randomNationalId() });
    const patient = patientRes.body.data as { id: string };

    const checkInRes = await request(app.getHttpServer())
      .post('/api/v1/reception/check-in')
      .set(authed(receptionistToken))
      .send({
        appointmentId: appointment.id,
        patientId: patient.id,
        version: appointment.version,
        doctorId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = checkInRes.body.data.id as string;
    await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
    return encounterId;
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

    fixture = await createTwoTenantFixture(privileged, 'Doctor availability e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    // Popup "Đóng ca hôm nay" (shift-summary) cần kê được đơn thuốc, mà PUT .../diagnoses cần
    // icd10_catalog có dữ liệu thật (FK icd10Code) — dữ liệu không seed sẵn toàn cục, tự seed cho
    // riêng file test này (cùng cách encounter-http.spec.ts/icd10-http.spec.ts đã làm).
    await seedIcd10Catalog(privileged);

    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    const doctorB = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorBToken = doctorB.token;
    doctorBUserId = doctorB.userId;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const tenantBDoctor = await createUserWithRole(fixture.tenantB.id, 'doctor');
    tenantBDoctorToken = tenantBDoctor.token;
    tenantBDoctorUserId = tenantBDoctor.userId;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).send({ status: 'BREAK' });
    expect(res.status).toBe(401);
  });

  it('bác sĩ tự chuyển BREAK → 200, statusChangedAt/reason đúng; tự "Quay lại làm việc" (ACTIVE) → 200', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/doctor-availability/${doctorAUserId}`)
      .set(authed(doctorAToken))
      .send({ status: 'BREAK', reason: 'Đi họp' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('BREAK');
    expect(res.body.data.reason).toBe('Đi họp');
    expect(res.body.data.statusChangedAt).not.toBeNull();
    expect(res.body.data.releasedEncounterCount).toBeNull();

    const board = await request(app.getHttpServer()).get('/api/v1/doctor-availability/today').set(authed(receptionistToken));
    expect(board.body.data.items.some((i: { doctorId: string; status: string }) => i.doctorId === doctorAUserId && i.status === 'BREAK')).toBe(true);

    const resume = await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'ACTIVE' });
    expect(resume.status).toBe(200);
    expect(resume.body.data.status).toBe('ACTIVE');
  });

  it('bác sĩ khác đổi hộ (scope personal, không phải chính mình) → 404', async () => {
    const res = await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorBUserId}`).set(authed(doctorAToken)).send({ status: 'BREAK' });
    expect(res.status).toBe(404);
  });

  it('lễ tân đổi hộ khi allowReceptionistEndShift TẮT (mặc định) → 403 DOCTOR_AVAILABILITY_RECEPTION_DISABLED', async () => {
    await setPolicy(fixture.tenantA.id, { allowReceptionistEndShift: false });
    const res = await request(app.getHttpServer())
      .put(`/api/v1/doctor-availability/${doctorAUserId}`)
      .set(authed(receptionistToken))
      .send({ status: 'BREAK' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DOCTOR_AVAILABILITY_RECEPTION_DISABLED');
  });

  it('bật allowReceptionistEndShift → lễ tân "Cho tạm nghỉ hộ" thành công (audit ghi onBehalfOf:true)', async () => {
    await setPolicy(fixture.tenantA.id, { allowReceptionistEndShift: true });
    const res = await request(app.getHttpServer())
      .put(`/api/v1/doctor-availability/${doctorAUserId}`)
      .set(authed(receptionistToken))
      .send({ status: 'BREAK', reason: 'Lễ tân cho nghỉ hộ' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('BREAK');

    const auditRow = await privileged.auditLog.findFirstOrThrow({
      where: { tenantId: fixture.tenantA.id, entityId: doctorAUserId, action: 'doctor_availability.break_started' },
      orderBy: { occurredAt: 'desc' },
    });
    expect((auditRow.afterJson as { onBehalfOf: boolean }).onBehalfOf).toBe(true);

    // dọn lại trạng thái cho các test sau
    await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'ACTIVE' });
  });

  it('tắt allowEmergencyEndShift → bác sĩ tự "Đóng ca" thủ công (không trigger) → 403 DOCTOR_AVAILABILITY_EMERGENCY_DISABLED; kèm trigger=SCHEDULED_END vẫn 200 (Trường hợp 2 luôn hoạt động)', async () => {
    await setPolicy(fixture.tenantA.id, { allowEmergencyEndShift: false });

    const manual = await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'ENDED' });
    expect(manual.status).toBe(403);
    expect(manual.body.error.code).toBe('DOCTOR_AVAILABILITY_EMERGENCY_DISABLED');

    const scheduled = await request(app.getHttpServer())
      .put(`/api/v1/doctor-availability/${doctorAUserId}`)
      .set(authed(doctorAToken))
      .send({ status: 'ENDED', trigger: 'SCHEDULED_END', reason: 'Hết giờ làm việc' });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.data.status).toBe('ENDED');

    await setPolicy(fixture.tenantA.id, { allowEmergencyEndShift: true });
    await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'ACTIVE' });
  });

  it('lễ tân đóng ca hộ cần CẢ HAI công tắc bật — chỉ allowReceptionistEndShift (thiếu allowEmergencyEndShift) → 403 DOCTOR_AVAILABILITY_EMERGENCY_DISABLED', async () => {
    await setPolicy(fixture.tenantA.id, { allowReceptionistEndShift: true, allowEmergencyEndShift: false });
    const res = await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(receptionistToken)).send({ status: 'ENDED' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DOCTOR_AVAILABILITY_EMERGENCY_DISABLED');
    await setPolicy(fixture.tenantA.id, { allowEmergencyEndShift: true });
  });

  it('"Đóng ca" — bulk trả CHECKED_IN + IN_CONSULTATION của bác sĩ về hàng chờ chung Khoa (doctorId=null), ghi đủ audit log', async () => {
    const checkedInId = await checkInFreshEncounter(8, doctorBUserId);
    const inConsultationId = await checkInFreshEncounter(9, doctorBUserId);
    await request(app.getHttpServer()).post(`/api/v1/encounters/${inConsultationId}/start`).set(authed(doctorBToken)).send({ version: 1 });

    const res = await request(app.getHttpServer())
      .put(`/api/v1/doctor-availability/${doctorBUserId}`)
      .set(authed(doctorBToken))
      .send({ status: 'ENDED', reason: 'Hết ca hôm nay' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ENDED');
    expect(res.body.data.releasedEncounterCount).toBe(2);

    const checkedIn = await privileged.encounter.findUniqueOrThrow({ where: { id: checkedInId } });
    expect(checkedIn.doctorId).toBeNull();
    expect(checkedIn.status).toBe('CHECKED_IN');

    const wasInConsultation = await privileged.encounter.findUniqueOrThrow({ where: { id: inConsultationId } });
    expect(wasInConsultation.doctorId).toBeNull();
    expect(wasInConsultation.status).toBe('CHECKED_IN');

    const endedAudit = await privileged.auditLog.findFirstOrThrow({
      where: { tenantId: fixture.tenantA.id, entityId: doctorBUserId, action: 'doctor_availability.ended' },
      orderBy: { occurredAt: 'desc' },
    });
    expect((endedAudit.afterJson as { releasedEncounterCount: number }).releasedEncounterCount).toBe(2);

    const releasedAudits = await privileged.auditLog.findMany({
      where: { tenantId: fixture.tenantA.id, action: 'encounter.released', entityId: { in: [checkedInId, inConsultationId] } },
    });
    expect(releasedAudits).toHaveLength(2);
  });

  it('"Tạm nghỉ" KHÔNG đụng tới lượt khám đang có', async () => {
    const encounterId = await checkInFreshEncounter(10, doctorAUserId);

    const res = await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'BREAK' });
    expect(res.status).toBe(200);

    const encounter = await privileged.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.doctorId).toBe(doctorAUserId);
    expect(encounter.status).toBe('CHECKED_IN');

    await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'ACTIVE' });
  });

  it('clinic_admin đổi hộ (global scope) thành công khi cấu hình cho phép', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/doctor-availability/${doctorAUserId}`)
      .set(authed(clinicAdminToken))
      .send({ status: 'BREAK', reason: 'Admin cho nghỉ' });
    expect(res.status).toBe(200);
    await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'ACTIVE' });
  });

  it('cách ly tenant: bác sĩ tenant B đổi trạng thái bác sĩ tenant A → 404', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/doctor-availability/${doctorAUserId}`)
      .set(authed(tenantBDoctorToken))
      .send({ status: 'BREAK' });
    expect(res.status).toBe(404);
  });

  it('cách ly tenant: board "today" của tenant B không lộ trạng thái bác sĩ tenant A', async () => {
    await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'BREAK' });

    const board = await request(app.getHttpServer()).get('/api/v1/doctor-availability/today').set(authed(tenantBDoctorToken));
    expect(board.status).toBe(200);
    expect(board.body.data.items.some((i: { doctorId: string }) => i.doctorId === doctorAUserId)).toBe(false);
    expect(board.body.data.items.some((i: { doctorId: string }) => i.doctorId === tenantBDoctorUserId)).toBe(false);

    await request(app.getHttpServer()).put(`/api/v1/doctor-availability/${doctorAUserId}`).set(authed(doctorAToken)).send({ status: 'ACTIVE' });
  });

  describe('GET /api/v1/doctor-availability/:doctorId/shift-summary — popup "Đóng ca hôm nay"', () => {
    let doctorCToken: string;
    let doctorCUserId: string;

    beforeAll(async () => {
      const doctorC = await createUserWithRole(fixture.tenantA.id, 'doctor');
      doctorCToken = doctorC.token;
      doctorCUserId = doctorC.userId;
    });

    it('không có access token → 401', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorCUserId}/shift-summary`);
      expect(res.status).toBe(401);
    });

    it('chưa có ca nào hôm nay → toàn 0, avgConsultMinutes null (không phải 0), tên bác sĩ đúng', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorCUserId}/shift-summary`).set(authed(doctorCToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        doctorId: doctorCUserId,
        doctorName: 'User doctor',
        calledCount: 0,
        completedCount: 0,
        avgConsultMinutes: null,
        cancelledCount: 0,
        prescriptionCount: 0,
      });
    });

    it('đếm đúng: 1 ca gọi+hoàn tất+kê 1 đơn đã ký, 1 ca gọi+huỷ giữa chừng', async () => {
      // Ca 1: gọi khám → chẩn đoán → kê đơn → ký đơn → hoàn tất khám.
      const encounter1 = await checkInFreshEncounter(8, doctorCUserId);
      await request(app.getHttpServer()).post(`/api/v1/encounters/${encounter1}/start`).set(authed(doctorCToken)).send({ version: 1 });
      await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounter1}/diagnoses`)
        .set(authed(doctorCToken))
        .send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' as const }] });

      const drug = await privileged.drug.create({
        data: {
          tenantId: fixture.tenantA.id,
          code: `DRG-${randomUUID().slice(0, 8)}`,
          name: 'Thuốc test tổng hợp ca',
          activeIngredient: 'Test',
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
      await request(app.getHttpServer())
        .put(`/api/v1/encounters/${encounter1}/prescription-items`)
        .set(authed(doctorCToken))
        .send({ items: [{ drugId: drug.id, dose: '1 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: 10 }] });
      await request(app.getHttpServer()).post(`/api/v1/encounters/${encounter1}/prescription/sign`).set(authed(doctorCToken)).send({ version: 1 });
      await request(app.getHttpServer()).post(`/api/v1/encounters/${encounter1}/complete`).set(authed(doctorCToken)).send({ version: 2 });

      // Ca 2: gọi khám rồi huỷ giữa chừng (khách bỏ về) — vẫn tính "đã gọi khám" + "huỷ khám".
      const encounter2 = await checkInFreshEncounter(9, doctorCUserId);
      await request(app.getHttpServer()).post(`/api/v1/encounters/${encounter2}/start`).set(authed(doctorCToken)).send({ version: 1 });
      await request(app.getHttpServer())
        .post(`/api/v1/encounters/${encounter2}/cancel`)
        .set(authed(doctorCToken))
        .send({ cancelReason: 'Khách bỏ về giữa chừng', version: 2 });

      const res = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorCUserId}/shift-summary`).set(authed(doctorCToken));
      expect(res.status).toBe(200);
      expect(res.body.data.calledCount).toBe(2);
      expect(res.body.data.completedCount).toBe(1);
      expect(res.body.data.avgConsultMinutes).toBeGreaterThanOrEqual(0);
      expect(res.body.data.cancelledCount).toBe(1);
      expect(res.body.data.prescriptionCount).toBe(1);
    });

    it('scope personal: bác sĩ khác xem hộ (không phải chính mình) → 404', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorCUserId}/shift-summary`).set(authed(doctorAToken));
      expect(res.status).toBe(404);
    });

    it('lễ tân (scope global) xem được tổng hợp của bác sĩ khác — cùng khuôn "Đóng ca hộ"', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorCUserId}/shift-summary`).set(authed(receptionistToken));
      expect(res.status).toBe(200);
      expect(res.body.data.doctorId).toBe(doctorCUserId);
    });

    it('cách ly tenant: bác sĩ tenant B xem tổng hợp của bác sĩ tenant A → 404', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/doctor-availability/${doctorCUserId}/shift-summary`).set(authed(tenantBDoctorToken));
      expect(res.status).toBe(404);
    });
  });
});
