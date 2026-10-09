import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getVietnamDateString } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Lấy mẫu xét nghiệm có ống mẫu, mã ống (SID) và tem mã vạch (docs/DECISIONS.md #220). Bao phủ: mở hộp thoại sinh ống gộp theo loại mẫu (idempotent) + SID toàn số,
 * tách ống, in tem, xác nhận THEO TỪNG ỐNG (lấy một phần → hàng đợi tách 2 dòng), chặn khi chưa thu tiền, công tắc "Bắt buộc quét đủ ống", tra mã ống (kể cả ống đã huỷ),
 * huỷ ống & lấy lại, huỷ xác nhận đã lấy (chặn khi đã có bản nháp kết quả), cách ly tenant và phân quyền.
 */
describe('HTTP e2e — /api/v1/paraclinical/lab/specimen-tubes (Lấy mẫu xét nghiệm có tem mã vạch)', () => {
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

  let glucoseId: string; // huyết thanh · nhóm Sinh hoá (SH) · có chỉ số glucose
  let ureId: string; // huyết thanh · SH
  let cbcId: string; // máu toàn phần EDTA · nhóm Huyết học (HH)

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const lab = '/api/v1/paraclinical/lab';
  const randomNationalId = (): string => '079' + Math.floor(100000000 + Math.random() * 899999999).toString();

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-tube-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  async function createCatalog(body: Record<string, unknown>): Promise<string> {
    const res = await http().post('/api/v1/reference-catalog').set(authed(adminToken)).send({ sortOrder: 0, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.code as string;
  }

  async function createService(body: Record<string, unknown>): Promise<string> {
    const res = await http()
      .post('/api/v1/technical-services')
      .set(authed(adminToken))
      .send({ isPerformedInHouse: true, serviceKind: 'LAB', prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100_000, effectiveFrom: '2020-01-01' }], ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function prepareEncounter(): Promise<{ encounterId: string }> {
    const patientRes = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e ống mẫu', dob: '1985-03-09', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
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

  type OrderItem = { id: string; name: string; status: string; technicalServiceId: string };
  async function order(encounterId: string, serviceIds: string[]): Promise<{ id: string; orderNo: string; items: OrderItem[] }> {
    const res = await http()
      .put(`/api/v1/encounters/${encounterId}/clinical-orders`)
      .set(authed(doctorToken))
      .send({ items: serviceIds.map((technicalServiceId) => ({ performance: 'IN_HOUSE', technicalServiceId, quantity: 1 })) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.order;
  }

  async function payAll(encounterId: string): Promise<void> {
    const inv = await http().get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
    expect(inv.status).toBe(200);
    const pay = await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: inv.body.data.version });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  }

  type Tube = {
    id: string;
    sid: string;
    status: 'PENDING' | 'COLLECTED' | 'CANCELLED';
    specimenName: string | null;
    capColor: string | null;
    capLabel: string | null;
    groupAbbreviation: string | null;
    printCount: number;
    collectedAt: string | null;
    collectedByName: string | null;
    collectedVia: string | null;
    cancelReason: string | null;
    replacesSid: string | null;
    replacedBySid: string | null;
    items: { itemId: string; name: string; canSplit: boolean }[];
    canRecollect: boolean;
    canUncollect: boolean;
  };
  type State = { orderId: string; orderNo: string; paid: boolean; scanRequired: boolean; patientName: string; patientBirthYear: number | null; patientGender: string | null; tubes: Tube[] };

  const open = (orderId: string, token = nurseToken) => http().post(`${lab}/orders/${orderId}/specimen-collection/open`).set(authed(token)).send();
  const openState = async (orderId: string, token = nurseToken): Promise<State> => {
    const res = await open(orderId, token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.state as State;
  };
  const collect = (tubes: { tubeId: string; via: 'SCAN' | 'MANUAL' }[], token = nurseToken) => http().post(`${lab}/specimen-tubes/collect`).set(authed(token)).send({ tubes });
  const stateOf = (res: request.Response): State => {
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.state as State;
  };

  type QueueRow = { key: string; orderId: string; itemIds: string[]; orderNo: string; bucket: string; tubes: { id: string | null; sid: string | null; status: string; capColor: string | null }[]; collectedAt: string | null; collectedByName: string | null; hasDraft: boolean };
  async function queueRows(orderNo: string): Promise<QueueRow[]> {
    const res = await http().get(`${lab}/queue`).set(authed(nurseToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.data.items as QueueRow[]).filter((r) => r.orderNo === orderNo);
  }

  /** Tiếp nhận + khám + chỉ định + (tuỳ chọn) thu tiền → phiếu sẵn sàng lấy mẫu. */
  async function placedOrder(serviceIds: string[], paid = true) {
    const { encounterId } = await prepareEncounter();
    const placed = await order(encounterId, serviceIds);
    if (paid) await payAll(encounterId);
    return { encounterId, placed };
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

    fixture = await createTwoTenantFixture(privileged, 'SpecimenTube e2e');
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

    // Danh mục: 2 loại mẫu (màu nắp đỏ / tím) và 2 nhóm dịch vụ (viết tắt SH / HH).
    const serum = await createCatalog({ category: 'SPECIMEN_TYPE', name: 'Huyết thanh (e2e ống)', capColor: 'RED' });
    const edta = await createCatalog({ category: 'SPECIMEN_TYPE', name: 'Máu toàn phần EDTA (e2e ống)', capColor: 'PURPLE' });
    const biochem = await createCatalog({ category: 'TECH_SERVICE_CATEGORY', name: 'Sinh hoá (e2e ống)', abbreviation: 'SH' });
    const hema = await createCatalog({ category: 'TECH_SERVICE_CATEGORY', name: 'Huyết học (e2e ống)', abbreviation: 'HH' });

    const glucoseIndicator = await http()
      .post('/api/v1/lab-indicators')
      .set(authed(adminToken))
      .send({ name: 'Glucose (e2e ống)', unit: 'mmol/L', valueType: 'NUMBER', references: [{ lowValue: 3.9, highValue: 5.5 }] });
    expect(glucoseIndicator.status, JSON.stringify(glucoseIndicator.body)).toBe(200);

    glucoseId = await createService({ name: 'Glucose máu (e2e ống)', specimenTypeCode: serum, categoryCode: biochem, indicators: [{ indicatorId: glucoseIndicator.body.data.id }] });
    ureId = await createService({ name: 'Ure máu (e2e ống)', specimenTypeCode: serum, categoryCode: biochem });
    cbcId = await createService({ name: 'Công thức máu (e2e ống)', specimenTypeCode: edta, categoryCode: hema });
  });

  afterAll(async () => {
    await privileged.$disconnect();
    await app.close();
  });

  describe('mở hộp thoại — sinh ống', () => {
    it('gộp xét nghiệm theo loại mẫu (cùng huyết thanh → 1 ống), kèm màu nắp, viết tắt nhóm, SID toàn số theo ngày; mở lại không đẻ thêm ống', async () => {
      const { placed } = await placedOrder([glucoseId, ureId, cbcId]);
      const state = await openState(placed.id);

      expect(state.orderNo).toBe(placed.orderNo);
      expect(state.paid).toBe(true);
      expect(state.scanRequired).toBe(false);
      expect(state.patientBirthYear).toBe(1985);
      expect(state.patientGender).toBe('female');
      expect(state.tubes).toHaveLength(2);

      const serumTube = state.tubes.find((t) => t.specimenName?.startsWith('Huyết thanh'))!;
      const edtaTube = state.tubes.find((t) => t.specimenName?.startsWith('Máu toàn phần'))!;
      expect(serumTube.items.map((i) => i.name).sort()).toEqual(['Glucose máu (e2e ống)', 'Ure máu (e2e ống)']);
      expect(serumTube).toMatchObject({ status: 'PENDING', capColor: 'RED', capLabel: 'Nắp đỏ', groupAbbreviation: 'SH', printCount: 0 });
      expect(edtaTube).toMatchObject({ capColor: 'PURPLE', capLabel: 'Nắp tím', groupAbbreviation: 'HH' });
      expect(edtaTube.items).toHaveLength(1);

      // SID mặc định toàn số: yyMMdd (giờ VN) + 4 chữ số đánh số lại mỗi ngày.
      const today = getVietnamDateString().replaceAll('-', '').slice(2);
      for (const tube of state.tubes) expect(tube.sid).toMatch(new RegExp(`^${today}\\d{4}$`));
      expect(new Set(state.tubes.map((t) => t.sid)).size).toBe(2);

      // Idempotent.
      const again = await openState(placed.id);
      expect(again.tubes.map((t) => t.sid).sort()).toEqual(state.tubes.map((t) => t.sid).sort());

      const logs = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'specimen_tube.created', entityId: { in: state.tubes.map((t) => t.id) } } });
      expect(logs).toHaveLength(2);
    });

    it('dòng thêm vào phiếu sau đó gộp vào ống chưa in tem cùng loại mẫu', async () => {
      // Phiếu CHƯA thu tiền nên bác sĩ còn thêm/bớt chỉ định được (dòng đã thu tiền bị khoá).
      const { encounterId, placed } = await placedOrder([glucoseId], false);
      const first = await openState(placed.id);
      expect(first.tubes).toHaveLength(1);

      const second = await http()
        .put(`/api/v1/encounters/${encounterId}/clinical-orders`)
        .set(authed(doctorToken))
        .send({ items: [glucoseId, ureId].map((technicalServiceId) => ({ performance: 'IN_HOUSE', technicalServiceId, quantity: 1 })) });
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      const after = await openState(placed.id);
      expect(after.tubes.filter((t) => t.status === 'PENDING')).toHaveLength(1);
      expect(after.tubes.find((t) => t.status === 'PENDING')!.items).toHaveLength(2);
    });

    it('phân quyền + cách ly tenant: lễ tân (không có lab_result) → 403; quản trị tenant khác → 404', async () => {
      const { placed } = await placedOrder([glucoseId]);
      expect((await open(placed.id, receptionistToken)).status).toBe(403);
      expect((await open(placed.id, tenantBAdminToken)).status).toBe(404);
      expect((await open(randomUUID())).status).toBe(404);
    });
  });

  describe('tách ống và in tem', () => {
    it('tách 1 xét nghiệm sang ống riêng (SID mới); ống 1 xét nghiệm hoặc đã in tem thì không tách được', async () => {
      const { placed } = await placedOrder([glucoseId, ureId, cbcId]);
      const state = await openState(placed.id);
      const serumTube = state.tubes.find((t) => t.items.length === 2)!;
      const single = state.tubes.find((t) => t.items.length === 1)!;

      const ure = serumTube.items.find((i) => i.name.startsWith('Ure'))!;
      const split = stateOf(await http().post(`${lab}/specimen-tubes/${serumTube.id}/split`).set(authed(nurseToken)).send({ itemId: ure.itemId }));
      expect(split.tubes).toHaveLength(3);
      const newTube = split.tubes.find((t) => t.items.some((i) => i.itemId === ure.itemId))!;
      expect(newTube.id).not.toBe(serumTube.id);
      expect(newTube.sid).not.toBe(serumTube.sid);
      expect(newTube.capColor).toBe('RED');
      expect(split.tubes.find((t) => t.id === serumTube.id)!.items).toHaveLength(1);

      // Ống 1 xét nghiệm → 409.
      const refuse = await http().post(`${lab}/specimen-tubes/${single.id}/split`).set(authed(nurseToken)).send({ itemId: single.items[0]!.itemId });
      expect(refuse.status).toBe(409);
      expect(refuse.body.error.code).toBe('SPECIMEN_TUBE_INVALID_STATE');
    });

    it('in tem tăng số lần in và ghi audit; ống đã in tem không tách được; ống đã huỷ không in được', async () => {
      const { placed } = await placedOrder([glucoseId, ureId]);
      const state = await openState(placed.id);
      const tube = state.tubes[0]!;

      const printed = stateOf(await http().post(`${lab}/specimen-tubes/print`).set(authed(nurseToken)).send({ tubeIds: [tube.id] }));
      expect(printed.tubes[0]!.printCount).toBe(1);
      expect(printed.tubes[0]!.items.every((i) => !i.canSplit)).toBe(true);
      const printedAgain = stateOf(await http().post(`${lab}/specimen-tubes/print`).set(authed(nurseToken)).send({ tubeIds: [tube.id] }));
      expect(printedAgain.tubes[0]!.printCount).toBe(2);

      const split = await http().post(`${lab}/specimen-tubes/${tube.id}/split`).set(authed(nurseToken)).send({ itemId: tube.items[0]!.itemId });
      expect(split.status).toBe(409);

      const logs = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'specimen_tube.printed', entityId: tube.id } });
      expect(logs).toHaveLength(2);

      // Huỷ ống rồi in → 409.
      const recollected = stateOf(await http().post(`${lab}/specimen-tubes/${tube.id}/recollect`).set(authed(nurseToken)).send({ reason: 'Dán nhầm tem' }));
      const cancelled = recollected.tubes.find((t) => t.id === tube.id)!;
      expect(cancelled.status).toBe('CANCELLED');
      const printCancelled = await http().post(`${lab}/specimen-tubes/print`).set(authed(nurseToken)).send({ tubeIds: [tube.id] });
      expect(printCancelled.status).toBe(409);
    });
  });

  describe('xác nhận đã lấy mẫu — theo từng ống', () => {
    it('lấy MỘT PHẦN: ống đã lấy sang "Đã lấy mẫu", ống chưa lấy ở lại "Chờ lấy mẫu" (hàng đợi tách 2 dòng); ghi giờ, người, cách xác nhận', async () => {
      const { placed } = await placedOrder([glucoseId, cbcId]);
      const state = await openState(placed.id);
      const serumTube = state.tubes.find((t) => t.capColor === 'RED')!;
      const edtaTube = state.tubes.find((t) => t.capColor === 'PURPLE')!;

      // Trước khi lấy: hàng đợi có 1 dòng "Chờ lấy mẫu" với 2 ống (đã sinh SID).
      const before = await queueRows(placed.orderNo);
      expect(before).toHaveLength(1);
      expect(before[0]!.bucket).toBe('WAITING');
      expect(before[0]!.tubes.map((t) => t.sid).sort()).toEqual([serumTube.sid, edtaTube.sid].sort());

      const done = stateOf(await collect([{ tubeId: serumTube.id, via: 'SCAN' }]));
      const collected = done.tubes.find((t) => t.id === serumTube.id)!;
      expect(collected).toMatchObject({ status: 'COLLECTED', collectedVia: 'SCAN', canUncollect: true });
      expect(collected.collectedAt).not.toBeNull();
      expect(collected.collectedByName).toBe('User nurse');
      expect(done.tubes.find((t) => t.id === edtaTube.id)!.status).toBe('PENDING');

      const rows = await queueRows(placed.orderNo);
      expect(rows).toHaveLength(2);
      const inProgress = rows.find((r) => r.bucket === 'IN_PROGRESS')!;
      expect(inProgress.tubes).toMatchObject([{ sid: serumTube.sid, status: 'COLLECTED' }]);
      expect(inProgress.collectedAt).not.toBeNull();
      expect(inProgress.collectedByName).toBe('User nurse');
      expect(inProgress.hasDraft).toBe(false);
      const waiting = rows.find((r) => r.bucket === 'WAITING')!;
      expect(waiting.tubes).toMatchObject([{ sid: edtaTube.sid, status: 'PENDING' }]);

      // Lấy nốt ống còn lại bằng tích tay: hết dòng "Chờ lấy mẫu".
      const rest = stateOf(await collect([{ tubeId: edtaTube.id, via: 'MANUAL' }]));
      expect(rest.tubes.every((t) => t.status === 'COLLECTED')).toBe(true);
      expect((await queueRows(placed.orderNo)).every((r) => r.bucket === 'IN_PROGRESS')).toBe(true);

      // Lấy lại ống đã lấy → 409.
      const twice = await collect([{ tubeId: serumTube.id, via: 'SCAN' }]);
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('SPECIMEN_TUBE_INVALID_STATE');
    });

    it('chưa thu tiền thì không lấy mẫu được (PARACLINICAL_PAYMENT_REQUIRED)', async () => {
      const { placed } = await placedOrder([glucoseId], false);
      const state = await openState(placed.id);
      expect(state.paid).toBe(false);
      const res = await collect([{ tubeId: state.tubes[0]!.id, via: 'MANUAL' }]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PARACLINICAL_PAYMENT_REQUIRED');
    });

    it('công tắc "Bắt buộc quét đủ ống": bật thì tích tay bị từ chối (SPECIMEN_SCAN_REQUIRED), quét vẫn được', async () => {
      const { placed } = await placedOrder([glucoseId, cbcId]);
      const state = await openState(placed.id);
      const [first, second] = state.tubes;

      const on = await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ specimenScanRequired: true });
      expect(on.status, JSON.stringify(on.body)).toBe(200);
      try {
        expect((await openState(placed.id)).scanRequired).toBe(true);
        const manual = await collect([{ tubeId: first!.id, via: 'MANUAL' }]);
        expect(manual.status).toBe(409);
        expect(manual.body.error.code).toBe('SPECIMEN_SCAN_REQUIRED');
        stateOf(await collect([{ tubeId: first!.id, via: 'SCAN' }]));
      } finally {
        await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ specimenScanRequired: false });
      }
      // Tắt lại → tích tay được.
      stateOf(await collect([{ tubeId: second!.id, via: 'MANUAL' }]));
    });
  });

  describe('tra mã ống', () => {
    it('trả phiếu + bệnh nhân + tab hiện tại; ống đã lấy kèm itemId để mở màn nhập kết quả; mã lạ/tenant khác → 404', async () => {
      const { placed } = await placedOrder([glucoseId]);
      const state = await openState(placed.id);
      const tube = state.tubes[0]!;
      const lookup = (sid: string, token = nurseToken) => http().get(`${lab}/specimen-tubes/lookup`).set(authed(token)).query({ sid });

      const pending = await lookup(`  ${tube.sid}\r\n`);
      expect(pending.status, JSON.stringify(pending.body)).toBe(200);
      expect(pending.body.data).toMatchObject({ sid: tube.sid, status: 'PENDING', orderNo: placed.orderNo, bucket: 'WAITING', itemId: null, replacedBySid: null, encounterCancelled: false });
      expect(pending.body.data.patientName).toBe('Bệnh nhân e2e ống mẫu');

      stateOf(await collect([{ tubeId: tube.id, via: 'SCAN' }]));
      const collected = await lookup(tube.sid);
      expect(collected.body.data).toMatchObject({ status: 'COLLECTED', bucket: 'IN_PROGRESS', itemId: tube.items[0]!.itemId });

      expect((await lookup('0000000000')).status).toBe(404);
      expect((await lookup(tube.sid, tenantBAdminToken)).status).toBe(404);
      expect((await lookup('   ')).status).toBe(400);
    });
  });

  describe('huỷ ống & lấy lại', () => {
    it('ống chưa lấy: huỷ → ống mới (SID mới, thay ống cũ), ống cũ giữ CANCELLED kèm lý do; tra mã ống cũ báo ống thay thế', async () => {
      const { placed } = await placedOrder([glucoseId]);
      const tube = (await openState(placed.id)).tubes[0]!;

      const bad = await http().post(`${lab}/specimen-tubes/${tube.id}/recollect`).set(authed(nurseToken)).send({ reason: '' });
      expect(bad.status).toBe(400);

      const after = stateOf(await http().post(`${lab}/specimen-tubes/${tube.id}/recollect`).set(authed(nurseToken)).send({ reason: 'Mẫu đông' }));
      const old = after.tubes.find((t) => t.id === tube.id)!;
      const fresh = after.tubes.find((t) => t.status === 'PENDING')!;
      expect(old).toMatchObject({ status: 'CANCELLED', cancelReason: 'Mẫu đông', replacedBySid: fresh.sid, canRecollect: false });
      expect(old.items).toHaveLength(0);
      expect(fresh.sid).not.toBe(tube.sid);
      expect(fresh).toMatchObject({ replacesSid: tube.sid, capColor: 'RED' });
      expect(fresh.items).toHaveLength(1);

      const lookup = await http().get(`${lab}/specimen-tubes/lookup`).set(authed(nurseToken)).query({ sid: tube.sid });
      expect(lookup.status).toBe(200);
      expect(lookup.body.data).toMatchObject({ status: 'CANCELLED', replacedBySid: fresh.sid });
    });

    it('ống đã lấy: huỷ → xét nghiệm trở lại "Chờ lấy mẫu"', async () => {
      const { placed } = await placedOrder([cbcId]);
      const tube = (await openState(placed.id)).tubes[0]!;
      stateOf(await collect([{ tubeId: tube.id, via: 'MANUAL' }]));
      expect((await queueRows(placed.orderNo))[0]!.bucket).toBe('IN_PROGRESS');

      stateOf(await http().post(`${lab}/specimen-tubes/${tube.id}/recollect`).set(authed(nurseToken)).send({ reason: 'Vỡ ống' }));
      const rows = await queueRows(placed.orderNo);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ bucket: 'WAITING', collectedAt: null });
    });
  });

  describe('huỷ xác nhận đã lấy mẫu', () => {
    it('trả ống về "Chờ lấy mẫu" khi chưa có kết quả; đã lưu nháp kết quả thì 409 (cả huỷ xác nhận lẫn huỷ ống)', async () => {
      const { placed } = await placedOrder([glucoseId]);
      const tube = (await openState(placed.id)).tubes[0]!;
      stateOf(await collect([{ tubeId: tube.id, via: 'MANUAL' }]));

      const noReason = await http().post(`${lab}/specimen-tubes/uncollect`).set(authed(nurseToken)).send({ tubeIds: [tube.id], reason: '' });
      expect(noReason.status).toBe(400);

      const reverted = stateOf(await http().post(`${lab}/specimen-tubes/uncollect`).set(authed(nurseToken)).send({ tubeIds: [tube.id], reason: 'Bấm nhầm' }));
      expect(reverted.tubes[0]).toMatchObject({ status: 'PENDING', collectedAt: null, collectedByName: null, collectedVia: null });
      const waiting = await queueRows(placed.orderNo);
      expect(waiting).toHaveLength(1);
      expect(waiting[0]).toMatchObject({ bucket: 'WAITING', collectedAt: null });

      // Lấy lại, nhập nháp kết quả → không huỷ được nữa.
      stateOf(await collect([{ tubeId: tube.id, via: 'MANUAL' }]));
      const itemId = tube.items[0]!.itemId;
      const draft = await http()
        .put(`${lab}/items/${itemId}/result`)
        .set(authed(nurseToken))
        .send({ sections: [{ itemId, values: [] }], submit: false });
      expect(draft.status, JSON.stringify(draft.body)).toBe(200);
      const rows = await queueRows(placed.orderNo);
      expect(rows[0]).toMatchObject({ bucket: 'IN_PROGRESS', hasDraft: true });

      const blocked = await http().post(`${lab}/specimen-tubes/uncollect`).set(authed(nurseToken)).send({ tubeIds: [tube.id], reason: 'Muốn lấy lại' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('SPECIMEN_TUBE_INVALID_STATE');
      const blockedRecollect = await http().post(`${lab}/specimen-tubes/${tube.id}/recollect`).set(authed(nurseToken)).send({ reason: 'Muốn lấy lại' });
      expect(blockedRecollect.status).toBe(409);

      const logs = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'specimen_tube.uncollected', entityId: tube.id } });
      expect(logs).toHaveLength(1);
    });
  });
});
