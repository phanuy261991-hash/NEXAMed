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

  /** Nhập kho + Duyệt ngay — trả về `batchId` (hoặc `null` nếu `isBatchManaged=false`). `opts.warehouseId`
   * mặc định kho chung của tenant, override được cho test phân quyền Khoa/Phòng (retrofit #173). */
  async function receiveStock(token: string, drugId: string, quantity: number, unitCost: number, opts: { batchNo?: string; expiryDate?: string; openingBalance?: boolean; warehouseId?: string } = {}) {
    const targetWarehouseId = opts.warehouseId ?? warehouseId;
    const body = opts.openingBalance
      ? { warehouseId: targetWarehouseId, receiptType: 'OPENING_BALANCE' as const, lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost }] }
      : {
          warehouseId: targetWarehouseId,
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

    const balancesRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(token)).query({ warehouseId: targetWarehouseId });
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

    // `warehouseStockOnHand` — tồn kho THẬT, tách biệt hoàn toàn với `remainingQuantity` (còn lại
    // theo đơn) — tránh nhầm lẫn thật đã gặp (báo "không đủ tồn" dù đơn "còn lại" khớp).
    const beforeStatus = await request(app.getHttpServer()).get(`/api/v1/inventory/prescriptions/${prescriptionId}/dispense-status`).set(authed(doctorToken)).query({ warehouseId });
    expect(beforeStatus.body.data.lines[0].warehouseStockOnHand).toBe(50);
    expect(beforeStatus.body.data.lines[0].remainingQuantity).toBe(5);
    // "Mã đơn thuốc thật" (#169) — khối thông tin đầu dialog "Phát thuốc".
    expect(beforeStatus.body.data.prescriptionNo).toMatch(/^DT\d{10}$/);
    expect(beforeStatus.body.data.signedByName).toBeTruthy();
    expect(beforeStatus.body.data.diagnosisLabel).toBeTruthy();
    // Rà soát 22/09/2026 — dialog trước đây không hiện đang phát cho bệnh nhân nào.
    expect(beforeStatus.body.data.patientFullName).toBeTruthy();
    expect(beforeStatus.body.data.patientCode).toMatch(/^BN\d{10}$/);

    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, quantity: 5 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0].batchId).toBeNull();
    expect(res.body.data.totalAmount).toBe(2500);

    const afterStatus = await request(app.getHttpServer()).get(`/api/v1/inventory/prescriptions/${prescriptionId}/dispense-status`).set(authed(doctorToken)).query({ warehouseId });
    expect(afterStatus.body.data.lines[0].warehouseStockOnHand).toBe(45);
    expect(afterStatus.body.data.lines[0].remainingQuantity).toBe(0);
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
    // `warehouseStockOnHand` cho hàng quản lý theo lô = TỔNG mọi lô (10+10), không phải riêng 1 lô.
    expect(line.warehouseStockOnHand).toBe(20);
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

  /** Retrofit phân quyền theo Khoa/Phòng cho `stock_issue` (docs/DECISIONS.md #173, đúng khuôn
   * `stock-count-http.spec.ts`/`inventory-http.spec.ts` — `getDispenseStatus()`/`listDispenseQueue()`
   * CHỦ ĐỘNG không scope, xem comment trong `StockIssueService`). */
  describe('Phân quyền theo Khoa/Phòng (retrofit #173)', () => {
    let deptAId: string;
    let deptAToken: string;
    let deptAUserId: string;
    let deptAWarehouseId: string;
    let otherWarehouseId: string;

    beforeAll(async () => {
      const deptARes = await request(app.getHttpServer()).post('/api/v1/departments').set(authed(clinicAdminToken)).send({ name: `Khoa Dược e2e ${randomUUID().slice(0, 6)}` });
      deptAId = deptARes.body.data.id as string;

      const whARes = await request(app.getHttpServer()).post('/api/v1/warehouses').set(authed(clinicAdminToken)).send({ name: `Kho Khoa A ${randomUUID().slice(0, 6)}`, departmentId: deptAId });
      deptAWarehouseId = whARes.body.data.id as string;
      otherWarehouseId = warehouseId;

      const rolesRes = await request(app.getHttpServer()).get('/api/v1/roles').set(authed(clinicAdminToken));
      const clinicAdminRole = rolesRes.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
      const matrixRes = await request(app.getHttpServer()).get(`/api/v1/roles/${clinicAdminRole.id}/permissions`).set(authed(clinicAdminToken));
      const newRole = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(clinicAdminToken)).send({ name: `Dược Khoa e2e ${randomUUID().slice(0, 6)}` });
      const entries = (matrixRes.body.data.permissions as { permissionId: string; module: string; action: string; dataScope: string }[])
        .filter((e) => e.dataScope !== 'none')
        .map((e) => ({ permissionId: e.permissionId, dataScope: e.module === 'stock_issue' ? 'department' : e.dataScope }));
      await request(app.getHttpServer()).put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(clinicAdminToken)).send({ entries });

      const username = `e2e-issue-deptA-${randomUUID()}`;
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const user = await privileged.userAccount.create({
        data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: 'Dược sĩ Khoa A', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: newRole.body.data.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      await privileged.userAccount.update({ where: { id: user.id }, data: { departmentId: deptAId } });

      const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
      deptAToken = login.body.data.accessToken as string;
      deptAUserId = user.id;
    });

    it('phát thuốc từ đúng kho của Khoa mình — thành công', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc Khoa A' });
      const batchId = await receiveStock(clinicAdminToken, drugId, 20, 1000, { warehouseId: deptAWarehouseId });
      const { encounterId } = await prepareEncounterInConsultation(20);
      const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 5 }]);

      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(deptAToken))
        .send({ prescriptionId, warehouseId: deptAWarehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 5 }] });
      expect(res.status).toBe(200);
    });

    it('phát thuốc từ kho NGOÀI Khoa mình — 404 (không phải 403)', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc Khoa A #2' });
      const batchId = await receiveStock(clinicAdminToken, drugId, 20, 1000, { warehouseId: otherWarehouseId });
      const { encounterId } = await prepareEncounterInConsultation(20, 15);
      const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 5 }]);

      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(deptAToken))
        .send({ prescriptionId, warehouseId: otherWarehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 5 }] });
      expect(res.status).toBe(404);
    });

    it('xem/huỷ phiếu xuất do bác sĩ (global) tạo ở kho NGOÀI Khoa mình — 404', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc Khoa A #3' });
      const batchId = await receiveStock(clinicAdminToken, drugId, 20, 1000, { warehouseId: otherWarehouseId });
      const { encounterId } = await prepareEncounterInConsultation(20, 30);
      const { prescriptionId, items } = await signPrescription(encounterId, [{ drugId, quantity: 5 }]);
      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(doctorToken))
        .send({ prescriptionId, warehouseId: otherWarehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity: 5 }] });
      expect(created.status).toBe(200);

      const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/issues/${created.body.data.id}`).set(authed(deptAToken));
      expect(getRes.status).toBe(404);

      const voidRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/${created.body.data.id}/void`)
        .set(authed(deptAToken))
        .send({ version: created.body.data.version, reason: 'Thử huỷ ngoài Khoa' });
      expect(voidRes.status).toBe(404);
    });

    it('danh sách chỉ trả phiếu thuộc kho của Khoa mình', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc Khoa A #4' });
      const batchOwn = await receiveStock(clinicAdminToken, drugId, 10, 1000, { warehouseId: deptAWarehouseId });
      const batchOther = await receiveStock(clinicAdminToken, drugId, 10, 1000, { warehouseId: otherWarehouseId });
      const own = await prepareEncounterInConsultation(21);
      const ownPrescription = await signPrescription(own.encounterId, [{ drugId, quantity: 1 }]);
      const ownIssue = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(deptAToken))
        .send({ prescriptionId: ownPrescription.prescriptionId, warehouseId: deptAWarehouseId, lines: [{ prescriptionItemId: ownPrescription.items[0]!.id, drugId, batchId: batchOwn, quantity: 1 }] });
      const other = await prepareEncounterInConsultation(21, 15);
      const otherPrescription = await signPrescription(other.encounterId, [{ drugId, quantity: 1 }]);
      const otherIssue = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues')
        .set(authed(doctorToken))
        .send({ prescriptionId: otherPrescription.prescriptionId, warehouseId: otherWarehouseId, lines: [{ prescriptionItemId: otherPrescription.items[0]!.id, drugId, batchId: batchOther, quantity: 1 }] });

      const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/issues').set(authed(deptAToken));
      const ids = (listRes.body.data.items as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(ownIssue.body.data.id);
      expect(ids).not.toContain(otherIssue.body.data.id);
    });

    it('actor scope department nhưng CHƯA gán Khoa/Phòng → danh sách rỗng, không lỗi', async () => {
      await privileged.userAccount.update({ where: { id: deptAUserId }, data: { departmentId: null } });
      const listRes = await request(app.getHttpServer()).get('/api/v1/inventory/issues').set(authed(deptAToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.items).toEqual([]);
      await privileged.userAccount.update({ where: { id: deptAUserId }, data: { departmentId: deptAId } });
    });
  });

  /**
   * "Phiếu xuất kho mở rộng" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — 3 loại Nháp→Duyệt lập tay
   * (Xuất dùng nội bộ/Xuất trả NCC/Xuất huỷ), khác hẳn "Phát thuốc" (1 bước, luồng test ở trên).
   */
  describe('Phiếu xuất kho mở rộng — Nháp→Duyệt (docs/DECISIONS.md #170)', () => {
    let manualDeptId: string;

    beforeAll(async () => {
      const deptRes = await request(app.getHttpServer()).post('/api/v1/departments').set(authed(clinicAdminToken)).send({ name: `Khoa tiếp nhận e2e ${randomUUID().slice(0, 6)}` });
      manualDeptId = deptRes.body.data.id as string;
    });

    it('INTERNAL_ALLOCATION thiếu departmentId → 400 (Zod)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'INTERNAL_ALLOCATION', warehouseId, note: 'Cấp vật tư', lines: [{ drugId: randomUUID(), quantity: 1 }] });
      expect(res.status).toBe(400);
    });

    it('WRITE_OFF kèm departmentId → 400 (loại này không có Khoa/Phòng tiếp nhận)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'WRITE_OFF', warehouseId, departmentId: manualDeptId, note: 'Hỏng do bảo quản sai', lines: [{ drugId: randomUUID(), quantity: 1 }] });
      expect(res.status).toBe(400);
    });

    it('thiếu Lý do → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'WRITE_OFF', warehouseId, note: '', lines: [{ drugId: randomUUID(), quantity: 1 }] });
      expect(res.status).toBe(400);
    });

    it('lễ tân (không có stock_issue.create) → 403 tạo Nháp', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(receptionistToken))
        .send({ issueType: 'WRITE_OFF', warehouseId, note: 'Thử tạo', lines: [{ drugId: randomUUID(), quantity: 1 }] });
      expect(res.status).toBe(403);
    });

    it('tạo Nháp INTERNAL_ALLOCATION hợp lệ → status DRAFT, chưa đụng tồn kho', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Cồn sát khuẩn e2e', isBatchManaged: false, isPrescriptionOnly: false });
      await receiveStock(clinicAdminToken, drugId, 50, 5000, { openingBalance: true });

      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'INTERNAL_ALLOCATION', warehouseId, departmentId: manualDeptId, note: 'Cấp cồn sát khuẩn tuần này', lines: [{ drugId, quantity: 10 }] });
      expect(created.status).toBe(200);
      expect(created.body.data.status).toBe('DRAFT');
      expect(created.body.data.departmentId).toBe(manualDeptId);
      expect(created.body.data.issueNo).toMatch(/^PXK/);

      const balancesRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
      const bal = (balancesRes.body.data.items as { drugId: string; quantityOnHand: number }[]).find((b) => b.drugId === drugId);
      expect(bal?.quantityOnHand).toBe(50);
    });

    it('bác sĩ (có create, KHÔNG có approve) → sửa Nháp OK, Duyệt 403', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Băng gạc e2e', isBatchManaged: false, isPrescriptionOnly: false });
      await receiveStock(clinicAdminToken, drugId, 30, 2000, { openingBalance: true });
      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(doctorToken))
        .send({ issueType: 'WRITE_OFF', warehouseId, note: 'Hỏng do ẩm mốc', lines: [{ drugId, quantity: 5 }] });
      expect(created.status).toBe(200);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/inventory/issues/manual/${created.body.data.id}`)
        .set(authed(doctorToken))
        .send({ issueType: 'WRITE_OFF', warehouseId, note: 'Hỏng do ẩm mốc — cập nhật', lines: [{ drugId, quantity: 6 }], version: created.body.data.version });
      expect(updated.status).toBe(200);
      expect(updated.body.data.note).toBe('Hỏng do ẩm mốc — cập nhật');

      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`)
        .set(authed(doctorToken))
        .send({ version: updated.body.data.version });
      expect(approveRes.status).toBe(403);
    });

    it('Duyệt thiếu tồn → 422 STOCK_ISSUE_INSUFFICIENT_STOCK, không đổi trạng thái', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Vitamin C e2e', isBatchManaged: false, isPrescriptionOnly: false });
      await receiveStock(clinicAdminToken, drugId, 5, 1000, { openingBalance: true });
      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'RETURN_TO_SUPPLIER', warehouseId, supplierId: await ensureSupplier(clinicAdminToken), note: 'Trả hàng lỗi NCC', lines: [{ drugId, quantity: 100 }] });
      expect(created.status).toBe(200);

      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: created.body.data.version });
      expect(approveRes.status).toBe(422);
      expect(approveRes.body.error.code).toBe('STOCK_ISSUE_INSUFFICIENT_STOCK');

      const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/issues/${created.body.data.id}`).set(authed(clinicAdminToken));
      expect(getRes.body.data.status).toBe('DRAFT');
    });

    it('Duyệt đủ tồn → POSTED, trừ đúng tồn kho + ghi thẻ kho reason ISSUE_INTERNAL_ALLOCATION, KHÔNG gắn tiền', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Khẩu trang y tế e2e', isBatchManaged: false, isPrescriptionOnly: false });
      await receiveStock(clinicAdminToken, drugId, 200, 500, { openingBalance: true });
      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'INTERNAL_ALLOCATION', warehouseId, departmentId: manualDeptId, note: 'Cấp khẩu trang', lines: [{ drugId, quantity: 50 }] });

      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: created.body.data.version });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('POSTED');
      expect(approveRes.body.data.approvedByName).toBeTruthy();
      expect(approveRes.body.data.lines[0].sellPrice).toBe(0);
      expect(approveRes.body.data.lines[0].lineAmount).toBe(0);
      expect(approveRes.body.data.totalAmount).toBe(0);

      const balancesRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
      const bal = (balancesRes.body.data.items as { drugId: string; quantityOnHand: number }[]).find((b) => b.drugId === drugId);
      expect(bal?.quantityOnHand).toBe(150);

      const ledgerRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/ledger`).set(authed(clinicAdminToken)).query({ warehouseId });
      const entry = (ledgerRes.body.data.items as { reason: string; quantityChange: number; sourceIssueNo: string | null }[]).find((e) => e.reason === 'ISSUE_INTERNAL_ALLOCATION');
      expect(entry?.quantityChange).toBe(-50);
      expect(entry?.sourceIssueNo).toBe(approveRes.body.data.issueNo);
    });

    it('Từ chối Nháp → REJECTED, không đụng tồn kho', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Bông y tế e2e', isBatchManaged: false, isPrescriptionOnly: false });
      await receiveStock(clinicAdminToken, drugId, 40, 300, { openingBalance: true });
      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'WRITE_OFF', warehouseId, note: 'Hết hạn dùng', lines: [{ drugId, quantity: 10 }] });

      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/reject`)
        .set(authed(clinicAdminToken))
        .send({ version: created.body.data.version, reason: 'Chưa đủ chứng từ' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('REJECTED');
      expect(rejectRes.body.data.rejectionReason).toBe('Chưa đủ chứng từ');

      const balancesRes = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
      const bal = (balancesRes.body.data.items as { drugId: string; quantityOnHand: number }[]).find((b) => b.drugId === drugId);
      expect(bal?.quantityOnHand).toBe(40);
    });

    it('Huỷ phiếu ĐÃ DUYỆT (POSTED, loại mở rộng) — đảo NGƯỢC đúng tồn kho (hồi quy: listForSourceIssue trước đây chỉ lọc reason ISSUE_RETAIL_SALE, âm thầm không đảo gì cho loại mới)', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Gel rửa tay e2e', isBatchManaged: false, isPrescriptionOnly: false });
      await receiveStock(clinicAdminToken, drugId, 80, 4000, { openingBalance: true });
      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'INTERNAL_ALLOCATION', warehouseId, departmentId: manualDeptId, note: 'Cấp gel rửa tay', lines: [{ drugId, quantity: 30 }] });
      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: created.body.data.version });
      expect(approveRes.status).toBe(200);

      const afterApprove = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
      expect((afterApprove.body.data.items as { drugId: string; quantityOnHand: number }[]).find((b) => b.drugId === drugId)?.quantityOnHand).toBe(50);

      const voidRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/${created.body.data.id}/void`)
        .set(authed(clinicAdminToken))
        .send({ version: approveRes.body.data.version, reason: 'Lập nhầm phiếu' });
      expect(voidRes.status).toBe(200);
      expect(voidRes.body.data.status).toBe('VOIDED');

      // Đây chính là hồi quy: TRƯỚC khi sửa `StockLedgerRepository.listForSourceIssue()`, tồn kho sẽ
      // DỪNG LẠI ở 50 (không đảo ngược gì) thay vì quay về đúng 80.
      const afterVoid = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
      expect((afterVoid.body.data.items as { drugId: string; quantityOnHand: number }[]).find((b) => b.drugId === drugId)?.quantityOnHand).toBe(80);
    });

    it('tenant B không tạo/duyệt được phiếu bằng ID của tenant A → 404', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Thuốc tenant A e2e', isBatchManaged: false, isPrescriptionOnly: false });
      await receiveStock(clinicAdminToken, drugId, 20, 1000, { openingBalance: true });
      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'WRITE_OFF', warehouseId, note: 'Hỏng', lines: [{ drugId, quantity: 5 }] });

      const getRes = await request(app.getHttpServer()).get(`/api/v1/inventory/issues/${created.body.data.id}`).set(authed(tenantBAdminToken));
      expect(getRes.status).toBe(404);
      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`)
        .set(authed(tenantBAdminToken))
        .send({ version: created.body.data.version });
      expect(approveRes.status).toBe(404);
    });
  });

  /**
   * "Công nợ nhà cung cấp" Phần C — "Trả hàng NCC" (docs/DECISIONS.md #180/#182, kế hoạch kỹ thuật
   * supplier-debt-cong-no-ncc.md mục 8). Gắn NCC + tiền vào `RETURN_TO_SUPPLIER` (trước đó chỉ khai
   * enum, `supplierId`/`totalAmount` luôn null/0) — Duyệt ghi bút toán RETURN vào sổ công nợ.
   */
  describe('Công nợ nhà cung cấp Phần C — Xuất trả NCC (docs/DECISIONS.md #180/#182)', () => {
    /** NCC RIÊNG cho mỗi test (khác `ensureSupplier()` dùng chung/cache cho cả file) — test số dư
     * công nợ cần 1 NCC "sạch", không lẫn phát sinh nợ từ các test khác trong cùng file. */
    async function createSupplier() {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set(authed(clinicAdminToken))
        .send({ name: `NCC Phần C ${randomUUID().slice(0, 8)}` });
      expect(res.status).toBe(200);
      return res.body.data.id as string;
    }

    /** Tạo + Duyệt 1 phiếu nhập PURCHASE, trả về `receiptId`/`batchId`/`netAmount` — dùng làm "phiếu
     * nhập gốc" cho test giá trả theo phiếu gốc (khác `receiveStock()` chỉ trả `batchId`). */
    async function createAndApprovePurchaseWithBatch(
      token: string,
      supplierId: string,
      drugId: string,
      opts: { quantity: number; unitCost: number; discountType?: 'PERCENT' | 'AMOUNT'; discountValue?: number },
    ) {
      const batchNo = `LOT-RTN-${randomUUID().slice(0, 6)}`;
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/inventory/receipts')
        .set(authed(token))
        .send({
          warehouseId,
          supplierId,
          receiptType: 'PURCHASE',
          lines: [
            {
              drugId,
              unitCode: 'VIEN',
              quantity: opts.quantity,
              unitCost: opts.unitCost,
              batchNo,
              expiryDate: '2028-01-01',
              ...(opts.discountType ? { discountType: opts.discountType, discountValue: opts.discountValue } : {}),
            },
          ],
        });
      expect(createRes.status).toBe(200);
      const receiptId = createRes.body.data.id as string;
      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/receipts/${receiptId}/approve`)
        .set(authed(token))
        .send({ version: createRes.body.data.version });
      expect(approveRes.status).toBe(200);

      const balancesRes = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(token)).query({ warehouseId });
      const batch = (balancesRes.body.data.items as { batchId: string; batchNo: string }[]).find((b) => b.batchNo === batchNo);
      return { receiptId, batchId: batch!.batchId as string, netAmount: opts.quantity * opts.unitCost };
    }

    it('thiếu supplierId → 400 (Zod)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'RETURN_TO_SUPPLIER', warehouseId, note: 'Trả hàng lỗi', lines: [{ drugId: randomUUID(), quantity: 1 }] });
      expect(res.status).toBe(400);
    });

    it('WRITE_OFF kèm supplierId → 400 (loại này không có Nhà cung cấp)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'WRITE_OFF', warehouseId, supplierId: randomUUID(), note: 'Hỏng', lines: [{ drugId: randomUUID(), quantity: 1 }] });
      expect(res.status).toBe(400);
    });

    it('sourceReceiptId của NCC KHÁC → 422', async () => {
      const drugId = await createDrug(clinicAdminToken, { name: 'Amoxicillin e2e Phần C', isBatchManaged: true, isPrescriptionOnly: true });
      const supplierA = await createSupplier();
      const supplierB = await createSupplier();
      const { batchId } = await createAndApprovePurchaseWithBatch(clinicAdminToken, supplierA, drugId, { quantity: 10, unitCost: 5000 });
      const { receiptId: receiptOfSupplierB } = await createAndApprovePurchaseWithBatch(clinicAdminToken, supplierB, drugId, { quantity: 1, unitCost: 1000 });

      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({
          issueType: 'RETURN_TO_SUPPLIER',
          warehouseId,
          supplierId: supplierA, // NCC A, nhưng chọn phiếu nhập gốc thuộc NCC B
          sourceReceiptId: receiptOfSupplierB,
          note: 'Trả nhầm phiếu gốc NCC khác',
          lines: [{ drugId, batchId, quantity: 1 }],
        });
      expect(res.status).toBe(422);
    });

    it('Duyệt KHÔNG chọn phiếu gốc — giá mặc định = giá vốn lô, ghi RETURN đúng, balance công nợ giảm', async () => {
      const supplierId = await createSupplier();
      const drugId = await createDrug(clinicAdminToken, { name: 'Paracetamol e2e Phần C', isBatchManaged: true, isPrescriptionOnly: true });
      const { batchId, receiptId, netAmount } = await createAndApprovePurchaseWithBatch(clinicAdminToken, supplierId, drugId, { quantity: 100, unitCost: 8000 });
      expect(netAmount).toBe(800000);

      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'RETURN_TO_SUPPLIER', warehouseId, supplierId, note: 'Hàng lỗi, không chọn phiếu gốc', lines: [{ drugId, batchId, quantity: 10 }] });
      expect(created.status).toBe(200);
      expect(created.body.data.lines[0].returnUnitPrice).toBe(8000);
      expect(created.body.data.totalAmount).toBe(80000);

      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: created.body.data.version });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('POSTED');

      const summary = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken));
      expect(summary.body.data).toMatchObject({ balance: netAmount - 80000, totalReturnAndAdjustment: 80000 });

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items.at(-1)).toMatchObject({ entryType: 'RETURN', amountChange: -80000, stockReceiptId: null });

      // Không chọn phiếu gốc — FIFO trừ vào khoản nợ cũ nhất (đúng phiếu nhập vừa tạo, khoản duy nhất).
      const receipts = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/receipts`).set(authed(clinicAdminToken));
      expect(receipts.body.data.items.find((it: { stockReceiptId: string }) => it.stockReceiptId === receiptId)).toMatchObject({ dueAmount: netAmount - 80000 });
    });

    it('Duyệt CÓ chọn phiếu gốc + chiết khấu Từng dòng — giá trả = SAU chiết khấu dòng, trừ ĐÚNG phiếu gốc trước', async () => {
      const supplierId = await createSupplier();
      const drugId = await createDrug(clinicAdminToken, { name: 'Omeprazol e2e Phần C', isBatchManaged: true, isPrescriptionOnly: true });
      // 20 viên × 10.000 = 200.000, chiết khấu 20% dòng = 40.000 → net 160.000 → đơn giá SAU CK = 8.000/viên.
      const { batchId, receiptId } = await createAndApprovePurchaseWithBatch(clinicAdminToken, supplierId, drugId, {
        quantity: 20,
        unitCost: 10000,
        discountType: 'PERCENT',
        discountValue: 20,
      });

      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'RETURN_TO_SUPPLIER', warehouseId, supplierId, sourceReceiptId: receiptId, note: 'Trả 1 phần, có phiếu gốc', lines: [{ drugId, batchId, quantity: 5 }] });
      expect(created.status).toBe(200);
      expect(created.body.data.lines[0].returnUnitPrice).toBe(8000); // KHÔNG phải 10.000 (giá trước chiết khấu)
      expect(created.body.data.totalAmount).toBe(40000);

      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: created.body.data.version });
      expect(approveRes.status).toBe(200);

      const ledger = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/ledger`).set(authed(clinicAdminToken));
      expect(ledger.body.data.items.at(-1)).toMatchObject({ entryType: 'RETURN', amountChange: -40000, stockReceiptId: receiptId });

      const receipts = await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/receipts`).set(authed(clinicAdminToken));
      expect(receipts.body.data.items.find((it: { stockReceiptId: string }) => it.stockReceiptId === receiptId)).toMatchObject({ originalAmount: 160000, dueAmount: 120000 });
    });

    it('client gửi kèm returnUnitPrice tường minh → ưu tiên dùng giá đó, KHÔNG tính lại theo phiếu gốc/giá vốn', async () => {
      const supplierId = await createSupplier();
      const drugId = await createDrug(clinicAdminToken, { name: 'Vitamin B1 e2e Phần C', isBatchManaged: true, isPrescriptionOnly: true });
      const { batchId } = await createAndApprovePurchaseWithBatch(clinicAdminToken, supplierId, drugId, { quantity: 30, unitCost: 3000 });

      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'RETURN_TO_SUPPLIER', warehouseId, supplierId, note: 'Sửa tay đơn giá trả', lines: [{ drugId, batchId, quantity: 4, returnUnitPrice: 2500 }] });
      expect(created.status).toBe(200);
      expect(created.body.data.lines[0].returnUnitPrice).toBe(2500);
      expect(created.body.data.totalAmount).toBe(10000);
    });

    it('Phần D — Huỷ phiếu xuất trả ĐÃ DUYỆT tự đảo CẢ tồn kho LẪN công nợ (voidPostedCore() dùng chung)', async () => {
      const supplierId = await createSupplier();
      const drugId = await createDrug(clinicAdminToken, { name: 'Cefixim e2e Phần C', isBatchManaged: true, isPrescriptionOnly: true });
      const { batchId } = await createAndApprovePurchaseWithBatch(clinicAdminToken, supplierId, drugId, { quantity: 50, unitCost: 4000 });

      const created = await request(app.getHttpServer())
        .post('/api/v1/inventory/issues/manual')
        .set(authed(clinicAdminToken))
        .send({ issueType: 'RETURN_TO_SUPPLIER', warehouseId, supplierId, note: 'Sẽ huỷ ngay sau khi duyệt', lines: [{ drugId, batchId, quantity: 10 }] });
      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/manual/${created.body.data.id}/approve`)
        .set(authed(clinicAdminToken))
        .send({ version: created.body.data.version });
      expect(approveRes.status).toBe(200);

      const balanceBefore = (await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken))).body.data.balance;
      expect(balanceBefore).toBe(160000); // PURCHASE 50×4000=200000 − RETURN 10×4000=40000

      const balancesBeforeVoid = await request(app.getHttpServer()).get(`/api/v1/inventory/balances`).set(authed(clinicAdminToken)).query({ warehouseId });
      const qtyBeforeVoid = (balancesBeforeVoid.body.data.items as { drugId: string; quantityOnHand: number }[]).filter((b) => b.drugId === drugId).reduce((s, b) => s + b.quantityOnHand, 0);

      const voidRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/issues/${created.body.data.id}/void`)
        .set(authed(clinicAdminToken))
        .send({ version: approveRes.body.data.version, reason: 'test huỷ — Phần D tự đảo công nợ' });
      expect(voidRes.status).toBe(200);

      const balancesAfterVoid = await request(app.getHttpServer()).get(`/api/v1/inventory/balances`).set(authed(clinicAdminToken)).query({ warehouseId });
      const qtyAfterVoid = (balancesAfterVoid.body.data.items as { drugId: string; quantityOnHand: number }[]).filter((b) => b.drugId === drugId).reduce((s, b) => s + b.quantityOnHand, 0);
      expect(qtyAfterVoid).toBe(qtyBeforeVoid + 10); // tồn kho đảo lại đúng (hành vi cũ, không đổi).

      const balanceAfter = (await request(app.getHttpServer()).get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(clinicAdminToken))).body.data.balance;
      expect(balanceAfter).toBe(200000); // Phần D — RETURN bị REVERSAL (+40000), chỉ còn lại PURCHASE gốc.
    });
  });
});
