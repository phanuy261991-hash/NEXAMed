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
 * HTTP e2e — Dòng đơn dùng cấu hình "Cách kê liều" của thuốc (docs/DECISIONS.md #267, phần 2): kiểu "Khi cần" (liều mỗi lần + số lượng nhập thẳng, không số ngày),
 * dung dịch tính theo ml (tổng ml ÷ dung tích mỗi Hộp, làm tròn lên), đơn vị liều chụp vào dòng, đơn mẫu mang theo kiểu kê.
 */
describe('HTTP e2e — Kê đơn theo kiểu kê của thuốc (Khi cần / ml)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let clinicAdminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let unitMlCode: string;
  let hourCursor = 0;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-dm-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createDrug(data: { name: string; doseMode?: 'SCHEDULED' | 'AS_NEEDED'; doseUnitCode?: string; dosePerBaseUnit?: number; isSplittable?: boolean }) {
    const drug = await privileged.drug.create({
      data: {
        tenantId: fixture.tenantA.id,
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: data.name,
        activeIngredient: `HC-${randomUUID().slice(0, 6)}`,
        doseMode: data.doseMode ?? 'SCHEDULED',
        doseUnitCode: data.doseUnitCode ?? null,
        dosePerBaseUnit: data.dosePerBaseUnit ?? null,
        isSplittable: data.isSplittable ?? true,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    // Đủ tồn để không lẫn cảnh báo vượt tồn (mặc định bật theo dõi tồn).
    const branch = await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const warehouse = await privileged.warehouse.create({
      data: { tenantId: fixture.tenantA.id, branchId: branch.id, code: `KHO-${randomUUID().slice(0, 8)}`, name: 'Kho test', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.stockBalance.create({ data: { tenantId: fixture.tenantA.id, drugId: drug.id, warehouseId: warehouse.id, quantityOnHand: 999, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return drug.id as string;
  }

  async function prepareEncounterInConsultation() {
    hourCursor += 1;
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId: doctorUserId, fullName: 'Khách kiểu kê', phone: '0911222333', scheduledAt: new Date(Date.UTC(2026, 7, 29, hourCursor % 24, 0, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };
    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân kiểu kê', dob: '2019-01-01', gender: 'male', phone: '0933555666', nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) });
    const patientId = (patientRes.body.data as { id: string }).id;
    const checkInRes = await request(app.getHttpServer())
      .post('/api/v1/reception/check-in')
      .set(authed(receptionistToken))
      .send({
        appointmentId: appointment.id,
        patientId,
        version: appointment.version,
        doctorId: doctorUserId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = checkInRes.body.data.id as string;
    await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
    await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set(authed(doctorToken))
      .send({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' as const }] });
    return encounterId;
  }

  const save = (encounterId: string, items: Record<string, unknown>[]) =>
    request(app.getHttpServer()).put(`/api/v1/encounters/${encounterId}/prescription-items`).set(authed(doctorToken)).send({ items });

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

    fixture = await createTwoTenantFixture(privileged, 'Prescription dose mode e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;

    unitMlCode = `DV-ML-${randomUUID().slice(0, 6)}`;
    await privileged.referenceCatalog.create({ data: { tenantId: fixture.tenantA.id, category: 'UNIT', code: unitMlCode, name: 'ml', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('kiểu "Khi cần"', () => {
    it('Hapacol: liều 1,5 gói/lần nhưng số lượng kê 5 gói là số xuất — không tính từ liều; không có số ngày; ký được', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Hapacol 250mg (khi cần)', doseMode: 'AS_NEEDED' });

      const res = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', singleDose: 1.5, quantity: 5, instruction: 'Uống 1,5 gói khi sốt cao' }]);
      expect(res.status).toBe(200);
      expect(res.body.data.items[0]).toMatchObject({ doseMode: 'AS_NEEDED', singleDose: 1.5, durationDays: null, quantity: 5, doseMorning: 0, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, doseUnitName: null });

      const signed = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version: res.body.data.version });
      expect(signed.status).toBe(200);
      expect(signed.body.data.items[0]).toMatchObject({ doseMode: 'AS_NEEDED', quantity: 5, durationDays: null });
    });

    it('bỏ trống doseMode → theo cấu hình thuốc ("Khi cần"); đổi liều mỗi lần không làm đổi số lượng', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Paracetamol (mặc định khi cần)', doseMode: 'AS_NEEDED' });
      const first = await save(encounterId, [{ drugId, singleDose: 1, quantity: 10 }]);
      expect(first.body.data.items[0]).toMatchObject({ doseMode: 'AS_NEEDED', quantity: 10 });
      const second = await save(encounterId, [{ drugId, singleDose: 2, quantity: 10 }]);
      expect(second.body.data.items[0]).toMatchObject({ singleDose: 2, quantity: 10 });
    });

    it('thuốc viên/gói đổi được sang "Khi cần" trên dòng đơn dù thuốc mặc định "Theo buổi"', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Thuốc gói đổi kiểu', doseMode: 'SCHEDULED' });
      const res = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 3 }]);
      expect(res.status).toBe(200);
      expect(res.body.data.items[0]).toMatchObject({ doseMode: 'AS_NEEDED', quantity: 3, durationDays: null });
    });

    it('nháp chưa nhập liều/số lượng lưu được; KÝ thì bị chặn 422 PRESCRIPTION_ITEM_MISSING_DOSE', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Thuốc khi cần chưa nhập', doseMode: 'AS_NEEDED' });
      const draft = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', quantity: 0 }]);
      expect(draft.status).toBe(200);
      const sign = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version: draft.body.data.version });
      expect(sign.status).toBe(422);
      expect(sign.body.error.code).toBe('PRESCRIPTION_ITEM_MISSING_DOSE');

      // Có liều mỗi lần nhưng số lượng 0 cũng chưa đủ.
      const half = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 0 }]);
      const sign2 = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version: half.body.data.version });
      expect(sign2.status).toBe(422);
    });

    it('liều không phải bội ¼ hoặc số lượng âm/quá lớn → bị từ chối ở bước kiểm tra dữ liệu', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Thuốc kiểm tra dữ liệu', doseMode: 'AS_NEEDED' });
      for (const bad of [{ singleDose: 0.3, quantity: 5 }, { singleDose: 1, quantity: -1 }, { singleDose: 1, quantity: 100000 }, { singleDose: 1, quantity: 2.5 }]) {
        const res = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', ...bad }]);
        expect(res.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
    });

    it('"Theo buổi" thiếu số ngày → bị từ chối (không tự bịa số ngày)', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Thuốc theo buổi thiếu ngày' });
      const res = await save(encounterId, [{ drugId, doseMode: 'SCHEDULED', doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0 }]);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('1,5 gói/lần với thuốc KHÔNG chia được vẫn báo cảnh báo chia lẻ (liều lẻ theo nghĩa bẻ viên)', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Thuốc không chia được (khi cần)', doseMode: 'AS_NEEDED', isSplittable: false });
      const res = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', singleDose: 1.5, quantity: 5 }]);
      expect(res.body.data.warnings.some((w: { kind: string }) => w.kind === 'not_splittable')).toBe(true);
    });

    it('đính chính đơn đã ký sang/giữ kiểu "Khi cần": ghi bản mới, thiếu số lượng bị từ chối', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Thuốc khi cần đính chính', doseMode: 'AS_NEEDED' });
      const draft = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 4 }]);
      const signed = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version: draft.body.data.version });
      const amend = (items: Record<string, unknown>[]) =>
        request(app.getHttpServer())
          .post(`/api/v1/encounters/${encounterId}/prescription/amend`)
          .set(authed(doctorToken))
          .send({ items, amendmentReason: 'Tăng số lượng', version: signed.body.data.version });
      const bad = await amend([{ drugId, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 0 }]);
      expect(bad.status).toBeGreaterThanOrEqual(400);
      expect(bad.status).toBeLessThan(500);
      const ok = await amend([{ drugId, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 6 }]);
      expect(ok.status).toBe(200);
      expect(ok.body.data.items[0]).toMatchObject({ doseMode: 'AS_NEEDED', quantity: 6, durationDays: null });
    });
  });

  describe('dung dịch tính theo ml (Zyrtec 60 ml/Hộp)', () => {
    it('5 ml sáng + 5 ml tối × 5 ngày = 50 ml → kê 1 Hộp; 10+10 × 7 = 140 ml → 3 Hộp (làm tròn lên)', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Zyrtec Sol 60ml', doseUnitCode: unitMlCode, dosePerBaseUnit: 60 });
      const one = await save(encounterId, [{ drugId, doseMorning: 5, doseNoon: 0, doseAfternoon: 0, doseEvening: 5, durationDays: 5 }]);
      expect(one.status).toBe(200);
      expect(one.body.data.items[0]).toMatchObject({ doseMode: 'SCHEDULED', quantity: 1, doseUnitName: 'ml', dosePerBaseUnit: 60, durationDays: 5 });
      const three = await save(encounterId, [{ drugId, doseMorning: 10, doseNoon: 0, doseAfternoon: 0, doseEvening: 10, durationDays: 7 }]);
      expect(three.body.data.items[0]).toMatchObject({ quantity: 3 });
    });

    it('đúng 60 ml tròn 1 Hộp, 60,25 ml cần 2 Hộp (biên làm tròn)', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Siro biên làm tròn', doseUnitCode: unitMlCode, dosePerBaseUnit: 60 });
      const exact = await save(encounterId, [{ drugId, doseMorning: 10, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 6 }]);
      expect(exact.body.data.items[0].quantity).toBe(1);
      const over = await save(encounterId, [{ drugId, doseMorning: 10.25, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 6 }]);
      // 10,25 × 6 = 61,5 ml > 60 ml
      expect(over.body.data.items[0].quantity).toBe(2);
    });

    it('thuốc có đơn vị liều: kiểu kê cố định theo thuốc — khách gửi "Khi cần" bị bỏ qua và (thiếu số ngày) bị từ chối', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Siro cố định theo buổi', doseUnitCode: unitMlCode, dosePerBaseUnit: 60 });
      const res = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', singleDose: 5, quantity: 1 }]);
      expect(res.status).toBe(400);
    });

    it('liều lẻ theo ml (2,5 ml) KHÔNG bị coi là liều lẻ "bẻ viên" dù thuốc không chia được', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Siro không chia được', doseUnitCode: unitMlCode, dosePerBaseUnit: 60, isSplittable: false });
      const res = await save(encounterId, [{ drugId, doseMorning: 2.5, doseNoon: 0, doseAfternoon: 0, doseEvening: 2.5, durationDays: 3 }]);
      expect(res.status).toBe(200);
      expect(res.body.data.warnings.some((w: { kind: string }) => w.kind === 'not_splittable')).toBe(false);
    });

    it('đơn vị liều + dung tích được CHỤP vào dòng: thuốc đổi cấu hình sau đó, đơn đã ký không đổi', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Siro chụp cấu hình', doseUnitCode: unitMlCode, dosePerBaseUnit: 60 });
      const draft = await save(encounterId, [{ drugId, doseMorning: 5, doseNoon: 0, doseAfternoon: 0, doseEvening: 5, durationDays: 5 }]);
      const signed = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version: draft.body.data.version });
      expect(signed.status).toBe(200);

      await privileged.drug.update({ where: { id: drugId }, data: { doseUnitCode: null, dosePerBaseUnit: null } });
      await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'UNIT', code: unitMlCode }, data: { name: 'mililit' } });
      const reread = await request(app.getHttpServer()).get(`/api/v1/encounters/${encounterId}/consultation`).set(authed(doctorToken));
      expect(reread.body.data.prescription.items[0]).toMatchObject({ doseUnitName: 'ml', dosePerBaseUnit: 60, quantity: 1 });
      await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'UNIT', code: unitMlCode }, data: { name: 'ml' } });
    });
  });

  describe('đơn thuốc mẫu mang theo kiểu kê', () => {
    const createTemplate = (items: Record<string, unknown>[]) =>
      request(app.getHttpServer()).post('/api/v1/prescription-templates').set(authed(clinicAdminToken)).send({ name: `Mẫu ${randomUUID().slice(0, 6)}`, items });

    it('lưu mẫu có dòng "Khi cần" (số lượng nhập thẳng, không số ngày) và dòng ml (số lượng tính theo dung tích)', async () => {
      const asNeededId = await createDrug({ name: 'Hapacol trong mẫu', doseMode: 'AS_NEEDED' });
      const mlId = await createDrug({ name: 'Zyrtec trong mẫu', doseUnitCode: unitMlCode, dosePerBaseUnit: 60 });
      const res = await createTemplate([
        { drugId: asNeededId, doseMode: 'AS_NEEDED', singleDose: 1.5, quantity: 5, instruction: 'Uống khi sốt' },
        { drugId: mlId, doseMorning: 5, doseNoon: 0, doseAfternoon: 0, doseEvening: 5, durationDays: 5 },
      ]);
      expect(res.status).toBe(200);
      const [a, b] = res.body.data.items as Record<string, unknown>[];
      expect(a).toMatchObject({ doseMode: 'AS_NEEDED', singleDose: 1.5, durationDays: null, quantity: 5 });
      expect(b).toMatchObject({ doseMode: 'SCHEDULED', singleDose: null, durationDays: 5, quantity: 1 });
    });

    it('mẫu "Theo buổi" thiếu số ngày bị từ chối', async () => {
      const drugId = await createDrug({ name: 'Mẫu thiếu ngày' });
      const res = await createTemplate([{ drugId, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 0 }]);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('CHECK ở cơ sở dữ liệu (lớp cuối)', () => {
    it('dòng "Khi cần" có số ngày hoặc liều theo buổi khác 0 bị DB từ chối; "Theo buổi" thiếu số ngày cũng vậy', async () => {
      const encounterId = await prepareEncounterInConsultation();
      const drugId = await createDrug({ name: 'Thuốc CHECK DB', doseMode: 'AS_NEEDED' });
      const draft = await save(encounterId, [{ drugId, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 2 }]);
      const prescriptionId = draft.body.data.id as string;
      const base = { tenantId: fixture.tenantA.id, prescriptionId, drugId, quantity: 1, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR };
      await expect(privileged.prescriptionItem.create({ data: { ...base, doseMode: 'AS_NEEDED', durationDays: 3 } })).rejects.toThrow();
      await expect(privileged.prescriptionItem.create({ data: { ...base, doseMode: 'AS_NEEDED', durationDays: null, doseMorning: 1 } })).rejects.toThrow();
      await expect(privileged.prescriptionItem.create({ data: { ...base, doseMode: 'SCHEDULED', durationDays: null } })).rejects.toThrow();
      await expect(privileged.prescriptionItem.create({ data: { ...base, doseMode: 'SCHEDULED', durationDays: 3, doseUnitName: 'ml', dosePerBaseUnit: null } })).rejects.toThrow();
    });
  });
});
