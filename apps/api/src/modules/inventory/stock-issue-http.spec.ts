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
 * HTTP e2e — "Phiếu xuất kho" (Kho Thuốc & Vật tư y tế Giai đoạn 3, docs/DECISIONS.md #163, kế
 * hoạch kỹ thuật fluttering-scribbling-liskov.md). Bao phủ: phát đủ/thiếu tồn, nhiều lô FEFO, phát
 * vượt kê đơn (422, chặn cứng khác PRE-02/03), hàng OTC không theo đơn, huỷ phiếu xuất hoàn đúng
 * tồn + xoá đúng invoice_line, race 2 phiếu cùng lô, gắn vào hoá đơn SERVICE đang mở vs hoá đơn
 * DRUG riêng, permission, cách ly tenant.
 */
describe('HTTP e2e — /api/v1/inventory (Phiếu xuất kho GĐ3)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let tenantBAdminToken: string;
  let warehouseId: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-issue-${roleName}-${randomUUID()}`;
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

  async function createDrug(token: string, overrides: Partial<{ name: string; isBatchManaged: boolean; isPrescriptionOnly: boolean; defaultSellPrice: number }> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(token))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: overrides.name ?? 'Paracetamol 500mg',
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
        activeIngredient: 'Paracetamol',
        unit: 'Viên',
        concentration: '500mg',
        manufacturerCode: 'TEST_MANUFACTURER',
        defaultSellPrice: overrides.defaultSellPrice ?? 2000,
        drugGroupCode: 'TEST_GROUP',
        routeCode: 'TEST_ROUTE',
        registrationNumber: 'VD-TEST-0001',
        dosageForm: 'Viên nén',
        countryOfOrigin: 'Việt Nam',
        ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
        units: [],
        isBatchManaged: overrides.isBatchManaged ?? true,
        isPrescriptionOnly: overrides.isPrescriptionOnly ?? true,
      });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  /** Nhập kho + Duyệt ngay — trả về `batchId` (hoặc `null` nếu `isBatchManaged=false`). */
  async function receiveStock(token: string, drugId: string, quantity: number, unitCost: number, opts: { batchNo?: string; expiryDate?: string; openingBalance?: boolean } = {}) {
    const body = opts.openingBalance
      ? { warehouseId, receiptType: 'OPENING_BALANCE' as const, lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost }] }
      : {
          warehouseId,
          supplierId: (await ensureSupplier(token)),
          receiptType: 'PURCHASE' as const,
          lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost, batchNo: opts.batchNo ?? `LOT-${randomUUID().slice(0, 6)}`, expiryDate: opts.expiryDate ?? '2027-01-01' }],
        };
    const created = await request(app.getHttpServer()).post('/api/v1/inventory/receipts').set(authed(token)).send(body);
    expect(created.status).toBe(200);
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`)
      .set(authed(token))
      .send({ version: created.body.data.version });
    expect(approved.status).toBe(200);

    const balancesRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(token)).query({ warehouseId });
    const batch = balancesRes.body.data.items.find((b: { batchNo: string | null }) => !opts.openingBalance && b.batchNo === (opts.batchNo ?? undefined));
    return (batch?.batchId as string | undefined) ?? (balancesRes.body.data.items[0]?.batchId as string | undefined) ?? null;
  }

  let cachedSupplierId: string | undefined;
  async function ensureSupplier(token: string): Promise<string> {
    if (cachedSupplierId) return cachedSupplierId;
    const res = await request(app.getHttpServer()).post('/api/v1/suppliers').set(authed(token)).send({ name: 'Cty CP Dược phẩm Test GĐ3' });
    cachedSupplierId = res.body.data.id as string;
    return cachedSupplierId;
  }

  /** Đọc `version` HIỆN TẠI trước khi thu tiền — hoá đơn có thể đã tăng version do phiếu xuất kho
   * cộng thêm dòng (`appendLines`) trước khi test này gọi tới, KHÔNG được hardcode `version: 1`. */
  async function payInvoice(encounterId: string, token = receptionistToken) {
    const current = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounterId}`).set(authed(token));
    const payRes = await request(app.getHttpServer())
      .post(`/api/v1/billing/invoices/${encounterId}/pay`)
      .set(authed(token))
      .send({ method: 'CASH', version: current.body.data.version });
    expect(payRes.status).toBe(200);
  }

  /** Tạo appointment + patient + check-in + "Bắt đầu khám" + chẩn đoán chính — sẵn sàng để kê đơn. Trả về encounter CHƯA thu tiền (để test có thể tự quyết định thu hay không). */
  async function prepareEncounterInConsultation(hour: number, minute = 0) {
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId: doctorUserId, fullName: 'Khách e2e phát thuốc', phone: '0911222999', scheduledAt: new Date(Date.UTC(2026, 7, 29, hour, minute, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };

    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e phát thuốc', dob: '1985-01-01', gender: 'male', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
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
        // "Bắt đầu khám" bị chặn (409 ENCOUNTER_PAYMENT_REQUIRED) khi còn phiếu thu UNPAID — bật
        // "Thanh toán sau" (tenant đã cấu hình `deferredPaymentEnabled=true` ở `beforeAll`) để hoá
        // đơn dịch vụ khám CỐ Ý GIỮ UNPAID lúc phát thuốc, đúng kịch bản cần kiểm ("cộng vào hoá
        // đơn SERVICE đang mở") — khác `prescription-http.spec.ts` (thu tiền ngay, không quan tâm
        // hoá đơn còn mở hay không vì không kiểm billing).
        allowsDeferredPayment: true,
      });
    const encounterId = checkInRes.body.data.id as string;

    const startRes = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    expect(startRes.status).toBe(200);
    await request(app.getHttpServer()).put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(doctorToken)).send({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' as const }] });

    return { encounterId, patientId: patient.id };
  }

  /** Kê + ký đơn với 1 dòng thuốc `drugId`/`quantity` — trả về `prescriptionId` + `prescriptionItemId`. */
  async function signPrescription(encounterId: string, lines: { drugId: string; quantity: number }[]) {
    const saveRes = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorToken))
      .send({ items: lines.map((l) => ({ drugId: l.drugId, dose: '1 viên', frequency: '2 lần/ngày', durationDays: 5, quantity: l.quantity })) });
    expect(saveRes.status).toBe(200);
    const signRes = await request(app.getHttpServer())
      .post(`/api/v1/encounters/${encounterId}/prescription/sign`)
      .set(authed(doctorToken))
      .send({ version: saveRes.body.data.version });
    expect(signRes.status).toBe(200);
    return { prescriptionId: signRes.body.data.id as string, items: signRes.body.data.items as { id: string; drugId: string }[] };
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

    fixture = await createTwoTenantFixture(privileged, 'StockIssue e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    const warehousesRes = await request(app.getHttpServer()).get('/api/v1/warehouses').set(authed(clinicAdminToken));
    warehouseId = warehousesRes.body.data.items[0].id;

    // Bật "Thanh toán sau" cấp phòng khám — cần thiết để `prepareEncounterInConsultation()` giữ hoá
    // đơn dịch vụ khám UNPAID lúc phát thuốc (xem comment trong hàm đó).
    await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ deferredPaymentEnabled: true });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/issues');
    expect(res.status).toBe(401);
  });

  it('lễ tân (chỉ stock_issue.read) → tạo phiếu 403, xem danh sách 200', async () => {
    const list = await request(app.getHttpServer()).get('/api/v1/inventory/issues').set(authed(receptionistToken));
    expect(list.status).toBe(200);
    const createRes = await request(app.getHttpServer()).post('/api/v1/inventory/issues').set(authed(receptionistToken)).send({ prescriptionId: randomUUID(), warehouseId, lines: [] });
    expect(createRes.status).toBe(403);
  });

  it('phát ĐỦ tồn (1 lô) — trừ đúng tồn kho + cộng vào hoá đơn SERVICE đang mở, KHÔNG tự tạo hoá đơn DRUG riêng', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Amoxicillin 500mg', defaultSellPrice: 3000 });
    const batchId = await receiveStock(clinicAdminToken, drugId, 100, 1000);
    const { encounterId } = await prepareEncounterInConsultation(6);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 20 }]);

    const issueRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 20 }] });
    expect(issueRes.status).toBe(200);
    expect(issueRes.body.data.status).toBe('POSTED');
    expect(issueRes.body.data.totalAmount).toBe(60_000);
    expect(issueRes.body.data.lines).toHaveLength(1);

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row.quantityOnHand).toBe(80);

    const invoiceRes = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
    expect(invoiceRes.status).toBe(200);
    // 150_000 (khám) + 60_000 (thuốc) — cộng chung 1 hoá đơn SERVICE, KHÔNG tách riêng (mặc định
    // pharmacySeparateInvoiceEnabled=false).
    expect(invoiceRes.body.data.totalAmount).toBe(210_000);
    expect(invoiceRes.body.data.lines).toHaveLength(2);
    const drugLine = invoiceRes.body.data.lines.find((l: { examTypeName: string }) => l.examTypeName === 'Amoxicillin 500mg');
    expect(drugLine).toMatchObject({ quantity: 20, unitPrice: 3000, lineTotal: 60_000 });
  });

  it('phát VƯỢT số lượng còn lại của đơn → 422 STOCK_ISSUE_EXCEEDS_PRESCRIBED_QUANTITY (chặn cứng)', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Vitamin C 1000mg' });
    await receiveStock(clinicAdminToken, drugId, 100, 500);
    const { encounterId } = await prepareEncounterInConsultation(7);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 10 }]);

    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, quantity: 11 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STOCK_ISSUE_EXCEEDS_PRESCRIBED_QUANTITY');
  });

  it('phát THIẾU tồn (kê trong hạn mức nhưng kho không đủ) → 422 STOCK_ISSUE_INSUFFICIENT_STOCK', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc ho Prospan' });
    const batchId = await receiveStock(clinicAdminToken, drugId, 5, 2000);
    const { encounterId } = await prepareEncounterInConsultation(8);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 20 }]);

    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 10 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STOCK_ISSUE_INSUFFICIENT_STOCK');
  });

  it('thuốc KHÔNG quản lý theo lô (isBatchManaged=false) — phát không cần batchId, bình quân gia quyền', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Cồn y tế 90 độ', isBatchManaged: false, defaultSellPrice: 500 });
    await receiveStock(clinicAdminToken, drugId, 50, 200, { openingBalance: true });
    const { encounterId } = await prepareEncounterInConsultation(9);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 5 }]);

    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, quantity: 5 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0].batchId).toBeNull();
    expect(res.body.data.totalAmount).toBe(2500);
  });

  it('nhiều lô — gợi ý FEFO sắp đúng theo hạn dùng (lô sắp hết hạn trước)', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Panadol Extra' });
    await receiveStock(clinicAdminToken, drugId, 10, 1000, { batchNo: `FAR-${randomUUID().slice(0, 6)}`, expiryDate: '2028-01-01' });
    await receiveStock(clinicAdminToken, drugId, 10, 1000, { batchNo: `NEAR-${randomUUID().slice(0, 6)}`, expiryDate: '2026-12-01' });
    const { encounterId } = await prepareEncounterInConsultation(10);
    const { prescriptionId } = await signPrescription(encounterId, [{ drugId, quantity: 5 }]);

    const statusRes = await request(app.getHttpServer()).get(`/api/v1/inventory/prescriptions/${prescriptionId}/dispense-status`).set(authed(doctorToken)).query({ warehouseId });
    expect(statusRes.status).toBe(200);
    const line = statusRes.body.data.lines[0];
    expect(line.prescribedQuantity).toBe(5);
    expect(line.remainingQuantity).toBe(5);
    expect(line.suggestedBatches).toHaveLength(2);
    expect(line.suggestedBatches[0].expiryDate).toBe('2026-12-01');
    expect(line.suggestedBatches[1].expiryDate).toBe('2028-01-01');
  });

  it('1 request gửi NHIỀU dòng cùng 1 thuốc kê (tách nhiều lô, #165) — cộng dồn đúng, thành công khi tổng không vượt số đã kê lẫn tồn từng lô', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Cefixim 200mg (tách lô)' });
    const batchA = await receiveStock(clinicAdminToken, drugId, 10, 1000, { batchNo: `SPLIT-A-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' });
    const batchB = await receiveStock(clinicAdminToken, drugId, 10, 1000, { batchNo: `SPLIT-B-${randomUUID().slice(0, 6)}`, expiryDate: '2027-06-01' });
    const { encounterId } = await prepareEncounterInConsultation(11);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 15 }]);

    // Kê 15, lô A chỉ có 10 — tách 10 (lô A) + 5 (lô B) trong CÙNG 1 request, đúng cách
    // `DispensePrescriptionDialog.tsx` tự gợi ý (`autoSplitFefo`).
    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({
        prescriptionId,
        warehouseId,
        lines: [
          { prescriptionItemId: items[0]!.id, drugId, batchId: batchA, quantity: 10 },
          { prescriptionItemId: items[0]!.id, drugId, batchId: batchB, quantity: 5 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.lines).toHaveLength(2);
    expect(res.body.data.totalAmount).toBe(15 * 2000);

    const statusRes = await request(app.getHttpServer()).get(`/api/v1/inventory/prescriptions/${prescriptionId}/dispense-status`).set(authed(doctorToken)).query({ warehouseId });
    expect(statusRes.body.data.lines[0].dispensedQuantity).toBe(15);
    expect(statusRes.body.data.lines[0].remainingQuantity).toBe(0);
  });

  it('1 request gửi NHIỀU dòng cùng 1 thuốc kê nhưng TỔNG vượt số đã kê (dù từng dòng riêng lẻ đều hợp lệ, đủ tồn) → 422 STOCK_ISSUE_EXCEEDS_PRESCRIBED_QUANTITY (#165, chặn cộng dồn trong CÙNG request)', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Cefixim 200mg (vượt kê cộng dồn)' });
    const batchA = await receiveStock(clinicAdminToken, drugId, 20, 1000, { batchNo: `OVER-A-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' });
    const batchB = await receiveStock(clinicAdminToken, drugId, 20, 1000, { batchNo: `OVER-B-${randomUUID().slice(0, 6)}`, expiryDate: '2027-06-01' });
    const { encounterId } = await prepareEncounterInConsultation(11, 30);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 15 }]);

    // Kê 15 — mỗi dòng 10 (từng dòng riêng lẻ đều ≤ 15, đủ tồn ở CẢ 2 lô) nhưng TỔNG 20 > 15 đã kê.
    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({
        prescriptionId,
        warehouseId,
        lines: [
          { prescriptionItemId: items[0]!.id, drugId, batchId: batchA, quantity: 10 },
          { prescriptionItemId: items[0]!.id, drugId, batchId: batchB, quantity: 10 },
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STOCK_ISSUE_EXCEEDS_PRESCRIBED_QUANTITY');

    // Không tạo phiếu/không trừ kho gì cả — toàn bộ request bị từ chối trong CÙNG 1 transaction.
    const statusRes = await request(app.getHttpServer()).get(`/api/v1/inventory/prescriptions/${prescriptionId}/dispense-status`).set(authed(doctorToken)).query({ warehouseId });
    expect(statusRes.body.data.lines[0].dispensedQuantity).toBe(0);
  });

  it('1 request gửi NHIỀU dòng CÙNG 1 lô (không chỉ cùng thuốc) với tổng vượt tồn thật của lô đó → 422 STOCK_ISSUE_INSUFFICIENT_STOCK (#165, chặn cộng dồn theo lô)', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Cefixim 200mg (trùng lô vượt tồn)' });
    const batchId = await receiveStock(clinicAdminToken, drugId, 15, 1000, { batchNo: `DUP-${randomUUID().slice(0, 6)}`, expiryDate: '2027-01-01' });
    const { encounterId } = await prepareEncounterInConsultation(12);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 20 }]);

    // Lô chỉ có 15 — gửi 2 dòng CÙNG lô đó, mỗi dòng 10 (từng dòng riêng lẻ ≤ 15) nhưng tổng 20 > 15.
    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({
        prescriptionId,
        warehouseId,
        lines: [
          { prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 10 },
          { prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 10 },
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STOCK_ISSUE_INSUFFICIENT_STOCK');
  });

  it('hàng OTC (không theo đơn) — chỉ cho phép khi drug.isPrescriptionOnly=false, chặn ngược lại', async () => {
    const rxDrugId = await createDrug(clinicAdminToken, { name: 'Amoxicillin OTC test', isPrescriptionOnly: true });
    await receiveStock(clinicAdminToken, rxDrugId, 20, 1000);
    // isBatchManaged=false — không cần chọn batchId, giữ test gọn (đúng khuôn "thuốc KHÔNG quản lý theo lô" ở trên).
    const otcDrugId = await createDrug(clinicAdminToken, { name: 'Cốm bổ sung kẽm', isPrescriptionOnly: false, isBatchManaged: false, defaultSellPrice: 15_000 });
    await receiveStock(clinicAdminToken, otcDrugId, 20, 5000, { openingBalance: true });

    const { encounterId } = await prepareEncounterInConsultation(11);
    const { prescriptionId } = await signPrescription(encounterId, [{ drugId: rxDrugId, quantity: 5 }]);

    const rejectRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: null, drugId: rxDrugId, quantity: 1 }] });
    expect(rejectRes.status).toBe(422);
    expect(rejectRes.body.error.code).toBe('STOCK_ISSUE_OTC_REQUIRES_NON_PRESCRIPTION_DRUG');

    const okRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: null, drugId: otcDrugId, quantity: 2 }] });
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.lines[0].prescriptionItemId).toBeNull();
    expect(okRes.body.data.totalAmount).toBe(30_000);
  });

  it('huỷ phiếu xuất — hoàn đúng tồn kho + xoá đúng invoice_line + giảm lại totalAmount hoá đơn', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Loratadine 10mg', defaultSellPrice: 1000 });
    const batchId = await receiveStock(clinicAdminToken, drugId, 30, 300);
    const { encounterId } = await prepareEncounterInConsultation(12);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 10 }]);

    const issueRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 10 }] });
    expect(issueRes.status).toBe(200);
    const issueId = issueRes.body.data.id as string;

    const invoiceBefore = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
    expect(invoiceBefore.body.data.totalAmount).toBe(160_000); // 150_000 + 10_000

    const voidRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/issues/${issueId}/void`)
      .set(authed(doctorToken))
      .send({ reason: 'Phát nhầm thuốc', version: issueRes.body.data.version });
    expect(voidRes.status).toBe(200);
    expect(voidRes.body.data.status).toBe('VOIDED');

    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row.quantityOnHand).toBe(30); // hoàn đủ lại

    const invoiceAfter = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
    expect(invoiceAfter.body.data.totalAmount).toBe(150_000);
    expect(invoiceAfter.body.data.lines.find((l: { examTypeName: string }) => l.examTypeName === 'Loratadine 10mg')).toBeUndefined();

    // Huỷ lại phiếu đã huỷ → chặn (không còn POSTED).
    const voidAgain = await request(app.getHttpServer())
      .post(`/api/v1/inventory/issues/${issueId}/void`)
      .set(authed(doctorToken))
      .send({ reason: 'thử lại', version: voidRes.body.data.version });
    expect(voidAgain.status).toBe(409);
    expect(voidAgain.body.error.code).toBe('STOCK_ISSUE_VOID_NOT_ALLOWED');
  });

  it('huỷ phiếu xuất khi hoá đơn liên quan ĐÃ THU tiền → 409 STOCK_ISSUE_VOID_NOT_ALLOWED (phải hoàn tiền thay vì huỷ)', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Cetirizine 10mg', defaultSellPrice: 800 });
    const batchId = await receiveStock(clinicAdminToken, drugId, 30, 300);
    const { encounterId } = await prepareEncounterInConsultation(13);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 5 }]);

    const issueRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 5 }] });
    expect(issueRes.status).toBe(200);

    await payInvoice(encounterId);

    const voidRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/issues/${issueRes.body.data.id}/void`)
      .set(authed(doctorToken))
      .send({ reason: 'thử huỷ sau khi đã thu', version: issueRes.body.data.version });
    expect(voidRes.status).toBe(409);
    expect(voidRes.body.error.code).toBe('STOCK_ISSUE_VOID_NOT_ALLOWED');
  });

  it('2 request đồng thời cùng lô, tổng vượt tồn → đúng 1 thành công, 1 báo thiếu tồn (khoá tay chống race)', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Race test drug' });
    const batchId = await receiveStock(clinicAdminToken, drugId, 10, 1000);
    const { encounterId: encA } = await prepareEncounterInConsultation(14, 0);
    const { encounterId: encB } = await prepareEncounterInConsultation(14, 30);
    const { prescriptionId: rxA, items: itemsA } = await signPrescription(encA, [{ drugId, quantity: 8 }]);
    const { prescriptionId: rxB, items: itemsB } = await signPrescription(encB, [{ drugId, quantity: 8 }]);

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(doctorToken))
        .send({ prescriptionId: rxA, warehouseId, lines: [{ prescriptionItemId: itemsA[0]!.id, drugId, batchId, quantity: 6 }] }),
      request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(doctorToken))
        .send({ prescriptionId: rxB, warehouseId, lines: [{ prescriptionItemId: itemsB[0]!.id, drugId, batchId, quantity: 6 }] }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 422]);
    const balanceRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    const row = balanceRes.body.data.items.find((i: { drugId: string }) => i.drugId === drugId);
    expect(row.quantityOnHand).toBe(4); // 10 - 6, chỉ 1 phiếu thành công
  });

  it('bật pharmacySeparateInvoiceEnabled → tự tạo hoá đơn DRUG riêng, KHÔNG cộng vào hoá đơn SERVICE', async () => {
    const toggleOn = await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ pharmacySeparateInvoiceEnabled: true });
    expect(toggleOn.status).toBe(200);
    try {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc hoá đơn riêng', defaultSellPrice: 4000 });
      const batchId = await receiveStock(clinicAdminToken, drugId, 20, 1000);
      const { encounterId } = await prepareEncounterInConsultation(15);
      const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 3 }]);

      const issueRes = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(doctorToken))
        .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 3 }] });
      expect(issueRes.status).toBe(200);

      const serviceInvoiceRes = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
      expect(serviceInvoiceRes.body.data.totalAmount).toBe(150_000); // KHÔNG cộng tiền thuốc vào đây

      const drugInvoice = await privileged.invoice.findFirst({ where: { tenantId: fixture.tenantA.id, encounterId, invoiceType: 'DRUG' } });
      expect(drugInvoice).not.toBeNull();
      expect(Number(drugInvoice!.totalAmount)).toBe(12_000);
    } finally {
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ pharmacySeparateInvoiceEnabled: false });
    }
  });

  it('cách ly tenant — tenant B xem/huỷ phiếu xuất của tenant A → 404', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Cách ly tenant test' });
    const batchId = await receiveStock(clinicAdminToken, drugId, 10, 1000);
    const { encounterId } = await prepareEncounterInConsultation(16);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 2 }]);
    const issueRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 2 }] });
    expect(issueRes.status).toBe(200);

    const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/issues/${issueRes.body.data.id}`).set(authed(tenantBAdminToken));
    expect(getRes.status).toBe(404);
    const voidRes = await request(app.getHttpServer()).post(`/api/v1/inventory/issues/${issueRes.body.data.id}/void`).set(authed(tenantBAdminToken)).send({ reason: 'x', version: 1 });
    expect(voidRes.status).toBe(404);
  });

  it('"Phát thuốc" — hàng đợi đúng đơn còn thuốc chưa phát hết, biến mất khi phát đủ', async () => {
    const drugId = await createDrug(clinicAdminToken, { name: 'Hàng đợi phát thuốc test' });
    const batchId = await receiveStock(clinicAdminToken, drugId, 20, 1000);
    const { encounterId } = await prepareEncounterInConsultation(17);
    const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 10 }]);

    const queueBefore = await request(app.getHttpServer()).get('/api/v1/inventory/dispense-queue').set(authed(doctorToken));
    expect(queueBefore.status).toBe(200);
    expect(queueBefore.body.data.items.some((i: { prescriptionId: string }) => i.prescriptionId === prescriptionId)).toBe(true);

    await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 10 }] });

    const queueAfter = await request(app.getHttpServer()).get('/api/v1/inventory/dispense-queue').set(authed(doctorToken));
    expect(queueAfter.body.data.items.some((i: { prescriptionId: string }) => i.prescriptionId === prescriptionId)).toBe(false);
  });
});
