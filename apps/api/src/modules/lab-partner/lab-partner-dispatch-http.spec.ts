import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { getVietnamDateString } from '@nexamed/core';
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
    expect(sentB.body.data.counts).toEqual({ pending: 0, sent: 0, done: 0, awaitingApproval: 0 });
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

  // ---- Nhận kết quả PDF, không nhận, duyệt, trả lại, ghi nợ (docs/DECISIONS.md #291 bổ sung 5) ----
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  const receive = (token: string, itemIds: string[], extra: Record<string, unknown> = {}, file: Buffer | null = PDF, fileName = 'kq-doi-tac.pdf') => {
    const req = http().post(`${QUEUE}/results`).set(authed(token)).field('data', JSON.stringify({ itemIds, ...extra }));
    return file ? req.attach('file', file, fileName) : req;
  };
  const debtBalance = async (supplierId: string): Promise<number> => {
    const res = await http().get(`/api/v1/supplier-debt/${supplierId}/summary`).set(authed(adminToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.balance as number;
  };
  const done = (token: string) => http().get(`${QUEUE}/done`).set(authed(token));
  const resultPath = (itemId: string) => `${lab}/items/${itemId}/result`;

  it('nhận kết quả PDF: một tệp gắn nhiều dịch vụ, ghi nợ ĐÚNG giá đã chụp lúc nhận, kết quả nháp chờ duyệt, rời hàng đợi gửi mẫu', async () => {
    const placed = await collectedOrder([svcBoth, svcOnlyA]);
    const both = itemOf(placed, svcBoth).id;
    const onlyA = itemOf(placed, svcOnlyA).id;
    const before = await debtBalance(partnerA.id);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [both, onlyA] })).status).toBe(200);
    expect(await debtBalance(partnerA.id)).toBe(before); // gửi mẫu CHƯA ghi nợ

    // Đổi giá sau khi gửi không làm đổi số nợ (đã chụp 150.000 + 90.000).
    const detail = await http().get(`/api/v1/technical-services/${svcBoth}`).set(authed(adminToken));
    await http()
      .patch(`/api/v1/technical-services/${svcBoth}`)
      .set(authed(adminToken))
      .send({ version: detail.body.data.version, partnerPrices: [{ supplierId: partnerA.id, amount: 999_000, isDefault: true }, { supplierId: partnerB.id, amount: 135_000 }] });

    const res = await receive(nurseToken, [both, onlyA], { note: 'Giao tận nơi' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ receivedCount: 2, supplierName: partnerA.name, fileName: 'kq-doi-tac.pdf' });

    expect(await debtBalance(partnerA.id)).toBe(before + 240_000);
    const stored = await privileged.labPartnerDispatchItem.findMany({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: { in: [both, onlyA] } }, include: { resultFile: true } });
    const entries = await privileged.supplierDebtEntry.findMany({ where: { tenantId: fixture.tenantA.id, entryType: 'LAB_PARTNER', labPartnerDispatchItemId: { in: stored.map((r) => r.id) } } });
    expect(entries.map((e) => Number(e.amountChange)).sort((a, b) => a - b)).toEqual([90_000, 150_000]);
    expect(entries.every((e) => (e.note ?? '').startsWith('GM'))).toBe(true);

    expect(stored.every((r) => r.status === 'RECEIVED' && r.receivedAt !== null && r.resultFile?.contentType === 'application/pdf')).toBe(true);
    expect(new Set(stored.map((r) => r.resultFileId)).size).toBe(1); // MỘT tệp cho cả hai dịch vụ
    const items = await privileged.clinicalOrderItem.findMany({ where: { tenantId: fixture.tenantA.id, id: { in: [both, onlyA] } } });
    expect(items.every((i) => i.status === 'RESULTED')).toBe(true);
    const results = await privileged.paraclinicalResult.findMany({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: { in: [both, onlyA] }, deletedAt: null }, include: { images: true } });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.signedAt === null && r.images.length === 1 && r.images[0]!.contentType === 'application/pdf' && r.images[0]!.storageKey === stored[0]!.resultFile!.storageKey)).toBe(true);

    // Rời "Đã gửi", vào "Đã có kết quả" (chờ duyệt) kèm đường dẫn PDF mở được; không còn ở hàng đợi xét nghiệm thường.
    const sentRes = await sent(adminToken);
    expect((sentRes.body.data.items as { itemId: string }[]).some((r) => [both, onlyA].includes(r.itemId))).toBe(false);
    const doneRes = await done(adminToken);
    expect(doneRes.status, JSON.stringify(doneRes.body)).toBe(200);
    const row = (doneRes.body.data.items as { itemId: string; approval: string; unitCost: number | null; fileUrl: string; supplierId: string; late: boolean }[]).find((r) => r.itemId === both)!;
    expect(row).toMatchObject({ approval: 'PENDING', unitCost: 150_000, supplierId: partnerA.id, late: false });
    const file = await http().get(row.fileUrl);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    // Màn kết quả (Tra cứu/hồ sơ/in) phải biết tệp đính kèm là PDF để không vẽ bằng thẻ ảnh.
    const form = await http().get(resultPath(both)).set(authed(adminToken));
    expect(form.status, JSON.stringify(form.body)).toBe(200);
    const formImages = (form.body.data.form.sections as { itemId: string; images: { contentType: string; url: string }[] }[]).find((s) => s.itemId === both)!.images;
    expect(formImages).toHaveLength(1);
    expect(formImages[0]!.contentType).toBe('application/pdf');
    const queue = await http().get(`${lab}/queue`).set(authed(nurseToken));
    const queueIds = (queue.body.data.items as { orderNo: string; itemIds: string[] }[]).filter((r) => r.orderNo === placed.orderNo).flatMap((r) => r.itemIds);
    expect(queueIds).not.toContain(both);

    // Kỹ thuật viên/điều dưỡng không thấy giá vốn ở danh sách "Đã có kết quả".
    const asNurse = await done(nurseToken);
    expect((asNurse.body.data.items as { itemId: string; unitCost: number | null }[]).find((r) => r.itemId === both)!.unitCost).toBeNull();

    // Dịch vụ gửi đối tác không nhập/duyệt ở màn kết quả thường.
    const normalSave = await http().put(resultPath(both)).set(authed(nurseToken)).send({ sections: [{ itemId: both, values: [], descriptionText: 'Nhập tay' }], submit: false });
    expect(normalSave.status, JSON.stringify(normalSave.body)).toBe(409);
  });

  it('nhận kết quả: kiểm tra đầu vào — không tệp/không phải PDF/quá lớn/khác đối tác/giờ sai/nhận hai lần', async () => {
    const placed = await collectedOrder([svcBoth, svcOnlyA]);
    const both = itemOf(placed, svcBoth).id;
    const onlyA = itemOf(placed, svcOnlyA).id;
    expect((await send(adminToken, { supplierId: partnerB.id, itemIds: [both] })).status).toBe(200);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [onlyA] })).status).toBe(200);

    expect((await receive(nurseToken, [both], {}, null)).status).toBe(400);
    expect((await receive(nurseToken, [both], {}, Buffer.from('không phải pdf'), 'gia-mao.pdf')).status).toBe(400);
    expect((await receive(nurseToken, [both], {}, Buffer.alloc(10 * 1024 * 1024 + 10, 0x20))).status).toBe(413);
    // Hai đối tác khác nhau trong một tệp → 422, KHÔNG nhận gì.
    const mixed = await receive(nurseToken, [both, onlyA]);
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(422);
    expect(await privileged.labPartnerDispatchItem.count({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: { in: [both, onlyA] }, status: 'RECEIVED' } })).toBe(0);
    // Giờ nhận tương lai/trước giờ gửi → 422.
    expect((await receive(nurseToken, [both], { receivedAt: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(422);
    expect((await receive(nurseToken, [both], { receivedAt: new Date(Date.now() - 86_400_000).toISOString() })).status).toBe(422);
    // Mẫu lạ → 409 (không còn "Đã gửi"); dữ liệu JSON hỏng → 400.
    expect((await receive(nurseToken, [randomUUID()])).status).toBe(409);
    expect((await http().post(`${QUEUE}/results`).set(authed(nurseToken)).field('data', '{hỏng').attach('file', PDF, 'a.pdf')).status).toBe(400);

    const ok = await receive(nurseToken, [both]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await receive(nurseToken, [both])).status).toBe(409); // nhận lần hai
  });

  it('đối tác không nhận mẫu: lý do bắt buộc, mẫu về "Chờ gửi" để gửi đối tác khác, giữ lịch sử, KHÔNG ghi nợ', async () => {
    const placed = await collectedOrder([svcBoth]);
    const both = itemOf(placed, svcBoth).id;
    const before = await debtBalance(partnerA.id);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [both] })).status).toBe(200);

    const reject = (token: string, body: Record<string, unknown>) => http().post(`${QUEUE}/items/${both}/reject`).set(authed(token)).send(body);
    expect((await reject(nurseToken, {})).status).toBe(400);
    expect((await reject(receptionistToken, { reason: 'Mẫu tán huyết' })).status).toBe(403);
    expect((await http().post(`${QUEUE}/items/${randomUUID()}/reject`).set(authed(nurseToken)).send({ reason: 'Mẫu tán huyết' })).status).toBe(404);
    expect((await reject(nurseToken, { reason: 'Mẫu tán huyết, đối tác yêu cầu lấy lại' })).status).toBe(200);
    expect((await reject(nurseToken, { reason: 'Lần hai' })).status).toBe(404); // không còn "Đã gửi"

    expect(await debtBalance(partnerA.id)).toBe(before);
    const stored = await privileged.labPartnerDispatchItem.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: both } });
    expect(stored).toMatchObject({ status: 'REJECTED', rejectReason: 'Mẫu tán huyết, đối tác yêu cầu lấy lại' });
    const pend = await pending(adminToken);
    expect((pend.body.data.items as { itemId: string }[]).some((r) => r.itemId === both)).toBe(true);
    expect((await sent(adminToken)).body.data.items.some((r: { itemId: string }) => r.itemId === both)).toBe(false);
    // Gửi lại cho đối tác B (lịch sử lần bị từ chối vẫn giữ).
    expect((await send(adminToken, { supplierId: partnerB.id, itemIds: [both] })).status).toBe(200);
    expect(await privileged.labPartnerDispatchItem.count({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: both } })).toBe(2);
  });

  it('bác sĩ duyệt: kết quả thành bản ký, dịch vụ COMPLETED; điều dưỡng không duyệt được; duyệt hai lần / trả lại sau duyệt → 409', async () => {
    const placed = await collectedOrder([svcOnlyA]);
    const onlyA = itemOf(placed, svcOnlyA).id;
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [onlyA] })).status).toBe(200);
    expect((await receive(nurseToken, [onlyA])).status).toBe(200);

    const approve = (token: string, body: Record<string, unknown> = {}) => http().post(`${QUEUE}/items/${onlyA}/approve`).set(authed(token)).send(body);
    expect((await approve(nurseToken)).status).toBe(403);
    expect((await approve(receptionistToken)).status).toBe(403);
    const ok = await approve(doctorToken, { conclusionText: 'Không có bất thường' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const result = await privileged.paraclinicalResult.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: onlyA, deletedAt: null } });
    expect(result.signedAt).not.toBeNull();
    expect(result.signedBy).toBe(doctorUserId);
    expect(result.conclusionText).toBe('Không có bất thường');
    expect((await privileged.clinicalOrderItem.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, id: onlyA } })).status).toBe('COMPLETED');
    const row = (await done(adminToken)).body.data.items.find((r: { itemId: string }) => r.itemId === onlyA);
    expect(row).toMatchObject({ approval: 'APPROVED', approvedByName: 'User doctor', conclusionText: 'Không có bất thường' });

    expect((await approve(doctorToken)).status).toBe(409);
    expect((await http().post(`${QUEUE}/items/${onlyA}/return`).set(authed(nurseToken)).send({ reason: 'Sai tệp' })).status).toBe(409);
  });

  it('trả lại kỹ thuật viên (chưa duyệt): bỏ kết quả nháp, ĐẢO bút toán nợ, mẫu về "Đã gửi"; nhận lại được', async () => {
    const placed = await collectedOrder([svcOnlyA]);
    const onlyA = itemOf(placed, svcOnlyA).id;
    const before = await debtBalance(partnerA.id);
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [onlyA] })).status).toBe(200);
    expect((await receive(nurseToken, [onlyA])).status).toBe(200);
    expect(await debtBalance(partnerA.id)).toBe(before + 90_000);

    const giveBack = (body: Record<string, unknown>) => http().post(`${QUEUE}/items/${onlyA}/return`).set(authed(nurseToken)).send(body);
    expect((await giveBack({})).status).toBe(400);
    expect((await giveBack({ reason: 'Tệp thiếu trang cuối' })).status).toBe(200);

    expect(await debtBalance(partnerA.id)).toBe(before); // bút toán đảo triệt tiêu
    const reversal = await privileged.supplierDebtEntry.findFirst({ where: { tenantId: fixture.tenantA.id, entryType: 'REVERSAL', labPartnerDispatchItemId: { not: null }, note: 'Tệp thiếu trang cuối' } });
    expect(reversal?.reversalOfId).not.toBeNull();
    expect((await privileged.clinicalOrderItem.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, id: onlyA } })).status).toBe('IN_PROGRESS');
    expect(await privileged.paraclinicalResult.count({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: onlyA, deletedAt: null } })).toBe(0);
    const sentRows = (await sent(adminToken)).body.data.items as { itemId: string }[];
    expect(sentRows.some((r) => r.itemId === onlyA)).toBe(true);
    expect(((await done(adminToken)).body.data.items as { itemId: string }[]).some((r) => r.itemId === onlyA)).toBe(false);

    // Nhận lại tệp đúng: ghi nợ lần nữa.
    expect((await receive(nurseToken, [onlyA])).status).toBe(200);
    expect(await debtBalance(partnerA.id)).toBe(before + 90_000);
  });

  it('nhận kết quả: công tắc tắt → 409; công ty khác không nhận/duyệt được; lễ tân không có quyền nhận', async () => {
    const placed = await collectedOrder([svcOnlyA]);
    const onlyA = itemOf(placed, svcOnlyA).id;
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [onlyA] })).status).toBe(200);
    expect((await receive(receptionistToken, [onlyA])).status).toBe(403);
    expect((await receive(tenantBAdminToken, [onlyA])).status).toBe(409);
    expect((await http().post(`${QUEUE}/items/${onlyA}/approve`).set(authed(tenantBAdminToken)).send({})).status).toBe(404);
    expect((await http().get(`${QUEUE}/done`)).status).toBe(401);
    expect((await done(receptionistToken)).status).toBe(403);

    await setToggle(adminToken, false);
    expect((await receive(adminToken, [onlyA])).status).toBe(409);
    expect((await done(adminToken)).status).toBe(409);
    await setToggle(adminToken, true);
    expect((await receive(adminToken, [onlyA])).status).toBe(200);
  });

  it('chờ duyệt (màn khám + Tổng quan bác sĩ): lọc theo lượt khám và "của tôi"; rỗng khi đã duyệt hoặc công tắc tắt; lễ tân 403', async () => {
    const placed = await collectedOrder([svcOnlyA]);
    const onlyA = itemOf(placed, svcOnlyA).id;
    const encounterId = (await privileged.clinicalOrder.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, id: placed.orderId } })).encounterId;
    const awaiting = (token: string, query = '') => http().get(`${QUEUE}/awaiting${query}`).set(authed(token));
    const idsOf = (res: { body: { data: { items: { itemId: string }[] } } }) => res.body.data.items.map((r) => r.itemId);

    expect(idsOf(await awaiting(doctorToken, `?encounterId=${encounterId}`))).toEqual([]); // chưa nhận kết quả
    expect((await send(adminToken, { supplierId: partnerA.id, itemIds: [onlyA] })).status).toBe(200);
    expect(idsOf(await awaiting(doctorToken, `?encounterId=${encounterId}`))).toEqual([]); // mới gửi, chưa nhận
    expect((await receive(nurseToken, [onlyA])).status).toBe(200);

    const byEncounter = await awaiting(doctorToken, `?encounterId=${encounterId}`);
    expect(byEncounter.status, JSON.stringify(byEncounter.body)).toBe(200);
    expect(idsOf(byEncounter)).toEqual([onlyA]);
    expect(byEncounter.body.data.items[0]).toMatchObject({ approval: 'PENDING', supplierId: partnerA.id, unitCost: null });
    expect((await http().get(byEncounter.body.data.items[0].fileUrl)).status).toBe(200);
    expect(idsOf(await awaiting(doctorToken, `?encounterId=${randomUUID()}`))).toEqual([]); // lượt khám khác
    // "Của tôi": lượt khám do bác sĩ này khám thấy, người khác (điều dưỡng, không phải bác sĩ của lượt) không thấy.
    expect(idsOf(await awaiting(doctorToken, '?mine=true'))).toContain(onlyA);
    expect(idsOf(await awaiting(nurseToken, '?mine=true'))).not.toContain(onlyA);
    expect(idsOf(await awaiting(adminToken))).toContain(onlyA); // không lọc: mọi kết quả chờ duyệt của chi nhánh
    expect((await awaiting(adminToken)).body.data.costVisible).toBe(true);
    expect((await awaiting(adminToken, '?mine=abc')).status).toBe(400);

    // Công ty khác không thấy; lễ tân không có quyền xem.
    expect(idsOf(await awaiting(tenantBAdminToken))).not.toContain(onlyA);
    expect((await awaiting(receptionistToken)).status).toBe(403);
    expect((await http().get(`${QUEUE}/awaiting`)).status).toBe(401);

    // Công tắc tắt → rỗng (không lỗi), bật lại thấy lại.
    await setToggle(adminToken, false);
    const off = await awaiting(doctorToken, `?encounterId=${encounterId}`);
    expect(off.status).toBe(200);
    expect(idsOf(off)).toEqual([]);
    await setToggle(adminToken, true);
    expect(idsOf(await awaiting(doctorToken, `?encounterId=${encounterId}`))).toEqual([onlyA]);

    // Duyệt xong thì rời danh sách chờ duyệt.
    expect((await http().post(`${QUEUE}/items/${onlyA}/approve`).set(authed(doctorToken)).send({})).status).toBe(200);
    expect(idsOf(await awaiting(doctorToken, `?encounterId=${encounterId}`))).toEqual([]);
    expect(idsOf(await awaiting(doctorToken, '?mine=true'))).not.toContain(onlyA);
  });

  // ---- Bảng kê mẫu gửi đối tác (docs/DECISIONS.md #291 GĐ4) ----
  it('bảng kê: đủ dòng (đã có kết quả/chờ kết quả quá hạn/không nhận), cộng đúng, số dư khớp sổ công nợ, lọc kỳ + trạng thái, Excel + nhật ký, quyền, cô lập, công tắc', async () => {
    const partnerC = await createPartner(adminToken, 'Đối tác bảng kê');
    const svcFast = await createService({ name: 'XN bảng kê hạn 60 phút (e2e)', turnaroundMinutes: 60, sentToPartner: true, partnerPrices: [{ supplierId: partnerC.id, amount: 100_000, isDefault: true }] });
    const svcPlain = await createService({ name: 'XN bảng kê không hạn (e2e)', sentToPartner: true, partnerPrices: [{ supplierId: partnerC.id, amount: 50_000, isDefault: true }] });
    const STATEMENT = `/api/v1/lab-partner-statement/${partnerC.id}`;
    const statement = (token: string, qs = '') => http().get(`${STATEMENT}${qs}`).set(authed(token));

    const order1 = await collectedOrder([svcFast, svcPlain]);
    const order2 = await collectedOrder([svcFast]);
    const order3 = await collectedOrder([svcFast]);
    const a1 = itemOf(order1, svcFast).id;
    const b1 = itemOf(order1, svcPlain).id;
    const a2 = itemOf(order2, svcFast).id;
    const a3 = itemOf(order3, svcFast).id;
    expect((await send(adminToken, { supplierId: partnerC.id, itemIds: [a1, b1, a2, a3] })).status).toBe(200);
    // Dòng bảng kê mang id của DÒNG GỬI (không phải dòng chỉ định).
    const dispatchItems = await privileged.labPartnerDispatchItem.findMany({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: { in: [a1, b1, a2, a3] } } });
    const dispatchIdOf = new Map(dispatchItems.map((r) => [r.clinicalOrderItemId, r.id]));
    const D = (orderItemId: string): string => dispatchIdOf.get(orderItemId)!;

    // a1 + b1 nhận kết quả (ghi nợ 150.000); a2 không nhận; a3 còn chờ và đã quá hạn.
    expect((await receive(nurseToken, [a1, b1])).status).toBe(200);
    expect((await http().post(`${QUEUE}/items/${a2}/reject`).set(authed(nurseToken)).send({ reason: 'Mẫu tán huyết' })).status).toBe(200);
    await privileged.labPartnerDispatchItem.updateMany({ where: { tenantId: fixture.tenantA.id, clinicalOrderItemId: a3 }, data: { dueAt: new Date(Date.now() - 3 * 3_600_000) } });

    // Toàn bộ: 4 dòng, đúng trạng thái và tiền.
    const all = await statement(adminToken);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const rows = all.body.data.items as { itemId: string; state: string; late: boolean; amount: number; tubeSid: string | null; patientName: string; patientCode: string; serviceName: string; branchName: string | null; turnaroundMinutes: number | null; receivedAt: string | null; rejectReason: string | null }[];
    expect(rows.map((r) => r.itemId).sort()).toEqual([a1, b1, a2, a3].map(D).sort());
    const byId = new Map(rows.map((r) => [r.itemId, r]));
    expect(byId.get(D(a1))).toMatchObject({ state: 'DONE', late: false, amount: 100_000, patientName: 'Bệnh nhân e2e gửi đối tác', serviceName: 'XN bảng kê hạn 60 phút (e2e)' });
    expect(byId.get(D(a1))!.tubeSid).toBe(order1.sidByItem.get(a1));
    expect(byId.get(D(a1))!.turnaroundMinutes).not.toBeNull();
    expect(byId.get(D(b1))).toMatchObject({ state: 'DONE', late: false, amount: 50_000 });
    expect(byId.get(D(a2))).toMatchObject({ state: 'REJECTED', late: false, amount: 0, receivedAt: null, rejectReason: 'Mẫu tán huyết' });
    expect(byId.get(D(a3))).toMatchObject({ state: 'WAITING', late: true, amount: 100_000, receivedAt: null, turnaroundMinutes: null });
    expect(typeof byId.get(D(a1))!.branchName).toBe('string');

    // Cộng: chỉ mẫu đã có kết quả = số phát sinh; số dư theo sổ công nợ trong cùng kỳ.
    expect(all.body.data.summary).toEqual({
      doneCount: 2,
      doneAmount: 150_000,
      waitingCount: 1,
      waitingAmount: 100_000,
      rejectedCount: 1,
      lateCount: 1,
      openingBalance: 0,
      periodAccrued: 150_000,
      periodPaid: 0,
      closingBalance: 150_000,
    });
    expect(all.body.data.supplier).toMatchObject({ name: 'Đối tác bảng kê' });
    expect(all.body.data.truncated).toBe(false);
    expect(await debtBalance(partnerC.id)).toBe(150_000);

    // Lọc trạng thái (tổng hợp vẫn tính cả kỳ).
    const idsOfRows = (res: { body: { data: { items: { itemId: string }[] } } }) => res.body.data.items.map((r) => r.itemId).sort();
    expect(idsOfRows(await statement(adminToken, '?status=DONE'))).toEqual([a1, b1].map(D).sort());
    expect(idsOfRows(await statement(adminToken, '?status=WAITING'))).toEqual([D(a3)]);
    expect(idsOfRows(await statement(adminToken, '?status=REJECTED'))).toEqual([D(a2)]);
    expect(idsOfRows(await statement(adminToken, '?status=LATE'))).toEqual([D(a3)]);
    const onlyDone = await statement(adminToken, '?status=DONE');
    expect(onlyDone.body.data.summary.waitingCount).toBe(1);

    // Kỳ: hôm nay gồm cả bốn (dòng chưa nhận rơi theo ngày gửi); kỳ quá khứ/tương lai rỗng; đảo ngày → 400.
    const today = getVietnamDateString(new Date());
    expect(idsOfRows(await statement(adminToken, `?from=${today}&to=${today}`))).toEqual([a1, b1, a2, a3].map(D).sort());
    expect(idsOfRows(await statement(adminToken, `?from=${today}&to=${today}&basis=SENT`))).toEqual([a1, b1, a2, a3].map(D).sort());
    const past = await statement(adminToken, '?from=2000-01-01&to=2000-12-31');
    expect(past.body.data.items).toEqual([]);
    expect(past.body.data.summary).toMatchObject({ doneCount: 0, doneAmount: 0, openingBalance: 0, periodAccrued: 0, periodPaid: 0, closingBalance: 0 });
    const future = await statement(adminToken, '?from=2999-01-01');
    expect(future.body.data.items).toEqual([]);
    expect(future.body.data.summary).toMatchObject({ doneCount: 0, openingBalance: 150_000, closingBalance: 150_000 });
    expect((await statement(adminToken, '?from=2026-11-10&to=2026-11-01')).status).toBe(400);
    expect((await statement(adminToken, '?status=SAI')).status).toBe(400);

    // Thanh toán một phần: "Đã thanh toán" chỉ tính phiếu chi thật; phát sinh giữ nguyên; đầu kỳ + phát sinh − đã trả = cuối kỳ.
    const accounts = await http().get('/api/v1/cash-accounts').set(authed(adminToken));
    const cashAccountId = accounts.body.data.items.find((a: { type: string }) => a.type === 'CASH').id as string;
    const pay = await http().post(`/api/v1/supplier-debt/${partnerC.id}/payment`).set(authed(adminToken)).send({ amount: 40_000, paymentMethodCode: 'CASH', cashAccountId });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const afterPay = await statement(adminToken);
    expect(afterPay.body.data.summary).toMatchObject({ doneAmount: 150_000, openingBalance: 0, periodAccrued: 150_000, periodPaid: 40_000, closingBalance: 110_000 });

    // Dải "đang chờ" ở trang đối tác.
    const pendingSummary = await http().get(`${STATEMENT}/pending-summary`).set(authed(adminToken));
    expect(pendingSummary.status, JSON.stringify(pendingSummary.body)).toBe(200);
    expect(pendingSummary.body.data).toEqual({ waitingCount: 1, waitingAmount: 100_000 });

    // Excel: cùng dòng và cùng tổng; ghi nhật ký xuất.
    const exp = await http().get(`${STATEMENT}/export`).set(authed(adminToken)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exp.body as unknown as ArrayBuffer);
    const lines: string[] = [];
    wb.worksheets[0]!.eachRow((row) => lines.push((row.values as ExcelJS.CellValue[]).filter((v) => v !== null && v !== undefined).join(' | ')));
    const sheetText = lines.join('\n');
    expect(wb.worksheets[0]!.name).toBe('Bảng kê mẫu gửi đối tác');
    expect(sheetText).toContain('Đối tác: ');
    expect(sheetText).toContain('Đối tác bảng kê');
    expect(sheetText).toContain('Số dư đầu kỳ: 0 · Phát sinh: 150.000 · Đã thanh toán: 40.000 · Số dư cuối kỳ: 110.000');
    expect(sheetText).toContain('Đã có kết quả: 2 mẫu = 150.000 đ');
    expect(sheetText).toContain('Đối tác không nhận');
    expect(sheetText).toContain('Không nhận');
    expect(sheetText).toContain('Chờ kết quả');
    expect(lines.filter((l) => l.includes('Bệnh nhân e2e gửi đối tác')).length).toBe(4);
    const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'supplier_debt.lab_partner_statement_exported', entityId: partnerC.id } });
    expect(audit).not.toBeNull();

    // Quyền: cần supplier_debt.read (điều dưỡng/lễ tân/bác sĩ không có); không token → 401.
    for (const token of [nurseToken, receptionistToken, doctorToken]) {
      expect((await statement(token)).status).toBe(403);
      expect((await http().get(`${STATEMENT}/export`).set(authed(token))).status).toBe(403);
      expect((await http().get(`${STATEMENT}/pending-summary`).set(authed(token))).status).toBe(403);
    }
    expect((await http().get(STATEMENT)).status).toBe(401);

    // Cô lập công ty: công ty B không xem được đối tác của A; id lạ/sai định dạng → 404.
    await setToggle(tenantBAdminToken, true); // công tắc là của từng công ty: bật cho B để kiểm đúng lớp cô lập
    expect((await statement(tenantBAdminToken)).status).toBe(404);
    expect((await http().get(`${STATEMENT}/export`).set(authed(tenantBAdminToken))).status).toBe(404);
    expect((await http().get(`${STATEMENT}/pending-summary`).set(authed(tenantBAdminToken))).status).toBe(404);
    expect((await http().get(`/api/v1/lab-partner-statement/${randomUUID()}`).set(authed(adminToken))).status).toBe(404);
    expect((await http().get('/api/v1/lab-partner-statement/khong-phai-uuid').set(authed(adminToken))).status).toBe(404);

    // Công tắc tắt → 409 cho cả ba API; bật lại thì như cũ.
    await setToggle(adminToken, false);
    expect((await statement(adminToken)).status).toBe(409);
    expect((await http().get(`${STATEMENT}/export`).set(authed(adminToken))).status).toBe(409);
    expect((await http().get(`${STATEMENT}/pending-summary`).set(authed(adminToken))).status).toBe(409);
    await setToggle(adminToken, true);
    expect((await statement(adminToken)).status).toBe(200);
  });
});
