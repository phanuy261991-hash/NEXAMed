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
 * HTTP e2e — Kê đơn (Sprint 4, S4-01/02/04): `PUT .../prescription-items`, `POST .../prescription/
 * sign|print|amend`. Xem `docs/product/future-modules-reference.md` §2.2.1 cho những gì CỐ Ý không
 * làm (kho, hoá đơn thuốc — ngoài phạm vi v1).
 */
describe('HTTP e2e — Kê đơn (/api/v1/encounters/:id/prescription*)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBToken: string;
  let tenantBDoctorToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-rx-${roleName}-${randomUUID()}`;
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

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  async function createDrug(tenantId: string, name: string, activeIngredient: string) {
    const drug = await privileged.drug.create({
      data: {
        tenantId,
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name,
        activeIngredient,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return drug.id as string;
  }

  async function createAllergen(tenantId: string, name: string) {
    const group = await privileged.allergenGroup.create({ data: { code: `AGRP-${randomUUID().slice(0, 8)}`, name: `Nhóm ${name}` } });
    const allergen = await privileged.allergen.create({ data: { allergenGroupId: group.id, code: `ALG-${randomUUID().slice(0, 8)}`, name } });
    // Gán trực tiếp cho bệnh nhân qua PATCH /patients/:id ở nơi gọi — hàm này chỉ tạo mục danh mục.
    return allergen.id as string;
  }

  /** Tạo appointment + patient + check-in + "Bắt đầu khám" + 1 chẩn đoán chính — sẵn sàng để kê đơn. */
  async function prepareEncounterInConsultation(hour: number, doctorId = doctorAUserId) {
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId, fullName: 'Khách e2e kê đơn', phone: '0911222444', scheduledAt: new Date(Date.UTC(2026, 7, 28, hour, 0, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };

    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e kê đơn', dob: '1990-01-01', gender: 'female', phone: '0933555666', nationalId: randomNationalId() });
    const patient = patientRes.body.data as { id: string };

    const checkInRes = await request(app.getHttpServer())
      .post('/api/v1/reception/check-in')
      .set(authed(receptionistToken))
      .send({
        appointmentId: appointment.id,
        patientId: patient.id,
        version: appointment.version,
        doctorId,
        examTypeCode: 'KT',
        examTypeName: 'Khám thường',
        examTypePrice: 150_000,
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = checkInRes.body.data.id as string;

    await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });

    await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set(authed(doctorAToken))
      .send({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' as const }] });

    return { encounterId, patientId: patient.id };
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

    fixture = await createTwoTenantFixture(privileged, 'Prescription e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    doctorBToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBDoctorToken = (await createUserWithRole(fixture.tenantB.id, 'doctor')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).put('/api/v1/encounters/00000000-0000-0000-0000-000000000000/prescription-items').send({ items: [] });
    expect(res.status).toBe(401);
  });

  it('chưa có chẩn đoán chính → 422 PRESCRIPTION_REQUIRES_DIAGNOSIS', async () => {
    // Không dùng prepareEncounterInConsultation() (đã tự thêm chẩn đoán) — tạo tay để bỏ bước đó.
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId: doctorAUserId, fullName: 'Không chẩn đoán', phone: '0911222555', scheduledAt: new Date(Date.UTC(2026, 7, 28, 6, 0, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };
    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'BN không chẩn đoán', dob: '1990-01-01', gender: 'female', phone: '0933555777', nationalId: randomNationalId() });
    const patient = patientRes.body.data as { id: string };
    const checkInRes = await request(app.getHttpServer())
      .post('/api/v1/reception/check-in')
      .set(authed(receptionistToken))
      .send({
        appointmentId: appointment.id,
        patientId: patient.id,
        version: appointment.version,
        doctorId: doctorAUserId,
        examTypeCode: 'KT',
        examTypeName: 'Khám thường',
        examTypePrice: 150_000,
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = checkInRes.body.data.id as string;
    await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });

    const drugId = await createDrug(fixture.tenantA.id, 'Thuốc A', 'Hoạt chất A');
    const res = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorAToken))
      .send({ items: [{ drugId, dose: '1 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: 10 }] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRESCRIPTION_REQUIRES_DIAGNOSIS');
  });

  it('kê 2 thuốc trùng hoạt chất → warnings PRE-02, ký khi trống → 422 PRESCRIPTION_EMPTY, ký thành công → bất biến, sửa lại bị chặn', async () => {
    const { encounterId } = await prepareEncounterInConsultation(7);
    const drugA = await createDrug(fixture.tenantA.id, 'Paracetamol 500mg', 'Paracetamol');
    const drugB = await createDrug(fixture.tenantA.id, 'Efferalgan', 'paracetamol');

    // Tạo đơn nháp RỖNG (items: []) rồi ký ngay → 422 PRESCRIPTION_EMPTY (khác trường hợp chưa
    // từng PUT prescription-items lần nào — lúc đó chưa có đơn nào để ký, trả 404).
    await request(app.getHttpServer()).put(`/api/v1/encounters/${encounterId}/prescription-items`).set(authed(doctorAToken)).send({ items: [] });
    const emptySign = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorAToken)).send({ version: 1 });
    expect(emptySign.status).toBe(422);
    expect(emptySign.body.error.code).toBe('PRESCRIPTION_EMPTY');

    const saveRes = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorAToken))
      .send({
        items: [
          { drugId: drugA, dose: '1 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: 10 },
          { drugId: drugB, dose: '1 viên', frequency: '3 lần/ngày', durationDays: 3, quantity: 9 },
        ],
      });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.data.items).toHaveLength(2);
    expect(saveRes.body.data.warnings).toHaveLength(1);
    expect(saveRes.body.data.warnings[0].kind).toBe('duplicate_active_ingredient');
    expect(saveRes.body.data.signedAt).toBeNull();

    const signRes = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorAToken)).send({ version: 1 });
    expect(signRes.status).toBe(200);
    expect(signRes.body.data.signedAt).not.toBeNull();
    expect(signRes.body.data.signedBy).toBe(doctorAUserId);
    expect(signRes.body.data.version).toBe(2);

    // Sửa lại đơn đã ký → 409 PRESCRIPTION_ALREADY_SIGNED.
    const editAfterSign = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorAToken))
      .send({ items: [{ drugId: drugA, dose: '2 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: 20 }] });
    expect(editAfterSign.status).toBe(409);
    expect(editAfterSign.body.error.code).toBe('PRESCRIPTION_ALREADY_SIGNED');
  });

  it('gán dị nguyên cho bệnh nhân, kê thuốc trùng tên → warning PRE-03', async () => {
    const { encounterId, patientId } = await prepareEncounterInConsultation(8);
    const allergenId = await createAllergen(fixture.tenantA.id, 'Amoxicillin');

    const patientRes = await request(app.getHttpServer()).get(`/api/v1/patients/${patientId}`).set(authed(doctorAToken));
    const patientVersion = patientRes.body.data.version as number;
    const assignRes = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientId}`)
      .set(authed(doctorAToken))
      .send({ allergenIds: [allergenId], version: patientVersion });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.data.allergens).toHaveLength(1);
    expect(assignRes.body.data.allergens[0].name).toBe('Amoxicillin');

    const drugId = await createDrug(fixture.tenantA.id, 'Amoxicillin 500mg', 'Amoxicillin');
    const saveRes = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorAToken))
      .send({ items: [{ drugId, dose: '1 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: 10 }] });

    expect(saveRes.status).toBe(200);
    expect(saveRes.body.data.warnings).toHaveLength(1);
    expect(saveRes.body.data.warnings[0].kind).toBe('allergy');
    expect(saveRes.body.data.warnings[0].label).toBe('Amoxicillin');

    // GET .../consultation cũng phải thấy đủ prescription + allergens của bệnh nhân.
    const consultationRes = await request(app.getHttpServer()).get(`/api/v1/encounters/${encounterId}/consultation`).set(authed(doctorAToken));
    expect(consultationRes.body.data.patient.allergens).toHaveLength(1);
    expect(consultationRes.body.data.prescription.items).toHaveLength(1);
    expect(consultationRes.body.data.prescription.warnings).toHaveLength(1);
  });

  it('in đơn ghi printedAt (idempotent), rồi đính chính tạo bản mới đã ký, bản cũ bị thay thế', async () => {
    const { encounterId } = await prepareEncounterInConsultation(9);
    const drugId = await createDrug(fixture.tenantA.id, 'Cefixim 200mg', 'Cefixim');

    await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorAToken))
      .send({ items: [{ drugId, dose: '1 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: 10 }] });
    const signRes = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorAToken)).send({ version: 1 });
    const originalPrescriptionId = signRes.body.data.id as string;

    // In lần đầu → printedAt set.
    const printRes1 = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/print`).set(authed(doctorAToken));
    expect(printRes1.status).toBe(200);
    expect(printRes1.body.data.printedAt).not.toBeNull();
    const firstPrintedAt = printRes1.body.data.printedAt as string;

    // In lần 2 → idempotent, không đổi thời điểm in đầu tiên (và không tăng version thêm nữa).
    const printRes2 = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/print`).set(authed(doctorAToken));
    expect(printRes2.body.data.printedAt).toBe(firstPrintedAt);
    const versionAfterPrint = printRes2.body.data.version as number;

    // Đính chính — thêm 1 dòng thuốc, đổi liều dòng cũ. `version` là version SAU khi in (in đơn
    // cũng tăng version, cùng optimistic lock như mọi UPDATE khác trong dự án).
    const drugId2 = await createDrug(fixture.tenantA.id, 'Vitamin C', 'Ascorbic acid');
    const amendRes = await request(app.getHttpServer())
      .post(`/api/v1/encounters/${encounterId}/prescription/amend`)
      .set(authed(doctorAToken))
      .send({
        amendmentReason: 'Bổ sung Vitamin C theo yêu cầu bệnh nhân',
        version: versionAfterPrint,
        items: [
          { drugId, dose: '2 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: 20 },
          { drugId: drugId2, dose: '1 viên', frequency: '1 lần/ngày', durationDays: 5, quantity: 5 },
        ],
      });
    expect(amendRes.status).toBe(200);
    expect(amendRes.body.data.id).not.toBe(originalPrescriptionId);
    expect(amendRes.body.data.supersedesId).toBe(originalPrescriptionId);
    expect(amendRes.body.data.amendmentReason).toBe('Bổ sung Vitamin C theo yêu cầu bệnh nhân');
    expect(amendRes.body.data.signedAt).not.toBeNull();
    expect(amendRes.body.data.items).toHaveLength(2);

    // Đơn đang hiệu lực của lượt khám giờ là bản đính chính.
    const consultationRes = await request(app.getHttpServer()).get(`/api/v1/encounters/${encounterId}/consultation`).set(authed(doctorAToken));
    expect(consultationRes.body.data.prescription.id).toBe(amendRes.body.data.id);
  });

  it('bác sĩ khác (không phụ trách, scope personal) → 404 khi lưu dòng thuốc/ký đơn', async () => {
    const { encounterId } = await prepareEncounterInConsultation(10);
    const drugId = await createDrug(fixture.tenantA.id, 'Thuốc B', 'Hoạt chất B');

    const saveRes = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorBToken))
      .send({ items: [{ drugId, dose: '1 viên', frequency: '1 lần/ngày', durationDays: 3, quantity: 3 }] });
    expect(saveRes.status).toBe(404);
  });

  it('cách ly tenant — tenant B không lưu/ký được đơn của tenant A → 404', async () => {
    const { encounterId } = await prepareEncounterInConsultation(11);
    const drugId = await createDrug(fixture.tenantA.id, 'Thuốc C', 'Hoạt chất C');

    const saveRes = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(tenantBDoctorToken))
      .send({ items: [{ drugId, dose: '1 viên', frequency: '1 lần/ngày', durationDays: 3, quantity: 3 }] });
    expect(saveRes.status).toBe(404);
  });

  it('DB trigger C8 chặn UPDATE trực tiếp lên nội dung đơn đã ký (kể cả gọi thẳng SQL, không qua service)', async () => {
    const { encounterId } = await prepareEncounterInConsultation(12);
    const drugId = await createDrug(fixture.tenantA.id, 'Thuốc D', 'Hoạt chất D');
    await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorAToken))
      .send({ items: [{ drugId, dose: '1 viên', frequency: '1 lần/ngày', durationDays: 3, quantity: 3 }] });
    const signRes = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorAToken)).send({ version: 1 });
    const prescriptionId = signRes.body.data.id as string;

    await expect(
      privileged.$executeRawUnsafe(`UPDATE prescription SET amendment_reason = 'hack' WHERE id = '${prescriptionId}'`),
    ).rejects.toThrow();
  });
});
