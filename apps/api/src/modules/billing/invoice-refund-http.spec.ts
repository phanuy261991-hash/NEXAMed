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
 * HTTP e2e — "Hoàn tiền MỘT PHẦN theo dòng thuốc" (docs/DECISIONS.md #203): `POST
 * /billing/invoices/:encounterId/refund-items`. Dựng dữ liệu thật qua HTTP (nhập kho → kê + ký đơn →
 * phát thuốc → thu tiền) rồi hoàn; kiểm tiền hoàn từng dòng (kể cả chiết khấu), thứ tự ví-trước, nhập
 * lại kho, khoá phiên bản chống hoàn đồng thời, chặn "Đánh dấu chưa thu", quyền, cách ly tenant.
 */
describe('HTTP e2e — POST /api/v1/billing/invoices/:encounterId/refund-items (#203)', () => {
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
  let supplierId: string | undefined;

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-refund-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  async function createDrug(name: string, defaultSellPrice: number) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(clinicAdminToken))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name,
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
        activeIngredient: 'Paracetamol',
        unit: 'Viên',
        concentration: '500mg',
        manufacturerCode: 'TEST_MANUFACTURER',
        defaultSellPrice,
        drugGroupCode: 'TEST_GROUP',
        routeCode: 'TEST_ROUTE',
        registrationNumber: 'VD-TEST-0001',
        dosageForm: 'Viên nén',
        countryOfOrigin: 'Việt Nam',
        ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
        units: [],
        isBatchManaged: true,
        isPrescriptionOnly: true,
      });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  async function receiveStock(drugId: string, quantity: number, unitCost: number): Promise<string> {
    if (!supplierId) {
      const s = await request(app.getHttpServer()).post('/api/v1/suppliers').set(authed(clinicAdminToken)).send({ name: 'Cty Dược hoàn tiền e2e' });
      supplierId = s.body.data.id as string;
    }
    const batchNo = `LOT-${randomUUID().slice(0, 6)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/inventory/receipts')
      .set(authed(clinicAdminToken))
      .send({ warehouseId, supplierId, receiptType: 'PURCHASE', lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost, batchNo, expiryDate: '2027-01-01' }] });
    expect(created.status).toBe(200);
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`)
      .set(authed(clinicAdminToken))
      .send({ version: created.body.data.version });
    expect(approved.status).toBe(200);
    const balances = await request(app.getHttpServer()).get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(clinicAdminToken)).query({ warehouseId });
    return balances.body.data.items.find((b: { batchNo: string | null }) => b.batchNo === batchNo).batchId as string;
  }

  async function stockOnHand(drugId: string): Promise<number> {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory/balances').set(authed(clinicAdminToken)).query({ warehouseId });
    return res.body.data.items.find((i: { drugId: string }) => i.drugId === drugId).quantityOnHand as number;
  }

  async function prepareEncounterInConsultation(hour: number) {
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId: doctorUserId, fullName: 'Khách e2e hoàn tiền', phone: '0911222888', scheduledAt: new Date(Date.UTC(2026, 7, 29, hour, 0, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };
    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e hoàn tiền', dob: '1985-01-01', gender: 'male', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
    const patientId = patientRes.body.data.id as string;
    const checkIn = await request(app.getHttpServer())
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
        allowsDeferredPayment: true,
      });
    const encounterId = checkIn.body.data.id as string;
    const start = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    expect(start.status).toBe(200);
    await request(app.getHttpServer()).put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(doctorToken)).send({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' as const }] });
    return { encounterId, patientId };
  }

  /** Kê + ký + phát thuốc; trả về `prescriptionId` để test gọi tiếp nếu cần. */
  async function prescribeAndDispense(encounterId: string, drugId: string, batchId: string, quantity: number) {
    const saveRes = await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/prescription-items`)
      .set(authed(doctorToken))
      .send({ items: [{ drugId, doseMorning: quantity, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: 1 }] });
    expect(saveRes.status).toBe(200);
    const signRes = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version: saveRes.body.data.version });
    expect(signRes.status).toBe(200);
    const items = signRes.body.data.items as { id: string }[];
    const issue = await request(app.getHttpServer())
      .post('/api/v1/inventory/issues')
      .set(authed(doctorToken))
      .send({ prescriptionId: signRes.body.data.id, warehouseId, lines: [{ prescriptionItemId: items[0]!.id, drugId, batchId, quantity }] });
    expect(issue.status).toBe(200);
  }

  async function getInvoice(encounterId: string, invoiceId?: string, token = receptionistToken) {
    const res = await request(app.getHttpServer()).get(`/api/v1/billing/invoices/${encounterId}`).set(authed(token)).query(invoiceId ? { invoiceId } : {});
    expect(res.status).toBe(200);
    return res.body.data as {
      id: string;
      version: number;
      status: string;
      dueAmount: number;
      refundedAmount: number;
      payments: { method: string; amount: number }[];
      refunds: { refundNo: string; totalAmount: number; lines: { invoiceLineId: string; quantity: number; amount: number; restocked: boolean }[] }[];
      lines: { id: string; examTypeName: string; lineSource: 'SERVICE' | 'DRUG'; quantity: number; netAmount: number; refundedQuantity: number; refundedAmount: number }[];
    };
  }

  async function payCash(encounterId: string, invoiceId?: string) {
    const current = await getInvoice(encounterId, invoiceId);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/billing/invoices/${encounterId}/pay`)
      .set(authed(receptionistToken))
      .send({ method: 'CASH', version: current.version, invoiceId });
    expect(res.status).toBe(200);
    return res.body.data as { version: number };
  }

  /**
   * Hoá đơn khám (150.000) + 1 dòng thuốc `quantity × sellPrice` cộng chung; chưa thu tiền.
   * Trả thêm `drugLineId` (dòng thuốc) để test gọi hoàn thẳng.
   */
  async function setupDispensed(opts: { quantity?: number; sellPrice?: number; hour: number; stock?: number }) {
    const quantity = opts.quantity ?? 20;
    const drugId = await createDrug(`Thuốc hoàn ${randomUUID().slice(0, 4)}`, opts.sellPrice ?? 3000);
    const batchId = await receiveStock(drugId, opts.stock ?? 100, 1000);
    const { encounterId, patientId } = await prepareEncounterInConsultation(opts.hour);
    await prescribeAndDispense(encounterId, drugId, batchId, quantity);
    const invoice = await getInvoice(encounterId);
    // Chế độ "hoá đơn thuốc riêng" (pharmacySeparateInvoiceEnabled): hoá đơn khám không có dòng thuốc.
    const drugLine = invoice.lines.find((l) => l.lineSource === 'DRUG');
    const serviceLine = invoice.lines.find((l) => l.lineSource === 'SERVICE')!;
    return { encounterId, patientId, drugId, drugLineId: drugLine?.id ?? '', serviceLineId: serviceLine.id, invoiceId: invoice.id };
  }

  function refundItems(encounterId: string, body: unknown, token = receptionistToken) {
    return request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounterId}/refund-items`).set(authed(token)).send(body as object);
  }

  async function topUpWallet(patientId: string, amount: number) {
    const res = await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(receptionistToken)).send({ patientId, amount, paymentMethodCode: 'CASH' });
    expect(res.status).toBe(200);
  }

  async function walletBalance(patientId: string): Promise<number> {
    const res = await request(app.getHttpServer()).get('/api/v1/wallet').set(authed(receptionistToken)).query({ patientId });
    return res.body.data.balance as number;
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

    fixture = await createTwoTenantFixture(privileged, 'InvoiceRefund e2e');
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
    await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ deferredPaymentEnabled: true });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('hoàn 1 phần 1 dòng thuốc (không nhập lại kho) — trả đúng tiền, hoá đơn vẫn PAID, tồn kho giữ nguyên', async () => {
    const s = await setupDispensed({ hour: 1 });
    const paid = await payCash(s.encounterId);
    expect(await stockOnHand(s.drugId)).toBe(80);

    const res = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'Khách trả 5 viên', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 5, restock: false }] });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PAID');
    expect(res.body.data.refundedAmount).toBe(15_000); // 60.000 × 5/20
    expect(res.body.data.refunds).toHaveLength(1);
    expect(res.body.data.refunds[0].refundNo).toMatch(/^PHT/);
    expect(res.body.data.refunds[0].lines[0]).toMatchObject({ invoiceLineId: s.drugLineId, quantity: 5, amount: 15_000, restocked: false });
    const drugLine = res.body.data.lines.find((l: { id: string }) => l.id === s.drugLineId);
    expect(drugLine).toMatchObject({ netAmount: 60_000, refundedQuantity: 5, refundedAmount: 15_000 });
    expect(await stockOnHand(s.drugId)).toBe(80);

    const refundPayments = await privileged.payment.findMany({ where: { tenantId: fixture.tenantA.id, invoiceId: s.invoiceId, type: 'REFUND' } });
    expect(refundPayments).toHaveLength(1);
    expect(refundPayments[0]).toMatchObject({ method: 'CASH', refundId: res.body.data.refunds[0].id });
    expect(Number(refundPayments[0]!.amount)).toBe(15_000);
  });

  it('restock=true — tự sinh phiếu nhập RETURN_FROM_USE POSTED gắn phiếu xuất gốc, tồn kho tăng đúng', async () => {
    const s = await setupDispensed({ hour: 2 });
    const paid = await payCash(s.encounterId);
    const res = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'Trả thuốc còn nguyên', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 5, restock: true }] });
    expect(res.status).toBe(200);
    expect(res.body.data.refunds[0].lines[0].restocked).toBe(true);
    expect(await stockOnHand(s.drugId)).toBe(85);

    const receipt = await privileged.stockReceipt.findFirst({ where: { tenantId: fixture.tenantA.id, receiptType: 'RETURN_FROM_USE', note: { contains: res.body.data.refunds[0].refundNo } } });
    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe('POSTED');
    expect(receipt!.sourceIssueId).not.toBeNull();
    const refundLine = await privileged.invoiceRefundLine.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, refundId: res.body.data.refunds[0].id } });
    expect(refundLine.stockReceiptId).toBe(receipt!.id);
  });

  it('chiết khấu tổng: tiền hoàn theo phần THẬT sau chiết khấu (không phải giá gốc)', async () => {
    const s = await setupDispensed({ hour: 3 });
    const current = await getInvoice(s.encounterId);
    const discount = await request(app.getHttpServer())
      .post(`/api/v1/billing/invoices/${s.encounterId}/discount`)
      .set(authed(receptionistToken))
      .send({ mode: 'TOTAL', discountType: 'PERCENT', discountValue: 10, reason: 'Khách quen', version: current.version });
    expect(discount.status).toBe(200);
    const paid = await payCash(s.encounterId);

    const res = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'Trả hết thuốc', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 20, restock: false }] });
    expect(res.status).toBe(200);
    // due = 210.000 − 10% = 189.000; net thuốc = 189.000 × 60.000/210.000 = 54.000.
    expect(res.body.data.refundedAmount).toBe(54_000);
    const drugLine = res.body.data.lines.find((l: { id: string }) => l.id === s.drugLineId);
    expect(drugLine.netAmount).toBe(54_000);
    // Còn dòng khám nên phiếu vẫn PAID.
    expect(res.body.data.status).toBe('PAID');
  });

  it('nhiều lần hoàn — tổng đúng bằng net dòng, không lệch đồng nào do làm tròn; hoàn đủ toàn bộ hoá đơn THUỐC riêng → REFUNDED', async () => {
    await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ pharmacySeparateInvoiceEnabled: true });
    try {
      const s = await setupDispensed({ hour: 4, quantity: 7, sellPrice: 3333 }); // 23.331đ — không chia hết cho 7 phần
      const drugInvoice = await privileged.invoice.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, encounterId: s.encounterId, invoiceType: 'DRUG' } });
      const detail = await getInvoice(s.encounterId, drugInvoice.id);
      const lineId = detail.lines[0]!.id;
      const paid = await payCash(s.encounterId, drugInvoice.id);

      const first = await refundItems(s.encounterId, { invoiceId: drugInvoice.id, reason: 'Lần 1', version: paid.version, lines: [{ invoiceLineId: lineId, quantity: 3, restock: false }] });
      expect(first.status).toBe(200);
      expect(first.body.data.status).toBe('PAID');
      expect(first.body.data.refundedAmount).toBe(9_999); // round(23.331 × 3/7)

      const second = await refundItems(s.encounterId, { invoiceId: drugInvoice.id, reason: 'Lần 2', version: first.body.data.version, lines: [{ invoiceLineId: lineId, quantity: 4, restock: false }] });
      expect(second.status).toBe(200);
      expect(second.body.data.refundedAmount).toBe(23_331); // hoàn hết = đúng net dòng
      expect(second.body.data.status).toBe('REFUNDED');
      expect(second.body.data.refunds).toHaveLength(2);
      expect(second.body.data.lines[0].refundedQuantity).toBe(7);

      // REFUNDED thì không hoàn tiếp được.
      const third = await refundItems(s.encounterId, { invoiceId: drugInvoice.id, reason: 'Lần 3', version: second.body.data.version, lines: [{ invoiceLineId: lineId, quantity: 1, restock: false }] });
      expect(third.status).toBe(409);
      expect(third.body.error.code).toBe('INVOICE_CLOSED');
    } finally {
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ pharmacySeparateInvoiceEnabled: false });
    }
  });

  it('trả hỗn hợp ví + tiền mặt — hoàn về VÍ trước, phần dư mới ra tiền mặt', async () => {
    await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ walletMixedPaymentEnabled: true });
    try {
      const s = await setupDispensed({ hour: 5 }); // tổng 210.000
      await topUpWallet(s.patientId, 50_000);
      const current = await getInvoice(s.encounterId);
      const pay = await request(app.getHttpServer())
        .post(`/api/v1/billing/invoices/${s.encounterId}/pay-with-wallet`)
        .set(authed(receptionistToken))
        .send({ version: current.version, remainderPaymentMethodCode: 'CASH' });
      expect(pay.status).toBe(200);
      expect(await walletBalance(s.patientId)).toBe(0);

      // Hoàn 5 viên = 15.000đ → toàn bộ về ví (ví đã trả 50.000).
      const r1 = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'Trả 5', version: pay.body.data.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 5, restock: false }] });
      expect(r1.status).toBe(200);
      expect(await walletBalance(s.patientId)).toBe(15_000);
      let refundRows = await privileged.payment.findMany({ where: { tenantId: fixture.tenantA.id, invoiceId: s.invoiceId, type: 'REFUND' } });
      expect(refundRows.map((r) => r.method)).toEqual(['WALLET']);

      // Hoàn nốt 15 viên = 45.000đ → ví còn hoàn được 35.000, phần dư 10.000 ra tiền mặt.
      const r2 = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'Trả nốt', version: r1.body.data.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 15, restock: false }] });
      expect(r2.status).toBe(200);
      expect(await walletBalance(s.patientId)).toBe(50_000);
      refundRows = await privileged.payment.findMany({ where: { tenantId: fixture.tenantA.id, invoiceId: s.invoiceId, type: 'REFUND' }, orderBy: { createdAt: 'asc' } });
      const byMethod = (m: string) => refundRows.filter((r) => r.method === m).reduce((sum, r) => sum + Number(r.amount), 0);
      expect(byMethod('WALLET')).toBe(50_000);
      expect(byMethod('CASH')).toBe(10_000);
    } finally {
      await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send({ walletMixedPaymentEnabled: false });
    }
  });

  it('vượt số lượng còn hoàn được (kể cả cộng dồn nhiều lần) → 422 INVOICE_REFUND_QUANTITY_EXCEEDED', async () => {
    const s = await setupDispensed({ hour: 6 });
    const paid = await payCash(s.encounterId);
    const tooMany = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 21, restock: false }] });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('INVOICE_REFUND_QUANTITY_EXCEEDED');

    const ok = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 15, restock: false }] });
    expect(ok.status).toBe(200);
    const exceed = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: ok.body.data.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 6, restock: false }] });
    expect(exceed.status).toBe(422);
    expect(exceed.body.error.code).toBe('INVOICE_REFUND_QUANTITY_EXCEEDED');
    // Lỗi không để lại vết: tiền hoàn vẫn 45.000.
    expect((await getInvoice(s.encounterId)).refundedAmount).toBe(45_000);
  });

  it('2 request hoàn ĐỒNG THỜI cùng version → đúng 1 thành công, 1 CONCURRENT_MODIFICATION (không hoàn đôi)', async () => {
    const s = await setupDispensed({ hour: 7 });
    const paid = await payCash(s.encounterId);
    const body = { invoiceId: s.invoiceId, reason: 'Đồng thời', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 15, restock: false }] };
    const [a, b] = await Promise.all([refundItems(s.encounterId, body), refundItems(s.encounterId, body)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('CONCURRENT_MODIFICATION');
    expect((await getInvoice(s.encounterId)).refundedAmount).toBe(45_000);
  });

  it('"Đánh dấu chưa thu" sau khi đã hoàn một phần → 409 INVOICE_HAS_REFUNDS', async () => {
    const s = await setupDispensed({ hour: 8 });
    const paid = await payCash(s.encounterId);
    const r = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'Trả', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 2, restock: false }] });
    expect(r.status).toBe(200);
    const revert = await request(app.getHttpServer())
      .post(`/api/v1/billing/invoices/${s.encounterId}/revert-payment`)
      .set(authed(receptionistToken))
      .send({ reason: 'Bấm nhầm', version: r.body.data.version });
    expect(revert.status).toBe(409);
    expect(revert.body.error.code).toBe('INVOICE_HAS_REFUNDS');
    expect((await getInvoice(s.encounterId)).status).toBe('PAID');
  });

  it('hoàn toàn phần (lượt khám huỷ) SAU khi đã hoàn một phần — chỉ hoàn PHẦN CÒN LẠI, không hoàn thừa', async () => {
    const s = await setupDispensed({ hour: 9 });
    const paid = await payCash(s.encounterId); // đã thu 210.000
    const partial = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'Trả 5', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 5, restock: false }] });
    expect(partial.status).toBe(200);

    // Ép lượt khám sang CANCELLED (test-only; đường huỷ thật từ IN_CONSULTATION không có ở API).
    await privileged.encounter.update({ where: { id: s.encounterId }, data: { status: 'CANCELLED' } });
    const full = await request(app.getHttpServer())
      .post(`/api/v1/billing/invoices/${s.encounterId}/refund`)
      .set(authed(clinicAdminToken))
      .send({ reason: 'Huỷ khám', version: partial.body.data.version });
    expect(full.status).toBe(200);
    expect(full.body.data.status).toBe('REFUNDED');
    expect(full.body.data.refundedAmount).toBe(210_000); // 15.000 + 195.000, không phải 15.000 + 210.000
    const refundRows = await privileged.payment.findMany({ where: { tenantId: fixture.tenantA.id, invoiceId: s.invoiceId, type: 'REFUND' } });
    expect(refundRows.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(210_000);
  });

  it('dòng dịch vụ khám (không phải thuốc) → 422 INVOICE_LINE_NOT_REFUNDABLE', async () => {
    const s = await setupDispensed({ hour: 10 });
    const paid = await payCash(s.encounterId);
    const res = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: paid.version, lines: [{ invoiceLineId: s.serviceLineId, quantity: 1, restock: false }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_LINE_NOT_REFUNDABLE');
  });

  it('hoá đơn chưa thu → 409 INVOICE_NOT_REFUNDABLE', async () => {
    const s = await setupDispensed({ hour: 11 });
    const current = await getInvoice(s.encounterId);
    const res = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: current.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 1, restock: false }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVOICE_NOT_REFUNDABLE');
  });

  it('thiếu lý do / không chọn dòng nào → 400', async () => {
    const s = await setupDispensed({ hour: 12 });
    const paid = await payCash(s.encounterId);
    const noReason = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: '  ', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 1, restock: false }] });
    expect(noReason.status).toBe(400);
    const noLines = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: paid.version, lines: [] });
    expect(noLines.status).toBe(400);
  });

  it('phân quyền: bác sĩ (không có invoice.refund_drug) → 403; lễ tân và quản trị → 200', async () => {
    const s = await setupDispensed({ hour: 13 });
    const paid = await payCash(s.encounterId);
    const body = (version: number) => ({ invoiceId: s.invoiceId, reason: 'x', version, lines: [{ invoiceLineId: s.drugLineId, quantity: 1, restock: false }] });
    const asDoctor = await refundItems(s.encounterId, body(paid.version), doctorToken);
    expect(asDoctor.status).toBe(403);
    const asReceptionist = await refundItems(s.encounterId, body(paid.version), receptionistToken);
    expect(asReceptionist.status).toBe(200);
    const asAdmin = await refundItems(s.encounterId, body(asReceptionist.body.data.version), clinicAdminToken);
    expect(asAdmin.status).toBe(200);
    const noToken = await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${s.encounterId}/refund-items`).send(body(1));
    expect(noToken.status).toBe(401);
  });

  it('cách ly: invoiceId thuộc lượt khám khác → 404; tenant khác → 404', async () => {
    const s = await setupDispensed({ hour: 14 });
    const other = await setupDispensed({ hour: 15 });
    const paid = await payCash(s.encounterId);
    const wrongEncounter = await refundItems(other.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 1, restock: false }] });
    expect(wrongEncounter.status).toBe(404);
    const otherTenant = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 1, restock: false }] }, tenantBAdminToken);
    expect(otherTenant.status).toBe(404);
    expect((await getInvoice(s.encounterId)).refundedAmount).toBe(0);
  });

  it('Sổ quỹ tiền mặt ghi đúng dòng "Hoàn tiền khám" cho phần hoàn TIỀN MẶT một phần (không ghi phần hoàn về ví)', async () => {
    const s = await setupDispensed({ hour: 17 });
    const paid = await payCash(s.encounterId);
    const before = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(clinicAdminToken));
    const cashAccount = before.body.data.items.find((a: { type: string; isDefault: boolean }) => a.type === 'CASH' && a.isDefault);
    const ledgerBefore = await request(app.getHttpServer()).get('/api/v1/cash-book/ledger').set(authed(clinicAdminToken)).query({ cashAccountId: cashAccount.id });
    const refund = await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'Sổ quỹ', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 4, restock: false }] });
    expect(refund.status).toBe(200);
    const ledgerAfter = await request(app.getHttpServer()).get('/api/v1/cash-book/ledger').set(authed(clinicAdminToken)).query({ cashAccountId: cashAccount.id });
    expect(ledgerAfter.status).toBe(200);
    // 60.000 × 4/20 = 12.000 chi ra từ két tiền mặt.
    expect(ledgerAfter.body.data.closingBalance - ledgerBefore.body.data.closingBalance).toBe(-12_000);
    const refundEntries = ledgerAfter.body.data.entries.filter((e: { entryType: string; referenceNo: string }) => e.entryType === 'INVOICE_REFUND');
    expect(refundEntries.some((e: { amountSigned: number }) => e.amountSigned === -12_000)).toBe(true);
  });

  it('danh sách Thu ngân trong ngày hiển thị refundedAmount của phiếu đã hoàn một phần', async () => {
    const s = await setupDispensed({ hour: 16 });
    const paid = await payCash(s.encounterId);
    await refundItems(s.encounterId, { invoiceId: s.invoiceId, reason: 'x', version: paid.version, lines: [{ invoiceLineId: s.drugLineId, quantity: 10, restock: false }] });
    const list = await request(app.getHttpServer()).get('/api/v1/billing/invoices').set(authed(receptionistToken));
    expect(list.status).toBe(200);
    const item = list.body.data.items.find((i: { invoiceId: string }) => i.invoiceId === s.invoiceId);
    expect(item.refundedAmount).toBe(30_000);
    expect(item.status).toBe('PAID');
    expect(list.body.data.refundedTotalAmount).toBeGreaterThanOrEqual(30_000);
  });
});
