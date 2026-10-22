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
 * Hồi quy 2 lỗi tìm ra khi đo tải luồng ghi (22/10/2026, docs/DECISIONS.md #248), cả hai làm MỌI lần ký đơn của phòng khám lỗi:
 *  (1) khuôn mã đơn thuốc ở chế độ tuỳ chỉnh (CUSTOM) có token `[Mã cơ sở KCB]`/`[Loại đơn]` (bảng token của màn "Sửa khuôn mẫu" cho chèn) — ký đơn
 *      không truyền mã cơ sở KCB vào bộ sinh mã nên ném 400 BUSINESS_CODE_TEMPLATE_INVALID;
 *  (2) lưu khuôn tường minh GIỮA kỳ (tháng) khi bộ đếm liên tục cũ đã cấp số: bộ đếm của kỳ mới tính lại từ 1 và trùng mã đã cấp → UNIQUE vi phạm,
 *      giao dịch hoàn tác nên bộ đếm không tiến → mọi lần ký sau đó đều 500.
 */
describe('HTTP e2e — mã đơn thuốc theo khuôn tuỳ chỉnh khi ký (#248)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let clinicAdminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let drugId: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-rxtpl-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  /** Tiếp nhận trực tiếp → thu tiền → bắt đầu khám → chẩn đoán → kê 1 thuốc → sẵn sàng ký. Trả mã lượt khám. */
  async function prepareEncounterReadyToSign(): Promise<string> {
    const patient = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e khuôn mã', dob: '1990-01-01', gender: 'female', phone: '0933555666', nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) });
    const direct = await http()
      .post('/api/v1/reception/direct')
      .set(authed(receptionistToken))
      .send({
        patientId: patient.body.data.id,
        doctorId: doctorUserId,
        checkedInAt: new Date().toISOString(),
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = direct.body.data.id as string;
    await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
    await http().post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    await http().put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(doctorToken)).send({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' }] });
    const items = await http()
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorToken))
      .send({ items: [{ drugId, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 1, durationDays: 3 }] });
    expect(items.status).toBe(200);
    return encounterId;
  }

  async function signNew() {
    const encounterId = await prepareEncounterReadyToSign();
    return http().post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version: 1 });
  }

  function patchPrescriptionTemplate(body: Record<string, unknown>) {
    return http().patch('/api/v1/clinic-settings/code-templates/PRESCRIPTION').set(authed(clinicAdminToken)).send(body);
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

    fixture = await createTwoTenantFixture(privileged, 'PrescriptionCodeTemplate e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;

    const drug = await privileged.drug.create({
      data: { tenantId: fixture.tenantA.id, code: `DRG-${randomUUID().slice(0, 8)}`, name: 'Thuốc khuôn mã', activeIngredient: 'Hoạt chất khuôn mã', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    drugId = drug.id as string;
    const defaultBranch = await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const warehouse = await privileged.warehouse.create({
      data: { tenantId: fixture.tenantA.id, branchId: defaultBranch.id, code: `KHO-${randomUUID().slice(0, 8)}`, name: 'Kho test', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.stockBalance.create({ data: { tenantId: fixture.tenantA.id, drugId, warehouseId: warehouse.id, quantityOnHand: 9999, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await privileged.branch.update({ where: { id: defaultBranch.id }, data: { facilityCode: '79001' } });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('(1) khuôn tuỳ chỉnh có [Mã cơ sở KCB] và [Loại đơn] → ký đơn thành công, mã mang đúng mã cơ sở của chi nhánh', async () => {
    const saved = await patchPrescriptionTemplate({ template: '[Mã cơ sở KCB][Số đếm]-[Loại đơn]', counterDigits: 7, mode: 'CUSTOM' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.mode).toBe('CUSTOM');

    const res = await signNew();
    expect(res.status).toBe(200);
    expect(res.body.data.prescriptionNo).toMatch(/^79001\d{7}-C$/);
  });

  it('(1b) khuôn tuỳ chỉnh có [Mã cơ sở KCB] mà chi nhánh/công ty chưa có mã → 422 PRESCRIPTION_FACILITY_CODE_MISSING (không phải lỗi chung chung), đơn chưa bị ký', async () => {
    const defaultBranch = await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    await privileged.branch.update({ where: { id: defaultBranch.id }, data: { facilityCode: null } });
    try {
      const encounterId = await prepareEncounterReadyToSign();
      const res = await http().post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version: 1 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PRESCRIPTION_FACILITY_CODE_MISSING');
      const draft = await privileged.prescription.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, encounterId }, orderBy: { createdAt: 'desc' } });
      expect(draft.signedAt).toBeNull();
    } finally {
      await privileged.branch.update({ where: { id: defaultBranch.id }, data: { facilityCode: '79001' } });
    }
  });

  it('(2) lưu khuôn tường minh GIỮA THÁNG sau khi bộ đếm liên tục đã cấp số → số tiếp theo NỐI TIẾP, không trùng mã đã cấp', async () => {
    // Về khuôn mặc định (chưa tường minh) rồi ký 2 đơn: bộ đếm liên tục cấp 1, 2.
    await privileged.tenantSetting.deleteMany({ where: { tenantId: fixture.tenantA.id, key: 'business_code_templates' } });
    const first = await signNew();
    const second = await signNew();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const issued = [first.body.data.prescriptionNo, second.body.data.prescriptionNo] as string[];
    expect(new Set(issued).size).toBe(2);

    // Quản trị bấm "Lưu" khuôn dạng giống hệt (chuyển sang tường minh, bộ đếm theo THÁNG): kỳ này đã có 2 mã nên phải đếm tiếp từ 3.
    const saved = await patchPrescriptionTemplate({ template: 'DT[Năm 2 số][Tháng][Số đếm]', counterDigits: 6, mode: 'CUSTOM' });
    expect(saved.status).toBe(200);

    const third = await signNew();
    expect(third.status).toBe(200);
    const thirdNo = third.body.data.prescriptionNo as string;
    expect(issued).not.toContain(thirdNo);
    const seq = (no: string) => Number(no.slice(-6));
    expect(seq(thirdNo)).toBe(Math.max(...issued.map(seq)) + 1);
  });
});
