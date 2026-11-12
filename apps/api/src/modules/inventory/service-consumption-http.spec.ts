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
 * HTTP e2e "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4): định mức, ghi tiêu hao (FEFO, kho mặc định chi nhánh, không thu tiền), đảo phiếu, quyền xem giá vốn,
 * cô lập công ty. Lượt khám thật đi qua Tiếp nhận → Bắt đầu khám; dòng chỉ định cận lâm sàng qua `PUT /encounters/:id/clinical-orders`.
 */
describe('HTTP e2e — /api/v1/service-consumption (Chi phí vật tư theo dịch vụ)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let nurseToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let warehouseId: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-sc-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { token: login.body.data.accessToken as string, userId: user.id as string };
  }

  async function createDrug(name: string, opts: { isBatchManaged?: boolean; itemType?: 'MEDICINE' | 'SUPPLY' } = {}) {
    const supply = opts.itemType === 'SUPPLY';
    const res = await http()
      .post('/api/v1/drugs')
      .set(authed(adminToken))
      .send({
        code: `SC-${randomUUID().slice(0, 8)}`,
        name,
        itemType: opts.itemType ?? 'MEDICINE',
        baseUnitCode: 'VIEN',
        manufacturerCode: 'TEST_MANUFACTURER',
        defaultSellPrice: 1000,
        isBatchManaged: opts.isBatchManaged ?? true,
        drugGroupCode: 'TEST_GROUP',
        registrationNumber: 'VD-TEST-0001',
        ...(supply
          ? { ingredients: [] }
          : { routeCode: 'TEST_ROUTE', dosageForm: 'Viên nén', countryOfOrigin: 'Việt Nam', ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }] }),
        units: [],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  /** Nhập kho tồn đầu kỳ (đã Duyệt) cho một lô, giá vốn `unitCost` mỗi đơn vị cơ sở. */
  async function stockIn(drugId: string, quantity: number, unitCost: number, lot?: { batchNo: string; expiryDate: string }) {
    const created = await http()
      .post('/api/v1/inventory/receipts')
      .set(authed(adminToken))
      .send({ warehouseId, receiptType: 'OPENING_BALANCE', lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost, ...(lot ? { batchNo: lot.batchNo, expiryDate: lot.expiryDate } : {}) }] });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(adminToken)).send({ version: created.body.data.version });
    expect(approved.status).toBe(200);
  }

  /** Tổng tồn của mặt hàng ở kho đang dùng (cả hàng không theo lô) + danh sách lô còn tồn. */
  const onHand = async (drugId: string) => {
    const lots = (await http().get(`/api/v1/inventory/drugs/${drugId}/balances`).set(authed(adminToken)).query({ warehouseId })).body.data as { items: { batchNo: string; quantityOnHand: number }[] };
    const rows = (await http().get('/api/v1/inventory/balances').set(authed(adminToken)).query({ warehouseId })).body.data.items as { drugId: string; quantityOnHand: number }[];
    return { totalQuantityOnHand: rows.find((r) => r.drugId === drugId)?.quantityOnHand ?? 0, items: lots.items };
  };

  async function newEncounter(): Promise<{ encounterId: string }> {
    const patient = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e tiêu hao', dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) });
    const checkIn = await http()
      .post('/api/v1/reception/direct')
      .set(authed(receptionistToken))
      .send({
        patientId: patient.body.data.id,
        doctorId: doctorUserId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
        allowsDeferredPayment: true,
        checkedInAt: new Date().toISOString(),
      });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
    const encounterId = checkIn.body.data.id as string;
    expect((await http().post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 })).status).toBe(200);
    return { encounterId };
  }

  async function orderTechService(encounterId: string): Promise<string> {
    const svc = await http().post('/api/v1/technical-services').set(authed(adminToken)).send({ name: `XN tiêu hao ${randomUUID().slice(0, 6)}`, serviceKind: 'LAB', isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100_000, effectiveFrom: '2020-01-01' }] });
    expect(svc.status, JSON.stringify(svc.body)).toBe(200);
    const saved = await http().put(`/api/v1/encounters/${encounterId}/clinical-orders`).set(authed(doctorToken)).send({ items: [{ performance: 'IN_HOUSE', technicalServiceId: svc.body.data.id, quantity: 1 }] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    return svc.body.data.id as string;
  }

  type Overview = {
    canSeeCost: boolean;
    warehouses: { id: string; name: string; isDefault: boolean; departmentName: string | null }[];
    services: {
      target: { kind: string; id: string };
      serviceKind: string;
      serviceName: string;
      norm: { drugId: string; quantity: number; drugName: string }[];
      record: null | { id: string; performedByName: string; totalCost: number | null; lines: { drugId: string; quantity: number; batchNo: string | null; unitCost: number | null }[] };
    }[];
  };
  const overview = async (encounterId: string, token = adminToken) => {
    const res = await http().get(`/api/v1/service-consumption/encounters/${encounterId}`).set(authed(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Overview;
  };
  const record = (token: string, body: Record<string, unknown>) => http().post('/api/v1/service-consumption/records').set(authed(token)).send(body);

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
    fixture = await createTwoTenantFixture(privileged, 'ServiceConsumption e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    nurseToken = (await createUserWithRole(fixture.tenantA.id, 'nurse')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
    warehouseId = (await http().get('/api/v1/warehouses').set(authed(adminToken))).body.data.items[0].id;
    // "Thanh toán sau": lượt khám vào khám được ngay dù phiếu thu chưa thu.
    await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ deferredPaymentEnabled: true });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('Định mức', () => {
    it('quản lý khai định mức cho dịch vụ kỹ thuật và dịch vụ khám; đọc lại có tên + loại; ghi lại thì thay nguyên; rỗng thì xoá hết', async () => {
      const a = await createDrug('Ống nghiệm định mức', { itemType: 'SUPPLY' });
      const b = await createDrug('Bông cồn định mức', { itemType: 'SUPPLY' });
      const { encounterId } = await newEncounter();
      const techId = await orderTechService(encounterId);

      const put = await http().put('/api/v1/service-consumption/norms').query({ kind: 'TECHNICAL_SERVICE', ref: techId }).set(authed(adminToken)).send({ lines: [{ drugId: a, quantity: 1 }, { drugId: b, quantity: 2 }] });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.data.lines.map((l: { drugName: string; quantity: number; itemType: string }) => [l.drugName, l.quantity, l.itemType])).toEqual([['Ống nghiệm định mức', 1, 'SUPPLY'], ['Bông cồn định mức', 2, 'SUPPLY']]);

      // Dịch vụ khám theo MÃ danh mục.
      const examCreated = await http().post('/api/v1/reference-catalog').set(authed(adminToken)).send({ category: 'EXAM_TYPE', name: `Khám thử định mức ${randomUUID().slice(0, 6)}`, examTypePrices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 150_000, effectiveFrom: '2020-01-01' }] });
      expect(examCreated.status, JSON.stringify(examCreated.body)).toBe(200);
      const exam = await http().put('/api/v1/service-consumption/norms').query({ kind: 'EXAM_TYPE', ref: examCreated.body.data.code }).set(authed(adminToken)).send({ lines: [{ drugId: a, quantity: 3 }] });
      expect(exam.status, JSON.stringify(exam.body)).toBe(200);

      const replaced = await http().put('/api/v1/service-consumption/norms').query({ kind: 'TECHNICAL_SERVICE', ref: techId }).set(authed(adminToken)).send({ lines: [{ drugId: b, quantity: 5 }] });
      expect(replaced.body.data.lines).toHaveLength(1);
      expect(replaced.body.data.lines[0]).toMatchObject({ drugId: b, quantity: 5 });
      const read = await http().get('/api/v1/service-consumption/norms').query({ kind: 'TECHNICAL_SERVICE', ref: techId }).set(authed(doctorToken));
      expect(read.status).toBe(200);
      expect(read.body.data.lines).toHaveLength(1);

      const cleared = await http().put('/api/v1/service-consumption/norms').query({ kind: 'TECHNICAL_SERVICE', ref: techId }).set(authed(adminToken)).send({ lines: [] });
      expect(cleared.body.data.lines).toEqual([]);
    });

    it('chặn: bác sĩ không có quyền khai định mức (403), một mặt hàng hai dòng (400), dịch vụ lạ (404), công ty khác không khai được dịch vụ của mình (404)', async () => {
      const a = await createDrug('Định mức chặn', { itemType: 'SUPPLY' });
      const { encounterId } = await newEncounter();
      const techId = await orderTechService(encounterId);
      const url = (token: string, body: unknown, ref = techId, kind = 'TECHNICAL_SERVICE') => http().put('/api/v1/service-consumption/norms').query({ kind, ref }).set(authed(token)).send(body as object);

      expect((await url(doctorToken, { lines: [{ drugId: a, quantity: 1 }] })).status).toBe(403);
      expect((await url(adminToken, { lines: [{ drugId: a, quantity: 1 }, { drugId: a, quantity: 2 }] })).status).toBe(400);
      expect((await url(adminToken, { lines: [{ drugId: a, quantity: 0 }] })).status).toBe(400);
      expect((await url(adminToken, { lines: [] }, randomUUID())).status).toBe(404);
      expect((await url(adminToken, { lines: [] }, 'khong-phai-uuid')).status).toBe(404);
      expect((await url(tenantBAdminToken, { lines: [] })).status).toBe(404);
    });
  });

  describe('Ghi tiêu hao', () => {
    it('ghi cho dịch vụ khám: tự chọn lô theo hạn dùng (FEFO), trừ đúng kho + thẻ kho, không đụng hoá đơn; người làm KHÔNG thấy giá vốn, quản lý thấy', async () => {
      const batchDrug = await createDrug('Gạc có lô', { itemType: 'SUPPLY' });
      const plainDrug = await createDrug('Bơm tiêm không lô', { itemType: 'SUPPLY', isBatchManaged: false });
      await stockIn(batchDrug, 2, 100, { batchNo: 'FEFO-A', expiryDate: '2099-01-01' }); // hết hạn SỚM hơn
      await stockIn(batchDrug, 10, 300, { batchNo: 'FEFO-B', expiryDate: '2099-06-01' });
      await stockIn(batchDrug, 5, 50, { batchNo: 'FEFO-OLD', expiryDate: '2020-01-01' }); // đã hết hạn: không dùng
      await stockIn(plainDrug, 20, 1000);

      const { encounterId } = await newEncounter();
      const svc = (await overview(encounterId)).services.find((s) => s.target.kind === 'ENCOUNTER_SERVICE_ITEM')!;
      const invoiceBefore = (await http().get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken))).body.data.totalAmount;

      const res = await record(doctorToken, { encounterId, target: svc.target, lines: [{ drugId: batchDrug, quantity: 3 }, { drugId: plainDrug, quantity: 4 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rec = res.body.data.services.find((s: { target: { id: string } }) => s.target.id === svc.target.id).record;
      expect(rec.performedByName).toBe('User doctor');
      const gauze = rec.lines.filter((l: { drugId: string }) => l.drugId === batchDrug).map((l: { batchNo: string; quantity: number }) => [l.batchNo, l.quantity]);
      expect(gauze).toEqual([['FEFO-A', 2], ['FEFO-B', 1]]);
      expect(rec.lines.find((l: { drugId: string }) => l.drugId === plainDrug)).toMatchObject({ batchNo: null, quantity: 4 });
      // Người làm không thấy giá vốn.
      expect(res.body.data.canSeeCost).toBe(false);
      expect(rec.totalCost).toBeNull();
      expect(rec.lines.every((l: { unitCost: number | null }) => l.unitCost === null)).toBe(true);
      // Quản lý thấy: 2×100 + 1×300 + 4×1000 = 4.500.
      const asAdmin = (await overview(encounterId)).services.find((s) => s.target.id === svc.target.id)!.record!;
      expect(asAdmin.totalCost).toBe(4500);

      // Lô FEFO-A hết sạch (không còn dòng tồn); FEFO-B còn 9; lô đã hết hạn không bị đụng.
      expect((await onHand(batchDrug)).items.map((i) => [i.batchNo, i.quantityOnHand]).sort()).toEqual([['FEFO-B', 9], ['FEFO-OLD', 5]]);
      expect((await onHand(plainDrug)).totalQuantityOnHand).toBe(16);
      const ledger = await http().get(`/api/v1/inventory/drugs/${batchDrug}/ledger`).set(authed(adminToken));
      expect(ledger.body.data.items.some((e: { reason: string; quantityChange: number }) => e.reason === 'ISSUE_SERVICE_CONSUMPTION' && e.quantityChange === -2)).toBe(true);
      // Không thu thêm tiền: hoá đơn khám giữ nguyên.
      expect((await http().get(`/api/v1/billing/invoices/${encounterId}`).set(authed(receptionistToken))).body.data.totalAmount).toBe(invoiceBefore);
    });

    it('ghi cho dòng chỉ định cận lâm sàng; ghi lần hai cho cùng dịch vụ → 409; hai người ghi cùng lúc → đúng một thành công, tồn chỉ trừ một lần', async () => {
      const drug = await createDrug('Ống EDTA', { itemType: 'SUPPLY', isBatchManaged: false });
      await stockIn(drug, 30, 500);
      const { encounterId } = await newEncounter();
      await orderTechService(encounterId);
      const cls = (await overview(encounterId)).services.find((s) => s.target.kind === 'CLINICAL_ORDER_ITEM')!;

      const results = await Promise.all([
        record(nurseToken, { encounterId, target: cls.target, lines: [{ drugId: drug, quantity: 2 }] }),
        record(doctorToken, { encounterId, target: cls.target, lines: [{ drugId: drug, quantity: 2 }] }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await onHand(drug)).totalQuantityOnHand).toBe(28);

      const again = await record(doctorToken, { encounterId, target: cls.target, lines: [{ drugId: drug, quantity: 1 }] });
      expect(again.status).toBe(409);
      expect(again.body.error.message).toContain('đảo phiếu cũ');
    });

    it('không đủ tồn → 422 nêu tên và số còn dùng được, KHÔNG ghi gì (kể cả mặt hàng đủ tồn đứng trước trong cùng yêu cầu)', async () => {
      const enough = await createDrug('Đủ tồn', { itemType: 'SUPPLY', isBatchManaged: false });
      const short = await createDrug('Thiếu tồn', { itemType: 'SUPPLY' });
      await stockIn(enough, 10, 100);
      await stockIn(short, 1, 100, { batchNo: 'ONE', expiryDate: '2099-01-01' });
      const { encounterId } = await newEncounter();
      const svc = (await overview(encounterId)).services[0]!;
      const res = await record(doctorToken, { encounterId, target: svc.target, lines: [{ drugId: enough, quantity: 3 }, { drugId: short, quantity: 5 }] });
      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('Thiếu tồn');
      expect(res.body.error.message).toContain('còn dùng được 1');
      expect((await onHand(enough)).totalQuantityOnHand).toBe(10);
      expect((await overview(encounterId)).services[0]!.record).toBeNull();
    });

    it('chặn: lễ tân không có quyền ghi (403); dịch vụ của lượt khám khác (404); lượt khám của công ty khác (404); thiếu dòng (400); mặt hàng trùng (400)', async () => {
      const drug = await createDrug('Chặn ghi', { itemType: 'SUPPLY', isBatchManaged: false });
      await stockIn(drug, 10, 100);
      const first = await newEncounter();
      const second = await newEncounter();
      const svc1 = (await overview(first.encounterId)).services[0]!;
      const svc2 = (await overview(second.encounterId)).services[0]!;
      const line = [{ drugId: drug, quantity: 1 }];

      expect((await record(receptionistToken, { encounterId: first.encounterId, target: svc1.target, lines: line })).status).toBe(403);
      expect((await record(doctorToken, { encounterId: first.encounterId, target: svc2.target, lines: line })).status).toBe(404);
      expect((await record(tenantBAdminToken, { encounterId: first.encounterId, target: svc1.target, lines: line })).status).toBe(404);
      expect((await record(doctorToken, { encounterId: first.encounterId, target: svc1.target, lines: [] })).status).toBe(400);
      expect((await record(doctorToken, { encounterId: first.encounterId, target: svc1.target, lines: [...line, ...line] })).status).toBe(400);
      expect((await http().get(`/api/v1/service-consumption/encounters/${first.encounterId}`).set(authed(tenantBAdminToken))).status).toBe(404);
      expect((await http().get(`/api/v1/service-consumption/encounters/${first.encounterId}`).set(authed(receptionistToken))).status).toBe(403);
    });
  });

  describe('Đảo phiếu', () => {
    it('quản lý đảo phiếu kèm lý do → hoàn kho đúng lô, dịch vụ ghi lại được; đảo lần hai → 409; thiếu lý do → 400; người làm không có quyền đảo → 403', async () => {
      const drug = await createDrug('Đảo phiếu', { itemType: 'SUPPLY' });
      await stockIn(drug, 6, 100, { batchNo: 'REV-1', expiryDate: '2099-01-01' });
      const { encounterId } = await newEncounter();
      const svc = (await overview(encounterId)).services[0]!;
      const recorded = await record(doctorToken, { encounterId, target: svc.target, lines: [{ drugId: drug, quantity: 4 }] });
      const issueId = recorded.body.data.services[0].record.id as string;
      expect((await onHand(drug)).totalQuantityOnHand).toBe(2);

      const reverse = (token: string, body: unknown) => http().post(`/api/v1/service-consumption/records/${issueId}/reverse`).set(authed(token)).send(body as object);
      expect((await reverse(doctorToken, { reason: 'Ghi nhầm số lượng' })).status).toBe(403);
      expect((await reverse(adminToken, {})).status).toBe(400);
      const done = await reverse(adminToken, { reason: 'Ghi nhầm số lượng' });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body.data.services[0].record).toBeNull();
      expect((await onHand(drug)).items.map((i) => [i.batchNo, i.quantityOnHand])).toEqual([['REV-1', 6]]);
      const ledger = await http().get(`/api/v1/inventory/drugs/${drug}/ledger`).set(authed(adminToken));
      expect(ledger.body.data.items.some((e: { reason: string }) => e.reason === 'ISSUE_VOID')).toBe(true);

      expect((await reverse(adminToken, { reason: 'Đảo lần hai' })).status).toBe(409);
      const again = await record(doctorToken, { encounterId, target: svc.target, lines: [{ drugId: drug, quantity: 1 }] });
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect((await onHand(drug)).totalQuantityOnHand).toBe(5);
    });
  });

  it('phiếu tiêu hao hiện ở danh sách phiếu xuất kho với loại SERVICE_CONSUMPTION và không có hoá đơn', async () => {
    const drug = await createDrug('Danh sách phiếu', { itemType: 'SUPPLY', isBatchManaged: false });
    await stockIn(drug, 5, 100);
    const { encounterId } = await newEncounter();
    const svc = (await overview(encounterId)).services[0]!;
    const res = await record(doctorToken, { encounterId, target: svc.target, lines: [{ drugId: drug, quantity: 1 }] });
    const issueId = res.body.data.services[0].record.id as string;
    const detail = await http().get(`/api/v1/inventory/issues/${issueId}`).set(authed(adminToken));
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data).toMatchObject({ issueType: 'SERVICE_CONSUMPTION', status: 'POSTED', totalAmount: 0 });

    // Không huỷ được ở danh sách phiếu xuất (bỏ qua quyền đảo + lý do tiêu hao) — phải đảo ở phần ghi vật tư đã dùng.
    const voided = await http().post(`/api/v1/inventory/issues/${issueId}/void`).set(authed(adminToken)).send({ version: detail.body.data.version, reason: 'Huỷ thử ở danh sách' });
    expect(voided.status, JSON.stringify(voided.body)).toBe(409);
    expect((await overview(encounterId)).services[0]!.record).not.toBeNull();
  });
  describe('Chọn kho trừ — kho chính và kho phụ theo chi nhánh', () => {
    let branchAId: string;
    let branchBId: string;
    let adminBranchBToken: string;
    let mainA: string;
    let mainB: string;
    let subA: string;
    let subB: string;

    /** Tài khoản gán đúng MỘT chi nhánh (công ty đã có 2 chi nhánh thì tài khoản mới phải được gán). */
    async function userIn(roleName: string, branchId: string, departmentId?: string) {
      const username = `e2e-sc-wh-${roleName}-${randomUUID()}`;
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const user = await privileged.userAccount.create({ data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: `User ${roleName}`, ...(departmentId ? { departmentId } : {}), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      const role = await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: roleName } });
      await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      await privileged.userBranch.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      const login = await http().post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      return { token: login.body.data.accessToken as string, userId: user.id as string };
    }

    async function stockInAt(token: string, whId: string, drugId: string, quantity: number, unitCost: number) {
      const created = await http()
        .post('/api/v1/inventory/receipts')
        .set(authed(token))
        .send({ warehouseId: whId, receiptType: 'OPENING_BALANCE', lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost, batchNo: `WH-${randomUUID().slice(0, 6)}`, expiryDate: '2099-01-01' }] });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(token)).send({ version: created.body.data.version });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    }

    const onHandAt = async (token: string, whId: string, drugId: string): Promise<number> => {
      const rows = (await http().get('/api/v1/inventory/balances').set(authed(token)).query({ warehouseId: whId })).body.data.items as { drugId: string; quantityOnHand: number }[];
      return rows.find((r) => r.drugId === drugId)?.quantityOnHand ?? 0;
    };

    const warehouseIds = async (token: string, encounterId: string) => (await overview(encounterId, token)).warehouses.map((w) => w.id);

    beforeAll(async () => {
      branchAId = (await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id }, orderBy: { createdAt: 'asc' } })).id;
      const br = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh Quận 7 (kho nhỏ)', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
      expect(br.status, JSON.stringify(br.body)).toBe(200);
      branchBId = br.body.data.id as string;
      adminBranchBToken = (await userIn('clinic_admin', branchBId)).token;
      mainA = warehouseId;
      // Kho nhỏ: KHÔNG truyền chi nhánh → thuộc chi nhánh đang làm việc của người tạo.
      const a = await http().post('/api/v1/warehouses').set(authed(adminToken)).send({ name: 'Kho thủ thuật A' });
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      subA = a.body.data.id as string;
      const b = await http().post('/api/v1/warehouses').set(authed(adminBranchBToken)).send({ name: 'Kho thủ thuật B' });
      expect(b.status, JSON.stringify(b.body)).toBe(200);
      subB = b.body.data.id as string;
      const listB = (await http().get('/api/v1/warehouses').set(authed(adminBranchBToken))).body.data.items as { id: string; isDefault: boolean }[];
      mainB = listB.find((w) => w.isDefault)!.id;
    }, 120_000);

    it('tạo kho không chọn chi nhánh → thuộc chi nhánh đang làm việc của người tạo; danh sách kho chỉ thấy kho của chi nhánh mình', async () => {
      const subAdb = await privileged.warehouse.findFirstOrThrow({ where: { id: subA } });
      const subBdb = await privileged.warehouse.findFirstOrThrow({ where: { id: subB } });
      expect(subAdb.branchId).toBe(branchAId);
      expect(subBdb.branchId).toBe(branchBId);
      const listA = ((await http().get('/api/v1/warehouses').set(authed(adminToken))).body.data.items as { id: string }[]).map((w) => w.id);
      const listB = ((await http().get('/api/v1/warehouses').set(authed(adminBranchBToken))).body.data.items as { id: string }[]).map((w) => w.id);
      expect(listA).toEqual(expect.arrayContaining([mainA, subA]));
      expect(listA).not.toContain(subB);
      expect(listA).not.toContain(mainB);
      expect(listB).toEqual(expect.arrayContaining([mainB, subB]));
      expect(listB).not.toContain(subA);
      expect(listB).not.toContain(mainA);
    });

    it('ô chọn kho của chi nhánh A: kho chính đứng đầu + kho phụ của A, KHÔNG có kho nào của chi nhánh B', async () => {
      const { encounterId } = await newEncounter();
      const view = await overview(encounterId);
      expect(view.warehouses[0]).toMatchObject({ id: mainA, isDefault: true });
      const ids = view.warehouses.map((w) => w.id);
      expect(ids).toEqual(expect.arrayContaining([mainA, subA]));
      expect(ids).not.toContain(subB);
      expect(ids).not.toContain(mainB);
    });

    it('chọn kho phụ: chỉ kho phụ đó bị trừ; kho chính cùng chi nhánh và kho cùng mặt hàng ở chi nhánh khác KHÔNG đổi; phiếu ghi đúng kho; đảo phiếu hoàn về kho phụ', async () => {
      const drug = await createDrug('Kho phụ cô lập', { itemType: 'SUPPLY' });
      await stockInAt(adminToken, mainA, drug, 50, 100);
      await stockInAt(adminToken, subA, drug, 10, 100);
      await stockInAt(adminBranchBToken, mainB, drug, 30, 100);
      await stockInAt(adminBranchBToken, subB, drug, 20, 100);

      const { encounterId } = await newEncounter();
      const svc = (await overview(encounterId)).services[0]!;
      const res = await record(adminToken, { encounterId, target: svc.target, warehouseId: subA, lines: [{ drugId: drug, quantity: 4 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rec = res.body.data.services[0].record;
      expect(rec.warehouseName).toBe('Kho thủ thuật A');
      expect(await onHandAt(adminToken, subA, drug)).toBe(6);
      expect(await onHandAt(adminToken, mainA, drug)).toBe(50);
      expect(await onHandAt(adminBranchBToken, subB, drug)).toBe(20);
      expect(await onHandAt(adminBranchBToken, mainB, drug)).toBe(30);
      const issue = await privileged.stockIssue.findFirstOrThrow({ where: { id: rec.id } });
      expect(issue.warehouseId).toBe(subA);

      const rev = await http().post(`/api/v1/service-consumption/records/${rec.id}/reverse`).set(authed(adminToken)).send({ reason: 'Ghi nhầm kho' });
      expect(rev.status, JSON.stringify(rev.body)).toBe(200);
      expect(await onHandAt(adminToken, subA, drug)).toBe(10);
      expect(await onHandAt(adminToken, mainA, drug)).toBe(50);
    });

    it('không chọn kho → trừ kho chính; chọn kho của chi nhánh KHÁC (phụ hoặc chính) hoặc kho của công ty khác → 404, không ghi gì, không tự đổi sang kho chính', async () => {
      const drug = await createDrug('Chọn sai kho', { itemType: 'SUPPLY' });
      await stockInAt(adminToken, mainA, drug, 20, 100);
      await stockInAt(adminBranchBToken, subB, drug, 20, 100);
      const tenantBWarehouse = ((await http().get('/api/v1/warehouses').set(authed(tenantBAdminToken))).body.data.items as { id: string }[])[0]!.id;

      const { encounterId } = await newEncounter();
      const svc = (await overview(encounterId)).services[0]!;
      for (const wrong of [subB, mainB, tenantBWarehouse]) {
        const res = await record(adminToken, { encounterId, target: svc.target, warehouseId: wrong, lines: [{ drugId: drug, quantity: 1 }] });
        expect(res.status, `${wrong} ${JSON.stringify(res.body)}`).toBe(404);
      }
      expect(await onHandAt(adminToken, mainA, drug)).toBe(20);
      expect((await overview(encounterId)).services[0]!.record).toBeNull();

      const ok = await record(adminToken, { encounterId, target: svc.target, lines: [{ drugId: drug, quantity: 2 }] });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.services[0].record.warehouseName).not.toBe('Kho thủ thuật A');
      expect(await onHandAt(adminToken, mainA, drug)).toBe(18);
    });

    it('thiếu tồn ở kho phụ đã chọn → 422 nêu tên kho phụ, KHÔNG lấy bù từ kho chính', async () => {
      const drug = await createDrug('Thiếu ở kho phụ', { itemType: 'SUPPLY' });
      await stockInAt(adminToken, mainA, drug, 100, 100);
      await stockInAt(adminToken, subA, drug, 2, 100);
      const { encounterId } = await newEncounter();
      const svc = (await overview(encounterId)).services[0]!;
      const res = await record(adminToken, { encounterId, target: svc.target, warehouseId: subA, lines: [{ drugId: drug, quantity: 5 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.message).toContain('Kho thủ thuật A');
      expect(await onHandAt(adminToken, mainA, drug)).toBe(100);
      expect(await onHandAt(adminToken, subA, drug)).toBe(2);
    });

    it('kho phụ NGỪNG hoạt động không chọn được (404) và không hiện trong ô chọn', async () => {
      const w = await http().post('/api/v1/warehouses').set(authed(adminToken)).send({ name: 'Kho tạm ngừng' });
      const wid = w.body.data.id as string;
      const { encounterId } = await newEncounter();
      expect(await warehouseIds(adminToken, encounterId)).toContain(wid);
      const off = await http().patch(`/api/v1/warehouses/${wid}`).set(authed(adminToken)).send({ version: w.body.data.version, isActive: false });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      expect(await warehouseIds(adminToken, encounterId)).not.toContain(wid);
      const svc = (await overview(encounterId)).services[0]!;
      const drug = await createDrug('Kho ngừng', { itemType: 'SUPPLY' });
      expect((await record(adminToken, { encounterId, target: svc.target, warehouseId: wid, lines: [{ drugId: drug, quantity: 1 }] })).status).toBe(404);
    });

    it('báo cáo chi phí: chi phí trừ ở kho phụ của chi nhánh A tính vào chi nhánh A, chi nhánh B không thấy', async () => {
      const range = { from: new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10), to: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10) };
      const a = (await http().get('/api/v1/reports/service-consumption/by-service').set(authed(adminToken)).query(range)).body.data;
      const b = (await http().get('/api/v1/reports/service-consumption/by-service').set(authed(adminBranchBToken)).query(range)).body.data;
      expect(a.totalCost).toBeGreaterThan(0);
      expect(b).toMatchObject({ totalCost: 0, visitCount: 0 });
    });

    describe('phạm vi Khoa/Phòng', () => {
      let deptD1: string;
      let deptD2: string;
      let subD1: string;
      let subD2: string;
      let deptUserToken: string;
      let noDeptUserToken: string;

      beforeAll(async () => {
        const d1 = await http().post('/api/v1/departments').set(authed(adminToken)).send({ name: `Khoa Thủ thuật e2e ${randomUUID().slice(0, 6)}` });
        const d2 = await http().post('/api/v1/departments').set(authed(adminToken)).send({ name: `Khoa Xét nghiệm e2e ${randomUUID().slice(0, 6)}` });
        deptD1 = d1.body.data.id as string;
        deptD2 = d2.body.data.id as string;
        subD1 = (await http().post('/api/v1/warehouses').set(authed(adminToken)).send({ name: 'Kho của Khoa 1', departmentId: deptD1 })).body.data.id as string;
        subD2 = (await http().post('/api/v1/warehouses').set(authed(adminToken)).send({ name: 'Kho của Khoa 2', departmentId: deptD2 })).body.data.id as string;

        // Vai trò sao chép từ quản lý, riêng nhóm tiêu hao ở phạm vi Khoa/Phòng.
        const roles = await http().get('/api/v1/roles').set(authed(adminToken));
        const adminRole = roles.body.data.items.find((r: { name: string }) => r.name === 'clinic_admin');
        const matrix = await http().get(`/api/v1/roles/${adminRole.id}/permissions`).set(authed(adminToken));
        const roleName = `Tiêu hao Khoa e2e ${randomUUID().slice(0, 6)}`;
        const newRole = await http().post('/api/v1/roles').set(authed(adminToken)).send({ name: roleName });
        const entries = (matrix.body.data.permissions as { permissionId: string; module: string; dataScope: string }[])
          .filter((e) => e.dataScope !== 'none')
          .map((e) => ({ permissionId: e.permissionId, dataScope: e.module === 'service_consumption' ? 'department' : e.dataScope }));
        await http().put(`/api/v1/roles/${newRole.body.data.id}/permissions`).set(authed(adminToken)).send({ entries, version: newRole.body.data.version });
        deptUserToken = (await userIn(roleName, branchAId, deptD1)).token;
        noDeptUserToken = (await userIn(roleName, branchAId)).token;
      }, 120_000);

      it('quyền Khoa/Phòng: chỉ thấy và chọn được kho chính + kho của Khoa mình; kho của Khoa khác → 404; chưa gán Khoa/Phòng thì chỉ kho chính', async () => {
        const { encounterId } = await newEncounter();
        const mine = await warehouseIds(deptUserToken, encounterId);
        expect(mine).toEqual(expect.arrayContaining([mainA, subD1]));
        expect(mine).not.toContain(subD2);
        expect(mine).not.toContain(subA);
        const none = await warehouseIds(noDeptUserToken, encounterId);
        expect(none).toEqual([mainA]);

        const drug = await createDrug('Kho theo Khoa', { itemType: 'SUPPLY' });
        await stockInAt(adminToken, subD1, drug, 10, 100);
        await stockInAt(adminToken, subD2, drug, 10, 100);
        const svc = (await overview(encounterId)).services[0]!;
        const other = await record(deptUserToken, { encounterId, target: svc.target, warehouseId: subD2, lines: [{ drugId: drug, quantity: 1 }] });
        expect(other.status, JSON.stringify(other.body)).toBe(404);
        const noDeptPick = await record(noDeptUserToken, { encounterId, target: svc.target, warehouseId: subD1, lines: [{ drugId: drug, quantity: 1 }] });
        expect(noDeptPick.status, JSON.stringify(noDeptPick.body)).toBe(404);
        const ok = await record(deptUserToken, { encounterId, target: svc.target, warehouseId: subD1, lines: [{ drugId: drug, quantity: 3 }] });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(await onHandAt(adminToken, subD1, drug)).toBe(7);
        expect(await onHandAt(adminToken, subD2, drug)).toBe(10);
      });
    });
  });
});
