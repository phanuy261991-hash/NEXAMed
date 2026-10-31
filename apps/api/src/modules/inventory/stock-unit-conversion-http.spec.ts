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
 * HTTP e2e — QUY ĐỔI ĐƠN VỊ trong kho và luồng nhập (đơn vị lớn) → tồn (đơn vị cơ sở) → kê đơn →
 * phát thuốc FEFO → huỷ (docs/DECISIONS.md #275). Các spec kho cũ đều dùng thuốc MỘT đơn vị
 * (`units: []`) nên đường chính "nhập Hộp/Vỉ, tồn tính theo Viên" chưa từng được kiểm tự động.
 *
 * Thuốc chuẩn của file này: đơn vị cơ sở VIEN; 1 Vỉ (VI) = 10 Viên; 1 Hộp (HOP) = 10 Vỉ = 100 Viên.
 */
describe('HTTP e2e — quy đổi đơn vị kho (nhập đơn vị lớn → tồn cơ sở → kê → phát → huỷ)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let warehouseId: string;
  let supplierId: string;

  const CHAIN = [
    { unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 10 },
    { unitCode: 'HOP', sortOrder: 1, factorToUnitBelow: 10 },
  ];

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-unitconv-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  function drugBody(overrides: Record<string, unknown> = {}) {
    return {
      code: `DRG-${randomUUID().slice(0, 8)}`,
      name: 'Amoxicillin 500mg (quy đổi)',
      itemType: 'MEDICINE',
      baseUnitCode: 'VIEN',
      activeIngredient: 'Amoxicillin',
      unit: 'Viên',
      concentration: '500mg',
      manufacturerCode: 'TEST_MANUFACTURER',
      defaultSellPrice: 3500,
      drugGroupCode: 'TEST_GROUP',
      routeCode: 'TEST_ROUTE',
      registrationNumber: 'VD-TEST-0002',
      dosageForm: 'Viên nén',
      countryOfOrigin: 'Việt Nam',
      ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
      units: CHAIN,
      isBatchManaged: true,
      isPrescriptionOnly: true,
      ...overrides,
    };
  }

  async function createDrug(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/drugs').set(authed(clinicAdminToken)).send(drugBody(overrides));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  type ReceiptLine = { drugId: string; unitCode: string; quantity: number; unitCost: number; batchNo?: string; expiryDate?: string };

  function createReceipt(lines: ReceiptLine[]) {
    return request(app.getHttpServer()).post('/api/v1/inventory/receipts').set(authed(clinicAdminToken)).send({ warehouseId, supplierId, receiptType: 'PURCHASE', lines });
  }

  function approveReceipt(id: string, version: number) {
    return request(app.getHttpServer()).post(`/api/v1/inventory/receipts/${id}/approve`).set(authed(clinicAdminToken)).send({ version });
  }

  async function receive(lines: ReceiptLine[]) {
    const created = await createReceipt(lines);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const approved = await approveReceipt(created.body.data.id, created.body.data.version);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    return approved.body.data as { id: string; version: number; totalAmount: number };
  }

  async function batchBalances(drugId: string) {
    const res = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(clinicAdminToken)).query({ warehouseId });
    expect(res.status).toBe(200);
    const byBatchNo = new Map<string, { batchId: string; quantityOnHand: number; unitCost: number }>();
    for (const item of res.body.data.items as { batchId: string; batchNo: string; quantityOnHand: number; unitCost: number }[]) {
      byBatchNo.set(item.batchNo, item);
    }
    return { byBatchNo, total: res.body.data.totalQuantityOnHand as number };
  }

  async function totalOnHand(drugId: string): Promise<number> {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = res.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    return (row?.quantityOnHand as number | undefined) ?? 0;
  }

  async function prepareEncounterInConsultation(hour: number) {
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId: doctorUserId, fullName: 'Khách e2e quy đổi', phone: '0911222888', scheduledAt: new Date(Date.UTC(2026, 7, 29, hour, 0, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };

    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e quy đổi', dob: '1985-01-01', gender: 'male', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
    const patient = patientRes.body.data as { id: string };

    const checkInRes = await request(app.getHttpServer())
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
        allowsDeferredPayment: true,
      });
    const encounterId = checkInRes.body.data.id as string;

    const startRes = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    expect(startRes.status).toBe(200);
    await request(app.getHttpServer()).put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(doctorToken)).send({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' as const }] });
    return { encounterId };
  }

  /** Kê + ký đơn: mỗi dòng gửi liều 4 buổi + số ngày (số lượng do backend tính, #196). */
  async function signPrescription(
    encounterId: string,
    lines: { drugId: string; doseMorning: number; doseEvening?: number; durationDays: number }[],
  ) {
    const saveRes = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorToken))
      .send({ items: lines.map((l) => ({ drugId: l.drugId, doseMorning: l.doseMorning, doseNoon: 0, doseAfternoon: 0, doseEvening: l.doseEvening ?? 0, durationDays: l.durationDays })) });
    expect(saveRes.status, JSON.stringify(saveRes.body)).toBe(200);
    const signRes = await request(app.getHttpServer())
      .post(`/api/v1/encounters/${encounterId}/prescription/sign`)
      .set(authed(doctorToken))
      .send({ version: saveRes.body.data.version });
    expect(signRes.status, JSON.stringify(signRes.body)).toBe(200);
    return { prescriptionId: signRes.body.data.id as string, items: signRes.body.data.items as { id: string; drugId: string; quantity: number }[] };
  }

  async function dispenseStatus(prescriptionId: string) {
    const res = await request(app.getHttpServer()).get(`/api/v1/inventory/prescriptions/${prescriptionId}/dispense-status`).set(authed(doctorToken)).query({ warehouseId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as {
      lines: { remainingQuantity: number; prescribedQuantity: number; warehouseStockOnHand: number; suggestedBatches: { batchId: string; batchNo: string; quantityOnHand: number }[] }[];
    };
  }

  function issue(prescriptionId: string, lines: { prescriptionItemId: string; drugId: string; batchId: string; quantity: number }[]) {
    return request(app.getHttpServer()).post('/api/v1/inventory/issues').set(authed(doctorToken)).send({ prescriptionId, warehouseId, lines });
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

    fixture = await createTwoTenantFixture(privileged, 'StockUnitConversion e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;

    const warehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    warehouseId = warehousesRes.body.data.items[0].id;
    const supplierRes = await request(app.getHttpServer()).post('/api/v1/suppliers').set(authed(clinicAdminToken)).send({ name: 'Cty CP Dược phẩm Test quy đổi' });
    supplierId = supplierRes.body.data.id as string;

    // Giữ hoá đơn dịch vụ khám UNPAID khi phát thuốc (khuôn `stock-issue-http.spec.ts`).
    await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ deferredPaymentEnabled: true });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('đường chính: nhập Hộp/Vỉ → tồn Viên → kê → phát FEFO → huỷ', () => {
    let drugId: string;
    let lateBatchId: string;
    let earlyBatchId: string;
    let firstIssueId: string;
    let firstIssueVersion: number;
    let receiptId: string;

    it('nhập 2 Hộp (lô hạn muộn) + 3 Vỉ (lô hạn sớm) → tồn 200 và 30 Viên, giá vốn theo Viên, tổng phiếu theo đơn vị đã nhập', async () => {
      drugId = await createDrug();
      const receipt = await receive([
        { drugId, unitCode: 'HOP', quantity: 2, unitCost: 300_000, batchNo: 'LATE', expiryDate: '2027-06-01' },
        { drugId, unitCode: 'VI', quantity: 3, unitCost: 31_000, batchNo: 'EARLY', expiryDate: '2027-01-01' },
      ]);
      receiptId = receipt.id;
      expect(receipt.totalAmount).toBe(2 * 300_000 + 3 * 31_000);

      const { byBatchNo, total } = await batchBalances(drugId);
      expect(byBatchNo.get('LATE')).toMatchObject({ quantityOnHand: 200, unitCost: 3000 });
      expect(byBatchNo.get('EARLY')).toMatchObject({ quantityOnHand: 30, unitCost: 3100 });
      expect(total).toBe(230);
      lateBatchId = byBatchNo.get('LATE')!.batchId;
      earlyBatchId = byBatchNo.get('EARLY')!.batchId;
      expect(await totalOnHand(drugId)).toBe(230);
    });

    it('thẻ kho ghi theo đơn vị cơ sở (+200 và +30 Viên)', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(clinicAdminToken)).query({ warehouseId });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const changes = (res.body.data.items as { quantityChange: number }[]).map((i) => i.quantityChange).sort((a, b) => a - b);
      expect(changes).toEqual([30, 200]);
    });

    it('kê 12 Viên, ký: gợi ý FEFO lô hạn sớm trước; phát 12 → tồn 218, hoá đơn tính THEO VIÊN', async () => {
      const { encounterId } = await prepareEncounterInConsultation(5);
      const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, doseMorning: 12, durationDays: 1 }]);
      expect(items[0]!.quantity).toBe(12);

      const status = await dispenseStatus(prescriptionId);
      const line = status.lines[0]!;
      expect(line).toMatchObject({ prescribedQuantity: 12, remainingQuantity: 12, warehouseStockOnHand: 230 });
      expect(line.suggestedBatches.map((b) => b.batchNo)).toEqual(['EARLY', 'LATE']);
      expect(line.suggestedBatches.map((b) => b.quantityOnHand)).toEqual([30, 200]);

      const res = await issue(prescriptionId, [{ prescriptionItemId: items[0]!.id, drugId, batchId: earlyBatchId, quantity: 12 }]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.totalAmount).toBe(12 * 3500);
      firstIssueId = res.body.data.id as string;
      firstIssueVersion = res.body.data.version as number;

      expect(await totalOnHand(drugId)).toBe(218);
      const after = await dispenseStatus(prescriptionId);
      expect(after.lines[0]).toMatchObject({ remainingQuantity: 0, warehouseStockOnHand: 218 });

      const invoice = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
      const drugLine = invoice.body.data.lines.find((l: { examTypeName: string }) => l.examTypeName === 'Amoxicillin 500mg (quy đổi)');
      expect(drugLine).toMatchObject({ quantity: 12, unitPrice: 3500, lineTotal: 42_000 });
    });

    it('phát nhiều lô trong một lần (18 từ lô sớm + 7 từ lô muộn) trừ đúng từng lô; huỷ phiếu hoàn đúng từng lô', async () => {
      const { encounterId } = await prepareEncounterInConsultation(6);
      const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, doseMorning: 25, durationDays: 1 }]);

      const res = await issue(prescriptionId, [
        { prescriptionItemId: items[0]!.id, drugId, batchId: earlyBatchId, quantity: 18 },
        { prescriptionItemId: items[0]!.id, drugId, batchId: lateBatchId, quantity: 7 },
      ]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.totalAmount).toBe(25 * 3500);

      // Lô hết hàng không còn dòng trong danh sách tồn theo lô → coi như 0.
      let balances = await batchBalances(drugId);
      expect(balances.byBatchNo.get('EARLY')?.quantityOnHand ?? 0).toBe(0);
      expect(balances.byBatchNo.get('LATE')!.quantityOnHand).toBe(193);

      const voided = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/${res.body.data.id}/void`)
        .set(authed(doctorToken))
        .send({ reason: 'Phát nhầm', version: res.body.data.version });
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);

      balances = await batchBalances(drugId);
      expect(balances.byBatchNo.get('EARLY')!.quantityOnHand).toBe(18);
      expect(balances.byBatchNo.get('LATE')!.quantityOnHand).toBe(200);
    });

    it('phát vượt tồn của lô (lô sớm chỉ còn 18) → 422, tồn không đổi', async () => {
      const { encounterId } = await prepareEncounterInConsultation(7);
      const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, doseMorning: 20, durationDays: 1 }]);
      const res = await issue(prescriptionId, [{ prescriptionItemId: items[0]!.id, drugId, batchId: earlyBatchId, quantity: 20 }]);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('STOCK_ISSUE_INSUFFICIENT_STOCK');
      expect(await totalOnHand(drugId)).toBe(218);
    });

    it('huỷ phiếu nhập khi lô đã xuất bớt → 409 STOCK_RECEIPT_VOID_NOT_ALLOWED, tồn không đổi', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/void`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Nhập nhầm', version: 2 });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error.code).toBe('STOCK_RECEIPT_VOID_NOT_ALLOWED');
      expect(await totalOnHand(drugId)).toBe(218);
    });

    it('huỷ phiếu xuất đầu tiên → hoàn 12 Viên vào lô sớm; sau đó huỷ phiếu nhập được nếu đủ tồn (tồn về 0)', async () => {
      const voided = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/${firstIssueId}/void`)
        .set(authed(doctorToken))
        .send({ reason: 'Phát nhầm', version: firstIssueVersion });
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      expect(await totalOnHand(drugId)).toBe(230);

      const receipt = await request(app.getHttpServer()).get(`/api/v1/inventory/receipts/${receiptId}`).set(authed(clinicAdminToken));
      const voidReceipt = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/void`)
        .set(authed(clinicAdminToken))
        .send({ reason: 'Nhập nhầm', version: receipt.body.data.version });
      expect(voidReceipt.status, JSON.stringify(voidReceipt.body)).toBe(200);
      expect(await totalOnHand(drugId)).toBe(0);
    });
  });

  describe('thuốc kê theo ml, đơn vị kho là Hộp 60 ml (liều theo ml quy ra số Hộp)', () => {
    it('kê 5 ml × 2 lần/ngày × 7 ngày = 70 ml → 2 Hộp; phát 2 → tồn còn 3', async () => {
      const drugId = await createDrug({
        name: 'Siro ho (quy đổi ml)',
        baseUnitCode: 'HOP',
        unit: 'Hộp',
        units: [{ unitCode: 'THUNG', sortOrder: 0, factorToUnitBelow: 12 }],
        doseUnitCode: 'ml',
        dosePerBaseUnit: 60,
        isBatchManaged: false,
      });
      // Nhập 1 Thùng = 12 Hộp, rồi nhập thêm bằng đơn vị cơ sở: 12 + 3... tổng 15 Hộp.
      await receive([{ drugId, unitCode: 'THUNG', quantity: 1, unitCost: 1_200_000 }]);
      await receive([{ drugId, unitCode: 'HOP', quantity: 3, unitCost: 110_000 }]);
      expect(await totalOnHand(drugId)).toBe(15);

      const { encounterId } = await prepareEncounterInConsultation(8);
      const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, doseMorning: 5, doseEvening: 5, durationDays: 7 }]);
      expect(items[0]!.quantity).toBe(2);

      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(doctorToken))
        .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, quantity: 2 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await totalOnHand(drugId)).toBe(13);
    });
  });

  describe('chặn đơn vị dòng phiếu nhập ngoài chuỗi quy đổi', () => {
    it('lập phiếu với đơn vị không thuộc chuỗi → 422 STOCK_RECEIPT_LINE_UNIT_INVALID', async () => {
      const drugId = await createDrug({ name: 'Thuốc chặn đơn vị lạ' });
      const res = await createReceipt([{ drugId, unitCode: 'THUNG', quantity: 1, unitCost: 100_000, batchNo: 'X1', expiryDate: '2027-06-01' }]);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe('STOCK_RECEIPT_LINE_UNIT_INVALID');
    });

    it('đơn vị cơ sở và các bậc trong chuỗi đều được nhận', async () => {
      const drugId = await createDrug({ name: 'Thuốc đơn vị hợp lệ' });
      for (const [i, unitCode] of ['VIEN', 'VI', 'HOP'].entries()) {
        const res = await createReceipt([{ drugId, unitCode, quantity: 1, unitCost: 1000, batchNo: `OK${i}`, expiryDate: '2027-06-01' }]);
        expect(res.status, `${unitCode}: ${JSON.stringify(res.body)}`).toBe(200);
      }
    });

    it('Nháp lập bằng Hộp, sau đó chuỗi bị sửa bỏ Hộp → Duyệt bị chặn 422, KHÔNG cộng tồn sai hệ số', async () => {
      const drugId = await createDrug({ name: 'Thuốc sửa chuỗi sau khi lập nháp' });
      const draft = await createReceipt([{ drugId, unitCode: 'HOP', quantity: 2, unitCost: 300_000, batchNo: 'DR1', expiryDate: '2027-06-01' }]);
      expect(draft.status, JSON.stringify(draft.body)).toBe(200);

      const current = await request(app.getHttpServer()).get(`/api/v1/drugs/${drugId}`).set(authed(clinicAdminToken));
      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/drugs/${drugId}`)
        .set(authed(clinicAdminToken))
        .send({ units: [{ unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 10 }], version: current.body.data.version });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);

      const approved = await approveReceipt(draft.body.data.id, draft.body.data.version);
      expect(approved.status, JSON.stringify(approved.body)).toBe(422);
      expect(approved.body.error.code).toBe('STOCK_RECEIPT_LINE_UNIT_INVALID');
      expect(await totalOnHand(drugId)).toBe(0);
    });
  });

  describe('chặn đổi đơn vị cơ sở khi còn tồn', () => {
    it('còn tồn → đổi baseUnitCode 409 DRUG_BASE_UNIT_CHANGE_BLOCKED; gửi lại cùng giá trị thì qua; hết tồn mới đổi được', async () => {
      const drugId = await createDrug({ name: 'Thuốc khoá đổi đơn vị cơ sở', units: [] });
      await receive([{ drugId, unitCode: 'VIEN', quantity: 10, unitCost: 1000, batchNo: 'BASE1', expiryDate: '2027-06-01' }]);

      const blocked = await request(app.getHttpServer()).patch(`/api/v1/drugs/${drugId}`).set(authed(clinicAdminToken)).send({ baseUnitCode: 'VI', version: 1 });
      expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
      expect(blocked.body.error.code).toBe('DRUG_BASE_UNIT_CHANGE_BLOCKED');

      const same = await request(app.getHttpServer()).patch(`/api/v1/drugs/${drugId}`).set(authed(clinicAdminToken)).send({ baseUnitCode: 'VIEN', name: 'Thuốc khoá đổi đơn vị cơ sở (sửa tên)', version: 1 });
      expect(same.status, JSON.stringify(same.body)).toBe(200);

      await privileged.stockBalance.updateMany({ where: { tenantId: fixture.tenantA.id, drugId }, data: { quantityOnHand: 0 } });
      const allowed = await request(app.getHttpServer()).patch(`/api/v1/drugs/${drugId}`).set(authed(clinicAdminToken)).send({ baseUnitCode: 'VI', version: 2 });
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
      expect(allowed.body.data.baseUnitCode).toBe('VI');
    });
  });

  describe('chuỗi đơn vị không hợp lệ bị chặn 400', () => {
    it('tạo thuốc: trùng mã đơn vị / trùng đơn vị cơ sở / trùng thứ tự bậc / tổng hệ số quá lớn', async () => {
      const create = (units: unknown) => request(app.getHttpServer()).post('/api/v1/drugs').set(authed(clinicAdminToken)).send(drugBody({ units }));
      const dupCode = await create([
        { unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 10 },
        { unitCode: 'VI', sortOrder: 1, factorToUnitBelow: 10 },
      ]);
      expect(dupCode.status).toBe(400);
      const sameAsBase = await create([{ unitCode: 'VIEN', sortOrder: 0, factorToUnitBelow: 10 }]);
      expect(sameAsBase.status).toBe(400);
      const dupOrder = await create([
        { unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 10 },
        { unitCode: 'HOP', sortOrder: 0, factorToUnitBelow: 10 },
      ]);
      expect(dupOrder.status).toBe(400);
      const tooBig = await create([
        { unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 100_000 },
        { unitCode: 'HOP', sortOrder: 1, factorToUnitBelow: 100_000 },
      ]);
      expect(tooBig.status).toBe(400);
    });

    it('sửa thuốc: gửi bảng quy đổi chứa đúng đơn vị cơ sở ĐANG LƯU (không kèm baseUnitCode) → 400', async () => {
      const drugId = await createDrug({ name: 'Thuốc kiểm chuỗi khi sửa' });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/drugs/${drugId}`)
        .set(authed(clinicAdminToken))
        .send({ units: [{ unitCode: 'VIEN', sortOrder: 0, factorToUnitBelow: 10 }], version: 1 });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });
  });
});
