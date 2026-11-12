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
 * HTTP e2e — báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9). Bao phủ: phân quyền (chỉ `service_consumption.report`), số liệu theo dịch vụ + theo khách + bộ lọc,
 * phiếu đã đảo không tính, Excel + nhật ký xuất, kiểm khoảng ngày, và CÔ LẬP: công ty khác (tenant B) không thấy gì, chi nhánh khác cùng công ty không thấy dữ liệu chi nhánh này.
 */
describe('HTTP e2e — /api/v1/reports/service-consumption (Chi phí vật tư theo dịch vụ)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let doctorName: string;
  let nurseToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let branchBAdminToken: string;
  let warehouseId: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = getVietnamDateString();
  const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
  const base = '/api/v1/reports/service-consumption';
  const range = { from: yesterday, to: today };

  async function createUserWithRole(tenantId: string, roleName: string, extra: { branchId?: string } = {}) {
    const username = `e2e-scr-${roleName}-${randomUUID()}`;
    const fullName = `Người ${roleName} ${randomUUID().slice(0, 4)}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    if (extra.branchId) await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId: extra.branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return { token: login.body.data.accessToken as string, userId: user.id as string, fullName };
  }

  async function createSupply(name: string): Promise<string> {
    const res = await http()
      .post('/api/v1/drugs')
      .set(authed(adminToken))
      .send({
        code: `RP-${randomUUID().slice(0, 8)}`,
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
      .send({ warehouseId, receiptType: 'OPENING_BALANCE', lines: [{ drugId, unitCode: 'VIEN', quantity, unitCost, batchNo: `RP-${randomUUID().slice(0, 6)}`, expiryDate: '2099-01-01' }] });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const approved = await http().post(`/api/v1/inventory/receipts/${created.body.data.id}/approve`).set(authed(adminToken)).send({ version: created.body.data.version });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  }

  /** Lượt khám đã vào khám, có 1 dịch vụ khám "Khám thường" (KT) và — nếu `withLab` — 1 xét nghiệm do bác sĩ chỉ định. */
  async function newEncounter(withLab: string | null): Promise<{ encounterId: string }> {
    const patient = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân báo cáo tiêu hao', dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) });
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
    if (withLab) {
      const saved = await http().put(`/api/v1/encounters/${encounterId}/clinical-orders`).set(authed(doctorToken)).send({ items: [{ performance: 'IN_HOUSE', technicalServiceId: withLab, quantity: 1 }] });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    }
    return { encounterId };
  }

  type Overview = { services: { target: { kind: string; id: string }; serviceKind: string; record: null | { id: string } }[] };
  const overview = async (encounterId: string) => (await http().get(`/api/v1/service-consumption/encounters/${encounterId}`).set(authed(adminToken))).body.data as Overview;
  const record = (encounterId: string, target: { kind: string; id: string }, drugId: string, quantity: number) =>
    http().post('/api/v1/service-consumption/records').set(authed(adminToken)).send({ encounterId, target, lines: [{ drugId, quantity }] });

  type ByService = { totalCost: number; visitCount: number; averageCost: number | null; branchCount: number; serviceCount: number; serviceOptions: { key: string; name: string }[]; rows: { key: string; name: string; visitCount: number; cost: number; averageCost: number | null; topItems: string[] }[] };
  type ByCustomer = { totalCost: number; visitCount: number; entryCount: number; entries: { patientName: string; serviceName: string; itemsText: string; doctorName: string | null; performerName: string | null; cost: number; branchName: string }[] };
  const byService = async (token: string, query: Record<string, unknown> = {}) => http().get(`${base}/by-service`).set(authed(token)).query({ ...range, ...query });
  const byCustomer = async (token: string, query: Record<string, unknown> = {}) => http().get(`${base}/by-customer`).set(authed(token)).query({ ...range, ...query });

  let labServiceId: string;
  let drugA: string;
  let drugB: string;
  let reversedIssueId: string;

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
    fixture = await createTwoTenantFixture(privileged, 'ServiceConsumptionReport e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    doctorName = doctor.fullName;
    nurseToken = (await createUserWithRole(fixture.tenantA.id, 'nurse')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
    warehouseId = (await http().get('/api/v1/warehouses').set(authed(adminToken))).body.data.items[0].id;
    await http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ deferredPaymentEnabled: true });

    // Chi nhánh thứ hai + quản lý CHỈ thuộc chi nhánh đó — kiểm cô lập chi nhánh cùng công ty.
    const branchB = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh Quận 7 (báo cáo tiêu hao)', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
    expect(branchB.status, JSON.stringify(branchB.body)).toBe(200);
    branchBAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin', { branchId: branchB.body.data.id as string })).token;

    const lab = await http().post('/api/v1/technical-services').set(authed(adminToken)).send({ name: `XN báo cáo ${randomUUID().slice(0, 6)}`, serviceKind: 'LAB', isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100_000, effectiveFrom: '2020-01-01' }] });
    expect(lab.status, JSON.stringify(lab.body)).toBe(200);
    labServiceId = lab.body.data.id as string;

    drugA = await createSupply('Ống mẫu báo cáo');
    drugB = await createSupply('Kim mẫu báo cáo');
    await stockIn(drugA, 100, 100); // giá vốn 100 đ / đơn vị
    await stockIn(drugB, 100, 250);

    // Lượt 1: dịch vụ khám dùng 3 ống (300 đ); xét nghiệm dùng 2 kim (500 đ). Lượt 2: dịch vụ khám dùng 1 ống (100 đ). Lượt 3: ghi rồi ĐẢO (không tính).
    const e1 = await newEncounter(labServiceId);
    const o1 = await overview(e1.encounterId);
    const exam1 = o1.services.find((s) => s.target.kind === 'ENCOUNTER_SERVICE_ITEM')!;
    const lab1 = o1.services.find((s) => s.target.kind === 'CLINICAL_ORDER_ITEM')!;
    expect((await record(e1.encounterId, exam1.target, drugA, 3)).status).toBe(200);
    expect((await record(e1.encounterId, lab1.target, drugB, 2)).status).toBe(200);

    const e2 = await newEncounter(null);
    const exam2 = (await overview(e2.encounterId)).services[0]!;
    expect((await record(e2.encounterId, exam2.target, drugA, 1)).status).toBe(200);

    const e3 = await newEncounter(null);
    const exam3 = (await overview(e3.encounterId)).services[0]!;
    const rec3 = await record(e3.encounterId, exam3.target, drugA, 5);
    expect(rec3.status, JSON.stringify(rec3.body)).toBe(200);
    reversedIssueId = rec3.body.data.services[0].record.id as string;
    const rev = await http().post(`/api/v1/service-consumption/records/${reversedIssueId}/reverse`).set(authed(adminToken)).send({ reason: 'Ghi nhầm' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('không token → 401; bác sĩ, điều dưỡng, lễ tân KHÔNG có quyền xem giá vốn → 403 (cả 4 route); quản lý xem được', async () => {
      for (const path of ['by-service', 'by-customer', 'by-service/export', 'by-customer/export']) {
        expect((await http().get(`${base}/${path}`).query(range)).status, path).toBe(401);
        for (const token of [doctorToken, nurseToken, receptionistToken]) {
          expect((await http().get(`${base}/${path}`).set(authed(token)).query(range)).status, path).toBe(403);
        }
        expect((await http().get(`${base}/${path}`).set(authed(adminToken)).query(range)).status, path).toBe(200);
      }
    });
  });

  describe('số liệu', () => {
    it('theo dịch vụ: số lượt, chi phí vốn, trung bình, mặt hàng dùng nhiều nhất; phiếu đã đảo KHÔNG tính; xếp theo chi phí giảm dần', async () => {
      const res = await byService(adminToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const r = res.body.data as ByService;
      // 300 + 100 (khám) + 500 (xét nghiệm) = 900; 3 lượt (lượt 3 đã đảo nên không tính).
      expect(r).toMatchObject({ totalCost: 900, visitCount: 3, averageCost: 300, branchCount: 1, serviceCount: 2 });
      expect(r.rows.map((x) => [x.name, x.visitCount, x.cost, x.averageCost])).toEqual([
        [expect.stringContaining('XN báo cáo'), 1, 500, 500],
        ['Khám thường', 2, 400, 200],
      ]);
      expect(r.rows[0]!.topItems).toEqual(['Kim mẫu báo cáo']);
      expect(r.rows[1]!.topItems).toEqual(['Ống mẫu báo cáo']);
      expect(r.serviceOptions.map((o) => o.name)).toEqual(expect.arrayContaining(['Khám thường']));
    });

    it('theo khách: từng lượt kèm vật tư đã dùng, bác sĩ, người thực hiện, chi phí; lọc theo dịch vụ và theo bác sĩ', async () => {
      const r = (await byCustomer(adminToken)).body.data as ByCustomer;
      expect(r).toMatchObject({ totalCost: 900, visitCount: 3, entryCount: 3 });
      expect(r.entries).toHaveLength(3);
      const exam = r.entries.filter((e) => e.serviceName === 'Khám thường');
      expect(exam.map((e) => e.cost).sort((a, b) => a - b)).toEqual([100, 300]);
      expect(exam.map((e) => e.itemsText).sort()).toEqual(['Ống mẫu báo cáo ×1', 'Ống mẫu báo cáo ×3']);
      expect(r.entries.every((e) => e.doctorName === doctorName)).toBe(true);
      expect(r.entries.every((e) => e.performerName !== null)).toBe(true);

      const key = ((await byService(adminToken)).body.data as ByService).rows.find((x) => x.name === 'Khám thường')!.key;
      const filtered = (await byCustomer(adminToken, { serviceKey: key })).body.data as ByCustomer;
      expect(filtered).toMatchObject({ totalCost: 400, visitCount: 2, entryCount: 2 });
      // Danh sách dịch vụ để chọn KHÔNG bị thu hẹp theo bộ lọc.
      expect(filtered).toHaveProperty('serviceOptions');
      expect(((await byService(adminToken, { serviceKey: key })).body.data as ByService).serviceOptions.length).toBe(2);

      const otherDoctor = (await byCustomer(adminToken, { doctorId: randomUUID() })).body.data as ByCustomer;
      expect(otherDoctor).toMatchObject({ totalCost: 0, visitCount: 0, entryCount: 0, entries: [] });
      expect(otherDoctor.totalCost).toBe(0);
      const myDoctor = (await byCustomer(adminToken, { doctorId: doctorUserId })).body.data as ByCustomer;
      expect(myDoctor.visitCount).toBe(3);
    });

    it('kỳ không có dữ liệu → toàn 0, trung bình null (không chia cho 0)', async () => {
      const r = (await byService(adminToken, { from: '2020-01-01', to: '2020-01-31' })).body.data as ByService;
      expect(r).toMatchObject({ totalCost: 0, visitCount: 0, averageCost: null, serviceCount: 0, rows: [] });
    });

    it('khoảng ngày sai → 400: ngày lạ, bắt đầu sau kết thúc, quá 366 ngày, khoá dịch vụ lạ', async () => {
      expect((await byService(adminToken, { from: '2026-13-45' })).status).toBe(400);
      expect((await byService(adminToken, { from: today, to: '2020-01-01' })).status).toBe(400);
      expect((await byService(adminToken, { from: '2020-01-01', to: '2026-12-31' })).status).toBe(400);
      expect((await byService(adminToken, { serviceKey: 'LUNG_TUNG' })).status).toBe(400);
    });
  });

  describe('cô lập tenant + chi nhánh', () => {
    it('công ty KHÁC (tenant B) gọi cả 4 route đều thấy rỗng, không lộ dữ liệu công ty A', async () => {
      const s = (await byService(tenantBAdminToken)).body.data as ByService;
      expect(s).toMatchObject({ totalCost: 0, visitCount: 0, serviceCount: 0, rows: [], serviceOptions: [] });
      const c = (await byCustomer(tenantBAdminToken)).body.data as ByCustomer;
      expect(c).toMatchObject({ totalCost: 0, visitCount: 0, entryCount: 0, entries: [] });
      // Bác sĩ của A truyền sang B vẫn không ra gì.
      expect(((await byCustomer(tenantBAdminToken, { doctorId: doctorUserId })).body.data as ByCustomer).entries).toEqual([]);
      for (const path of ['by-service/export', 'by-customer/export']) {
        expect((await http().get(`${base}/${path}`).set(authed(tenantBAdminToken)).query(range)).status).toBe(200);
      }
    });

    it('mặc định CHỈ chi nhánh đang làm việc: quản lý chi nhánh khác cùng công ty không thấy dữ liệu chi nhánh này', async () => {
      const s = (await byService(branchBAdminToken)).body.data as ByService;
      expect(s).toMatchObject({ totalCost: 0, visitCount: 0, serviceCount: 0, rows: [] });
      const c = (await byCustomer(branchBAdminToken)).body.data as ByCustomer;
      expect(c.entries).toEqual([]);
    });

    it('gộp chi nhánh (scope=all / pick) cần THÊM quyền xem báo cáo toàn công ty: có quyền thì thấy đủ và có tên chi nhánh; vai trò chỉ có quyền xem chi phí vật tư → 403 dù tự gửi tham số', async () => {
      const all = (await byService(adminToken, { scope: 'all' })).body.data as ByService;
      expect(all).toMatchObject({ branchCount: 2, totalCost: 900, visitCount: 3 });
      const customers = (await byCustomer(adminToken, { scope: 'all' })).body.data as ByCustomer;
      expect(customers.entries).toHaveLength(3);
      expect(customers.entries.every((e) => e.branchName !== '')).toBe(true);
      // Quản lý chi nhánh B gộp cả công ty (có company_report.read) thì thấy dữ liệu chi nhánh A — đúng thiết kế.
      expect(((await byService(branchBAdminToken, { scope: 'all' })).body.data as ByService).totalCost).toBe(900);

      const perm = await privileged.permission.findFirstOrThrow({ where: { module: 'service_consumption', action: 'report' } });
      const role = await privileged.role.create({ data: { tenantId: fixture.tenantA.id, name: `chi-xem-chi-phi-${randomUUID().slice(0, 6)}`, isSystemDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      await privileged.rolePermission.create({ data: { tenantId: fixture.tenantA.id, roleId: role.id, permissionId: perm.id, dataScope: 'global', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      // Đã có 2 chi nhánh nên tài khoản mới phải được gán chi nhánh (chi nhánh đầu tiên của công ty).
      const branchA = (await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id }, orderBy: { createdAt: 'asc' } })).id;
      const limited = (await createUserWithRole(fixture.tenantA.id, role.name, { branchId: branchA })).token;
      expect((await byService(limited)).status).toBe(200);
      for (const extra of [{ scope: 'all' }, { scope: 'pick', branchIds: randomUUID() }]) {
        expect((await byService(limited, extra)).status, JSON.stringify(extra)).toBe(403);
        expect((await byCustomer(limited, extra)).status, JSON.stringify(extra)).toBe(403);
      }
    });
  });

  describe('Excel + nhật ký xuất', () => {
    it('xuất được Excel cho cả hai tab (đúng kiểu tệp, có tên tệp theo kỳ) và ghi nhật ký người xuất', async () => {
      for (const path of ['by-service/export', 'by-customer/export']) {
        const res = await http().get(`${base}/${path}`).set(authed(adminToken)).query(range).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
        expect(res.status, path).toBe(200);
        expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
        expect(res.headers['content-disposition']).toContain(`${yesterday}-${today}.xlsx`);
        expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // tệp xlsx là zip
      }
      const logs = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'service_consumption.exported' } });
      expect(logs).toBeGreaterThanOrEqual(2);
    });
  });
});
