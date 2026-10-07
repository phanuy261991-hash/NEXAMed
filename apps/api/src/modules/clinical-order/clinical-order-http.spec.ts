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

/**
 * HTTP e2e — Cận lâm sàng GĐ3: Chỉ định của bác sĩ (docs/DECISIONS.md #212). Bao phủ: 2 đường (tại phòng khám/ra ngoài + tên tự do), tiền ghi vào hoá
 * đơn khám đang mở, gói = 1 dòng hoá đơn, gỡ/đổi dòng, khoá khi đã thu tiền + hoá đơn `PARACLINICAL` riêng, bảng giá có thời hạn, phân quyền, cách ly tenant.
 */
describe('HTTP e2e — /api/v1/encounters/:id/clinical-orders (Chỉ định cận lâm sàng GĐ3)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let receptionistToken: string;
  let nurseToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let otherDoctorToken: string;
  let tenantBAdminToken: string;

  let glucoseId: string; // XN tại phòng khám — 80.000
  let imagingId: string; // CĐHA tại phòng khám — 420.000
  let outsideOnlyId: string; // CT scan — phòng khám không tự làm
  let unpricedId: string; // làm tại phòng khám nhưng chưa có đơn giá

  const http = () => request(app.getHttpServer());
  const randomNationalId = (): string => '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const orderUrl = (encounterId: string) => `/api/v1/encounters/${encounterId}/clinical-orders`;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-order-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  async function createTechService(name: string, serviceKind: 'LAB' | 'IMAGING', opts: { amount?: number; inHouse?: boolean } = {}): Promise<string> {
    const res = await http()
      .post('/api/v1/technical-services')
      .set(authed(adminToken))
      .send({
        name,
        serviceKind,
        isPerformedInHouse: opts.inHouse ?? true,
        ...(opts.amount !== undefined ? { prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: opts.amount, effectiveFrom: '2020-01-01' }] } : {}),
      });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  /** Tiếp nhận + bắt đầu khám — hoá đơn khám 150.000 CỐ Ý giữ UNPAID ("Thanh toán sau"). */
  async function prepareEncounterInConsultation(): Promise<{ encounterId: string }> {
    const patientRes = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e chỉ định', dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
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

  async function save(encounterId: string, body: Record<string, unknown>, token = doctorToken) {
    return http().put(orderUrl(encounterId)).set(authed(token)).send(body);
  }

  async function savedOrder(encounterId: string, body: Record<string, unknown>, token = doctorToken) {
    const res = await save(encounterId, body, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.order as {
      id: string;
      orderNo: string;
      inHouseTotal: number;
      items: { id: string; name: string; performance: string; quantity: number; unitPrice: number | null; lineTotal: number | null; packageId: string | null; note: string | null; editable: boolean; placeName: string | null }[];
      packages: { id: string; name: string; unitPrice: number; editable: boolean }[];
      invoices: { invoiceId: string; invoiceType: string; status: string }[];
    };
  }

  async function invoiceOf(encounterId: string, invoiceId?: string) {
    const res = await http()
      .get(`/api/v1/billing/invoices/${encounterId}`)
      .set(authed(receptionistToken))
      .query(invoiceId ? { invoiceId } : {});
    expect(res.status).toBe(200);
    return res.body.data as { id: string; version: number; totalAmount: number; invoiceType: string; status: string; lines: { examTypeName: string; lineSource: string; clinicalOrderNo: string | null; lineTotal: number; quantity: number }[] };
  }

  const inHouse = (technicalServiceId: string, extra: Record<string, unknown> = {}) => ({ performance: 'IN_HOUSE', technicalServiceId, quantity: 1, ...extra });

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

    fixture = await createTwoTenantFixture(privileged, 'ClinicalOrder e2e');
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
    otherDoctorToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ deferredPaymentEnabled: true });

    glucoseId = await createTechService('Glucose máu lúc đói (chỉ định)', 'LAB', { amount: 80_000 });
    imagingId = await createTechService('Siêu âm ổ bụng (chỉ định)', 'IMAGING', { amount: 420_000 });
    outsideOnlyId = await createTechService('CT scan bụng (chỉ định)', 'IMAGING', { inHouse: false });
    unpricedId = await createTechService('XN chưa có giá (chỉ định)', 'LAB', {});
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền + phạm vi', () => {
    it('không token → 401; điều dưỡng/lễ tân XEM được nhưng KHÔNG lưu (403); bác sĩ KHÁC (personal) → 404', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      expect((await http().get(orderUrl(encounterId))).status).toBe(401);
      for (const token of [nurseToken, receptionistToken]) {
        const read = await http().get(orderUrl(encounterId)).set(authed(token));
        expect(read.status).toBe(200);
        expect(read.body.data.order).toBeNull();
        expect((await save(encounterId, { items: [inHouse(glucoseId)] }, token)).status).toBe(403);
      }
      expect((await save(encounterId, { items: [inHouse(glucoseId)] }, otherDoctorToken)).status).toBe(404);
      expect((await http().get(orderUrl(encounterId)).set(authed(otherDoctorToken))).status).toBe(200); // read = global
    });

    it('lượt khám chưa vào khám / đã hoàn tất → 409; chưa có phiếu mà gửi danh sách rỗng → order null, không tạo phiếu', async () => {
      const patientRes = await http().post('/api/v1/patients').set(authed(receptionistToken)).send({ fullName: 'Chưa vào khám', dob: '1990-01-01', gender: 'male', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
      const reg = await http()
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({ patientId: patientRes.body.data.id, doctorId: doctorUserId, services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }], receptionTypeCode: 'RT_NEW', examFormCode: 'EF_NORMAL', allowsDeferredPayment: true, checkedInAt: new Date().toISOString() });
      const checkedInOnly = reg.body.data.id as string;
      const res = await save(checkedInOnly, { items: [inHouse(glucoseId)] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_NOT_IN_CONSULTATION');

      const { encounterId } = await prepareEncounterInConsultation();
      const empty = await save(encounterId, { items: [] });
      expect(empty.status).toBe(200);
      expect(empty.body.data.order).toBeNull();
    });

    it('cách ly tenant: tenant B không xem/lưu được phiếu của tenant A (404)', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      await savedOrder(encounterId, { items: [inHouse(glucoseId)] });
      expect((await http().get(orderUrl(encounterId)).set(authed(tenantBAdminToken))).status).toBe(404);
      expect((await save(encounterId, { items: [] }, tenantBAdminToken)).status).toBe(404);
    });
  });

  describe('2 đường chỉ định + hoá đơn', () => {
    it('tại phòng khám lẻ: mã CLS, giá chốt, cộng vào hoá đơn khám đang mở (UNPAID) thành dòng nguồn cận lâm sàng; ra ngoài (tên tự do + dịch vụ không tự làm) không tính tiền', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await savedOrder(encounterId, {
        items: [
          inHouse(glucoseId, { quantity: 2 }),
          inHouse(imagingId),
          { performance: 'EXTERNAL', technicalServiceId: outsideOnlyId, quantity: 1, note: 'Nhịn ăn 6 giờ' },
          { performance: 'EXTERNAL', freeTextName: 'Đo mật độ xương DEXA', quantity: 1 },
        ],
      });
      expect(order.orderNo).toMatch(/^CLS/);
      expect(order.inHouseTotal).toBe(2 * 80_000 + 420_000);
      const glucose = order.items.find((i) => i.name.startsWith('Glucose'))!;
      expect(glucose).toMatchObject({ performance: 'IN_HOUSE', quantity: 2, unitPrice: 80_000, lineTotal: 160_000, editable: true });
      const ct = order.items.find((i) => i.name.startsWith('CT scan'))!;
      expect(ct).toMatchObject({ performance: 'EXTERNAL', unitPrice: null, lineTotal: null, note: 'Nhịn ăn 6 giờ' });
      expect(order.items.find((i) => i.name === 'Đo mật độ xương DEXA')).toMatchObject({ performance: 'EXTERNAL', unitPrice: null });

      expect(order.invoices).toHaveLength(1);
      expect(order.invoices[0]).toMatchObject({ invoiceType: 'SERVICE', status: 'UNPAID' });
      const invoice = await invoiceOf(encounterId);
      expect(invoice.totalAmount).toBe(150_000 + 580_000);
      const orderLines = invoice.lines.filter((l) => l.lineSource === 'PARACLINICAL');
      expect(orderLines).toHaveLength(2);
      expect(orderLines.every((l) => l.clinicalOrderNo === order.orderNo)).toBe(true);
      expect(invoice.lines.some((l) => l.examTypeName.startsWith('CT scan'))).toBe(false);
    });

    it('validate: làm tại phòng khám với dịch vụ không tự làm → 422; chưa có đơn giá → 422; tên tự do kèm IN_HOUSE → 400; dịch vụ lạ → 400', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const notInHouse = await save(encounterId, { items: [inHouse(outsideOnlyId)] });
      expect(notInHouse.status).toBe(422);
      expect(notInHouse.body.error.code).toBe('CLINICAL_ORDER_SERVICE_NOT_IN_HOUSE');
      const noPrice = await save(encounterId, { items: [inHouse(unpricedId)] });
      expect(noPrice.status).toBe(422);
      expect(noPrice.body.error.code).toBe('CLINICAL_ORDER_PRICE_MISSING');
      expect((await save(encounterId, { items: [{ performance: 'IN_HOUSE', freeTextName: 'Tự do', quantity: 1 }] })).status).toBe(400);
      expect((await save(encounterId, { items: [inHouse(randomUUID())] })).status).toBe(400);
      expect((await save(encounterId, { items: [{ performance: 'EXTERNAL', quantity: 1 }] })).status).toBe(400);
      // Lỗi giữa chừng KHÔNG để lại phiếu/hoá đơn dở dang (rollback cả giao dịch).
      expect((await http().get(orderUrl(encounterId)).set(authed(doctorToken))).body.data.order).toBeNull();
      expect((await invoiceOf(encounterId)).totalAmount).toBe(150_000);
    });
  });

  describe('sửa phiếu (so khớp theo id)', () => {
    it('gỡ dòng → trừ tiền hoá đơn; đổi số lượng → thay dòng + tiền; đổi ghi chú tại chỗ; dòng giữ nguyên giữ nguyên id', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const first = await savedOrder(encounterId, {
        items: [inHouse(glucoseId), inHouse(imagingId), { performance: 'EXTERNAL', freeTextName: 'MRI sọ não', quantity: 1 }],
      });
      expect((await invoiceOf(encounterId)).totalAmount).toBe(150_000 + 500_000);

      const glucose = first.items.find((i) => i.name.startsWith('Glucose'))!;
      const imaging = first.items.find((i) => i.name.startsWith('Siêu âm'))!;
      const mri = first.items.find((i) => i.name === 'MRI sọ não')!;

      // Gỡ siêu âm, nâng glucose lên 3, đổi ghi chú MRI.
      const second = await savedOrder(encounterId, {
        items: [
          { id: glucose.id, ...inHouse(glucoseId, { quantity: 3 }) },
          { id: mri.id, performance: 'EXTERNAL', freeTextName: 'MRI sọ não', quantity: 1, note: 'Không đeo kim loại' },
        ],
      });
      expect(second.items.find((i) => i.id === imaging.id)).toBeUndefined();
      const mriAfter = second.items.find((i) => i.name === 'MRI sọ não')!;
      expect(mriAfter.id).toBe(mri.id); // ghi chú đổi tại chỗ, không tạo dòng mới
      expect(mriAfter.note).toBe('Không đeo kim loại');
      const glucoseAfter = second.items.find((i) => i.name.startsWith('Glucose'))!;
      expect(glucoseAfter.quantity).toBe(3);
      expect(glucoseAfter.id).not.toBe(glucose.id); // đổi số lượng = thay dòng
      expect(second.inHouseTotal).toBe(240_000);
      expect((await invoiceOf(encounterId)).totalAmount).toBe(150_000 + 240_000);
    });

    it('dòng id không thuộc phiếu / trùng id → 400', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await savedOrder(encounterId, { items: [inHouse(glucoseId)] });
      const only = order.items[0]!;
      expect((await save(encounterId, { items: [{ id: randomUUID(), ...inHouse(glucoseId) }] })).status).toBe(400);
      expect((await save(encounterId, { items: [{ id: only.id, ...inHouse(glucoseId) }, { id: only.id, ...inHouse(glucoseId) }] })).status).toBe(400);
    });
  });

  describe('gói dịch vụ', () => {
    async function createPackage(name: string, extra: Record<string, unknown> = {}) {
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
          ...extra,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data as { id: string };
    }

    it('thêm theo gói: hoá đơn ghi ĐÚNG 1 dòng gói (giá chốt), dịch vụ con hiện trong phiếu nhưng không tính tiền riêng; gỡ gói → gỡ dòng tiền + dịch vụ con', async () => {
      const pkg = await createPackage('Gói XN + siêu âm (chỉ định)');
      const { encounterId } = await prepareEncounterInConsultation();
      const order = await savedOrder(encounterId, { items: [], packages: [{ servicePackageId: pkg.id }] });
      expect(order.packages).toHaveLength(1);
      expect(order.packages[0]).toMatchObject({ unitPrice: 400_000, editable: true });
      expect(order.items).toHaveLength(2);
      expect(order.items.every((i) => i.packageId === order.packages[0]!.id && i.unitPrice === null && i.performance === 'IN_HOUSE')).toBe(true);
      expect(order.inHouseTotal).toBe(400_000);

      const invoice = await invoiceOf(encounterId);
      expect(invoice.totalAmount).toBe(150_000 + 400_000);
      const packageLines = invoice.lines.filter((l) => l.lineSource === 'PARACLINICAL');
      expect(packageLines).toHaveLength(1);
      expect(packageLines[0]).toMatchObject({ examTypeName: 'Gói XN + siêu âm (chỉ định)', lineTotal: 400_000, quantity: 1 });

      // Đổi giá gói SAU khi đã chỉ định không đổi phiếu đã lưu (giá snapshot).
      const gets = await http().get('/api/v1/service-packages/' + pkg.id).set(authed(adminToken));
      await http().patch('/api/v1/service-packages/' + pkg.id).set(authed(adminToken)).send({ version: gets.body.data.version, fixedPrice: 999_000 });
      const again = await http().get(orderUrl(encounterId)).set(authed(doctorToken));
      expect(again.body.data.order.packages[0].unitPrice).toBe(400_000);

      // Gỡ gói (giữ lại danh sách rỗng).
      const removed = await savedOrder(encounterId, { items: [], packages: [] });
      expect(removed.packages).toHaveLength(0);
      expect(removed.items).toHaveLength(0);
      expect((await invoiceOf(encounterId)).totalAmount).toBe(150_000);
    });

    it('gói đã ngừng / chưa tới hiệu lực → 422 CLINICAL_ORDER_PACKAGE_NOT_ORDERABLE', async () => {
      const stopped = await createPackage('Gói đã ngừng (chỉ định)', { isActive: false });
      const future = await createPackage('Gói tương lai (chỉ định)', { effectiveFrom: '2099-01-01' });
      const { encounterId } = await prepareEncounterInConsultation();
      for (const pkg of [stopped, future]) {
        const res = await save(encounterId, { items: [], packages: [{ servicePackageId: pkg.id }] });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('CLINICAL_ORDER_PACKAGE_NOT_ORDERABLE');
      }
    });
  });

  describe('đã thu tiền + hoá đơn Cận lâm sàng riêng', () => {
    it('hoá đơn đã thu → KHÔNG gỡ/đổi được dòng đã thu (409), nhưng chỉ định THÊM được: tạo hoá đơn PARACLINICAL riêng, gỡ dòng mới → hoá đơn riêng tự đóng', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const first = await savedOrder(encounterId, { items: [inHouse(glucoseId)] });
      const glucose = first.items[0]!;

      // Thu tiền hoá đơn khám (gồm cả dòng glucose vừa cộng vào).
      const current = await invoiceOf(encounterId);
      const pay = await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: current.version });
      expect(pay.status).toBe(200);

      // Gỡ dòng đã thu → 409 khoá.
      const locked = await save(encounterId, { items: [] });
      expect(locked.status).toBe(409);
      expect(locked.body.error.code).toBe('CLINICAL_ORDER_ITEM_LOCKED');

      // Giữ nguyên dòng cũ + thêm siêu âm → hoá đơn PARACLINICAL riêng.
      const second = await savedOrder(encounterId, { items: [{ id: glucose.id, ...inHouse(glucoseId) }, inHouse(imagingId)] });
      expect(second.invoices.map((i) => i.invoiceType).sort()).toEqual(['PARACLINICAL', 'SERVICE']);
      const oldItem = second.items.find((i) => i.id === glucose.id)!;
      expect(oldItem.editable).toBe(false); // đã thu
      const newItem = second.items.find((i) => i.name.startsWith('Siêu âm'))!;
      expect(newItem.editable).toBe(true);
      const paraInvoice = second.invoices.find((i) => i.invoiceType === 'PARACLINICAL')!;
      expect(paraInvoice.status).toBe('UNPAID');
      const para = await invoiceOf(encounterId, paraInvoice.invoiceId);
      expect(para.totalAmount).toBe(420_000);
      expect(para.lines).toHaveLength(1);

      // Chỉ định thêm lần nữa → cộng tiếp vào hoá đơn PARACLINICAL đang mở (không tạo hoá đơn thứ 3).
      const third = await savedOrder(encounterId, { items: [{ id: glucose.id, ...inHouse(glucoseId) }, { id: newItem.id, ...inHouse(imagingId) }, inHouse(glucoseId, { quantity: 2 })] });
      expect(third.invoices).toHaveLength(2);
      expect((await invoiceOf(encounterId, paraInvoice.invoiceId)).totalAmount).toBe(420_000 + 160_000);

      // Gỡ hết dòng mới → hoá đơn PARACLINICAL không còn gì để thu → CANCELLED; hoá đơn khám đã thu giữ nguyên.
      const back = await savedOrder(encounterId, { items: [{ id: glucose.id, ...inHouse(glucoseId) }] });
      expect(back.items).toHaveLength(1);
      expect((await invoiceOf(encounterId, paraInvoice.invoiceId)).status).toBe('CANCELLED');
      expect((await invoiceOf(encounterId)).status).toBe('PAID');
    });
  });

  describe('bảng giá có thời hạn (GĐ2)', () => {
    it('bảng giá đang hiệu lực làm đổi giá chốt; ngừng bảng giá sau đó KHÔNG đổi dòng đã lưu', async () => {
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10);
      const list = await http()
        .post('/api/v1/price-lists')
        .set(authed(adminToken))
        .send({ name: 'Giảm XN (chỉ định)', effectiveFrom: day(-1), effectiveTo: day(1), priority: 10, lines: [{ itemKind: 'TECHNICAL_SERVICE', technicalServiceId: imagingId, priceTypeCode: 'THUONG', mode: 'NEW_PRICE', value: 300_000 }] });
      expect(list.status, JSON.stringify(list.body)).toBe(200);

      const { encounterId } = await prepareEncounterInConsultation();
      const order = await savedOrder(encounterId, { items: [inHouse(imagingId)] });
      expect(order.items[0]).toMatchObject({ unitPrice: 300_000 });
      expect((await invoiceOf(encounterId)).totalAmount).toBe(150_000 + 300_000);

      const stop = await http().patch(`/api/v1/price-lists/${list.body.data.id}`).set(authed(adminToken)).send({ version: list.body.data.version, isActive: false });
      expect(stop.status).toBe(200);
      const after = await http().get(orderUrl(encounterId)).set(authed(doctorToken));
      expect(after.body.data.order.items[0].unitPrice).toBe(300_000);
    });
  });

  describe('in phiếu', () => {
    it('ghi audit in phiếu; chưa có phiếu → 404', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      expect((await http().post(`${orderUrl(encounterId)}/print`).set(authed(doctorToken)).send({})).status).toBe(404);
      await savedOrder(encounterId, { items: [inHouse(glucoseId)] });
      const res = await http().post(`${orderUrl(encounterId)}/print`).set(authed(doctorToken)).send({});
      expect(res.status).toBe(200);
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'clinical_order.printed' } });
      expect(audit).not.toBeNull();
    });
  });
});
