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
 * HTTP e2e — "Gửi mẫu đối tác": gửi mẫu đi, chọn đối tác và áp đúng giá (docs/DECISIONS.md #291). Bao phủ: mẫu đã lấy của dịch vụ "Gửi đối tác" vào "Chờ gửi" (kèm đối tác + giá từng cặp), rời hàng đợi xét nghiệm;
 * gửi cho MỘT đối tác → áp ĐÚNG giá của cặp (dịch vụ × đối tác) và chụp lại (đổi giá sau không làm lệch), hạn trả = giờ gửi + thời gian trả kết quả; đối tác chưa có giá → 422; gửi trùng → 409;
 * giờ gửi tương lai/trước giờ lấy mẫu → 422; giá trả chỉ hiện cho người thấy được giá vốn; công tắc tắt → 409; cô lập công ty; phân quyền.
 */
describe('HTTP e2e — /api/v1/lab-partner-dispatch (Gửi mẫu đối tác)', () => {
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

  let partnerA: { id: string; name: string };
  let partnerB: { id: string; name: string };
  let svcBoth: string; // gửi đối tác: A 150.000 (mặc định), B 135.000, hạn 24 giờ
  let svcOnlyA: string; // gửi đối tác: chỉ A 90.000, không đặt hạn
  let svcInHouse: string; // làm tại phòng khám

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const lab = '/api/v1/paraclinical/lab';
  const QUEUE = '/api/v1/lab-partner-dispatch';
  const randomNationalId = (): string => '079' + Math.floor(100000000 + Math.random() * 899999999).toString();

  async function createUserWithRole(tenantId: string, roleName: string, extra: { branchId?: string } = {}) {
    const username = `e2e-lpd-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    if (extra.branchId) {
      await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId: extra.branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  async function createPartner(token: string, name: string) {
    const res = await http().post('/api/v1/suppliers').set(authed(token)).send({ name, isLabPartner: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { id: res.body.data.id as string, name };
  }

  async function createService(body: Record<string, unknown>): Promise<string> {
    const res = await http()
      .post('/api/v1/technical-services')
      .set(authed(adminToken))
      .send({ isPerformedInHouse: true, serviceKind: 'LAB', prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 220_000, effectiveFrom: '2020-01-01' }], ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function prepareEncounter(): Promise<{ encounterId: string }> {
    const patientRes = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e gửi đối tác', dob: '1985-03-09', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
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

  type OrderItem = { id: string; technicalServiceId: string };
  /** Tiếp nhận → khám → chỉ định → thu tiền → lấy mẫu (xác nhận mọi ống) → mẫu sẵn sàng gửi. */
  async function collectedOrder(serviceIds: string[]): Promise<{ orderId: string; orderNo: string; items: OrderItem[]; sidByItem: Map<string, string> }> {
    const { encounterId } = await prepareEncounter();
    const res = await http()
      .put(`/api/v1/encounters/${encounterId}/clinical-orders`)
      .set(authed(doctorToken))
      .send({ items: serviceIds.map((technicalServiceId) => ({ performance: 'IN_HOUSE', technicalServiceId, quantity: 1 })) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const placed = res.body.data.order as { id: string; orderNo: string; items: OrderItem[] };
    const inv = await http().get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken));
    const pay = await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: inv.body.data.version });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const open = await http().post(`${lab}/orders/${placed.id}/specimen-collection/open`).set(authed(nurseToken)).send();
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    const tubes = open.body.data.state.tubes as { id: string; sid: string; items: { itemId: string }[] }[];
    const collected = await http()
      .post(`${lab}/specimen-tubes/collect`)
      .set(authed(nurseToken))
      .send({ tubes: tubes.map((t) => ({ tubeId: t.id, via: 'MANUAL' })) });
    expect(collected.status, JSON.stringify(collected.body)).toBe(200);
    const sidByItem = new Map<string, string>();
    for (const t of tubes) for (const i of t.items) sidByItem.set(i.itemId, t.sid);
    return { orderId: placed.id, orderNo: placed.orderNo, items: placed.items, sidByItem };
  }

  const itemOf = (placed: { items: OrderItem[] }, serviceId: string) => placed.items.find((i) => i.technicalServiceId === serviceId)!;
  const send = (token: string, body: Record<string, unknown>) => http().post(QUEUE).set(authed(token)).send(body);
  const pending = (token: string) => http().get(`${QUEUE}/pending`).set(authed(token));
  const sent = (token: string) => http().get(`${QUEUE}/sent`).set(authed(token));
  const setToggle = async (token: string, value: boolean) => {
    const res = await http().patch('/api/v1/clinic-settings').set(authed(token)).send({ labPartnerEnabled: value });
    expect(res.status).toBe(200);
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

    fixture = await createTwoTenantFixture(privileged, 'Lab partner dispatch e2e');
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
    await setToggle(adminToken, true);

    partnerA = await createPartner(adminToken, 'Đối tác A gửi mẫu');
    partnerB = await createPartner(adminToken, 'Đối tác B gửi mẫu');
    svcBoth = await createService({
      name: 'XN gửi cả hai đối tác (e2e)',
      turnaroundMinutes: 1440,
      sentToPartner: true,
      partnerPrices: [
        { supplierId: partnerA.id, amount: 150_000, isDefault: true },
        { supplierId: partnerB.id, amount: 135_000 },
      ],
    });
    svcOnlyA = await createService({ name: 'XN chỉ đối tác A (e2e)', sentToPartner: true, partnerPrices: [{ supplierId: partnerA.id, amount: 90_000 }] });
    svcInHouse = await createService({ name: 'XN tại phòng khám (e2e)' });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('mẫu đã lấy của dịch vụ "Gửi đối tác" vào "Chờ gửi" kèm đối tác + giá từng cặp; dịch vụ tại phòng khám thì không; giá chỉ hiện cho người thấy giá vốn', async () => {
    const placed = await collectedOrder([svcBoth, svcOnlyA, svcInHouse]);
    const asAdmin = await pending(adminToken);
    expect(asAdmin.status, JSON.stringify(asAdmin.body)).toBe(200);
    const rows = (asAdmin.body.data.items as { itemId: string; orderNo: string; tubeSid: string | null; patientName: string; options: { supplierId: string; isDefault: boolean; amount: number | null }[] }[]).filter((r) => r.orderNo === placed.orderNo);
    expect(rows.map((r) => r.itemId).sort()).toEqual([itemOf(placed, svcBoth).id, itemOf(placed, svcOnlyA).id].sort());
    expect(asAdmin.body.data.costVisible).toBe(true);

    const both = rows.find((r) => r.itemId === itemOf(placed, svcBoth).id)!;
    expect(both.tubeSid).toBe(placed.sidByItem.get(both.itemId));
    expect(both.patientName).toBe('Bệnh nhân e2e gửi đối tác');
    expect(both.options.map((o) => [o.supplierId, o.isDefault, o.amount])).toEqual([
      [partnerA.id, true, 150_000],
      [partnerB.id, false, 135_000],
    ]);
    expect(rows.find((r) => r.itemId === itemOf(placed, svcOnlyA).id)!.options.map((o) => [o.supplierId, o.amount])).toEqual([[partnerA.id, 90_000]]);

    // Kỹ thuật viên/điều dưỡng thấy đối tác nhưng KHÔNG thấy giá vốn.
    const asNurse = await pending(nurseToken);
    expect(asNurse.status).toBe(200);
    expect(asNurse.body.data.costVisible).toBe(false);
    const nurseRow = (asNurse.body.data.items as { itemId: string; options: { amount: number | null; supplierName: string }[] }[]).find((r) => r.itemId === both.itemId)!;
    expect(nurseRow.options.map((o) => o.amount)).toEqual([null, null]);
    expect(nurseRow.options.map((o) => o.supplierName)).toEqual([partnerA.name, partnerB.name]);

    // Rời hàng đợi xét nghiệm: dịch vụ gửi đối tác đã lấy mẫu không còn ở đó; dịch vụ tại phòng khám vẫn còn.
    const queue = await http().get(`${lab}/queue`).set(authed(nurseToken));
    const queueItemIds = (queue.body.data.items as { orderNo: string; itemIds: string[] }[]).filter((r) => r.orderNo === placed.orderNo).flatMap((r) => r.itemIds);
    expect(queueItemIds).toContain(itemOf(placed, svcInHouse).id);
    expect(queueItemIds).not.toContain(both.itemId);
    expect(queueItemIds).not.toContain(itemOf(placed, svcOnlyA).id);
  });

  it('gửi cho MỘT đối tác: áp ĐÚNG giá của cặp, chụp lại, hạn = giờ gửi + thời gian trả; đối tác chưa có giá → 422; gửi trùng → 409', async () => {
    const placed = await collectedOrder([svcBoth, svcOnlyA]);
    const both = itemOf(placed, svcBoth).id;
    const onlyA = itemOf(placed, svcOnlyA).id;

    // Đối tác B không có giá cho svcOnlyA → từ chối, KHÔNG gửi gì (kể cả mẫu hợp lệ trong cùng yêu cầu).
    const noPrice = await send(adminToken, { supplierId: partnerB.id, itemIds: [both, onlyA] });
    expect(noPrice.status, JSON.stringify(noPrice.body)).toBe(422);
    expect(noPrice.body.error.message).toContain(partnerB.name);
    expect(noPrice.body.error.message).toContain('XN chỉ đối tác A (e2e)');
    expect(await privileged.labPartnerDispatchItem.count({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: { in: [both, onlyA] } } })).toBe(0);

    // Gửi svcBoth cho B (giá 135.000, không phải giá mặc định của A).
    // Giờ gửi = bây giờ (không thể trước giờ lấy mẫu vừa xác nhận ở trên).
    const sentAt = new Date().toISOString();
    const ok = await send(adminToken, { supplierId: partnerB.id, itemIds: [both], sentAt, note: 'Shipper lấy lúc 11h' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.dispatchNo).toMatch(/^GM/);
    expect(ok.body.data.supplierName).toBe(partnerB.name);
    expect(ok.body.data.items).toEqual([{ itemId: both, unitCost: 135_000, dueAt: new Date(new Date(sentAt).getTime() + 1440 * 60_000).toISOString() }]);

    const stored = await privileged.labPartnerDispatchItem.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: both }, include: { dispatch: true } });
    expect(stored.unitCost).toBe(135_000n);
    expect(stored.status).toBe('SENT');
    expect(stored.dispatch.supplierId).toBe(partnerB.id);
    expect(stored.dispatch.note).toBe('Shipper lấy lúc 11h');
    expect(stored.specimenTubeId).not.toBeNull();

    // Gửi svcOnlyA cho A (90.000, không đặt hạn).
    const okA = await send(adminToken, { supplierId: partnerA.id, itemIds: [onlyA] });
    expect(okA.status, JSON.stringify(okA.body)).toBe(200);
    expect(okA.body.data.items[0]).toMatchObject({ itemId: onlyA, unitCost: 90_000, dueAt: null });

    // Gửi lại cùng mẫu → 409.
    const again = await send(adminToken, { supplierId: partnerA.id, itemIds: [both] });
    expect(again.status).toBe(409);

    // Hai mẫu đã rời "Chờ gửi" và vào "Đã gửi" đúng đối tác.
    const pend = await pending(adminToken);
    expect((pend.body.data.items as { itemId: string }[]).some((r) => [both, onlyA].includes(r.itemId))).toBe(false);
    const sentRes = await sent(adminToken);
    expect(sentRes.status).toBe(200);
    const sentRows = sentRes.body.data.items as { itemId: string; supplierId: string; dispatchNo: string; unitCost: number | null; overdue: boolean; dueAt: string | null; sentByName: string | null }[];
    const rowBoth = sentRows.find((r) => r.itemId === both)!;
    expect(rowBoth).toMatchObject({ supplierId: partnerB.id, unitCost: 135_000, overdue: false });
    expect(rowBoth.dueAt).not.toBeNull();
    expect(rowBoth.sentByName).toBe('User clinic_admin');
    expect(sentRows.find((r) => r.itemId === onlyA)).toMatchObject({ supplierId: partnerA.id, unitCost: 90_000, dueAt: null, overdue: false });

    // Lọc theo đối tác.
    const onlyB = await http().get(`${QUEUE}/sent?supplierId=${partnerB.id}`).set(authed(adminToken));
    const idsB = (onlyB.body.data.items as { itemId: string }[]).map((r) => r.itemId);
    expect(idsB).toContain(both);
    expect(idsB).not.toContain(onlyA);

    // Giá trả CHỤP LẠI: đổi giá của đối tác B sau đó không làm đổi dòng đã gửi.
    const detail = await http().get(`/api/v1/technical-services/${svcBoth}`).set(authed(adminToken));
    const edit = await http()
      .patch(`/api/v1/technical-services/${svcBoth}`)
      .set(authed(adminToken))
      .send({ version: detail.body.data.version, partnerPrices: [{ supplierId: partnerA.id, amount: 150_000, isDefault: true }, { supplierId: partnerB.id, amount: 999_000 }] });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const after = await sent(adminToken);
    expect((after.body.data.items as { itemId: string; unitCost: number }[]).find((r) => r.itemId === both)!.unitCost).toBe(135_000);

    // Người không thấy giá vốn: gửi vẫn áp giá nhưng phản hồi/danh sách không lộ số.
    const placed2 = await collectedOrder([svcOnlyA]);
    const asNurse = await send(nurseToken, { supplierId: partnerA.id, itemIds: [itemOf(placed2, svcOnlyA).id] });
    expect(asNurse.status, JSON.stringify(asNurse.body)).toBe(200);
    expect(asNurse.body.data.items[0].unitCost).toBeNull();
    expect((await privileged.labPartnerDispatchItem.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: itemOf(placed2, svcOnlyA).id } })).unitCost).toBe(90_000n);
    const nurseSent = await sent(nurseToken);
    expect((nurseSent.body.data.items as { itemId: string; unitCost: number | null }[]).find((r) => r.itemId === itemOf(placed2, svcOnlyA).id)!.unitCost).toBeNull();
  });

  it('kiểm tra giờ gửi và điều kiện mẫu: tương lai/trước giờ lấy mẫu → 422; dịch vụ tại phòng khám, đối tác không hợp lệ, id lạ → từ chối', async () => {
    const placed = await collectedOrder([svcBoth, svcInHouse]);
    const both = itemOf(placed, svcBoth).id;
    const inHouse = itemOf(placed, svcInHouse).id;

    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [both], sentAt: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(422);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [both], sentAt: new Date(Date.now() - 7 * 86_400_000).toISOString() })).status).toBe(422);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [inHouse] })).status).toBe(422);
    expect((await send(adminToken, { supplierId: randomUUID(), itemIds: [both] })).status).toBe(422);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [randomUUID()] })).status).toBe(404);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [both, both] })).status).toBe(400);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [] })).status).toBe(400);

    // Nhà cung cấp thường (không phải đối tác) không nhận mẫu được.
    const plain = await http().post('/api/v1/suppliers').set(authed(adminToken)).send({ name: 'NCC thường gửi mẫu' });
    expect((await send(adminToken, { supplierId: plain.body.data.id, itemIds: [both] })).status).toBe(422);
    // Chưa có gì được ghi.
    expect(await privileged.labPartnerDispatchItem.count({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: { in: [both, inHouse] } } })).toBe(0);
  });

  it('công tắc "Dùng đối tác xét nghiệm" tắt: mọi API 409 và mẫu quay lại hàng đợi xét nghiệm; bật lại thì như cũ', async () => {
    const placed = await collectedOrder([svcOnlyA]);
    const itemId = itemOf(placed, svcOnlyA).id;
    await setToggle(adminToken, false);
    try {
      for (const res of [await pending(adminToken), await sent(adminToken), await send(adminToken, { supplierId: partnerA.id, itemIds: [itemId] })]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('LAB_PARTNER_DISABLED');
      }
      const queue = await http().get(`${lab}/queue`).set(authed(nurseToken));
      const ids = (queue.body.data.items as { orderNo: string; itemIds: string[] }[]).filter((r) => r.orderNo === placed.orderNo).flatMap((r) => r.itemIds);
      expect(ids).toContain(itemId);
    } finally {
      await setToggle(adminToken, true);
    }
    expect((await pending(adminToken)).status).toBe(200);
  });

  it('cô lập CHI NHÁNH (cùng công ty): chi nhánh B không thấy mẫu chờ gửi/đã gửi của chi nhánh A và không gửi được (404); đối tác dùng chung cả công ty', async () => {
    const placed = await collectedOrder([svcBoth]); // chi nhánh mặc định (A)
    const itemId = itemOf(placed, svcBoth).id;
    const branchB = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh B gửi mẫu (e2e)', address: '1 Đường B', phone: '0283777001' });
    expect(branchB.status, JSON.stringify(branchB.body)).toBe(200);
    const nurseB = (await createUserWithRole(fixture.tenantA.id, 'nurse', { branchId: branchB.body.data.id as string })).token;

    expect((await pending(adminToken)).body.data.items.some((r: { itemId: string }) => r.itemId === itemId)).toBe(true);
    const pendingB = await pending(nurseB);
    expect(pendingB.status, JSON.stringify(pendingB.body)).toBe(200);
    expect(pendingB.body.data.items.some((r: { itemId: string }) => r.itemId === itemId)).toBe(false);
    // Chi nhánh B không gửi được mẫu của chi nhánh A (coi như không tồn tại), dù đối tác dùng chung cả công ty.
    expect((await send(nurseB, { supplierId: partnerA.id, itemIds: [itemId] })).status).toBe(404);

    const ok = await send(adminToken, { supplierId: partnerA.id, itemIds: [itemId] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await sent(adminToken)).body.data.items.some((r: { itemId: string }) => r.itemId === itemId)).toBe(true);
    const sentB = await sent(nurseB);
    expect(sentB.status).toBe(200);
    expect(sentB.body.data.items.some((r: { itemId: string }) => r.itemId === itemId)).toBe(false);
    expect(sentB.body.data.counts).toEqual({ pending: 0, sent: 0, done: 0 });
  });

  it('cô lập công ty + phân quyền: công ty B không thấy/gửi được mẫu của A; lễ tân không có quyền; không token → 401; bác sĩ xem được', async () => {
    const placed = await collectedOrder([svcOnlyA]);
    const itemId = itemOf(placed, svcOnlyA).id;

    await setToggle(tenantBAdminToken, true);
    const partnerOfB = await createPartner(tenantBAdminToken, 'Đối tác của công ty B');
    const bPending = await pending(tenantBAdminToken);
    expect(bPending.status).toBe(200);
    expect((bPending.body.data.items as { itemId: string }[]).some((r) => r.itemId === itemId)).toBe(false);
    expect((await send(tenantBAdminToken, { supplierId: partnerOfB.id, itemIds: [itemId] })).status).toBe(404);
    // Đối tác của công ty A không dùng được ở công ty B.
    expect((await send(tenantBAdminToken, { supplierId: partnerA.id, itemIds: [itemId] })).status).toBe(422);

    expect((await pending(receptionistToken)).status).toBe(403);
    expect((await sent(receptionistToken)).status).toBe(403);
    expect((await send(receptionistToken, { supplierId: partnerA.id, itemIds: [itemId] })).status).toBe(403);
    expect((await http().get(`${QUEUE}/pending`)).status).toBe(401);
    expect((await pending(doctorToken)).status).toBe(200);
  });
});
