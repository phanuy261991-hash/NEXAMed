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
 * HTTP e2e — "Đăng ký ca làm việc" Giai đoạn 2, phần chặn đặt lịch hẹn ngoài ca
 * (`ClinicSettings.blockBookingOutsideWorkShiftEnabled`) + `GET /appointments/doctor-work-shifts`.
 * Tách file riêng khỏi `appointment-http.spec.ts` (đã rất dài) — cùng lý do các spec khác trong dự
 * án tách file để dễ đọc/tránh vượt rate-limit login khi chạy.
 */
describe('HTTP e2e — chặn đặt lịch hẹn ngoài ca đã đăng ký', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let doctorUserId: string;
  let shiftMorningId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function bookingPayload(doctorId: string, scheduledAt: string, overrides: Record<string, unknown> = {}) {
    return {
      doctorId,
      fullName: 'Khách kiểm thử',
      phone: '0900000000',
      scheduledAt,
      durationMinutes: 30,
      source: 'phone',
      ...overrides,
    };
  }

  async function setBlockEnabled(enabled: boolean) {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/clinic-settings')
      .set(authed(clinicAdminToken))
      .send({ blockBookingOutsideWorkShiftEnabled: enabled });
    expect(res.status).toBe(200);
    expect(res.body.data.blockBookingOutsideWorkShiftEnabled).toBe(enabled);
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

    fixture = await createTwoTenantFixture(privileged, 'AppointmentWorkShift e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    const admin = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    clinicAdminToken = admin.token;
    const receptionist = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    receptionistToken = receptionist.token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorUserId = doctor.userId;

    const shift = await request(app.getHttpServer())
      .post('/api/v1/work-shifts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Ca Sáng', startTime: '07:00', endTime: '11:00', color: 'blue' });
    shiftMorningId = shift.body.data.id;
  });

  afterAll(async () => {
    await setBlockEnabled(false);
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('công tắc mặc định TẮT — đặt lịch giờ bất kỳ vẫn thành công dù bác sĩ chưa đăng ký ca nào', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorUserId, '2026-10-01T02:00:00.000Z'));
    expect(res.status).toBe(200);
  });

  it('BẬT công tắc — bác sĩ CHƯA đăng ký ca cho ngày cụ thể đó → không giới hạn gì thêm, vẫn đặt được', async () => {
    await setBlockEnabled(true);
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorUserId, '2026-10-02T02:00:00.000Z'));
    expect(res.status).toBe(200);
  });

  it('BẬT công tắc — bác sĩ ĐÃ đăng ký ca, đặt lịch TRONG ca → thành công', async () => {
    // 2026-10-05, giờ VN 08:00 = 01:00 UTC — trong ca Sáng 07:00-11:00 (giờ VN).
    await request(app.getHttpServer())
      .post('/api/v1/work-shift-assignments')
      .set(authed(clinicAdminToken))
      .send({ userId: doctorUserId, workShiftId: shiftMorningId, workDate: '2026-10-05' });

    const shifts = await request(app.getHttpServer())
      .get('/api/v1/appointments/doctor-work-shifts')
      .query({ date: '2026-10-05' })
      .set(authed(receptionistToken));
    expect(shifts.status).toBe(200);
    expect(shifts.body.data.byDoctorId[doctorUserId]).toHaveLength(1);
    expect(shifts.body.data.byDoctorId[doctorUserId][0].name).toBe('Ca Sáng');

    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorUserId, '2026-10-05T01:00:00.000Z'));
    expect(res.status).toBe(200);
  });

  it('BẬT công tắc — đặt lịch NGOÀI ca đã đăng ký cùng ngày → 409 APPOINTMENT_OUTSIDE_WORK_SHIFT', async () => {
    // 2026-10-05 giờ VN 14:00 = 07:00 UTC — ngoài ca Sáng 07:00-11:00 (giờ VN).
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorUserId, '2026-10-05T07:00:00.000Z'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPOINTMENT_OUTSIDE_WORK_SHIFT');
  });

  it('TẮT công tắc lại — cùng giờ ngoài ca ở trên giờ đặt được bình thường', async () => {
    await setBlockEnabled(false);
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorUserId, '2026-10-05T07:00:00.000Z'));
    expect(res.status).toBe(200);
  });
});
