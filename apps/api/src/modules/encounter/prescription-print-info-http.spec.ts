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
 * HTTP e2e — `GET /encounters/:id/prescription-print-info` (docs/DECISIONS.md #242, mockup "Mẫu in đơn thuốc" 20/10/2026): thông tin bệnh nhân in thêm trên đơn thuốc
 * (mã BN, CCCD giải mã, địa chỉ, SĐT, cân nặng sinh hiệu mới nhất có đo, tháng tuổi, người thân) + cấu hình bật/tắt trong bản mẫu in đơn thuốc.
 */
describe('HTTP e2e — thông tin bệnh nhân in trên đơn thuốc (#242)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let clinicalOnlyToken: string;
  let tenantBAdminToken: string;
  let hourSeed = 1;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleId: string, label: string) {
    const username = `e2e-pinfo-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  async function createUserWithRole(tenantId: string, roleName: string) {
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    return createUser(tenantId, role.id, roleName);
  }

  /** Lượt khám đang khám của một bệnh nhân mới (tạo qua API để CCCD được mã hoá đúng đường thật). */
  async function prepareEncounter(patientBody: Record<string, unknown>, weightGrams: number[] = []): Promise<{ encounterId: string; patientId: string; patientCode: string }> {
    const hour = hourSeed++;
    const appointmentRes = await http()
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId: doctorUserId, fullName: 'Khách e2e in đơn', phone: '0911222555', scheduledAt: new Date(Date.UTC(2026, 7, 28, hour, 0, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };
    const patientRes = await http().post('/api/v1/patients').set(authed(receptionistToken)).send({ fullName: 'Bệnh nhân e2e in đơn', gender: 'female', phone: '0933555666', ...patientBody });
    expect(patientRes.status, JSON.stringify(patientRes.body)).toBe(200);
    const patient = patientRes.body.data as { id: string; patientCode: string };
    const checkIn = await http()
      .post('/api/v1/reception/check-in')
      .set(authed(receptionistToken))
      .send({
        appointmentId: appointment.id,
        patientId: patient.id,
        version: appointment.version,
        doctorId: doctorUserId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = checkIn.body.data.id as string;
    for (const weightGram of weightGrams) {
      const vital = await http().post(`/api/v1/reception/encounters/${encounterId}/vital-signs`).set(authed(doctorToken)).send({ weightGram, pulse: 80 });
      expect(vital.status, JSON.stringify(vital.body)).toBe(200);
    }
    return { encounterId, patientId: patient.id, patientCode: patient.patientCode };
  }

  const printInfo = (token: string, encounterId: string) => http().get(`/api/v1/encounters/${encounterId}/prescription-print-info`).set(authed(token));

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

    fixture = await createTwoTenantFixture(privileged, 'PrescriptionPrintInfo e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    // Vai trò tuỳ biến CHỈ có quyền xem nội dung lâm sàng — không có `patient.read` (mọi vai trò mặc định có cả hai nên phải tự dựng).
    const clinicalRead = await privileged.permission.findFirstOrThrow({ where: { module: 'encounter', action: 'read_clinical' } });
    const customRole = await privileged.role.create({ data: { tenantId: fixture.tenantA.id, name: `chi-lam-sang-${randomUUID().slice(0, 6)}`, isSystemDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await privileged.rolePermission.create({ data: { tenantId: fixture.tenantA.id, roleId: customRole.id, permissionId: clinicalRead.id, dataScope: 'global', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    clinicalOnlyToken = (await createUser(fixture.tenantA.id, customRole.id, 'clinical-only')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('người lớn: trả mã BN, CCCD giải mã, địa chỉ, SĐT, cân nặng LẦN ĐO MỚI NHẤT có ghi, người thân; không có người giám hộ nào thì guardian = null', async () => {
    const { encounterId, patientCode } = await prepareEncounter(
      { dob: '1988-03-12', nationalId: '079188001234', address: { street: '12 Lê Văn Sỹ' }, relativeFullName: 'Nguyễn Văn Nam', relativeRelationship: 'Chồng' },
      [54_000, 56_500],
    );
    const res = await printInfo(doctorToken, encounterId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      patientCode,
      nationalId: '079188001234',
      address: { street: '12 Lê Văn Sỹ' },
      phone: '0933555666',
      weightGram: 56_500,
      guardian: { fullName: 'Nguyễn Văn Nam', relationship: 'Chồng' },
    });
    expect(res.body.data.ageMonths).toBeGreaterThanOrEqual(12 * 37);

    const noRelative = await prepareEncounter({ dob: '1990-01-01', nationalId: '079190001111' });
    const res2 = await printInfo(adminToken, noRelative.encounterId);
    expect(res2.status).toBe(200);
    expect(res2.body.data.guardian).toBeNull();
    expect(res2.body.data.weightGram).toBeNull();
  });

  it('trẻ em chưa có CCCD: nationalId = null, ageMonths đúng (dưới 72), có người giám hộ', async () => {
    const dob = new Date(Date.now() - 30 * 31 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const { encounterId } = await prepareEncounter({ dob, relativeFullName: 'Trần Thị Mẹ', relativeRelationship: 'Mẹ' });
    const res = await printInfo(doctorToken, encounterId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.nationalId).toBeNull();
    expect(res.body.data.ageMonths).toBeGreaterThanOrEqual(28);
    expect(res.body.data.ageMonths).toBeLessThan(72);
    expect(res.body.data.guardian).toEqual({ fullName: 'Trần Thị Mẹ', relationship: 'Mẹ' });
  });

  it('cân nặng lấy lần đo MỚI NHẤT có ghi cân nặng, bỏ qua lần đo mới hơn nhưng không đo cân nặng', async () => {
    const { encounterId } = await prepareEncounter({ dob: '1985-05-05', nationalId: '079185005555' }, [60_000]);
    const noWeight = await http().post(`/api/v1/reception/encounters/${encounterId}/vital-signs`).set(authed(doctorToken)).send({ pulse: 90 });
    expect(noWeight.status).toBe(200);
    const res = await printInfo(doctorToken, encounterId);
    expect(res.body.data.weightGram).toBe(60_000);
  });

  it('vai trò chỉ có xem lâm sàng, KHÔNG có patient.read → vẫn lấy được thông tin nhưng nationalId = null', async () => {
    const { encounterId } = await prepareEncounter({ dob: '1980-02-02', nationalId: '079180002222' });
    const res = await printInfo(clinicalOnlyToken, encounterId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.nationalId).toBeNull();
    expect(res.body.data.phone).toBe('0933555666');
  });

  it('lễ tân (không có encounter.read_clinical) → 403; không đăng nhập → 401', async () => {
    const { encounterId } = await prepareEncounter({ dob: '1980-02-02', nationalId: '079180003333' });
    expect((await printInfo(receptionistToken, encounterId)).status).toBe(403);
    expect((await http().get(`/api/v1/encounters/${encounterId}/prescription-print-info`)).status).toBe(401);
  });

  it('công ty khác không đọc được (404/403), và lượt khám không tồn tại → 404', async () => {
    const { encounterId } = await prepareEncounter({ dob: '1980-02-02', nationalId: '079180004444' });
    const other = await printInfo(tenantBAdminToken, encounterId);
    expect([403, 404]).toContain(other.status);
    expect(other.body?.data?.nationalId).toBeUndefined();
    expect((await printInfo(doctorToken, randomUUID())).status).toBe(404);
  });

  it('mỗi lần lấy ghi nhật ký xem lượt khám (CCCD giải mã là dữ liệu nhạy cảm)', async () => {
    const { encounterId } = await prepareEncounter({ dob: '1980-02-02', nationalId: '079180005555' });
    const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'encounter.viewed', entityId: encounterId } });
    expect((await printInfo(doctorToken, encounterId)).status).toBe(200);
    const after = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'encounter.viewed', entityId: encounterId } });
    expect(after).toBe(before + 1);
  });

  describe('nhật ký riêng "in đơn thuốc có số CCCD"', () => {
    const ACTION = 'encounter.prescription_printed_with_national_id';
    const countAction = (encounterId: string) => privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: ACTION, entityId: encounterId } });

    it('CCCD được giải mã để in → ghi đúng 1 dòng riêng, KHÔNG chứa số CCCD', async () => {
      const { encounterId } = await prepareEncounter({ dob: '1980-02-02', nationalId: '079180006666' });
      expect(await countAction(encounterId)).toBe(0);
      expect((await printInfo(doctorToken, encounterId)).status).toBe(200);
      expect(await countAction(encounterId)).toBe(1);
      const row = await privileged.auditLog.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, action: ACTION, entityId: encounterId } });
      expect(row.actorId).toBe(doctorUserId);
      expect(JSON.stringify(row)).not.toContain('079180006666');
    });

    it('người in không có patient.read (CCCD = null) → KHÔNG có dòng riêng (vẫn có dòng xem chung)', async () => {
      const { encounterId } = await prepareEncounter({ dob: '1980-02-02', nationalId: '079180007777' });
      expect((await printInfo(clinicalOnlyToken, encounterId)).status).toBe(200);
      expect(await countAction(encounterId)).toBe(0);
    });

    it('bệnh nhân chưa có CCCD → KHÔNG có dòng riêng', async () => {
      const { encounterId } = await prepareEncounter({ dob: '2024-01-01' });
      expect((await printInfo(doctorToken, encounterId)).status).toBe(200);
      expect(await countAction(encounterId)).toBe(0);
    });
  });

  describe('cấu hình bản mẫu in đơn thuốc (prescriptionInfo)', () => {
    it('chưa lưu bản mẫu nào → bản dựng sẵn có prescriptionInfo bật hết, nationalIdWhenMissing = hide; chứng từ khác KHÔNG có khối này', async () => {
      const res = await http().get('/api/v1/print-templates/resolved').set(authed(doctorToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as { documentType: string; config: { prescriptionInfo?: Record<string, unknown> } }[];
      const prescription = items.find((i) => i.documentType === 'PRESCRIPTION')!;
      expect(prescription.config.prescriptionInfo).toEqual({
        showPatientCode: true,
        showNationalId: true,
        nationalIdWhenMissing: 'hide',
        showAddress: true,
        showPhone: true,
        showWeight: true,
        showGuardian: true,
        showCourse: true,
        showQuantityInWords: true,
        showReceiverBox: true,
        // Số lượng dưới 10 in hai chữ số (#267) — mặc định bật.
        padSmallQuantity: true,
      });
      for (const other of items.filter((i) => i.documentType !== 'PRESCRIPTION')) {
        expect(other.config.prescriptionInfo).toBeUndefined();
      }
    });

    it('lưu công tắc ở bản mẫu Đơn thuốc rồi đọc lại đúng; chứng từ khác không giữ khối này; giá trị sai → 400; chỉ vai trò có clinic_config.update mới lưu được', async () => {
      const resolved = await http().get('/api/v1/print-templates/resolved').set(authed(doctorToken));
      const rx = (resolved.body.data.items as { documentType: string; paperSize: string; config: Record<string, unknown> }[]).find((i) => i.documentType === 'PRESCRIPTION')!;
      const changed = { ...rx.config, prescriptionInfo: { ...(rx.config.prescriptionInfo as Record<string, unknown>), showAddress: false, showQuantityInWords: false, nationalIdWhenMissing: 'dots' } };

      expect((await http().post('/api/v1/print-templates').set(authed(doctorToken)).send({ documentType: 'PRESCRIPTION', name: 'Thử quyền', paperSize: rx.paperSize, config: changed })).status).toBe(403);
      const bad = await http()
        .post('/api/v1/print-templates')
        .set(authed(adminToken))
        .send({ documentType: 'PRESCRIPTION', name: 'Sai giá trị', paperSize: rx.paperSize, config: { ...rx.config, prescriptionInfo: { ...(rx.config.prescriptionInfo as Record<string, unknown>), nationalIdWhenMissing: 'abc' } } });
      expect(bad.status).toBe(400);

      const created = await http().post('/api/v1/print-templates').set(authed(adminToken)).send({ documentType: 'PRESCRIPTION', name: 'Đơn thuốc đã tắt vài mục', paperSize: rx.paperSize, config: changed, isDefault: true });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);

      const after = await http().get('/api/v1/print-templates/resolved').set(authed(doctorToken));
      const saved = (after.body.data.items as { documentType: string; config: { prescriptionInfo?: Record<string, unknown> } }[]).find((i) => i.documentType === 'PRESCRIPTION')!;
      expect(saved.config.prescriptionInfo).toMatchObject({ showAddress: false, showQuantityInWords: false, nationalIdWhenMissing: 'dots', showPatientCode: true });
      // In ra khổ giấy KHÁC khổ đã lưu (nút "In ▾") cũng phải áp đúng các công tắc đó — không được quay về "bật hết".
      const rxAfter = (after.body.data.items as { documentType: string; options: { paperSize: string; config: { prescriptionInfo?: Record<string, unknown> } }[] }[]).find((i) => i.documentType === 'PRESCRIPTION')!;
      expect(rxAfter.options.length).toBeGreaterThan(1);
      for (const option of rxAfter.options) {
        expect(option.config.prescriptionInfo, `khổ ${option.paperSize}`).toMatchObject({ showAddress: false, showQuantityInWords: false, nationalIdWhenMissing: 'dots' });
      }

      // Khối này CHỈ của đơn thuốc: gắn vào chứng từ khác thì bị bỏ khi đọc.
      const invoice = (resolved.body.data.items as { documentType: string; paperSize: string; config: Record<string, unknown> }[]).find((i) => i.documentType === 'INVOICE')!;
      const onInvoice = await http()
        .post('/api/v1/print-templates')
        .set(authed(adminToken))
        .send({ documentType: 'INVOICE', name: 'Phiếu thu gắn nhầm khối', paperSize: invoice.paperSize, config: { ...invoice.config, prescriptionInfo: changed.prescriptionInfo }, isDefault: true });
      expect(onInvoice.status, JSON.stringify(onInvoice.body)).toBeLessThan(300);
      const afterInvoice = await http().get('/api/v1/print-templates/resolved').set(authed(doctorToken));
      expect((afterInvoice.body.data.items as { documentType: string; config: { prescriptionInfo?: unknown } }[]).find((i) => i.documentType === 'INVOICE')!.config.prescriptionInfo).toBeUndefined();
    });
  });
});
