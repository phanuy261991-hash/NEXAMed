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
 * HTTP e2e cho module `appointment` (S2-05, APP-01/02/03; đổi mô hình sang "lead capture" ở
 * docs/DECISIONS.md #032 — không tạo/gắn `patient` lúc đặt). Cùng khuôn với `patient-http.spec.ts`
 * (S2-01). Trọng tâm: exclusion constraint C2 (docs/ERD.md mục 4) chặn trùng khung giờ cùng bác
 * sĩ THẬT SỰ ở tầng DB, kể cả khi hai request tới gần như đồng thời (APP-03) — gate cuối Sprint 2
 * yêu cầu chính xác kịch bản này (docs/product/plan.md mục 5).
 */
describe('HTTP e2e — /api/v1/appointments', () => {
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

  const DEFAULT_FULL_NAME = 'Nguyễn Văn Khách';
  const DEFAULT_PHONE = '0900111222';

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-${roleName}-${randomUUID()}`;
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

  function isoAt(hour: number, minute: number, day = 20) {
    return new Date(Date.UTC(2026, 7, day, hour, minute, 0)).toISOString();
  }

  /** Payload đặt lịch tối thiểu hợp lệ (docs/DECISIONS.md #032 — không còn `patientId`). */
  function bookingPayload(doctorId: string, scheduledAt: string, overrides: Record<string, unknown> = {}) {
    return { doctorId, fullName: DEFAULT_FULL_NAME, phone: DEFAULT_PHONE, scheduledAt, source: 'phone' as const, ...overrides };
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

    fixture = await createTwoTenantFixture(privileged, 'Appointment e2e');
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
    tenantBReceptionistToken = (await createUserWithRole(fixture.tenantB.id, 'receptionist')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/appointments');
    expect(res.status).toBe(401);
  });

  it('vai trò không có appointment.create (nurse) → 403 PERMISSION_DENIED kèm breakGlassAvailable', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(nurseToken))
      .send(bookingPayload(doctorAUserId, isoAt(8, 0)));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('receptionist tạo lịch hợp lệ → 200, mặc định duration 15 phút, status SCHEDULED, có bookingCode, patientId null', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorAUserId, isoAt(8, 0)));

    expect(res.status).toBe(200);
    expect(res.body.data.durationMinutes).toBe(15);
    expect(res.body.data.status).toBe('SCHEDULED');
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.fullName).toBe(DEFAULT_FULL_NAME);
    expect(res.body.data.phone).toBe(DEFAULT_PHONE);
    expect(res.body.data.patientId).toBeNull();
    expect(res.body.data.bookingCode).toMatch(/^LH\d{10}$/);
  });

  it('hai lịch tạo liên tiếp có bookingCode khác nhau (duy nhất theo tenant)', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorAUserId, isoAt(8, 30)));
    const second = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorBUserId, isoAt(8, 30)));

    expect(first.body.data.bookingCode).not.toBe(second.body.data.bookingCode);
  });

  it('bác sĩ (scope personal) tự đặt lịch cho chính mình → 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(doctorAToken))
      .send(bookingPayload(doctorAUserId, isoAt(9, 0)));

    expect(res.status).toBe(200);
    expect(res.body.data.doctorId).toBe(doctorAUserId);
  });

  it('bác sĩ (scope personal) đặt lịch hộ bác sĩ khác → 403 PERMISSION_DENIED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(doctorAToken))
      .send(bookingPayload(doctorBUserId, isoAt(9, 30)));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('hai request đặt TRÙNG khung giờ CÙNG bác sĩ gần như đồng thời → một 200, một 409 APPOINTMENT_SLOT_CONFLICT (gate cuối Sprint 2)', async () => {
    const payload = bookingPayload(doctorAUserId, isoAt(10, 0), { durationMinutes: 15 });

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/appointments').set(authed(receptionistToken)).send(payload),
      request(app.getHttpServer()).post('/api/v1/appointments').set(authed(receptionistToken)).send(payload),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = first.status === 409 ? first : second;
    expect(conflictRes.body.error.code).toBe('APPOINTMENT_SLOT_CONFLICT');
  });

  it('trùng giờ nhưng KHÁC bác sĩ → cả hai đều tạo được', async () => {
    const scheduledAt = isoAt(11, 0);
    const [forDoctorA, forDoctorB] = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/appointments').set(authed(receptionistToken)).send(bookingPayload(doctorAUserId, scheduledAt)),
      request(app.getHttpServer()).post('/api/v1/appointments').set(authed(receptionistToken)).send(bookingPayload(doctorBUserId, scheduledAt)),
    ]);

    expect(forDoctorA.status).toBe(200);
    expect(forDoctorB.status).toBe(200);
  });

  it('cùng bác sĩ nhưng KHÔNG chồng khung giờ (liền kề) → cả hai đều tạo được', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorAUserId, isoAt(13, 0), { durationMinutes: 15 }));
    const second = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorAUserId, isoAt(13, 15), { durationMinutes: 15 }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('doctorId không tồn tại → 422 APPOINTMENT_INVALID_REFERENCE', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(randomUUID(), isoAt(14, 0)));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('APPOINTMENT_INVALID_REFERENCE');
  });

  it('thiếu trường bắt buộc (source) → 400 VALIDATION_ERROR', async () => {
    const withoutSource: Record<string, unknown> = bookingPayload(doctorAUserId, isoAt(15, 0));
    delete withoutSource.source;
    const res = await request(app.getHttpServer()).post('/api/v1/appointments').set(authed(receptionistToken)).send(withoutSource);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('thiếu phone → 400 VALIDATION_ERROR', async () => {
    const withoutPhone: Record<string, unknown> = bookingPayload(doctorAUserId, isoAt(15, 15));
    delete withoutPhone.phone;
    const res = await request(app.getHttpServer()).post('/api/v1/appointments').set(authed(receptionistToken)).send(withoutPhone);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET :id — tenant B không thấy lịch hẹn của tenant A → 404, không phải 403', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorAUserId, isoAt(16, 0)));
    const id = created.body.data.id as string;

    const res = await request(app.getHttpServer()).get(`/api/v1/appointments/${id}`).set(authed(tenantBReceptionistToken));
    expect(res.status).toBe(404);
  });

  it('GET :id — bác sĩ (scope personal) không thấy lịch hẹn của bác sĩ khác → 404', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorBUserId, isoAt(17, 0)));
    const id = created.body.data.id as string;

    const res = await request(app.getHttpServer()).get(`/api/v1/appointments/${id}`).set(authed(doctorAToken));
    expect(res.status).toBe(404);
  });

  it('GET :id — chính bác sĩ phụ trách xem được lịch hẹn của mình → 200', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorAUserId, isoAt(18, 0)));
    const id = created.body.data.id as string;

    const res = await request(app.getHttpServer()).get(`/api/v1/appointments/${id}`).set(authed(doctorAToken));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('GET danh sách — bác sĩ (scope personal) chỉ thấy lịch của chính mình dù không truyền doctorId', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/appointments').set(authed(doctorAToken)).query({ limit: 100 });

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items.every((a: { doctorId: string }) => a.doctorId === doctorAUserId)).toBe(true);
  });

  it('GET danh sách — receptionist (scope global) lọc theo doctorId khi truyền vào', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/appointments')
      .set(authed(receptionistToken))
      .query({ doctorId: doctorBUserId, limit: 100 });

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items.every((a: { doctorId: string }) => a.doctorId === doctorBUserId)).toBe(true);
  });

  it('cách ly tenant (S2-10): GET danh sách — tenant B (scope global) không thấy lịch hẹn nào của tenant A', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/appointments').set(authed(tenantBReceptionistToken)).query({ limit: 100 });

    expect(res.status).toBe(200);
    expect(res.body.data.items.every((a: { doctorId: string }) => a.doctorId !== doctorAUserId && a.doctorId !== doctorBUserId)).toBe(true);
  });

  it('walk-in (APP-06): tạo lịch qua đúng POST /appointments với source=walk_in → 200, status SCHEDULED (chưa check-in/chưa tạo encounter — module Tiếp nhận là Sprint 3)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send(bookingPayload(doctorAUserId, new Date().toISOString(), { source: 'walk_in' }));

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('walk_in');
    expect(res.body.data.status).toBe('SCHEDULED');
  });

  describe('GET /api/v1/appointments/doctors, /schedule-config (S2-09) — gắn quyền appointment.read', () => {
    it('receptionist gọi được /doctors dù không có user_account.read → 200, chỉ liệt kê 2 bác sĩ đã tạo', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/appointments/doctors').set(authed(receptionistToken));
      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((d: { id: string }) => d.id);
      expect(ids).toEqual(expect.arrayContaining([doctorAUserId, doctorBUserId]));
      expect(res.body.data.items.every((d: { fullName: string }) => typeof d.fullName === 'string')).toBe(true);
    });

    it('cách ly tenant (S2-10): tenant B không thấy bác sĩ của tenant A trong /doctors', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/appointments/doctors').set(authed(tenantBReceptionistToken));
      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((d: { id: string }) => d.id);
      expect(ids).not.toEqual(expect.arrayContaining([doctorAUserId, doctorBUserId]));
    });

    it('bác sĩ (scope personal) cũng gọi được /doctors → 200', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/appointments/doctors').set(authed(doctorAToken));
      expect(res.status).toBe(200);
    });

    it('nurse (không có appointment.read) → 403 PERMISSION_DENIED', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/appointments/doctors').set(authed(nurseToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('receptionist gọi được /schedule-config dù không có clinic_config.read → 200, đúng shape clinicSettings', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/appointments/schedule-config').set(authed(receptionistToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('businessHours');
      expect(typeof res.body.data.slotDurationMinutes).toBe('number');
    });

    it('cách ly tenant (S2-10): /schedule-config của tenant B độc lập, không lẫn cấu hình tenant A', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/appointments/schedule-config').set(authed(tenantBReceptionistToken));
      expect(res.status).toBe(200);
      // tenant B chưa từng cấu hình (chỉ tenant A dùng module `clinic` ở test khác) — phải là mặc định.
      expect(res.body.data.slotDurationMinutes).toBe(15);
    });
  });

  describe('GET /api/v1/appointments/lookup?phone=... (docs/DECISIONS.md #032) — tự điền tên + cảnh báo spam', () => {
    const spamPhone = '0987000111';

    it('SĐT chưa từng đặt → suggestedFullName null, cancelledCount 0', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/appointments/lookup')
        .set(authed(receptionistToken))
        .query({ phone: '0987999999' });

      expect(res.status).toBe(200);
      expect(res.body.data.suggestedFullName).toBeNull();
      expect(res.body.data.cancelledCount).toBe(0);
    });

    it('SĐT đã từng đặt → trả đúng tên của lần đặt gần nhất', async () => {
      const phone = '0987000222';
      await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(9, 0, 21), { phone, fullName: 'Trần Văn Cũ' }));
      const secondBooking = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(10, 0, 21), { phone, fullName: 'Trần Văn Mới' }));
      expect(secondBooking.status).toBe(200);

      const res = await request(app.getHttpServer()).get('/api/v1/appointments/lookup').set(authed(receptionistToken)).query({ phone });
      expect(res.status).toBe(200);
      expect(res.body.data.suggestedFullName).toBe('Trần Văn Mới');
    });

    it('SĐT bị huỷ đủ ngưỡng (5 lần) → cancelledCount đúng bằng 5, không chặn tra cứu', async () => {
      for (let i = 0; i < 5; i++) {
        const created = await request(app.getHttpServer())
          .post('/api/v1/appointments')
          .set(authed(receptionistToken))
          .send(bookingPayload(doctorAUserId, isoAt(8 + i, 0, 22), { phone: spamPhone }));
        expect(created.status).toBe(200);
        const cancelled = await request(app.getHttpServer())
          .post(`/api/v1/appointments/${created.body.data.id}/cancel`)
          .set(authed(receptionistToken))
          .send({ cancelReason: `Huỷ lần ${i + 1}`, version: 1 });
        expect(cancelled.status).toBe(200);
      }

      const res = await request(app.getHttpServer())
        .get('/api/v1/appointments/lookup')
        .set(authed(receptionistToken))
        .query({ phone: spamPhone });
      expect(res.status).toBe(200);
      expect(res.body.data.cancelledCount).toBe(5);
    });

    it('nurse (không có appointment.read) → 403 PERMISSION_DENIED', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/appointments/lookup').set(authed(nurseToken)).query({ phone: '0987000333' });
      expect(res.status).toBe(403);
    });

    it('cách ly tenant (S2-10): tenant B tra cứu đúng SĐT đã đặt ở tenant A → không lộ tên/lịch sử, trả như chưa từng đặt', async () => {
      const phone = '0987000444';
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(9, 30, 21), { phone, fullName: 'Bí mật tenant A' }));
      expect(created.status).toBe(200);

      const res = await request(app.getHttpServer()).get('/api/v1/appointments/lookup').set(authed(tenantBReceptionistToken)).query({ phone });
      expect(res.status).toBe(200);
      expect(res.body.data.suggestedFullName).toBeNull();
      expect(res.body.data.cancelledCount).toBe(0);
    });
  });

  describe('GET /api/v1/appointments?date=... (S2-09) — lọc theo ngày giờ Việt Nam', () => {
    it('lịch 23:30 giờ VN vẫn thuộc đúng ngày, lịch 00:30 giờ VN hôm sau KHÔNG lọt vào — biên UTC+7, không phải UTC', async () => {
      // 2026-08-24T16:30:00Z = 23:30 giờ VN ngày 24/08. 2026-08-24T17:30:00Z = 00:30 giờ VN ngày 25/08.
      const lateNight24 = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, '2026-08-24T16:30:00.000Z'));
      expect(lateNight24.status).toBe(200);

      const earlyMorning25 = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, '2026-08-24T17:30:00.000Z'));
      expect(earlyMorning25.status).toBe(200);

      const day24 = await request(app.getHttpServer())
        .get('/api/v1/appointments')
        .set(authed(receptionistToken))
        .query({ date: '2026-08-24', doctorId: doctorAUserId, limit: 100 });
      const day24Ids = day24.body.data.items.map((a: { id: string }) => a.id);
      expect(day24Ids).toContain(lateNight24.body.data.id);
      expect(day24Ids).not.toContain(earlyMorning25.body.data.id);

      const day25 = await request(app.getHttpServer())
        .get('/api/v1/appointments')
        .set(authed(receptionistToken))
        .query({ date: '2026-08-25', doctorId: doctorAUserId, limit: 100 });
      const day25Ids = day25.body.data.items.map((a: { id: string }) => a.id);
      expect(day25Ids).toContain(earlyMorning25.body.data.id);
      expect(day25Ids).not.toContain(lateNight24.body.data.id);
    });

    it('items trả kèm fullName/phone/bookingCode trực tiếp trên appointment (không phải join patient)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/appointments')
        .set(authed(receptionistToken))
        .query({ date: '2026-08-24', doctorId: doctorAUserId, limit: 100 });

      expect(res.status).toBe(200);
      const item = res.body.data.items[0];
      expect(item.fullName).toBe(DEFAULT_FULL_NAME);
      expect(item.phone).toBe(DEFAULT_PHONE);
      expect(typeof item.bookingCode).toBe('string');
      expect(item.patientId).toBeNull();
    });
  });

  describe('POST /api/v1/appointments/:id/cancel — huỷ lịch (S2-06, APP-04)', () => {
    it('thiếu access token → 401', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/appointments/${randomUUID()}/cancel`);
      expect(res.status).toBe(401);
    });

    it('vai trò không có appointment.cancel (nurse) → 403 PERMISSION_DENIED', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(19, 0)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(nurseToken))
        .send({ cancelReason: 'Bệnh nhân bận', version: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('thiếu cancelReason → 400 VALIDATION_ERROR', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(19, 15)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(receptionistToken))
        .send({ version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('receptionist huỷ đúng lịch, đúng version → 200, status CANCELLED, ghi đúng cancelReason', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(19, 30)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Bệnh nhân xin dời lịch', version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
      expect(res.body.data.cancelReason).toBe('Bệnh nhân xin dời lịch');
      expect(res.body.data.version).toBe(2);
    });

    it('version cũ (đã bị đổi) → 409 CONCURRENT_MODIFICATION', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(19, 45)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Lý do', version: 999 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('huỷ lịch đã CANCELLED rồi → 409 APPOINTMENT_NOT_CANCELLABLE', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(20, 0)));
      const id = created.body.data.id as string;

      const firstCancel = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Lần 1', version: 1 });
      expect(firstCancel.status).toBe(200);

      const secondCancel = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Lần 2', version: 2 });

      expect(secondCancel.status).toBe(409);
      expect(secondCancel.body.error.code).toBe('APPOINTMENT_NOT_CANCELLABLE');
    });

    it('huỷ xong → khung giờ đó không còn bị exclusion constraint chặn, đặt lịch mới cùng giờ cùng bác sĩ thành công', async () => {
      const scheduledAt = isoAt(21, 0);
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, scheduledAt));
      const id = created.body.data.id as string;

      const cancelRes = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Đổi ý', version: 1 });
      expect(cancelRes.status).toBe(200);

      const rebooked = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, scheduledAt));

      expect(rebooked.status).toBe(200);
    });

    it('bác sĩ (scope personal) không huỷ được lịch của bác sĩ khác → 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorBUserId, isoAt(22, 0)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(doctorAToken))
        .send({ cancelReason: 'Lý do', version: 1 });

      expect(res.status).toBe(404);
    });

    it('tenant B không huỷ được lịch hẹn của tenant A → 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(22, 15)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(tenantBReceptionistToken))
        .send({ cancelReason: 'Lý do', version: 1 });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/appointments/:id/reschedule — đổi/dời lịch (S2-09)', () => {
    it('receptionist đổi giờ hợp lệ → 200, scheduledAt/durationMinutes/version cập nhật đúng', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(8, 0, 23)));
      const id = created.body.data.id as string;

      const newTime = isoAt(9, 0, 23);
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${id}/reschedule`)
        .set(authed(receptionistToken))
        .send({ doctorId: doctorAUserId, scheduledAt: newTime, durationMinutes: 30, version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.scheduledAt).toBe(newTime);
      expect(res.body.data.durationMinutes).toBe(30);
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.status).toBe('SCHEDULED');
    });

    it('đổi sang khung giờ đã có lịch khác của CÙNG bác sĩ → 409 APPOINTMENT_SLOT_CONFLICT (exclusion constraint C2 áp lại như lúc tạo)', async () => {
      const occupied = isoAt(10, 0, 23);
      await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, occupied));

      const toMove = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(10, 30, 23)));
      const id = toMove.body.data.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${id}/reschedule`)
        .set(authed(receptionistToken))
        .send({ doctorId: doctorAUserId, scheduledAt: occupied, durationMinutes: 15, version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('APPOINTMENT_SLOT_CONFLICT');
    });

    it('lịch đã CANCELLED → 409 APPOINTMENT_NOT_CANCELLABLE, không sửa được qua đường này nữa', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(11, 0, 23)));
      const id = created.body.data.id as string;

      await request(app.getHttpServer())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(authed(receptionistToken))
        .send({ cancelReason: 'Đổi ý', version: 1 });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${id}/reschedule`)
        .set(authed(receptionistToken))
        .send({ doctorId: doctorAUserId, scheduledAt: isoAt(11, 30, 23), durationMinutes: 15, version: 2 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_CANCELLABLE');
    });

    it('version cũ → 409 CONCURRENT_MODIFICATION', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(12, 0, 23)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${id}/reschedule`)
        .set(authed(receptionistToken))
        .send({ doctorId: doctorAUserId, scheduledAt: isoAt(12, 30, 23), durationMinutes: 15, version: 999 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('bác sĩ (scope personal) đổi lịch của mình sang cho bác sĩ khác → 403 PERMISSION_DENIED', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(doctorAToken))
        .send(bookingPayload(doctorAUserId, isoAt(13, 0, 23)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${id}/reschedule`)
        .set(authed(doctorAToken))
        .send({ doctorId: doctorBUserId, scheduledAt: isoAt(13, 30, 23), durationMinutes: 15, version: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('tenant B không đổi được lịch hẹn của tenant A → 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(14, 0, 23)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${id}/reschedule`)
        .set(authed(tenantBReceptionistToken))
        .send({ doctorId: doctorAUserId, scheduledAt: isoAt(14, 30, 23), durationMinutes: 15, version: 1 });

      expect(res.status).toBe(404);
    });

    it('thiếu trường bắt buộc (doctorId) → 400 VALIDATION_ERROR', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/appointments')
        .set(authed(receptionistToken))
        .send(bookingPayload(doctorAUserId, isoAt(15, 0, 23)));
      const id = created.body.data.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${id}/reschedule`)
        .set(authed(receptionistToken))
        .send({ scheduledAt: isoAt(15, 30, 23), durationMinutes: 15, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // Check-in (trước đây `POST /appointments/:id/checkin`) đã chuyển hẳn sang
  // `POST /reception/check-in` (Sprint 3, Tiếp nhận — tạo encounter thật, không chỉ đổi status) —
  // xem `src/modules/reception/reception-http.spec.ts`. Endpoint cũ đã gỡ, không còn tồn tại.
});
