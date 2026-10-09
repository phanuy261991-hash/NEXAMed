import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { addDaysToDateString, getVietnamDateString } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — tab "Lịch sử khám chữa bệnh" ở hồ sơ bệnh nhân (docs/DECISIONS.md #223): `GET /encounters/by-patient/:patientId/history`, quyền mới `encounter.read_clinical`
 * (tách khỏi `encounter.read`) và việc `GET /encounters/:id/consultation` giờ cần quyền đó.
 */
describe('HTTP e2e — Lịch sử khám chữa bệnh của bệnh nhân (#223)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let receptionistToken: string;
  let nurseToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let tenantBAdminToken: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const randomNationalId = (): string => '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  const historyUrl = (patientId: string, query = '') => `/api/v1/encounters/by-patient/${patientId}/history${query}`;
  const followUpDate = () => addDaysToDateString(getVietnamDateString(), 14)!;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-hist-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  async function createPatient(): Promise<string> {
    const res = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e lịch sử', dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  /** Tiếp nhận (thu tiền ngay, 150.000đ) + bắt đầu khám cho bệnh nhân đã có. */
  async function checkInAndStart(patientId: string): Promise<string> {
    const checkIn = await http()
      .post('/api/v1/reception/direct')
      .set(authed(receptionistToken))
      .send({
        patientId,
        doctorId: doctorUserId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
        checkedInAt: new Date().toISOString(),
      });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
    const encounterId = checkIn.body.data.id as string;
    const pay = await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const start = await http().post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    return encounterId;
  }

  const noteBody = (extra: Record<string, unknown> = {}) => ({
    reasonForVisit: { content: 'Ho kéo dài' },
    illnessProgress: { content: '' },
    preliminaryDiagnosis: { content: 'Viêm phế quản cấp' },
    generalExam: { content: '' },
    regionalExam: { content: '' },
    plan: { content: '' },
    ...extra,
  });

  async function saveNote(encounterId: string, extra: Record<string, unknown>) {
    const res = await http().put(`/api/v1/encounters/${encounterId}/clinical-note`).set(authed(doctorToken)).send(noteBody(extra));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function saveDiagnosis(encounterId: string) {
    const res = await http().put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(doctorToken)).send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function complete(encounterId: string) {
    const detail = await http().get(`/api/v1/encounters/${encounterId}/consultation`).set(authed(doctorToken));
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const done = await http().post(`/api/v1/encounters/${encounterId}/complete`).set(authed(doctorToken)).send({ version: detail.body.data.encounter.version });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  }

  /** Bệnh nhân có 1 lượt ĐÃ HOÀN TẤT (kết luận + hẹn tái khám) rồi 1 lượt ĐANG KHÁM với bản nháp. */
  async function patientWithTwoEncounters() {
    const patientId = await createPatient();
    const done = await checkInAndStart(patientId);
    await saveNote(done, {
      conclusion: { content: 'Viêm phế quản cấp, chưa biến chứng' },
      plan: { content: 'Kháng sinh 7 ngày' },
      treatmentPlan: { directions: ['PRESCRIPTION', 'FOLLOW_UP'], followUpDate: followUpDate() },
    });
    await saveDiagnosis(done);
    await complete(done);
    const open = await checkInAndStart(patientId);
    await saveDiagnosis(open);
    await saveNote(open, { conclusion: { content: 'Bản nháp chưa ký' } });
    return { patientId, doneEncounterId: done, openEncounterId: open };
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

    fixture = await createTwoTenantFixture(privileged, 'PatientHistory e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    nurseToken = (await createUserWithRole(fixture.tenantA.id, 'nurse')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('mặc định chỉ lượt ĐÃ HOÀN TẤT; status=ALL thêm lượt đang khám; số đếm không phụ thuộc bộ lọc; bác sĩ thấy nội dung lâm sàng nhưng không thấy chi phí', async () => {
    const { patientId, doneEncounterId, openEncounterId } = await patientWithTwoEncounters();

    const res = await http().get(historyUrl(patientId)).set(authed(doctorToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body.data;
    expect(body.items).toHaveLength(1);
    expect(body.completedCount).toBe(1);
    expect(body.totalCount).toBe(2);
    expect(body.canViewClinical).toBe(true);
    expect(body.canViewBilling).toBe(false);
    const row = body.items[0];
    expect(row.encounterId).toBe(doneEncounterId);
    expect(row.status).toBe('COMPLETED');
    expect(row.doctorName).toBe('User doctor');
    expect(row.reason).toBe('Ho kéo dài');
    expect(row.clinical).toMatchObject({
      primaryDiagnosisCode: 'A00.0',
      otherDiagnosisCount: 0,
      conclusion: 'Viêm phế quản cấp, chưa biến chứng',
      followUpDate: followUpDate(),
      prescriptionNo: null,
      prescriptionItemCount: 0,
      paraclinical: null,
    });
    expect(row.billing).toBeNull();

    const all = await http().get(historyUrl(patientId, '?status=ALL')).set(authed(doctorToken));
    expect(all.status).toBe(200);
    expect(all.body.data.items.map((i: { encounterId: string }) => i.encounterId)).toEqual([openEncounterId, doneEncounterId]);
  });

  it('lượt đang khám KHÔNG lộ bản nháp (chẩn đoán/kết luận chưa ký)', async () => {
    const { patientId, openEncounterId } = await patientWithTwoEncounters();
    const res = await http().get(historyUrl(patientId, '?status=ALL')).set(authed(doctorToken));
    const open = res.body.data.items.find((i: { encounterId: string }) => i.encounterId === openEncounterId);
    expect(open.status).toBe('IN_CONSULTATION');
    expect(open.clinical).toMatchObject({ primaryDiagnosisCode: null, conclusion: null, followUpDate: null, prescriptionNo: null });
  });

  it('lễ tân: thấy danh sách + chi phí nhưng KHÔNG có nội dung lâm sàng (máy chủ không gửi); không mở được chi tiết lượt khám', async () => {
    const { patientId, doneEncounterId } = await patientWithTwoEncounters();
    const res = await http().get(historyUrl(patientId)).set(authed(receptionistToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.canViewClinical).toBe(false);
    expect(res.body.data.canViewBilling).toBe(true);
    const row = res.body.data.items[0];
    expect(row.clinical).toBeNull();
    expect(row.billing).toEqual({ netAmount: 150_000, paymentState: 'PAID' });
    expect(JSON.stringify(res.body)).not.toContain('A00.0');
    expect(JSON.stringify(res.body)).not.toContain('Viêm phế quản cấp, chưa biến chứng');

    // Vá lỗ hổng: trước #223 mọi vai trò có `encounter.read` (kể cả lễ tân) đọc được toàn bộ hồ sơ khám qua endpoint này.
    const consult = await http().get(`/api/v1/encounters/${doneEncounterId}/consultation`).set(authed(receptionistToken));
    expect(consult.status).toBe(403);
  });

  it('điều dưỡng và quản lý phòng khám có quyền lâm sàng: xem được chi tiết lượt khám', async () => {
    const { patientId, doneEncounterId } = await patientWithTwoEncounters();
    for (const token of [nurseToken, adminToken]) {
      const consult = await http().get(`/api/v1/encounters/${doneEncounterId}/consultation`).set(authed(token));
      expect(consult.status, JSON.stringify(consult.body)).toBe(200);
      const list = await http().get(historyUrl(patientId)).set(authed(token));
      expect(list.body.data.canViewClinical).toBe(true);
      expect(list.body.data.items[0].clinical.primaryDiagnosisCode).toBe('A00.0');
    }
    // Quản lý có cả quyền xem phiếu thu → có chi phí.
    const admin = await http().get(historyUrl(patientId)).set(authed(adminToken));
    expect(admin.body.data.canViewBilling).toBe(true);
    expect(admin.body.data.items[0].billing.paymentState).toBe('PAID');
  });

  it('phân trang cursor: limit=1 trả nextCursor, trang sau lấy lượt cũ hơn, hết thì nextCursor=null', async () => {
    const { patientId, doneEncounterId, openEncounterId } = await patientWithTwoEncounters();
    const first = await http().get(historyUrl(patientId, '?status=ALL&limit=1')).set(authed(doctorToken));
    expect(first.status).toBe(200);
    expect(first.body.data.items.map((i: { encounterId: string }) => i.encounterId)).toEqual([openEncounterId]);
    expect(first.body.data.nextCursor).toBe(openEncounterId);

    const second = await http().get(historyUrl(patientId, `?status=ALL&limit=1&cursor=${first.body.data.nextCursor}`)).set(authed(doctorToken));
    expect(second.body.data.items.map((i: { encounterId: string }) => i.encounterId)).toEqual([doneEncounterId]);
    expect(second.body.data.nextCursor).toBeNull();
  });

  it('cách ly tenant: tenant B không thấy lượt khám của bệnh nhân tenant A (danh sách rỗng, không 403)', async () => {
    const { patientId } = await patientWithTwoEncounters();
    const res = await http().get(historyUrl(patientId, '?status=ALL')).set(authed(tenantBAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.totalCount).toBe(0);
  });

  it('patientId không phải UUID → 400; thiếu token → 401', async () => {
    const bad = await http().get(historyUrl('khong-phai-uuid')).set(authed(doctorToken));
    expect(bad.status).toBe(400);
    const anon = await http().get(historyUrl(randomUUID()));
    expect(anon.status).toBe(401);
  });

  it('ghi nhật ký "xem hồ sơ bệnh nhân" mỗi lần mở danh sách', async () => {
    const patientId = await createPatient();
    await http().get(historyUrl(patientId)).set(authed(doctorToken));
    const rows = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'patient.viewed', entityId: patientId } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
