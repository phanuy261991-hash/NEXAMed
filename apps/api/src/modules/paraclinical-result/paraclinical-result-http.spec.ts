import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PARACLINICAL_RESULTS_READER_PORT, type ParaclinicalResultsReaderPort } from '@nexamed/core';
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
  // Tách 2 menu (#215): mỗi dòng chỉ định thuộc nhóm `lab` (xét nghiệm) hoặc `imaging` (CĐHA/thăm dò) — URL, quyền và hàng đợi khác nhau. Sổ này ghi nhớ nhóm của từng dòng.
  type Group = 'lab' | 'imaging';
  const groupByService = new Map<string, Group>();
  const groupByItem = new Map<string, Group>();
  const groupOfItem = (itemId: string): Group => groupByItem.get(itemId) ?? 'lab';
  const baseUrl = (group: Group) => `/api/v1/paraclinical/${group}`;
  const resultUrl = (itemId: string) => `${baseUrl(groupOfItem(itemId))}/items/${itemId}/result`;

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
    groupByService.set(res.body.data.id as string, body.serviceKind === 'LAB' ? 'lab' : 'imaging');
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
    for (const item of res.body.data.order.items as { id: string; technicalServiceId: string }[]) groupByItem.set(item.id, groupByService.get(item.technicalServiceId) ?? 'lab');
    return res.body.data.order;
  }

  async function payAll(encounterId: string): Promise<void> {
    const inv = await http().get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
    expect(inv.status).toBe(200);
    const pay = await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: inv.body.data.version });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  }

  type QueueRow = { key: string; orderId: string; itemIds: string[]; orderNo: string; bucket: string; paid: boolean; serviceKind: string; serviceNames: string[] };
  type QueueData = { items: QueueRow[]; counts: Record<string, number>; allowBeforePayment: boolean };
  async function queueOf(group: Group, token: string, params: Record<string, string> = {}): Promise<QueueData> {
    const res = await http().get(`${baseUrl(group)}/queue`).set(authed(token)).query(params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const row of (res.body.data as QueueData).items) for (const id of row.itemIds) groupByItem.set(id, group);
    return res.body.data;
  }
  /** Hàng đợi của CẢ HAI menu gộp lại (mọi test cũ vốn xem chung); token thiếu quyền một nhóm thì nhóm đó coi như rỗng. */
  async function queue(token: string, params: Record<string, string> = {}): Promise<QueueData> {
    const merged: QueueData = { items: [], counts: {}, allowBeforePayment: false };
    for (const group of ['lab', 'imaging'] as const) {
      const probe = await http().get(`${baseUrl(group)}/queue`).set(authed(token)).query(params);
      if (probe.status === 403) continue;
      const data = await queueOf(group, token, params);
      merged.items.push(...data.items);
      for (const [bucket, n] of Object.entries(data.counts)) merged.counts[bucket] = (merged.counts[bucket] ?? 0) + n;
      merged.allowBeforePayment = data.allowBeforePayment;
    }
    return merged;
  }
  const rowsOf = async (orderNo: string, token = adminToken): Promise<QueueRow[]> => (await queue(token)).items.filter((r) => r.orderNo === orderNo);

  /**
   * "Lấy mẫu" / "Gọi vào phòng". CĐHA & thăm dò: `POST imaging/start`. Xét nghiệm (docs/DECISIONS.md #220) đi qua ống mẫu: mở hộp thoại (sinh ống) rồi xác nhận mọi ống chứa các dòng này
   * bằng tích tay — trả về phản hồi của bước ghi cuối cùng (hoặc của bước mở nếu đã lỗi) để các test cũ vẫn kiểm status/code như trước.
   */
  async function start(token: string, itemIds: string[]) {
    if (groupOfItem(itemIds[0]!) === 'imaging') return http().post(`${baseUrl('imaging')}/start`).set(authed(token)).send({ itemIds });
    const row = (await queue(token)).items.find((r) => r.itemIds.some((id) => itemIds.includes(id)));
    if (!row) return http().post(`${baseUrl('lab')}/specimen-tubes/collect`).set(authed(token)).send({ tubes: [{ tubeId: randomUUID(), via: 'MANUAL' }] });
    type TubeState = { id: string; status: string; items: { itemId: string; canSplit: boolean }[] };
    let res = await http().post(`${baseUrl('lab')}/orders/${row.orderId}/specimen-collection/open`).set(authed(token)).send();
    if (res.status !== 200) return res;
    // Xét nghiệm cùng loại mẫu (hoặc cùng chưa khai loại mẫu) nằm chung 1 ống: muốn chỉ lấy một phần thì TÁCH các dòng không cần sang ống riêng trước (như KTV làm ở hộp thoại).
    for (let guard = 0; guard < 20; guard += 1) {
      const tubes = res.body.data.state.tubes as TubeState[];
      const mixed = tubes.find((t) => t.status === 'PENDING' && t.items.some((i) => itemIds.includes(i.itemId)) && t.items.some((i) => !itemIds.includes(i.itemId) && i.canSplit));
      if (!mixed) break;
      const extra = mixed.items.find((i) => !itemIds.includes(i.itemId))!;
      res = await http().post(`${baseUrl('lab')}/specimen-tubes/${mixed.id}/split`).set(authed(token)).send({ itemId: extra.itemId });
      if (res.status !== 200) return res;
    }
    const tubes = (res.body.data.state.tubes as TubeState[]).filter((t) => t.items.some((i) => itemIds.includes(i.itemId)));
    return http()
      .post(`${baseUrl('lab')}/specimen-tubes/collect`)
      .set(authed(token))
      .send({ tubes: tubes.map((t) => ({ tubeId: t.id, via: 'MANUAL' })) });
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
      expect((await http().get('/api/v1/paraclinical/lab/queue')).status).toBe(401);
      expect((await http().get('/api/v1/paraclinical/imaging/queue')).status).toBe(401);
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

    it('phân quyền theo phòng: vai trò scope "department" chỉ thấy/xử lý dịch vụ do ĐÚNG Khoa/Phòng của mình thực hiện (xét nghiệm và CĐHA không thấy việc của nhau); chưa gán phòng → rỗng; global thấy hết', async () => {
      const tenantId = fixture.tenantA.id;
      const makeDept = async (name: string) => (await privileged.department.create({ data: { tenantId, name, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
      const labDept = await makeDept('Phòng xét nghiệm (test)');
      const imgDept = await makeDept('Phòng CĐHA (test)');

      // Vai trò tuỳ biến: lab_result + imaging_result (read/enter) ở scope "department".
      const created = await http().post('/api/v1/roles').set(authed(adminToken)).send({ name: `KTV theo phòng ${randomUUID().slice(0, 6)}` });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const roleId = created.body.data.id as string;
      const matrix = await http().get(`/api/v1/roles/${roleId}/permissions`).set(authed(adminToken));
      const perm = (key: string) => (matrix.body.data.permissions as { permissionId: string; module: string; action: string }[]).find((x) => `${x.module}.${x.action}` === key)!.permissionId;
      const saved = await http()
        .put(`/api/v1/roles/${roleId}/permissions`)
        .set(authed(adminToken))
        .send({ version: matrix.body.data.role.version, entries: ['lab_result.read', 'lab_result.enter', 'imaging_result.read', 'imaging_result.enter'].map((k) => ({ permissionId: perm(k), dataScope: 'department' })) });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);

      const makeUser = async (departmentId: string | null) => {
        const username = `e2e-dept-${randomUUID()}`;
        const user = await privileged.userAccount.create({
          data: { tenantId, username, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), fullName: 'KTV phòng', departmentId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
        });
        await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
        const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
        return login.body.data.accessToken as string;
      };
      const labToken = await makeUser(labDept);
      const imgToken = await makeUser(imgDept);
      const noDeptToken = await makeUser(null);

      const labSvc = await createService({ name: `XN phòng riêng ${randomUUID().slice(0, 4)}`, serviceKind: 'LAB', departmentId: labDept, indicators: [{ indicatorId: glucoseIndicatorId }] });
      const imgSvc = await createService({ name: `SA phòng riêng ${randomUUID().slice(0, 4)}`, serviceKind: 'IMAGING', departmentId: imgDept });
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [labSvc, imgSvc]);
      await payAll(encounterId);
      const labItem = placed.items.find((i) => i.name.startsWith('XN phòng riêng'))!;
      const imgItem = placed.items.find((i) => i.name.startsWith('SA phòng riêng'))!;

      const kinds = async (token: string) => (await queue(token)).items.filter((r) => r.orderNo === placed.orderNo).map((r) => r.serviceKind).sort();
      expect(await kinds(labToken)).toEqual(['LAB']);
      expect(await kinds(imgToken)).toEqual(['IMAGING']);
      expect(await kinds(noDeptToken)).toEqual([]);
      expect(await kinds(adminToken)).toEqual(['IMAGING', 'LAB']);

      // Việc của phòng khác: 404 (không phải 403) ở mọi thao tác.
      expect((await start(labToken, [imgItem.id])).status).toBe(404);
      expect((await http().get(resultUrl(imgItem.id)).set(authed(labToken))).status).toBe(404);
      expect((await start(noDeptToken, [labItem.id])).status).toBe(404);
      // Việc của phòng mình: làm được.
      expect((await start(labToken, [labItem.id])).status).toBe(200);
      expect((await http().get(resultUrl(labItem.id)).set(authed(labToken))).status).toBe(200);
      expect((await http().get(resultUrl(labItem.id)).set(authed(imgToken))).status).toBe(404);
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
      // Ống đã lấy rồi (docs/DECISIONS.md #220): lỗi trạng thái của ỐNG, không còn của dòng chỉ định.
      expect(again.body.error.code).toBe('SPECIMEN_TUBE_INVALID_STATE');
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
      // Dòng chưa bắt đầu đã bị đóng (#219) nên phiếu không còn xét nghiệm nào để lấy mẫu → 404 (không còn 409 như khi lấy mẫu một cú bấm).
      expect((await start(nurseToken, [itemId])).status).toBe(404);
    });

    it('huỷ lượt khám (#219) chỉ đóng dòng CHƯA BẮT ĐẦU (ORDERED → CANCELLED); dòng đang làm dở và dòng đã duyệt giữ nguyên; ghi số dòng đã đóng vào audit; tạm tính không còn cộng dòng đã huỷ', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [glucoseId, ultrasoundId, cbcId]);
      await payAll(encounterId);
      const byName = (needle: string) => placed.items.find((i) => i.name.includes(needle))!.id;
      const doneId = byName('Glucose');
      const doingId = byName('Siêu âm');
      const untouchedId = byName('Công thức máu');

      // Glucose: lấy mẫu → nhập → duyệt (COMPLETED); siêu âm: gọi vào phòng (IN_PROGRESS); công thức máu: chưa làm gì (ORDERED).
      expect((await start(nurseToken, [doneId])).status).toBe(200);
      const body = { sections: [{ itemId: doneId, values: [{ indicatorId: glucoseIndicatorId, valueText: '5,0' }] }], submit: true };
      expect((await http().put(resultUrl(doneId)).set(authed(nurseToken)).send(body)).status).toBe(200);
      expect((await http().post(`${resultUrl(doneId)}/approve`).set(authed(doctorToken)).send(body)).status).toBe(200);
      expect((await start(nurseToken, [doingId])).status).toBe(200);

      const cancel = await http().post(`/api/v1/encounters/${encounterId}/cancel`).set(authed(adminToken)).send({ cancelReason: 'Khách bỏ về giữa chừng', version: 2 });
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);

      const statusOf = async (id: string) => (await privileged.clinicalOrderItem.findUniqueOrThrow({ where: { id } })).status;
      expect(await statusOf(untouchedId)).toBe('CANCELLED');
      expect(await statusOf(doingId)).toBe('IN_PROGRESS');
      expect(await statusOf(doneId)).toBe('COMPLETED');
      // Kết quả đã ký không bị chạm.
      expect((await privileged.paraclinicalResult.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: doneId, deletedAt: null } })).signedAt).not.toBeNull();

      const audit = await privileged.auditLog.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, action: 'encounter.cancelled', entityId: encounterId } });
      expect(audit.afterJson).toMatchObject({ cancelledOrderItemCount: 1 });

      // Màn khám: dòng đã huỷ báo CANCELLED + không còn sửa/gỡ được; tạm tính không cộng dòng đã huỷ.
      const detail = (await http().get(orderUrl(encounterId)).set(authed(adminToken))).body.data.order as { items: { id: string; status: string; editable: boolean; lineTotal: number | null }[]; inHouseTotal: number };
      const cancelled = detail.items.find((i) => i.id === untouchedId)!;
      expect([cancelled.status, cancelled.editable]).toEqual(['CANCELLED', false]);
      expect(detail.inHouseTotal).toBe(detail.items.filter((i) => i.status !== 'CANCELLED').reduce((sum, i) => sum + (i.lineTotal ?? 0), 0));

      // Lấy mẫu dòng đã huỷ không được (lượt khám đã huỷ): dòng không còn trong phiếu nên không có ống nào để mở/lấy → 404.
      expect((await start(nurseToken, [untouchedId])).status).toBe(404);
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

      // Khối "Kết quả đã có" ở màn khám: chưa duyệt thì chưa có mốc "Trả lúc".
      const beforeApprove = await http().get(orderUrl(encounterId)).set(authed(doctorToken));
      expect(beforeApprove.status, JSON.stringify(beforeApprove.body)).toBe(200);
      expect(beforeApprove.body.data.order.items[0].resultReturnedAt).toBeNull();

      const approved = await http().post(`${resultUrl(row.key)}/approve`).set(authed(doctorToken)).send({ sections: [section('Gan nhiễm mỡ nhẹ.', 'Gan nhiễm mỡ độ I.')] });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(approved.body.data.form.bucket).toBe('COMPLETED');
      expect(approved.body.data.form.sections[0].conclusionText).toBe('Gan nhiễm mỡ độ I.');

      const afterApprove = await http().get(orderUrl(encounterId)).set(authed(doctorToken));
      expect(afterApprove.body.data.order.items[0].status).toBe('COMPLETED');
      expect(afterApprove.body.data.order.items[0].resultReturnedAt).toBe(approved.body.data.form.signedAt);

      const actions = (await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, entityType: 'paraclinical_result' }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['paraclinical_result.saved', 'paraclinical_result.approved']));

      // In phiếu kết quả: chỉ có sau khi đã có kết quả; ghi audit; form trả đủ thông tin cho bản in (ngày sinh, mốc đăng ký, nhóm).
      const printed = await http().post(`${resultUrl(row.key)}/print`).set(authed(nurseToken)).send({});
      expect(printed.status, JSON.stringify(printed.body)).toBe(200);
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'paraclinical_result.printed' } });
      expect(audit).not.toBeNull();
      const full = (await form(row.key)) as unknown as { patientDob: string; registeredAt: string; sections: { categoryName: string | null }[] };
      expect(full.patientDob).toBe('1985-01-01');
      expect(full.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(full.sections[0]).toHaveProperty('categoryName');
      expect((await http().post(`${resultUrl(randomUUID())}/print`).set(authed(nurseToken)).send({})).status).toBe(404);
    });

    it('ảnh đính kèm: thêm (magic-byte JPG/PNG) → có đường dẫn ký xem được; gỡ; sai định dạng → 4xx; xét nghiệm không có ảnh; đã duyệt → 409 và DB chặn', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [ultrasoundId, glucoseId]);
      await payAll(encounterId);
      const imgItem = placed.items.find((i) => i.name.startsWith('Siêu âm'))!;
      const labItem = placed.items.find((i) => i.name.startsWith('Glucose'))!;
      await start(nurseToken, [imgItem.id]);
      await start(nurseToken, [labItem.id]);

      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
      const upload = (itemId: string, buffer: Buffer, name = 'sieu-am.png', token = nurseToken) => http().post(`${baseUrl('imaging')}/items/${itemId}/images`).set(authed(token)).attach('file', buffer, name);

      const ok = await upload(imgItem.id, png);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const images = ok.body.data.form.sections[0].images as { id: string; fileName: string; url: string }[];
      expect(images).toHaveLength(1);
      expect(images[0]!.url).toMatch(/^\/api\/v1\/files\//);
      const served = await http().get(images[0]!.url);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toContain('image/png');

      // Sai định dạng / không có file / quyền / xét nghiệm không có ảnh.
      expect((await upload(imgItem.id, Buffer.from('không phải ảnh'), 'x.png')).status).toBeGreaterThanOrEqual(400);
      expect((await http().post(`${baseUrl('imaging')}/items/${imgItem.id}/images`).set(authed(nurseToken))).status).toBe(400);
      expect((await upload(imgItem.id, png, 'a.png', receptionistToken)).status).toBe(403);
      // Xét nghiệm không có ảnh: endpoint ảnh thuộc menu CĐHA nên dịch vụ loại LAB không tồn tại ở đó (404).
      expect((await upload(labItem.id, png)).status).toBe(404);

      // Gỡ ảnh.
      const removed = await http().delete(`${baseUrl('imaging')}/images/${images[0]!.id}`).set(authed(nurseToken));
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      expect(removed.body.data.form.sections[0].images).toHaveLength(0);

      // Thêm lại rồi duyệt → bản ký: không thêm/gỡ được nữa (service 409 + trigger DB).
      const again = await upload(imgItem.id, png);
      const keptId = (again.body.data.form.sections[0].images as { id: string }[])[0]!.id;
      const approved = await http()
        .post(`${resultUrl(imgItem.id)}/approve`)
        .set(authed(doctorToken))
        .send({ sections: [{ itemId: imgItem.id, values: [], descriptionText: 'Gan bình thường.', conclusionText: 'Không bất thường.' }] });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(approved.body.data.form.sections[0].images).toHaveLength(1);
      expect((await upload(imgItem.id, png)).status).toBe(409);
      expect((await http().delete(`${baseUrl('imaging')}/images/${keptId}`).set(authed(nurseToken))).status).toBe(409);
      await expect(privileged.paraclinicalResultImage.updateMany({ where: { tenantId: fixture.tenantA.id, id: keptId }, data: { deletedAt: new Date() } })).rejects.toThrow(/đã ký/);

      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'paraclinical_result.image_added' } });
      expect(audit).not.toBeNull();
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
  describe('tách 2 menu Xét nghiệm / CĐHA & Thăm dò chức năng (#215)', () => {
    it('Kỹ thuật viên xét nghiệm chỉ thấy + làm việc ở menu Xét nghiệm, KTV CĐHA chỉ ở menu CĐHA; không ai duyệt được; điều dưỡng/bác sĩ có cả hai', async () => {
      const labTech = await createUserWithRole(fixture.tenantA.id, 'lab_technician');
      const imgTech = await createUserWithRole(fixture.tenantA.id, 'imaging_technician');
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [glucoseId, ultrasoundId]);
      await payAll(encounterId);
      const labItem = placed.items.find((i) => i.name.startsWith('Glucose'))!;
      const imgItem = placed.items.find((i) => i.name.startsWith('Siêu âm'))!;

      // Mỗi menu chỉ trả đúng loại dịch vụ của mình; menu còn lại 403.
      const labRows = (await queueOf('lab', labTech.token)).items.filter((r) => r.orderNo === placed.orderNo);
      expect(labRows.map((r) => r.serviceKind)).toEqual(['LAB']);
      expect((await http().get(`${baseUrl('imaging')}/queue`).set(authed(labTech.token))).status).toBe(403);
      const imgRows = (await queueOf('imaging', imgTech.token)).items.filter((r) => r.orderNo === placed.orderNo);
      expect(imgRows.map((r) => r.serviceKind)).toEqual(['IMAGING']);
      expect((await http().get(`${baseUrl('lab')}/queue`).set(authed(imgTech.token))).status).toBe(403);

      // Dịch vụ của menu kia: không tồn tại với endpoint này (404), dù tài khoản có quyền ở endpoint đó.
      expect((await http().post(`${baseUrl('lab')}/start`).set(authed(labTech.token)).send({ itemIds: [imgItem.id] })).status).toBe(404);
      expect((await http().get(`${baseUrl('lab')}/items/${imgItem.id}/result`).set(authed(adminToken))).status).toBe(404);
      expect((await http().get(`${baseUrl('imaging')}/items/${labItem.id}/result`).set(authed(adminToken))).status).toBe(404);

      // Làm việc đúng nhóm; kỹ thuật viên không duyệt/ký.
      expect((await start(labTech.token, [labItem.id])).status).toBe(200);
      expect((await http().post(`${baseUrl('imaging')}/start`).set(authed(imgTech.token)).send({ itemIds: [imgItem.id] })).status).toBe(200);
      const labBody = { sections: [{ itemId: labItem.id, values: [{ indicatorId: glucoseIndicatorId, valueText: '5,0' }] }], submit: true };
      expect((await http().put(`${baseUrl('lab')}/items/${labItem.id}/result`).set(authed(labTech.token)).send(labBody)).status).toBe(200);
      expect((await http().post(`${baseUrl('lab')}/items/${labItem.id}/result/approve`).set(authed(labTech.token)).send(labBody)).status).toBe(403);
      const imgBody = { sections: [{ itemId: imgItem.id, values: [], descriptionText: 'Gan bình thường.', conclusionText: 'Không bất thường.' }] };
      expect((await http().post(`${baseUrl('imaging')}/items/${imgItem.id}/result/approve`).set(authed(imgTech.token)).send(imgBody)).status).toBe(403);
      // Bác sĩ duyệt được cả hai nhóm.
      expect((await http().post(`${baseUrl('lab')}/items/${labItem.id}/result/approve`).set(authed(doctorToken)).send(labBody)).status).toBe(200);
      expect((await http().post(`${baseUrl('imaging')}/items/${imgItem.id}/result/approve`).set(authed(doctorToken)).send(imgBody)).status).toBe(200);
      // Điều dưỡng thấy cả hai menu.
      expect((await http().get(`${baseUrl('lab')}/queue`).set(authed(nurseToken))).status).toBe(200);
      expect((await http().get(`${baseUrl('imaging')}/queue`).set(authed(nurseToken))).status).toBe(200);
    });
  });
  describe('đính chính kết quả đã duyệt (#215)', () => {
    /** Đưa 1 xét nghiệm glucose tới trạng thái ĐÃ DUYỆT (điều dưỡng nhập, bác sĩ duyệt) — trả id dòng chỉ định + id lượt khám. */
    async function approvedGlucose(value = '5,0') {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [glucoseId]);
      await payAll(encounterId);
      const itemId = placed.items[0]!.id;
      expect((await start(nurseToken, [itemId])).status).toBe(200);
      const body = { sections: [{ itemId, values: [{ indicatorId: glucoseIndicatorId, valueText: value }] }], submit: true };
      expect((await http().put(resultUrl(itemId)).set(authed(nurseToken)).send(body)).status).toBe(200);
      expect((await http().post(`${resultUrl(itemId)}/approve`).set(authed(doctorToken)).send(body)).status).toBe(200);
      return { encounterId, itemId };
    }
    const orderItem = async (encounterId: string) => (await http().get(orderUrl(encounterId)).set(authed(doctorToken))).body.data.order.items[0] as { status: string; resultReturnedAt: string | null; amendmentPending: boolean };

    it('điều dưỡng (quyền Nhập) đề nghị đính chính kèm lý do → quay lại "Đang thực hiện" với nội dung cũ; sửa + gửi duyệt; bác sĩ duyệt lại → bản mới có supersedes_id + lý do, bản gốc được giữ (soft-delete), mốc "Trả lúc" là bản mới', async () => {
      const { encounterId, itemId } = await approvedGlucose('5,0');
      const original = await privileged.paraclinicalResult.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: itemId, deletedAt: null } });
      expect(original.signedAt).not.toBeNull();

      // Lý do bắt buộc (>= 5 ký tự); người chỉ có quyền Xem không đề nghị được.
      expect((await http().post(`${resultUrl(itemId)}/amend`).set(authed(nurseToken)).send({})).status).toBe(400);
      expect((await http().post(`${resultUrl(itemId)}/amend`).set(authed(nurseToken)).send({ reason: 'ab' })).status).toBe(400);
      expect((await http().post(`${resultUrl(itemId)}/amend`).set(authed(receptionistToken)).send({ reason: 'Nhập nhầm chỉ số glucose' })).status).toBe(403);

      const started = await http().post(`${resultUrl(itemId)}/amend`).set(authed(nurseToken)).send({ reason: 'Nhập nhầm chỉ số glucose' });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      const draft = started.body.data.form as Awaited<ReturnType<typeof form>> & { amendment: { reason: string; originalSignedAt: string | null } | null };
      expect(draft.bucket).toBe('IN_PROGRESS');
      expect(draft.signedAt).toBeNull();
      expect(draft.amendment).toMatchObject({ reason: 'Nhập nhầm chỉ số glucose' });
      expect(draft.amendment!.originalSignedAt).toBe(original.signedAt!.toISOString());
      expect(draft.sections[0]!.indicators[0]!.valueText).toBe('5,0');

      // Bản gốc đã ký được giữ nguyên trong DB (bị thay thế, KHÔNG xoá cứng); đang đính chính thì màn khám thấy "đang đính chính", chưa có "Trả lúc".
      const retired = await privileged.paraclinicalResult.findUniqueOrThrow({ where: { id: original.id } });
      expect(retired.deletedAt).not.toBeNull();
      expect(retired.signedAt?.toISOString()).toBe(original.signedAt!.toISOString());
      expect(await orderItem(encounterId)).toMatchObject({ status: 'IN_PROGRESS', amendmentPending: true, resultReturnedAt: null });
      const inQueue = (await queue(adminToken)).items.find((r) => r.itemIds.includes(itemId)) as unknown as { bucket: string; isAmendment: boolean };
      expect(inQueue).toMatchObject({ bucket: 'IN_PROGRESS', isAmendment: true });
      // Đã đang đính chính thì không mở thêm lần nữa (kết quả chưa ở trạng thái đã duyệt).
      expect((await http().post(`${resultUrl(itemId)}/amend`).set(authed(nurseToken)).send({ reason: 'Đính chính lần hai' })).status).toBe(409);

      // Sửa giá trị + gửi duyệt; điều dưỡng không tự duyệt được, bác sĩ duyệt.
      const fixedBody = { sections: [{ itemId, values: [{ indicatorId: glucoseIndicatorId, valueText: '6,1' }] }], submit: true };
      expect((await http().put(resultUrl(itemId)).set(authed(nurseToken)).send(fixedBody)).status).toBe(200);
      expect((await http().post(`${resultUrl(itemId)}/approve`).set(authed(nurseToken)).send(fixedBody)).status).toBe(403);
      const approved = await http().post(`${resultUrl(itemId)}/approve`).set(authed(doctorToken)).send(fixedBody);
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const done = approved.body.data.form as typeof draft;
      expect(done.bucket).toBe('COMPLETED');
      expect(done.signedAt).not.toBeNull();
      expect(done.sections[0]!.indicators[0]).toMatchObject({ valueText: '6,1', flag: 'HIGH' });
      expect(done.amendment).toMatchObject({ reason: 'Nhập nhầm chỉ số glucose' });

      const active = await privileged.paraclinicalResult.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: itemId, deletedAt: null } });
      expect(active.id).not.toBe(original.id);
      expect(active.supersedesId).toBe(original.id);
      expect(active.amendmentReason).toBe('Nhập nhầm chỉ số glucose');
      expect(active.signedAt).not.toBeNull();
      expect(await orderItem(encounterId)).toMatchObject({ status: 'COMPLETED', amendmentPending: false, resultReturnedAt: active.signedAt!.toISOString() });
      const actions = (await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, entityType: 'paraclinical_result', entityId: { in: [active.id] } }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['paraclinical_result.amendment_started', 'paraclinical_result.amended']));
      // Hàng đợi "Đã trả kết quả" vẫn đánh dấu là bản đính chính.
      expect(((await queue(adminToken, { bucket: 'COMPLETED' })).items.find((r) => r.itemIds.includes(itemId)) as unknown as { isAmendment: boolean }).isAmendment).toBe(true);
    });

    it('huỷ đính chính → bỏ bản nháp, KHÔI PHỤC bản đã duyệt cũ nguyên vẹn (kết quả, mốc ký, trạng thái "Đã trả"); không có đính chính thì huỷ → 409; chưa duyệt thì đề nghị đính chính → 409', async () => {
      const { encounterId, itemId } = await approvedGlucose('5,2');
      const original = await privileged.paraclinicalResult.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: itemId, deletedAt: null } });

      expect((await http().post(`${resultUrl(itemId)}/amend/cancel`).set(authed(nurseToken)).send({})).status).toBe(409);
      expect((await http().post(`${resultUrl(itemId)}/amend`).set(authed(nurseToken)).send({ reason: 'Muốn kiểm tra lại mẫu' })).status).toBe(200);
      const cancelled = await http().post(`${resultUrl(itemId)}/amend/cancel`).set(authed(nurseToken)).send({});
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const back = cancelled.body.data.form as { bucket: string; signedAt: string | null; amendment: unknown; sections: { indicators: { valueText: string | null }[] }[] };
      expect(back.bucket).toBe('COMPLETED');
      expect(back.signedAt).toBe(original.signedAt!.toISOString());
      expect(back.amendment).toBeNull();
      expect(back.sections[0]!.indicators[0]!.valueText).toBe('5,2');

      const restored = await privileged.paraclinicalResult.findUniqueOrThrow({ where: { id: original.id } });
      expect(restored.deletedAt).toBeNull();
      const all = await privileged.paraclinicalResult.findMany({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: itemId } });
      expect(all.filter((r) => r.deletedAt === null)).toHaveLength(1);
      expect(all.filter((r) => r.supersedesId !== null && r.deletedAt !== null)).toHaveLength(1);
      expect(await orderItem(encounterId)).toMatchObject({ status: 'COMPLETED', amendmentPending: false, resultReturnedAt: original.signedAt!.toISOString() });

      // Dịch vụ chưa duyệt (đang thực hiện) không đính chính được.
      const fresh = await prepareEncounterInConsultation();
      const placed = await order(fresh.encounterId, [glucoseId]);
      await payAll(fresh.encounterId);
      const freshItem = placed.items[0]!.id;
      await start(nurseToken, [freshItem]);
      expect((await http().post(`${resultUrl(freshItem)}/amend`).set(authed(nurseToken)).send({ reason: 'Chưa duyệt mà đính chính' })).status).toBe(409);
    });

    it('đính chính giữ cả ảnh đính kèm của CĐHA (sao chép sang bản nháp) và dịch vụ nhóm khác không đính chính được qua endpoint này (404)', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [ultrasoundId]);
      await payAll(encounterId);
      const imgItem = placed.items[0]!.id;
      await start(nurseToken, [imgItem]);
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
      const uploaded = await http().post(`${baseUrl('imaging')}/items/${imgItem}/images`).set(authed(nurseToken)).attach('file', png, 'sieu-am.png');
      expect(uploaded.status).toBe(200);
      const body = { sections: [{ itemId: imgItem, values: [], descriptionText: 'Gan bình thường.', conclusionText: 'Không bất thường.' }] };
      expect((await http().post(`${resultUrl(imgItem)}/approve`).set(authed(doctorToken)).send(body)).status).toBe(200);

      // Dịch vụ CĐHA không đính chính được qua endpoint của xét nghiệm.
      expect((await http().post(`${baseUrl('lab')}/items/${imgItem}/result/amend`).set(authed(adminToken)).send({ reason: 'Sai nhóm menu' })).status).toBe(404);

      const started = await http().post(`${resultUrl(imgItem)}/amend`).set(authed(nurseToken)).send({ reason: 'Kết luận ghi thiếu' });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      const images = started.body.data.form.sections[0].images as { id: string; url: string }[];
      expect(images).toHaveLength(1);
      expect((await http().get(images[0]!.url)).status).toBe(200);
      const corrected = { sections: [{ itemId: imgItem, values: [], descriptionText: 'Gan bình thường.', conclusionText: 'Gan nhiễm mỡ độ I.' }] };
      const approved = await http().post(`${resultUrl(imgItem)}/approve`).set(authed(doctorToken)).send(corrected);
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(approved.body.data.form.sections[0].conclusionText).toBe('Gan nhiễm mỡ độ I.');
      expect(approved.body.data.form.sections[0].images).toHaveLength(1);
    });
  });

  describe('kết quả vào màn khám + bệnh án PDF (#215)', () => {
    /** Đưa 1 xét nghiệm glucose tới trạng thái ĐÃ DUYỆT — trả id dòng chỉ định + id lượt khám. */
    async function approvedGlucoseFor(value: string) {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [glucoseId]);
      await payAll(encounterId);
      const itemId = placed.items[0]!.id;
      expect((await start(nurseToken, [itemId])).status).toBe(200);
      const body = { sections: [{ itemId, values: [{ indicatorId: glucoseIndicatorId, valueText: value }] }], submit: true };
      expect((await http().put(resultUrl(itemId)).set(authed(nurseToken)).send(body)).status).toBe(200);
      expect((await http().post(`${resultUrl(itemId)}/approve`).set(authed(doctorToken)).send(body)).status).toBe(200);
      return { encounterId, itemId };
    }
    const reader = () => app.get<ParaclinicalResultsReaderPort>(PARACLINICAL_RESULTS_READER_PORT);

    it('dòng chỉ định trả kèm loại dịch vụ (LAB/IMAGING) để màn khám mở đúng nhóm kết quả', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      await order(encounterId, [glucoseId, ultrasoundId]);
      const items = (await http().get(orderUrl(encounterId)).set(authed(doctorToken))).body.data.order.items as { name: string; serviceKind: string | null }[];
      expect(items.map((i) => i.serviceKind).sort()).toEqual(['IMAGING', 'LAB']);
    });

    it('port bệnh án PDF: chỉ trả kết quả ĐÃ DUYỆT (kèm cờ vượt mức + khoảng tham chiếu đã chụp); nháp/đang đính chính không có; đính chính xong thì là giá trị mới; tenant khác không thấy', async () => {
      const { encounterId, itemId } = await approvedGlucoseFor('7,2');

      const afterApprove = (await reader().listSignedForEncounters(fixture.tenantA.id, [encounterId]))[encounterId] ?? [];
      expect(afterApprove).toHaveLength(1);
      expect(afterApprove[0]).toMatchObject({ serviceName: 'Glucose máu (kết quả)', serviceKind: 'LAB', imageCount: 0 });
      expect(afterApprove[0]!.indicators[0]).toMatchObject({ valueText: '7,2', abnormal: true });
      expect(afterApprove[0]!.indicators[0]!.referenceText).not.toBe('');

      // Đang đính chính → kết quả cũ tạm KHÔNG có trong bệnh án (đồng nhất với màn khám: kết quả bị nghi sai chưa dùng).
      expect((await http().post(`${resultUrl(itemId)}/amend`).set(authed(nurseToken)).send({ reason: 'Nhập nhầm chỉ số glucose' })).status).toBe(200);
      expect((await reader().listSignedForEncounters(fixture.tenantA.id, [encounterId]))[encounterId]).toBeUndefined();

      // Duyệt lại → giá trị mới, không trùng bản cũ.
      const fixedBody = { sections: [{ itemId, values: [{ indicatorId: glucoseIndicatorId, valueText: '5,0' }] }], submit: true };
      expect((await http().put(resultUrl(itemId)).set(authed(nurseToken)).send(fixedBody)).status).toBe(200);
      expect((await http().post(`${resultUrl(itemId)}/approve`).set(authed(doctorToken)).send(fixedBody)).status).toBe(200);
      const afterAmend = (await reader().listSignedForEncounters(fixture.tenantA.id, [encounterId]))[encounterId] ?? [];
      expect(afterAmend).toHaveLength(1);
      expect(afterAmend[0]!.indicators[0]).toMatchObject({ valueText: '5,0', abnormal: false });

      // Cách ly tenant (RLS): tenant B hỏi đúng id lượt khám của tenant A → không thấy gì.
      expect(await reader().listSignedForEncounters(fixture.tenantB.id, [encounterId])).toEqual({});
      // Không truyền id nào → rỗng, không lỗi.
      expect(await reader().listSignedForEncounters(fixture.tenantA.id, [])).toEqual({});
    });

    it('port bệnh án PDF: kết quả CĐHA mang mô tả + kết luận + số ảnh; dịch vụ chưa có kết quả/đang nhập dở không có mặt', async () => {
      const { encounterId } = await prepareEncounterInConsultation();
      const placed = await order(encounterId, [ultrasoundId]);
      await payAll(encounterId);
      const imgItem = placed.items[0]!.id;
      await start(nurseToken, [imgItem]);
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
      expect((await http().post(`${baseUrl('imaging')}/items/${imgItem}/images`).set(authed(nurseToken)).attach('file', png, 'sieu-am.png')).status).toBe(200);
      const body = { sections: [{ itemId: imgItem, values: [], descriptionText: 'Gan sáng.', conclusionText: 'Gan nhiễm mỡ độ I.' }] };

      // Mới lưu nháp → chưa vào bệnh án.
      expect((await http().put(resultUrl(imgItem)).set(authed(nurseToken)).send(body)).status).toBe(200);
      expect((await reader().listSignedForEncounters(fixture.tenantA.id, [encounterId]))[encounterId]).toBeUndefined();

      expect((await http().post(`${resultUrl(imgItem)}/approve`).set(authed(doctorToken)).send(body)).status).toBe(200);
      const entry = (await reader().listSignedForEncounters(fixture.tenantA.id, [encounterId]))[encounterId]![0]!;
      expect(entry).toMatchObject({ serviceKind: 'IMAGING', descriptionText: 'Gan sáng.', conclusionText: 'Gan nhiễm mỡ độ I.', imageCount: 1, indicators: [] });
    });
  });
});
