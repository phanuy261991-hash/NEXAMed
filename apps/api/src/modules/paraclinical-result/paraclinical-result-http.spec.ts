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
 * HTTP e2e — Cận lâm sàng GĐ4 đợt 1: hàng đợi, lấy mẫu / gọi vào phòng, nhập + gửi duyệt + duyệt kết quả (docs/DECISIONS.md #212). Bao phủ: gộp xét nghiệm cùng
 * phiếu thành 1 dòng, chặn khi chưa thu tiền (và công tắc "thực hiện trước khi thu tiền"), khoảng tham chiếu theo giới tính + cờ Cao/Thấp, kết quả đã duyệt là bản
 * ký bất biến (kể cả khi danh mục bị sửa sau đó), phân quyền nhập/duyệt, huỷ lượt khám, cách ly tenant, audit "xem".
 */
describe('HTTP e2e — /api/v1/paraclinical (Hàng đợi & kết quả cận lâm sàng GĐ4)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let receptionistToken: string;
  let nurseToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let tenantBAdminToken: string;

  let hgbId: string;
  let urineId: string;
  let glucoseIndicatorId: string;
  let cbcId: string; // XN: HGB + nước tiểu, 150.000
  let glucoseId: string; // XN: glucose, 80.000
  let ultrasoundId: string; // CĐHA: mô tả + kết luận, 420.000

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const randomNationalId = (): string => '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  const orderUrl = (encounterId: string) => `/api/v1/encounters/${encounterId}/clinical-orders`;
  const resultUrl = (itemId: string) => `/api/v1/paraclinical/items/${itemId}/result`;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-para-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  async function createIndicator(body: Record<string, unknown>): Promise<string> {
    const res = await http().post('/api/v1/lab-indicators').set(authed(adminToken)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function createService(body: Record<string, unknown>): Promise<string> {
    const res = await http()
      .post('/api/v1/technical-services')
      .set(authed(adminToken))
      .send({ isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100_000, effectiveFrom: '2020-01-01' }], ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  /** Tiếp nhận (hoá đơn khám UNPAID, "Thanh toán sau") + bắt đầu khám. Bệnh nhân NỮ 41 tuổi để kiểm khoảng tham chiếu theo giới tính. */
  async function prepareEncounterInConsultation(): Promise<{ encounterId: string }> {
    const patientRes = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e kết quả', dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
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

  type OrderItem = { id: string; name: string; status: string };
  async function order(encounterId: string, technicalServiceIds: string[]): Promise<{ orderNo: string; items: OrderItem[] }> {
    const res = await http()
      .put(orderUrl(encounterId))
      .set(authed(doctorToken))
      .send({ items: technicalServiceIds.map((technicalServiceId) => ({ performance: 'IN_HOUSE', technicalServiceId, quantity: 1 })) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.order;
  }

  async function payAll(encounterId: string): Promise<void> {
    const inv = await http().get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
    expect(inv.status).toBe(200);
    const pay = await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: inv.body.data.version });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  }

  type QueueRow = { key: string; itemIds: string[]; orderNo: string; bucket: string; paid: boolean; serviceKind: string; serviceNames: string[] };
  async function queue(token: string, params: Record<string, string> = {}): Promise<{ items: QueueRow[]; counts: Record<string, number>; allowBeforePayment: boolean }> {
    const res = await http().get('/api/v1/paraclinical/queue').set(authed(token)).query(params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  }
  const rowsOf = async (orderNo: string, token = adminToken): Promise<QueueRow[]> => (await queue(token)).items.filter((r) => r.orderNo === orderNo);

  async function start(token: string, itemIds: string[]) {
    return http().post('/api/v1/paraclinical/start').set(authed(token)).send({ itemIds });
  }

  const form = async (itemId: string, token = adminToken) => {
    const res = await http().get(resultUrl(itemId)).set(authed(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.form as {
      bucket: string;
      sections: { itemId: string; name: string; status: string; indicators: { indicatorId: string; name: string; valueText: string | null; flag: string | null; referenceText: string; reference: { lowValue: number | null; highValue: number | null } | null }[]; descriptionText: string | null; conclusionText: string | null }[];
      signedAt: string | null;
      signedByName: string | null;
      approvers: { id: string }[];
      performedById: string | null;
    };
  };

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

    fixture = await createTwoTenantFixture(privileged, 'ParaclinicalResult e2e');
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
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ deferredPaymentEnabled: true });

    // HGB: nam 130–175, nữ 120–160 (từ 15 tuổi). Nước tiểu: chọn, bình thường = Âm tính. Glucose: 3.9–5.5 mọi giới.
    hgbId = await createIndicator({
      name: 'HGB (kết quả)',
      unit: 'g/L',
      valueType: 'NUMBER',
      references: [
        { sex: 'MALE', ageFromYears: 15, lowValue: 130, highValue: 175 },
        { sex: 'FEMALE', ageFromYears: 15, lowValue: 120, highValue: 160 },
      ],
    });
    urineId = await createIndicator({ name: 'Nước tiểu (kết quả)', valueType: 'CHOICE', choiceOptions: ['Âm tính', 'Dương tính'], references: [{ normalText: 'Âm tính' }] });
    glucoseIndicatorId = await createIndicator({ name: 'Glucose (kết quả)', unit: 'mmol/L', valueType: 'NUMBER', references: [{ lowValue: 3.9, highValue: 5.5 }] });

    cbcId = await createService({ name: 'Công thức máu (kết quả)', serviceKind: 'LAB', indicators: [{ indicatorId: hgbId }, { indicatorId: urineId, interpretationText: 'Dương tính cần xét nghiệm lại' }], prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 150_000, effectiveFrom: '2020-01-01' }] });
    glucoseId = await createService({ name: 'Glucose máu (kết quả)', serviceKind: 'LAB', indicators: [{ indicatorId: glucoseIndicatorId }], prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 80_000, effectiveFrom: '2020-01-01' }] });
    ultrasoundId = await createService({ name: 'Siêu âm ổ bụng (kết quả)', serviceKind: 'IMAGING', prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 420_000, effectiveFrom: '2020-01-01' }] });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('không token → 401; lễ tân chỉ XEM hàng đợi (không lấy mẫu → 403); điều dưỡng lấy mẫu/nhập được nhưng KHÔNG duyệt (403); bác sĩ duyệt được', async () => {
      expect((await http().get('/api/v1/paraclinical/queue')).status).toBe(401);
      expect((await queue(receptionistToken)).items).toBeDefined();
      expect((await start(receptionistToken, [randomUUID()])).status).toBe(403);

      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [glucoseId]);
      await payAll(encounterId);
      const itemId = placed.items[0]!.id;
      expect((await start(nurseToken, [itemId])).status).toBe(200);

      const body = { sections: [{ itemId, values: [{ indicatorId: glucoseIndicatorId, valueText: '5,0' }] }], submit: true };
      expect((await http().put(resultUrl(itemId)).set(authed(nurseToken)).send(body)).status).toBe(200);
      expect((await http().post(`${resultUrl(itemId)}/approve`).set(authed(nurseToken)).send(body)).status).toBe(403);
      expect((await http().post(`${resultUrl(itemId)}/approve`).set(authed(doctorToken)).send(body)).status).toBe(200);
    });

    it('cách ly tenant: tenant B không mở được kết quả của tenant A (404) và không thấy trong hàng đợi', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [glucoseId]);
      expect((await http().get(resultUrl(placed.items[0]!.id)).set(authed(tenantBAdminToken))).status).toBe(404);
      expect((await queue(tenantBAdminToken)).items.filter((r) => r.orderNo === placed.orderNo)).toHaveLength(0);
    });
  });

  describe('hàng đợi + lấy mẫu', () => {
    it('xét nghiệm cùng phiếu GỘP 1 dòng, CĐHA riêng; chưa thu tiền → "Chờ thu tiền", lấy mẫu bị chặn; thu tiền rồi → "Chờ lấy mẫu", lấy mẫu cả nhóm; lấy lại → 409', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [cbcId, glucoseId, ultrasoundId]);

      const before = await rowsOf(placed.orderNo);
      expect(before).toHaveLength(2);
      const lab = before.find((r) => r.serviceKind === 'LAB')!;
      const imaging = before.find((r) => r.serviceKind === 'IMAGING')!;
      expect(lab.itemIds).toHaveLength(2);
      expect(lab.serviceNames.sort()).toEqual(['Công thức máu (kết quả)', 'Glucose máu (kết quả)']);
      expect(imaging.itemIds).toHaveLength(1);
      expect([lab.bucket, imaging.bucket, lab.paid]).toEqual(['AWAITING_PAYMENT', 'AWAITING_PAYMENT', false]);

      const blocked = await start(nurseToken, lab.itemIds);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('PARACLINICAL_PAYMENT_REQUIRED');

      await payAll(encounterId);
      const waiting = await rowsOf(placed.orderNo);
      expect(waiting.map((r) => r.bucket)).toEqual(['WAITING', 'WAITING']);
      expect(waiting.every((r) => r.paid)).toBe(true);

      const started = await start(nurseToken, lab.itemIds);
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      const after = await rowsOf(placed.orderNo);
      expect(after.find((r) => r.serviceKind === 'LAB')!.bucket).toBe('IN_PROGRESS');
      expect(after.find((r) => r.serviceKind === 'IMAGING')!.bucket).toBe('WAITING');

      const again = await start(nurseToken, lab.itemIds);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('PARACLINICAL_ITEM_INVALID_STATE');
    });

    it('lọc theo tab + tìm theo tên bệnh nhân không dấu; đếm tab độc lập bộ lọc', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [glucoseId]);
      const all = await queue(adminToken, { bucket: 'AWAITING_PAYMENT' });
      expect(all.items.some((r) => r.orderNo === placed.orderNo)).toBe(true);
      expect(all.counts.AWAITING_PAYMENT).toBeGreaterThan(0);
      const found = await queue(adminToken, { q: 'benh nhan e2e ket qua' });
      expect(found.items.some((r) => r.orderNo === placed.orderNo)).toBe(true);
      const none = await queue(adminToken, { q: 'khong-co-ai-ten-nay' });
      expect(none.items).toHaveLength(0);
      expect(none.counts.AWAITING_PAYMENT).toBe(all.counts.AWAITING_PAYMENT);
    });

    it('công tắc "thực hiện trước khi thu tiền": bật → chưa thu vẫn vào "Chờ lấy mẫu" và lấy mẫu được; tắt lại → chặn như cũ', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [ultrasoundId]);
      const on = await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ paraclinicalBeforePaymentEnabled: true });
      expect(on.status, JSON.stringify(on.body)).toBe(200);
      try {
        const q = await queue(adminToken);
        expect(q.allowBeforePayment).toBe(true);
        const row = q.items.find((r) => r.orderNo === placed.orderNo)!;
        expect([row.bucket, row.paid]).toEqual(['WAITING', false]);
        expect((await start(nurseToken, row.itemIds)).status).toBe(200);
      } finally {
        await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ paraclinicalBeforePaymentEnabled: false });
      }
      const second = await prepareEncounterInConsultation();
      const placed2 = await order(second.encounterId, [ultrasoundId]);
      const row2 = (await rowsOf(placed2.orderNo))[0]!;
      expect(row2.bucket).toBe('AWAITING_PAYMENT');
      expect((await start(nurseToken, row2.itemIds)).status).toBe(409);
    });

    it('huỷ lượt khám → dịch vụ biến khỏi hàng đợi và không lấy mẫu được', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [glucoseId]);
      await payAll(encounterId);
      const itemId = placed.items[0]!.id;
      const cancel = await http().post(`/api/v1/encounters/${encounterId}/cancel`).set(authed(adminToken)).send({ cancelReason: 'Khách bỏ về', version: 2 });
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      expect(await rowsOf(placed.orderNo)).toHaveLength(0);
      expect((await start(nurseToken, [itemId])).status).toBe(409);
    });
  });

  describe('nhập + duyệt kết quả xét nghiệm', () => {
    it('chọn khoảng tham chiếu theo giới tính (nữ 120–160), gắn cờ Cao/Thấp, nháp → gửi duyệt (phải đủ) → duyệt; bản đã duyệt bất biến dù danh mục bị sửa sau đó', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [cbcId, glucoseId]);
      await payAll(encounterId);
      const lab = (await rowsOf(placed.orderNo))[0]!;
      await start(nurseToken, lab.itemIds);

      // Mở màn nhập: 2 dịch vụ cùng 1 màn, khoảng tham chiếu của NỮ.
      const opened = await form(lab.key);
      expect(opened.sections).toHaveLength(2);
      const cbc = opened.sections.find((s) => s.name === 'Công thức máu (kết quả)')!;
      const glu = opened.sections.find((s) => s.name === 'Glucose máu (kết quả)')!;
      const hgbRow = cbc.indicators.find((i) => i.indicatorId === hgbId)!;
      expect(hgbRow.reference).toMatchObject({ lowValue: 120, highValue: 160 });
      expect(hgbRow.referenceText).toBe('120 - 160');
      expect(opened.approvers.length).toBeGreaterThan(0);

      const body = (hgb: string, urine: string | null, glucose: string | null, submit: boolean) => ({
        sections: [
          { itemId: cbc.itemId, values: [{ indicatorId: hgbId, valueText: hgb, note: 'Thiếu máu nhẹ' }, { indicatorId: urineId, valueText: urine }] },
          { itemId: glu.itemId, values: [{ indicatorId: glucoseIndicatorId, valueText: glucose }] },
        ],
        submit,
      });

      // Số sai định dạng → 422, không ghi gì.
      const bad = await http().put(resultUrl(lab.key)).set(authed(nurseToken)).send(body('abc', null, null, false));
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('PARACLINICAL_RESULT_INCOMPLETE');

      // Lưu nháp (glucose để trống) → vẫn "Đang thực hiện", HGB 104 < 120 ⇒ LOW.
      const draft = await http().put(resultUrl(lab.key)).set(authed(nurseToken)).send(body('104', 'Âm tính', null, false));
      expect(draft.status, JSON.stringify(draft.body)).toBe(200);
      const draftForm = draft.body.data.form as Awaited<ReturnType<typeof form>>;
      expect(draftForm.bucket).toBe('IN_PROGRESS');
      const draftHgb = draftForm.sections.find((s) => s.itemId === cbc.itemId)!.indicators.find((i) => i.indicatorId === hgbId)!;
      expect([draftHgb.valueText, draftHgb.flag]).toEqual(['104', 'LOW']);
      const draftUrine = draftForm.sections.find((s) => s.itemId === cbc.itemId)!.indicators.find((i) => i.indicatorId === urineId)!;
      expect(draftUrine.flag).toBe('NORMAL');

      // Gửi duyệt khi còn thiếu glucose → 422 và vẫn là nháp.
      const incomplete = await http().put(resultUrl(lab.key)).set(authed(nurseToken)).send(body('104', 'Âm tính', null, true));
      expect(incomplete.status).toBe(422);
      expect((await form(lab.key)).bucket).toBe('IN_PROGRESS');

      // Gửi duyệt đủ → "Chờ duyệt".
      const submitted = await http().put(resultUrl(lab.key)).set(authed(nurseToken)).send(body('104', 'Dương tính', '7,2', true));
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
      expect(submitted.body.data.form.bucket).toBe('PENDING_APPROVAL');
      const pending = (await rowsOf(placed.orderNo))[0]!;
      expect(pending.bucket).toBe('PENDING_APPROVAL');

      // Bác sĩ duyệt (ký).
      const approved = await http().post(`${resultUrl(lab.key)}/approve`).set(authed(doctorToken)).send(body('104', 'Dương tính', '7,2', true));
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const done = approved.body.data.form as Awaited<ReturnType<typeof form>>;
      expect(done.bucket).toBe('COMPLETED');
      expect(done.signedAt).not.toBeNull();
      expect(done.signedByName).toBe('User doctor');
      const gluDone = done.sections.find((s) => s.itemId === glu.itemId)!.indicators[0]!;
      expect([gluDone.valueText, gluDone.flag]).toEqual(['7,2', 'HIGH']);
      expect(done.sections.find((s) => s.itemId === cbc.itemId)!.indicators.find((i) => i.indicatorId === urineId)!.flag).toBe('ABNORMAL');

      // Đã ký → sửa trực tiếp bị chặn (409), kể cả duyệt lại.
      const edit = await http().put(resultUrl(lab.key)).set(authed(doctorToken)).send(body('130', 'Âm tính', '5,0', false));
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('PARACLINICAL_ITEM_INVALID_STATE');
      expect((await http().post(`${resultUrl(lab.key)}/approve`).set(authed(doctorToken)).send(body('130', 'Âm tính', '5,0', true))).status).toBe(409);

      // Sửa khoảng tham chiếu trong danh mục SAU khi duyệt → phiếu đã duyệt vẫn hiện khoảng ĐÃ CHỤP (120–160).
      const ind = await http().get(`/api/v1/lab-indicators/${hgbId}`).set(authed(adminToken));
      const patched = await http()
        .patch(`/api/v1/lab-indicators/${hgbId}`)
        .set(authed(adminToken))
        .send({ version: ind.body.data.version, references: [{ sex: 'FEMALE', ageFromYears: 15, lowValue: 100, highValue: 110 }] });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const reopened = await form(lab.key);
      const frozen = reopened.sections.find((s) => s.itemId === cbc.itemId)!.indicators.find((i) => i.indicatorId === hgbId)!;
      expect(frozen.reference).toMatchObject({ lowValue: 120, highValue: 160 });
      expect(frozen.flag).toBe('LOW');

      // DB cưỡng chế bất biến: sửa thẳng nội dung kết quả đã ký bị trigger chặn.
      await expect(privileged.paraclinicalResult.updateMany({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: cbc.itemId }, data: { conclusionText: 'sửa lén' } })).rejects.toThrow(/đã ký/);
      await expect(privileged.paraclinicalResultValue.updateMany({ where: { tenantId: fixture.tenantA.id, labIndicatorId: hgbId }, data: { valueText: '999' } })).rejects.toThrow(/đã ký/);

      // Tab "Đã trả kết quả" thấy phiếu này.
      const completed = await queue(adminToken, { bucket: 'COMPLETED' });
      expect(completed.items.some((r) => r.orderNo === placed.orderNo)).toBe(true);
    });
  });

  describe('nhập + duyệt kết quả chẩn đoán hình ảnh', () => {
    it('cần cả mô tả lẫn kết luận mới gửi duyệt/duyệt; xong → COMPLETED, ghi audit lưu/duyệt', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [ultrasoundId]);
      await payAll(encounterId);
      const row = (await rowsOf(placed.orderNo))[0]!;
      await start(nurseToken, row.itemIds);

      const opened = await form(row.key);
      expect(opened.sections).toHaveLength(1);
      expect(opened.sections[0]!.indicators).toHaveLength(0);

      const section = (description: string | null, conclusion: string | null) => ({ itemId: row.key, values: [], descriptionText: description, conclusionText: conclusion });
      const missing = await http().post(`${resultUrl(row.key)}/approve`).set(authed(doctorToken)).send({ sections: [section('Gan nhiễm mỡ nhẹ.', null)] });
      expect(missing.status).toBe(422);

      const draft = await http().put(resultUrl(row.key)).set(authed(nurseToken)).send({ sections: [section('Gan nhiễm mỡ nhẹ.', null)] });
      expect(draft.status).toBe(200);
      expect(draft.body.data.form.sections[0].descriptionText).toBe('Gan nhiễm mỡ nhẹ.');

      const approved = await http().post(`${resultUrl(row.key)}/approve`).set(authed(doctorToken)).send({ sections: [section('Gan nhiễm mỡ nhẹ.', 'Gan nhiễm mỡ độ I.')] });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(approved.body.data.form.bucket).toBe('COMPLETED');
      expect(approved.body.data.form.sections[0].conclusionText).toBe('Gan nhiễm mỡ độ I.');

      const actions = (await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, entityType: 'paraclinical_result' }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['paraclinical_result.saved', 'paraclinical_result.approved']));
    });

    it('GET kết quả ghi audit "xem"; chưa lấy mẫu mở màn nhập → 409', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [ultrasoundId]);
      await payAll(encounterId);
      const itemId = placed.items[0]!.id;
      expect((await http().get(resultUrl(itemId)).set(authed(adminToken))).status).toBe(409);
      await start(nurseToken, [itemId]);
      expect((await http().get(resultUrl(itemId)).set(authed(adminToken))).status).toBe(200);
      const viewed = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'paraclinical_result.viewed', entityId: itemId } });
      expect(viewed).not.toBeNull();
    });
  });
});
