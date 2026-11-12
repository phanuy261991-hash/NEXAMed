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
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { seedSystemReferenceDataForTenant } from '../../infrastructure/persistence/seed-reference-catalog';
import { PARACLINICAL_RESULTS_READER_PORT, type ParaclinicalResultsReaderPort } from '@nexamed/core';

/**
 * HTTP e2e — "Khách không làm dịch vụ" ở quầy thu ngân (docs/DECISIONS.md #280). Bao phủ: phân quyền (quyền HẸP `invoice.cancel_service`), hai nhánh theo trạng thái phiếu
 * (chưa thu → gỡ dòng + trừ tiền; đã thu → hoàn tiền theo phương thức đã thu), dòng chỉ định → CANCELLED kèm lý do (KHÔNG soft-delete), bác sĩ vẫn lưu được chỉ định sau đó,
 * các dòng bị chặn (đã làm / đã huỷ / lý do lạ), ba chế độ gói, đồng thời, cô lập tenant + chi nhánh.
 */
describe('HTTP e2e — /api/v1/billing/invoices/:encounterId/service-decline (Khách không làm dịch vụ)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let receptionistToken: string;
  let receptionistName: string;
  let nurseToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let tenantBAdminToken: string;
  let branchBReceptionistToken: string;

  let glucoseId: string; // XN — 80.000
  let imagingId: string; // CĐHA — 420.000

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const randomNationalId = (): string => '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  const orderUrl = (encounterId: string) => `/api/v1/encounters/${encounterId}/clinical-orders`;
  const declineUrl = (encounterId: string, suffix = '') => `/api/v1/billing/invoices/${encounterId}/service-decline${suffix}`;

  async function createUserWithRole(tenantId: string, roleName: string, extra: { branchId?: string } = {}) {
    const username = `e2e-decl-${roleName}-${randomUUID()}`;
    const fullName = `Nhân viên ${roleName} ${randomUUID().slice(0, 4)}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    if (extra.branchId) {
      await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId: extra.branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return { userId: user.id as string, token: login.body.data.accessToken as string, fullName };
  }

  async function createTechService(name: string, serviceKind: 'LAB' | 'IMAGING', amount: number): Promise<string> {
    const res = await http()
      .post('/api/v1/technical-services')
      .set(authed(adminToken))
      .send({ name, serviceKind, isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount, effectiveFrom: '2020-01-01' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  /** Tiếp nhận + bắt đầu khám — hoá đơn khám 150.000 giữ UNPAID ("Thanh toán sau"). */
  async function prepareEncounterInConsultation(): Promise<{ encounterId: string }> {
    const patientRes = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e bỏ dịch vụ', dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
    const checkIn = await http()
      .post('/api/v1/reception/direct')
      .set(authed(receptionistToken))
      .send({
        patientId: patientRes.body.data.id,
        doctorId: doctorUserId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
        allowsDeferredPayment: true,
        checkedInAt: new Date().toISOString(),
      });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
    const encounterId = checkIn.body.data.id as string;
    const start = await http().post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    return { encounterId };
  }

  type OrderView = {
    id: string;
    inHouseTotal: number;
    items: { id: string; name: string; status: string; packageId: string | null; declineReasonCode: string | null; declineReasonLabel: string | null; declineNote: string | null; declinedAt: string | null; declinedByName: string | null }[];
    packages: { id: string; name: string; unitPrice: number }[];
    invoices: { invoiceId: string; invoiceType: string; status: string }[];
  };

  async function saveOrder(encounterId: string, body: Record<string, unknown>) {
    const res = await http().put(orderUrl(encounterId)).set(authed(doctorToken)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.order as OrderView;
  }

  async function getOrder(encounterId: string): Promise<OrderView> {
    const res = await http().get(orderUrl(encounterId)).set(authed(doctorToken));
    expect(res.status).toBe(200);
    return res.body.data.order as OrderView;
  }

  async function invoiceOf(encounterId: string, invoiceId?: string) {
    const res = await http().get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken)).query(invoiceId ? { invoiceId } : {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as {
      id: string;
      version: number;
      status: string;
      totalAmount: number;
      dueAmount: number;
      refundedAmount: number;
      payments: { method: string; amount: number }[];
      lines: { id: string; examTypeName: string; lineTotal: number }[];
    };
  }

  async function pay(encounterId: string) {
    const current = await invoiceOf(encounterId);
    const res = await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: current.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function decline(encounterId: string, body: Record<string, unknown>, token = receptionistToken) {
    return http().post(declineUrl(encounterId)).set(authed(token)).send(body);
  }

  async function quote(encounterId: string, body: Record<string, unknown>, token = receptionistToken) {
    return http().post(declineUrl(encounterId, '/quote')).set(authed(token)).send(body);
  }

  /** Mở phiếu thu của lượt khám, trả `invoiceId` + `version` để gửi lên. */
  async function openInvoice(encounterId: string) {
    const inv = await invoiceOf(encounterId);
    return { invoiceId: inv.id, invoiceVersion: inv.version, inv };
  }

  const inHouse = (technicalServiceId: string, extra: Record<string, unknown> = {}) => ({ performance: 'IN_HOUSE', technicalServiceId, quantity: 1, ...extra });

  async function createPackage(name: string) {
    const res = await http()
      .post('/api/v1/service-packages')
      .set(authed(adminToken))
      .send({
        name,
        pricingMode: 'FIXED',
        fixedPrice: 400_000,
        effectiveFrom: '2020-01-01',
        items: [
          { itemKind: 'TECHNICAL_SERVICE', technicalServiceId: glucoseId, quantity: 1 },
          { itemKind: 'TECHNICAL_SERVICE', technicalServiceId: imagingId, quantity: 1 },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { id: string };
  }

  async function setPackageMode(mode: 'BLOCK' | 'REPRICE_SINGLE' | 'KEEP_PACKAGE_PRICE') {
    const res = await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ packageDeclineMode: mode });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
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

    fixture = await createTwoTenantFixture(privileged, 'ServiceDecline e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    // 5 lý do mặc định (mã CỐ ĐỊNH) — nạp bằng đúng hàm tạo tenant mới dùng.
    await seedSystemReferenceDataForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const receptionist = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    receptionistToken = receptionist.token;
    receptionistName = receptionist.fullName;
    nurseToken = (await createUserWithRole(fixture.tenantA.id, 'nurse')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ deferredPaymentEnabled: true });

    glucoseId = await createTechService('Glucose máu lúc đói (bỏ dịch vụ)', 'LAB', 80_000);
    imagingId = await createTechService('Siêu âm ổ bụng (bỏ dịch vụ)', 'IMAGING', 420_000);

    // Chi nhánh thứ hai + lễ tân CHỈ thuộc chi nhánh đó — để kiểm cô lập chi nhánh cùng tenant.
    const branchB = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh Quận 7 (bỏ dịch vụ)', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
    expect(branchB.status, JSON.stringify(branchB.body)).toBe(200);
    branchBReceptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist', { branchId: branchB.body.data.id as string })).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền + cô lập', () => {
    it('không token → 401; bác sĩ và điều dưỡng KHÔNG có quyền hẹp invoice.cancel_service → 403; lễ tân xem được', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      await saveOrder(encounterId, { items: [inHouse(glucoseId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);

      expect((await http().get(declineUrl(encounterId)).query({ invoiceId })).status).toBe(401);
      for (const token of [doctorToken, nurseToken]) {
        expect((await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(token))).status).toBe(403);
        expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [randomUUID()], reasonCode: 'PRICE_HIGH' }, token)).status).toBe(403);
      }
      expect((await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(receptionistToken))).status).toBe(200);
      expect((await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(adminToken))).status).toBe(200);
    });

    it('tenant khác → 404; chi nhánh khác CÙNG tenant → 404 (không lộ phiếu); phiếu của lượt khám khác → 404', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      await saveOrder(encounterId, { items: [inHouse(glucoseId)] });
      const { invoiceId } = await openInvoice(encounterId);
      const other = await prepareEncounterInConsultation();

      expect((await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(tenantBAdminToken))).status).toBe(404);
      expect((await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(branchBReceptionistToken))).status).toBe(404);
      // invoiceId thuộc lượt khám này nhưng gọi với encounterId của lượt khác.
      expect((await http().get(declineUrl(other.encounterId)).query({ invoiceId }).set(authed(receptionistToken))).status).toBe(404);
    });
  });

  describe('phiếu CHƯA THU — gỡ dòng + trừ tiền', () => {
    it('xem trước liệt kê dịch vụ kèm tiền và nhánh REMOVE_LINE; báo giá khớp số sẽ ghi', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);

      const preview = await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(receptionistToken));
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body.data).toMatchObject({ invoiceId, invoiceStatus: 'UNPAID', invoiceVersion, packageMode: 'BLOCK', action: 'REMOVE_LINE' });
      const items = preview.body.data.items as { orderItemId: string; name: string; amount: number | null; declinable: boolean }[];
      expect(items).toHaveLength(2);
      expect(items.find((i) => i.name.startsWith('Glucose'))).toMatchObject({ amount: 80_000, declinable: true });
      expect(items.find((i) => i.name.startsWith('Siêu âm'))).toMatchObject({ amount: 420_000, declinable: true });

      const glucose = order.items.find((i) => i.name.startsWith('Glucose'))!;
      const q = await quote(encounterId, { invoiceId, orderItemIds: [glucose.id] });
      expect(q.status, JSON.stringify(q.body)).toBe(200);
      expect(q.body.data).toMatchObject({ action: 'REMOVE_LINE', itemCount: 1, amount: 80_000, surcharge: 0, newDueAmount: 570_000, refundBreakdown: [] });
    });

    it('bỏ một dịch vụ: tiền giảm đúng, dòng chỉ định thành CANCELLED kèm lý do + người + lúc (KHÔNG biến mất), có nhật ký', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const glucose = order.items.find((i) => i.name.startsWith('Glucose'))!;

      const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'PRICE_HIGH', reasonNote: 'Khách nói để mai' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'UNPAID', totalAmount: 570_000 });

      // Dòng chỉ định còn nguyên, trạng thái CANCELLED + lý do tra từ danh mục + tên người xác nhận.
      const after = await getOrder(encounterId);
      expect(after.items).toHaveLength(2);
      const declined = after.items.find((i) => i.id === glucose.id)!;
      expect(declined).toMatchObject({ status: 'CANCELLED', declineReasonCode: 'PRICE_HIGH', declineReasonLabel: 'Khách thấy giá cao', declineNote: 'Khách nói để mai', declinedByName: receptionistName });
      expect(declined.declinedAt).not.toBeNull();
      expect(after.inHouseTotal).toBe(420_000); // dòng đã huỷ không tính vào tạm tính

      const inv = await invoiceOf(encounterId);
      expect(inv.lines.map((l) => l.examTypeName).sort()).toEqual(['Khám thường', 'Siêu âm ổ bụng (bỏ dịch vụ)']);

      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'invoice.service_declined', entityId: invoiceId } });
      expect(audit).not.toBeNull();
    });

    it('bác sĩ VẪN lưu được chỉ định sau khi thu ngân bỏ một dịch vụ — dòng đã huỷ là lịch sử, không bị coi là "bị gỡ"', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const glucose = order.items.find((i) => i.name.startsWith('Glucose'))!;
      const imaging = order.items.find((i) => i.name.startsWith('Siêu âm'))!;
      expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'LATER' })).status).toBe(200);

      // Màn khám chỉ gửi lại dòng còn hiệu lực (dòng đã huỷ nằm ở khối riêng) — trước khi vá save() đây là 409 CLINICAL_ORDER_ITEM_LOCKED.
      const resaved = await saveOrder(encounterId, { items: [{ id: imaging.id, ...inHouse(imagingId) }] });
      expect(resaved.items.find((i) => i.id === glucose.id)).toMatchObject({ status: 'CANCELLED', declineReasonCode: 'LATER' });
      expect(resaved.items.find((i) => i.id === imaging.id)?.status).toBe('ORDERED');

      // Bản web cũ (và panel hiện tại trước khi vá) gửi lại CẢ dòng đã huỷ cùng danh sách: máy chủ phải bỏ qua lặng lẽ, KHÔNG báo 400 "dòng không tồn tại".
      const withFrozen = await saveOrder(encounterId, { items: [{ id: glucose.id, ...inHouse(glucoseId) }, { id: imaging.id, ...inHouse(imagingId) }] });
      expect(withFrozen.items.find((i) => i.id === glucose.id)).toMatchObject({ status: 'CANCELLED', declineReasonCode: 'LATER' });
      expect(withFrozen.items.find((i) => i.id === imaging.id)?.status).toBe('ORDERED');
    });

    it('bỏ nhiều dịch vụ một lượt; lý do + ghi thêm tuỳ chọn; ghi thêm quá dài → 400', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const ids = order.items.map((i) => i.id);

      expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: ids, reasonCode: 'REFUSED', reasonNote: 'x'.repeat(501) })).status).toBe(400);
      const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: ids, reasonCode: 'REFUSED' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ totalAmount: 150_000 }); // chỉ còn tiền khám
      const after = await getOrder(encounterId);
      expect(after.items.every((i) => i.status === 'CANCELLED' && i.declineReasonCode === 'REFUSED')).toBe(true);
    });
  });

  describe('phiếu ĐÃ THU — hoàn tiền theo phương thức đã thu, không nhập lại kho', () => {
    it('hoàn đúng số tiền của dịch vụ, phiếu vẫn PAID, ghi dòng hoàn + nhật ký hoàn; dòng chỉ định CANCELLED', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      await pay(encounterId);
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const imaging = order.items.find((i) => i.name.startsWith('Siêu âm'))!;

      const preview = await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(receptionistToken));
      expect(preview.body.data).toMatchObject({ invoiceStatus: 'PAID', action: 'REFUND' });

      const q = await quote(encounterId, { invoiceId, orderItemIds: [imaging.id] });
      expect(q.body.data).toMatchObject({ action: 'REFUND', amount: 420_000, surcharge: 0, newDueAmount: null, refundBreakdown: [{ method: 'CASH', amount: 420_000 }] });

      const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [imaging.id], reasonCode: 'DONE_ELSEWHERE' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'PAID', refundedAmount: 420_000 });

      const after = await getOrder(encounterId);
      expect(after.items.find((i) => i.id === imaging.id)).toMatchObject({ status: 'CANCELLED', declineReasonCode: 'DONE_ELSEWHERE' });

      const refundAudit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'invoice.service_declined_refunded' }, orderBy: { occurredAt: 'desc' } });
      expect(refundAudit).not.toBeNull();
      // Dịch vụ không có hàng → KHÔNG phát sinh phiếu nhập kho hoàn thuốc.
      const refundRow = await privileged.invoiceRefund.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, invoiceId }, include: { lines: true } });
      expect(refundRow.lines.every((l) => l.restocked === false && l.stockReceiptId === null)).toBe(true);
    });

    it('dịch vụ đã hoàn rồi thì không hoàn lần hai (409); hoàn hết mọi dòng có tiền thì phiếu chuyển REFUNDED', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId)] });
      await pay(encounterId);
      const first = await openInvoice(encounterId);
      const glucose = order.items[0]!;
      expect((await decline(encounterId, { invoiceId: first.invoiceId, invoiceVersion: first.invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'PRICE_HIGH' })).status).toBe(200);

      const again = await openInvoice(encounterId);
      const twice = await decline(encounterId, { invoiceId: again.invoiceId, invoiceVersion: again.invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'PRICE_HIGH' });
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('SERVICE_DECLINE_BLOCKED');
    });
  });

  describe('có CHIẾT KHẤU — tiền thật của dòng là phần sau chiết khấu, không phải giá gốc', () => {
    /** Phiếu 650.000 (khám 150.000 + XN 80.000 + siêu âm 420.000) chiết khấu 10% toàn phiếu → phải thu 585.000; phần thật của siêu âm = 378.000. */
    async function prepareDiscountedInvoice() {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      const before = await openInvoice(encounterId);
      const disc = await http()
        .post(`/api/v1/billing/invoices/${encounterId}/discount`)
        .set(authed(receptionistToken))
        .send({ mode: 'TOTAL', invoiceId: before.invoiceId, discountType: 'PERCENT', discountValue: 10, reason: 'Khách quen', version: before.invoiceVersion });
      expect(disc.status, JSON.stringify(disc.body)).toBe(200);
      return { encounterId, imaging: order.items.find((i) => i.name.startsWith('Siêu âm'))! };
    }

    it('phiếu CHƯA THU: báo giá và số tiền giảm tính trên phần sau chiết khấu (378.000), phải thu mới 207.000', async () => {
      const { encounterId, imaging } = await prepareDiscountedInvoice();
      const { invoiceId, invoiceVersion, inv } = await openInvoice(encounterId);
      expect(inv.dueAmount).toBe(585_000);

      const q = await quote(encounterId, { invoiceId, orderItemIds: [imaging.id] });
      expect(q.body.data).toMatchObject({ action: 'REMOVE_LINE', amount: 378_000, newDueAmount: 207_000 });

      const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [imaging.id], reasonCode: 'PRICE_HIGH' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ totalAmount: 230_000, dueAmount: 207_000 });
    });

    it('phiếu ĐÃ THU: hoàn đúng 378.000 (phần khách thật sự đã trả cho dịch vụ này), KHÔNG hoàn 420.000 theo giá gốc', async () => {
      const { encounterId, imaging } = await prepareDiscountedInvoice();
      await pay(encounterId);
      const { invoiceId, invoiceVersion, inv } = await openInvoice(encounterId);
      expect(inv.payments.reduce((s, p) => s + p.amount, 0)).toBe(585_000);

      const q = await quote(encounterId, { invoiceId, orderItemIds: [imaging.id] });
      expect(q.body.data).toMatchObject({ action: 'REFUND', amount: 378_000, refundBreakdown: [{ method: 'CASH', amount: 378_000 }] });

      const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [imaging.id], reasonCode: 'PRICE_HIGH' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.refundedAmount).toBe(378_000);
    });
  });

  describe('đường dữ liệu vào bệnh án (cổng đọc dùng cho PDF)', () => {
    it('trả đúng dịch vụ + TÊN lý do + người xác nhận + ghi thêm; dòng huỷ do HUỶ LƯỢT KHÁM (không phải khách từ chối) KHÔNG lẫn vào; tenant khác không đọc được', async () => {
      const reader = app.get<ParaclinicalResultsReaderPort>(PARACLINICAL_RESULTS_READER_PORT);
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const glucose = order.items.find((i) => i.name.startsWith('Glucose'))!;
      const imaging = order.items.find((i) => i.name.startsWith('Siêu âm'))!;
      expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'PRICE_HIGH', reasonNote: 'Để mai' })).status).toBe(200);
      // Siêu âm bị CANCELLED nhưng KHÔNG qua luồng khách từ chối (như huỷ lượt khám #219): không có declinedAt.
      await privileged.clinicalOrderItem.update({ where: { id: imaging.id }, data: { status: 'CANCELLED' } });

      const got = await reader.listDeclinedForEncounters(fixture.tenantA.id, [encounterId]);
      expect(got[encounterId]).toHaveLength(1);
      expect(got[encounterId]![0]).toMatchObject({ orderItemId: glucose.id, serviceName: glucose.name, reasonLabel: 'Khách thấy giá cao', note: 'Để mai', declinedByName: receptionistName });
      expect(got[encounterId]![0]!.declinedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect(await reader.listDeclinedForEncounters(fixture.tenantB.id, [encounterId])).toEqual({});

      // Bệnh án trên màn hình (#280): endpoint kết quả cận lâm sàng trả thêm `declined` — cùng nội dung bản in; tenant khác không thấy.
      const screen = await http().get(`/api/v1/encounters/${encounterId}/medical-record/paraclinical`).set(authed(doctorToken));
      expect(screen.status, JSON.stringify(screen.body)).toBe(200);
      expect(screen.body.data.declined).toHaveLength(1);
      expect(screen.body.data.declined[0]).toMatchObject({ orderItemId: glucose.id, reasonLabel: 'Khách thấy giá cao', note: 'Để mai' });
      expect((await http().get(`/api/v1/encounters/${encounterId}/medical-record/paraclinical`).set(authed(tenantBAdminToken))).status).toBe(404);
      expect(await reader.listDeclinedForEncounters(fixture.tenantA.id, [])).toEqual({});
    });

    it('lý do bị ẨN sau đó vẫn hiện đúng tên trên bệnh án (hồ sơ cũ không mất lý do); mã bị xoá hẳn thì rơi về chính mã', async () => {
      const reader = app.get<ParaclinicalResultsReaderPort>(PARACLINICAL_RESULTS_READER_PORT);
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [order.items[0]!.id], reasonCode: 'LATER' })).status).toBe(200);

      await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'SERVICE_DECLINE_REASON', code: 'LATER' }, data: { isActive: false } });
      try {
        expect((await reader.listDeclinedForEncounters(fixture.tenantA.id, [encounterId]))[encounterId]![0]!.reasonLabel).toBe('Hẹn làm hôm khác');
      } finally {
        await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'SERVICE_DECLINE_REASON', code: 'LATER' }, data: { isActive: true } });
      }
      await privileged.clinicalOrderItem.update({ where: { id: order.items[0]!.id }, data: { declineReasonCode: 'MA_DA_XOA' } });
      expect((await reader.listDeclinedForEncounters(fixture.tenantA.id, [encounterId]))[encounterId]![0]!.reasonLabel).toBe('MA_DA_XOA');
    });
  });

  describe('dòng bị chặn + dữ liệu sai', () => {
    it('dịch vụ đã lấy mẫu / đang làm → 409 SERVICE_DECLINE_BLOCKED (việc đã làm thì vẫn phải trả tiền); tiền không đổi', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const glucose = order.items.find((i) => i.name.startsWith('Glucose'))!;
      await privileged.clinicalOrderItem.update({ where: { id: glucose.id }, data: { status: 'IN_PROGRESS' } });

      const preview = await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(receptionistToken));
      expect(preview.body.data.items.find((i: { name: string }) => i.name.startsWith('Glucose'))).toMatchObject({ declinable: false, blockedReason: 'WORK_STARTED', blockedLabel: 'Đã lấy mẫu hoặc đã thực hiện' });

      const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'PRICE_HIGH' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SERVICE_DECLINE_BLOCKED');
      expect(res.body.error.message).toContain('Glucose');
      expect((await invoiceOf(encounterId)).totalAmount).toBe(650_000);
    });

    it('lý do ngoài danh mục hoặc ĐÃ ẨN → 422; thiếu lý do → 400; dịch vụ không thuộc phiếu → 400; phiên bản phiếu cũ → 409', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const glucose = order.items[0]!;

      expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'KHONG_CO' })).status).toBe(422);
      expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: '' })).status).toBe(400);
      expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [randomUUID()], reasonCode: 'PRICE_HIGH' })).status).toBe(400);
      expect((await decline(encounterId, { invoiceId, invoiceVersion: invoiceVersion + 5, orderItemIds: [glucose.id], reasonCode: 'PRICE_HIGH' })).status).toBe(409);

      await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'SERVICE_DECLINE_REASON', code: 'DOCTOR_CHANGED' }, data: { isActive: false } });
      try {
        const hidden = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'DOCTOR_CHANGED' });
        expect(hidden.status).toBe(422);
        expect(hidden.body.error.code).toBe('SERVICE_DECLINE_REASON_INVALID');
      } finally {
        await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'SERVICE_DECLINE_REASON', code: 'DOCTOR_CHANGED' }, data: { isActive: true } });
      }
    });

    it('hai thu ngân bỏ CÙNG một dịch vụ đồng thời → đúng một người thành công, người kia nhận 409 và tiền chỉ giảm MỘT lần', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId), inHouse(imagingId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const glucose = order.items.find((i) => i.name.startsWith('Glucose'))!;
      const body = { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'PRICE_HIGH' };

      const [a, b] = await Promise.all([decline(encounterId, body), decline(encounterId, body, adminToken)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect((await invoiceOf(encounterId)).totalAmount).toBe(570_000);
    });

    it('phiếu đã đóng sổ (huỷ lượt khám) → không bỏ được (409)', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId)] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      await privileged.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLED' } });
      const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [order.items[0]!.id], reasonCode: 'PRICE_HIGH' });
      expect(res.status).toBe(409);
    });
  });

  describe('gói dịch vụ — ba chế độ', () => {
    it('mặc định BLOCK: dịch vụ trong gói bị chặn, gỡ cả gói mới được', async () => {
      await setPackageMode('BLOCK');
      const pkg = await createPackage('Gói chặn (bỏ dịch vụ)');
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [], packages: [{ servicePackageId: pkg.id }] });
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      const child = order.items[0]!;

      const preview = await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(receptionistToken));
      expect(preview.body.data.items.find((i: { orderItemId: string }) => i.orderItemId === child.id)).toMatchObject({ declinable: false, blockedReason: 'PACKAGE_ITEM_BLOCKED' });
      const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [child.id], reasonCode: 'PRICE_HIGH' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SERVICE_DECLINE_BLOCKED');
    });

    it('KEEP_PACKAGE_PRICE: bỏ một mục không đổi tiền; bỏ mục cuối = bỏ cả gói (dòng tiền gỡ, gói không còn tính vào tạm tính)', async () => {
      await setPackageMode('KEEP_PACKAGE_PRICE');
      try {
        const pkg = await createPackage('Gói giữ giá (bỏ dịch vụ)');
        const { encounterId } = await prepareEncounterInConsultation();
        const order = await saveOrder(encounterId, { items: [], packages: [{ servicePackageId: pkg.id }] });
        const [first, second] = order.items;
        let ctx = await openInvoice(encounterId);
        expect(ctx.inv.totalAmount).toBe(550_000); // 150.000 khám + 400.000 gói

        const q = await quote(encounterId, { invoiceId: ctx.invoiceId, orderItemIds: [first!.id] });
        expect(q.body.data).toMatchObject({ action: 'NO_MONEY_CHANGE', amount: 0, surcharge: 0 });
        expect((await decline(encounterId, { invoiceId: ctx.invoiceId, invoiceVersion: ctx.invoiceVersion, orderItemIds: [first!.id], reasonCode: 'LATER' })).status).toBe(200);
        expect((await invoiceOf(encounterId)).totalAmount).toBe(550_000); // giữ nguyên giá gói
        expect((await getOrder(encounterId)).inHouseTotal).toBe(400_000);

        ctx = await openInvoice(encounterId);
        const last = await decline(encounterId, { invoiceId: ctx.invoiceId, invoiceVersion: ctx.invoiceVersion, orderItemIds: [second!.id], reasonCode: 'LATER' });
        expect(last.status, JSON.stringify(last.body)).toBe(200);
        expect(last.body.data.totalAmount).toBe(150_000); // không ai trả tiền cho gói không còn dịch vụ nào
        const after = await getOrder(encounterId);
        expect(after.inHouseTotal).toBe(0);

        // Bác sĩ lưu lại chỉ định (gói đã "chết") không bị 409.
        expect((await http().put(orderUrl(encounterId)).set(authed(doctorToken)).send({ items: [], packages: [] })).status).toBe(200);
      } finally {
        await setPackageMode('BLOCK');
      }
    });

    it('REPRICE_SINGLE: tính lại theo giá lẻ — bỏ xét nghiệm thì phần còn lại (siêu âm 420.000) đắt hơn giá gói 400.000 nên khách trả THÊM 20.000; giá gói được chốt lại', async () => {
      await setPackageMode('REPRICE_SINGLE');
      try {
        const pkg = await createPackage('Gói tính lại (bỏ dịch vụ)');
        const { encounterId } = await prepareEncounterInConsultation();
        const order = await saveOrder(encounterId, { items: [], packages: [{ servicePackageId: pkg.id }] });
        const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
        const glucose = order.items.find((i) => i.name.startsWith('Glucose'))!;

        const q = await quote(encounterId, { invoiceId, orderItemIds: [glucose.id] });
        expect(q.body.data).toMatchObject({ action: 'REMOVE_LINE', amount: 0, surcharge: 20_000, newDueAmount: 570_000 });

        const res = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [glucose.id], reasonCode: 'PRICE_HIGH' });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.totalAmount).toBe(570_000);
        const after = await getOrder(encounterId);
        expect(after.packages[0]!.unitPrice).toBe(420_000); // màn chỉ định và hoá đơn cùng một con số
        expect(after.inHouseTotal).toBe(420_000);
      } finally {
        await setPackageMode('BLOCK');
      }
    });

    it('REPRICE_SINGLE trên phiếu ĐÃ THU bị chặn (tính lại có thể đòi thu thêm): 409 PACKAGE_REPRICE_PAID; chế độ giữ giá gói thì vẫn bỏ được', async () => {
      await setPackageMode('REPRICE_SINGLE');
      try {
        const pkg = await createPackage('Gói đã thu (bỏ dịch vụ)');
        const { encounterId } = await prepareEncounterInConsultation();
        const order = await saveOrder(encounterId, { items: [], packages: [{ servicePackageId: pkg.id }] });
        await pay(encounterId);
        const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
        const child = order.items[0]!;

        const preview = await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(receptionistToken));
        expect(preview.body.data.items.find((i: { orderItemId: string }) => i.orderItemId === child.id)).toMatchObject({ declinable: false, blockedReason: 'PACKAGE_REPRICE_PAID' });
        expect((await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [child.id], reasonCode: 'PRICE_HIGH' })).status).toBe(409);

        await setPackageMode('KEEP_PACKAGE_PRICE');
        const ok = await decline(encounterId, { invoiceId, invoiceVersion, orderItemIds: [child.id], reasonCode: 'PRICE_HIGH' });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(ok.body.data.refundedAmount).toBe(0); // giữ nguyên giá gói: không có tiền để hoàn
      } finally {
        await setPackageMode('BLOCK');
      }
    });
  });
  describe('vật tư tiêu hao đã ghi cho dịch vụ định bỏ (#297 GĐ4)', () => {
    let warehouseId: string;

    async function createSupply(name: string): Promise<string> {
      const res = await http()
        .post('/api/v1/drugs')
        .set(authed(adminToken))
        .send({
          code: `DC-${randomUUID().slice(0, 8)}`,
          name,
          itemType: 'SUPPLY',
          baseUnitCode: 'VIEN',
          manufacturerCode: 'TEST_MANUFACTURER',
          defaultSellPrice: 1000,
          isBatchManaged: true,
          drugGroupCode: 'TEST_GROUP',
          registrationNumber: 'VD-TEST-0001',
          ingredients: [],
          units: [],
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.id as string;
    }

    async function stockIn(drugId: string, quantity: number, unitCost: number) {
      const created = await http()
        .post('/api/v1/inventory/receipts')
        .set(authed(adminToken))
        .send({ warehouseId, receiptType: 'OPENING_BALANCE', lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost, batchNo: `DC-${randomUUID().slice(0, 6)}`, expiryDate: '2099-01-01' }] });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(adminToken)).send({ version: created.body.data.version });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    }

    const onHand = async (drugId: string): Promise<number> => {
      const rows = (await http().get('/api/v1/inventory/balances').set(authed(adminToken)).query({ warehouseId })).body.data.items as { drugId: string; quantityOnHand: number }[];
      return rows.find((r) => r.drugId === drugId)?.quantityOnHand ?? 0;
    };

    /** Lượt khám có 1 xét nghiệm đã ghi tiêu hao `used` đơn vị vật tư (kho còn `stock`). */
    async function encounterWithConsumption(stock: number, used: number) {
      const drugId = await createSupply(`Vật tư bỏ dịch vụ ${randomUUID().slice(0, 6)}`);
      await stockIn(drugId, stock, 500);
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await saveOrder(encounterId, { items: [inHouse(glucoseId)] });
      const itemId = order.items[0]!.id;
      const rec = await http()
        .post('/api/v1/service-consumption/records')
        .set(authed(adminToken))
        .send({ encounterId, target: { kind: 'CLINICAL_ORDER_ITEM', id: itemId }, lines: [{ drugId, quantity: used }] });
      expect(rec.status, JSON.stringify(rec.body)).toBe(200);
      const { invoiceId, invoiceVersion } = await openInvoice(encounterId);
      return { encounterId, itemId, drugId, invoiceId, invoiceVersion };
    }

    const previewOf = async (encounterId: string, invoiceId: string, token: string) => {
      const res = await http().get(declineUrl(encounterId)).query({ invoiceId }).set(authed(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data as {
        consumptions: { orderItemId: string; issueNo: string; totalCost: number | null; lines: { drugName: string; quantity: number }[] }[];
        canReverseConsumption: boolean;
      };
    };

    beforeAll(async () => {
      warehouseId = (await http().get('/api/v1/warehouses').set(authed(adminToken))).body.data.items[0].id;
    });

    it('xem trước: thu ngân thấy tên + số lượng vật tư đã ghi nhưng KHÔNG thấy giá vốn và không có quyền đảo; quản lý thấy giá vốn + được đảo; dịch vụ chưa ghi thì rỗng', async () => {
      const ctx = await encounterWithConsumption(10, 3);
      const asReceptionist = await previewOf(ctx.encounterId, ctx.invoiceId, receptionistToken);
      expect(asReceptionist.canReverseConsumption).toBe(false);
      expect(asReceptionist.consumptions).toHaveLength(1);
      expect(asReceptionist.consumptions[0]).toMatchObject({ orderItemId: ctx.itemId, totalCost: null });
      expect(asReceptionist.consumptions[0]!.lines).toMatchObject([{ quantity: 3 }]);

      const asAdmin = await previewOf(ctx.encounterId, ctx.invoiceId, adminToken);
      expect(asAdmin.canReverseConsumption).toBe(true);
      expect(asAdmin.consumptions[0]!.totalCost).toBe(1500);

      const plain = await prepareEncounterInConsultation();
      await saveOrder(plain.encounterId, { items: [inHouse(glucoseId)] });
      const plainInvoice = await openInvoice(plain.encounterId);
      expect((await previewOf(plain.encounterId, plainInvoice.invoiceId, adminToken)).consumptions).toEqual([]);
    });

    it('dịch vụ đã ghi tiêu hao mà không chọn cách xử lý → 400, KHÔNG huỷ dịch vụ, kho không đổi', async () => {
      const ctx = await encounterWithConsumption(10, 3);
      const res = await decline(ctx.encounterId, { invoiceId: ctx.invoiceId, invoiceVersion: ctx.invoiceVersion, orderItemIds: [ctx.itemId], reasonCode: 'PRICE_HIGH' });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect((await getOrder(ctx.encounterId)).items[0]!.status).toBe('ORDERED');
      expect(await onHand(ctx.drugId)).toBe(7);
    });

    it('"Giữ nguyên": huỷ dịch vụ, vật tư đã dùng KHÔNG hoàn kho và phiếu tiêu hao vẫn hiệu lực', async () => {
      const ctx = await encounterWithConsumption(10, 3);
      const res = await decline(ctx.encounterId, { invoiceId: ctx.invoiceId, invoiceVersion: ctx.invoiceVersion, orderItemIds: [ctx.itemId], reasonCode: 'PRICE_HIGH', consumptionAction: 'KEEP' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await getOrder(ctx.encounterId)).items[0]!.status).toBe('CANCELLED');
      expect(await onHand(ctx.drugId)).toBe(7);
      const stillThere = await privileged.stockIssue.count({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: ctx.itemId, issueType: 'SERVICE_CONSUMPTION', status: 'POSTED' } });
      expect(stillThere).toBe(1);
    });

    it('"Đảo phiếu" thiếu lý do → 400; người không có quyền đảo (thu ngân) → 403 và KHÔNG có gì thay đổi (cả dòng chỉ định lẫn kho)', async () => {
      const ctx = await encounterWithConsumption(10, 3);
      const body = { invoiceId: ctx.invoiceId, invoiceVersion: ctx.invoiceVersion, orderItemIds: [ctx.itemId], reasonCode: 'PRICE_HIGH', consumptionAction: 'REVERSE' };
      expect((await decline(ctx.encounterId, body, adminToken)).status).toBe(400);
      expect((await decline(ctx.encounterId, { ...body, consumptionReason: 'Khách đổi ý' })).status).toBe(403);
      expect((await getOrder(ctx.encounterId)).items[0]!.status).toBe('ORDERED');
      expect(await onHand(ctx.drugId)).toBe(7);
    });

    it('"Đảo phiếu" có lý do (quản lý): dịch vụ CANCELLED, tiền gỡ khỏi phiếu, vật tư hoàn về đúng kho, phiếu tiêu hao thành VOIDED, nhật ký ghi lý do', async () => {
      const ctx = await encounterWithConsumption(10, 3);
      const res = await decline(
        ctx.encounterId,
        { invoiceId: ctx.invoiceId, invoiceVersion: ctx.invoiceVersion, orderItemIds: [ctx.itemId], reasonCode: 'PRICE_HIGH', consumptionAction: 'REVERSE', consumptionReason: 'Khách bỏ trước khi thực hiện' },
        adminToken,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await getOrder(ctx.encounterId)).items[0]!.status).toBe('CANCELLED');
      expect(await onHand(ctx.drugId)).toBe(10);
      const issue = await privileged.stockIssue.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: ctx.itemId, issueType: 'SERVICE_CONSUMPTION' } });
      expect(issue.status).toBe('VOIDED');
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'service_consumption.reversed', entityId: issue.id } });
      expect(audit?.afterJson).toMatchObject({ reason: 'Khách bỏ trước khi thực hiện', viaServiceDecline: true });
    });
  });
});
