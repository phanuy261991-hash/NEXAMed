import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Cận lâm sàng GĐ2: Gói dịch vụ + Bảng giá có thời hạn (docs/DECISIONS.md #212). Mọi ngày dùng mốc cố định xa
 * (2030) nên kết quả không phụ thuộc ngày chạy test; giá mặc định lấy từ đơn giá hiệu lực từ 2020.
 */
describe('HTTP e2e — Gói dịch vụ + Bảng giá có thời hạn', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let doctorToken: string;
  let nurseToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());
  const PACKAGES = '/api/v1/service-packages';
  const LISTS = '/api/v1/price-lists';

  // Dữ liệu dùng chung (tạo 1 lần ở beforeAll)
  let examCode: string; // Dịch vụ khám — giá THUONG 150.000
  let labId: string; // Xét nghiệm — giá THUONG 150.000
  let imagingId: string; // CĐHA — giá THUONG 420.000
  let medicineId: string; // Thuốc — 2.000/Viên, Vỉ=10 viên, Hộp=10 vỉ
  let supplyId: string; // Vật tư — 3.500/Cái

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-price-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  async function createTechService(name: string, serviceKind: 'LAB' | 'IMAGING', amount: number): Promise<string> {
    const res = await http()
      .post('/api/v1/technical-services')
      .set(authed(adminToken))
      .send({ name, serviceKind, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount, effectiveFrom: '2020-01-01' }] });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  async function createDrug(itemType: 'MEDICINE' | 'SUPPLY', name: string, defaultSellPrice: number, units: unknown[] = []): Promise<string> {
    const res = await http()
      .post('/api/v1/drugs')
      .set(authed(adminToken))
      .send({
        code: `PRC-${randomUUID().slice(0, 8)}`,
        name,
        itemType,
        baseUnitCode: itemType === 'SUPPLY' ? 'CAI' : 'VIEN',
        manufacturerCode: 'TEST_MANUFACTURER',
        defaultSellPrice,
        ...(itemType === 'MEDICINE'
          ? {
              drugGroupCode: 'TEST_GROUP',
              routeCode: 'TEST_ROUTE',
              registrationNumber: 'VD-TEST-0001',
              dosageForm: 'Viên nén',
              countryOfOrigin: 'Việt Nam',
              ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
            }
          : { ingredients: [] }),
        units,
      });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  const exam = (extra: Record<string, unknown> = {}) => ({ itemKind: 'EXAM_TYPE', examTypeCode: examCode, ...extra });
  const tech = (id: string, extra: Record<string, unknown> = {}) => ({ itemKind: 'TECHNICAL_SERVICE', technicalServiceId: id, ...extra });

  async function createPackage(body: Record<string, unknown>) {
    const res = await http().post(PACKAGES).set(authed(adminToken)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  }

  async function createPriceList(body: Record<string, unknown>) {
    const res = await http().post(LISTS).set(authed(adminToken)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  }

  async function resolve(date: string, items: Record<string, unknown>[], token = adminToken) {
    const res = await http().post(`${LISTS}/resolve`).set(authed(token)).send({ date, items });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.items as { baseAmount: number | null; amount: number | null; applied: { code: string; name: string; priority: number } | null }[];
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

    fixture = await createTwoTenantFixture(privileged, 'Pricing e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    nurseToken = await createUserWithRole(fixture.tenantA.id, 'nurse');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');

    const examRes = await http()
      .post('/api/v1/reference-catalog')
      .set(authed(adminToken))
      .send({ category: 'EXAM_TYPE', name: 'Khám nội tổng quát (bảng giá)', examTypePrices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 150_000, effectiveFrom: '2020-01-01' }] });
    expect(examRes.status).toBe(200);
    examCode = examRes.body.data.code as string;
    labId = await createTechService('Tổng phân tích tế bào máu (bảng giá)', 'LAB', 150_000);
    imagingId = await createTechService('Siêu âm ổ bụng (bảng giá)', 'IMAGING', 420_000);
    medicineId = await createDrug('MEDICINE', 'Paracetamol bảng giá', 2_000, [
      { unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 10 },
      { unitCode: 'HOP', sortOrder: 1, factorToUnitBelow: 10 },
    ]);
    supplyId = await createDrug('SUPPLY', 'Bơm tiêm 5ml bảng giá', 3_500);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('không token → 401', async () => {
      expect((await http().get(PACKAGES)).status).toBe(401);
      expect((await http().get(LISTS)).status).toBe(401);
      expect((await http().post(`${LISTS}/resolve`).send({})).status).toBe(401);
    });

    it('bác sĩ/điều dưỡng/lễ tân XEM + tra giá được, KHÔNG tạo/sửa gói hay bảng giá (chỉ clinic_admin)', async () => {
      for (const token of [doctorToken, nurseToken, receptionistToken]) {
        expect((await http().get(PACKAGES).set(authed(token))).status).toBe(200);
        expect((await http().get(LISTS).set(authed(token))).status).toBe(200);
        expect((await http().post(`${LISTS}/resolve`).set(authed(token)).send({ date: '2030-02-05', items: [{ itemKind: 'EXAM_TYPE', ref: examCode }] })).status).toBe(200);
        expect((await http().post(PACKAGES).set(authed(token)).send({ name: 'X' })).status).toBe(403);
        expect((await http().post(LISTS).set(authed(token)).send({ name: 'X' })).status).toBe(403);
      }
    });
  });

  describe('gói dịch vụ', () => {
    it('giá cố định: mã tự sinh GOI, tổng giá lẻ + khách lợi tính đúng, dịch vụ con kèm giá lẻ', async () => {
      const created = await createPackage({
        name: 'Gói khám tổng quát',
        pricingMode: 'FIXED',
        fixedPrice: 250_000,
        effectiveFrom: '2020-01-01',
        items: [exam(), tech(labId)],
      });
      expect(created.code).toMatch(/^GOI/);
      expect(created.status).toBe('ACTIVE');
      expect(created.itemCount).toBe(2);
      expect(created.retailTotal).toBe(300_000);
      expect(created.price).toBe(250_000);
      expect(created.saving).toBe(50_000);
      expect(created.items).toHaveLength(2);
      expect(created.items.find((i: { itemKind: string }) => i.itemKind === 'EXAM_TYPE').unitPrice).toBe(150_000);
      expect(created.items.find((i: { itemKind: string }) => i.itemKind === 'TECHNICAL_SERVICE').groupName).toBeNull();
    });

    it('tổng trừ chiết khấu %: giá tự theo đơn giá dịch vụ con, đổi đơn giá con thì giá gói đổi theo', async () => {
      const lab = await createTechService('XN đổi giá', 'LAB', 100_000);
      const created = await createPackage({
        name: 'Gói chiết khấu',
        pricingMode: 'SUM_MINUS_DISCOUNT',
        discountType: 'PERCENT',
        discountValue: 10,
        effectiveFrom: '2020-01-01',
        items: [tech(lab, { quantity: 2 }), tech(imagingId)],
      });
      expect(created.retailTotal).toBe(620_000); // 2×100.000 + 420.000
      expect(created.price).toBe(558_000);

      const svc = await http().get(`/api/v1/technical-services/${lab}`).set(authed(adminToken));
      const upd = await http()
        .patch(`/api/v1/technical-services/${lab}`)
        .set(authed(adminToken))
        .send({ version: svc.body.data.version, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 200_000, effectiveFrom: '2020-01-01' }] });
      expect(upd.status).toBe(200);
      const after = await http().get(`${PACKAGES}/${created.id}`).set(authed(adminToken));
      expect(after.body.data.retailTotal).toBe(820_000);
      expect(after.body.data.price).toBe(738_000);
    });

    it('chiết khấu số tiền không đẩy giá xuống dưới 0', async () => {
      const created = await createPackage({
        name: 'Gói giảm sâu',
        pricingMode: 'SUM_MINUS_DISCOUNT',
        discountType: 'AMOUNT',
        discountValue: 9_000_000,
        effectiveFrom: '2020-01-01',
        items: [exam()],
      });
      expect(created.price).toBe(0);
    });

    it('validate: thiếu giá cố định / không có dịch vụ / trùng dịch vụ / dịch vụ không tồn tại → 400', async () => {
      const base = { name: 'Gói lỗi', effectiveFrom: '2020-01-01' };
      expect((await http().post(PACKAGES).set(authed(adminToken)).send({ ...base, pricingMode: 'FIXED', items: [exam()] })).status).toBe(400);
      expect((await http().post(PACKAGES).set(authed(adminToken)).send({ ...base, pricingMode: 'FIXED', fixedPrice: 1, items: [] })).status).toBe(400);
      expect((await http().post(PACKAGES).set(authed(adminToken)).send({ ...base, pricingMode: 'FIXED', fixedPrice: 1, items: [exam(), exam()] })).status).toBe(400);
      expect((await http().post(PACKAGES).set(authed(adminToken)).send({ ...base, pricingMode: 'FIXED', fixedPrice: 1, items: [tech(randomUUID())] })).status).toBe(400);
      expect((await http().post(PACKAGES).set(authed(adminToken)).send({ ...base, pricingMode: 'FIXED', fixedPrice: 1, effectiveTo: '2019-01-01', items: [exam()] })).status).toBe(400);
      expect((await http().post(PACKAGES).set(authed(adminToken)).send({ ...base, pricingMode: 'SUM_MINUS_DISCOUNT', discountType: 'PERCENT', items: [exam()] })).status).toBe(400);
      expect((await http().post(PACKAGES).set(authed(adminToken)).send({ ...base, pricingMode: 'SUM_MINUS_DISCOUNT', discountType: 'PERCENT', discountValue: 101, items: [exam()] })).status).toBe(400);
    });

    it('sửa: đổi kiểu giá sang tổng-trừ-chiết-khấu xoá giá cố định; version cũ → 409; thay danh sách dịch vụ con', async () => {
      const created = await createPackage({ name: 'Gói sửa', pricingMode: 'FIXED', fixedPrice: 100_000, effectiveFrom: '2020-01-01', items: [exam()] });
      const updated = await http()
        .patch(`${PACKAGES}/${created.id}`)
        .set(authed(adminToken))
        .send({ version: created.version, pricingMode: 'SUM_MINUS_DISCOUNT', discountType: 'AMOUNT', discountValue: 10_000, items: [exam(), tech(imagingId)] });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.data.fixedPrice).toBeNull();
      expect(updated.body.data.itemCount).toBe(2);
      expect(updated.body.data.price).toBe(560_000); // 150.000 + 420.000 − 10.000
      expect(updated.body.data.version).toBe(created.version + 1);

      const stale = await http().patch(`${PACKAGES}/${created.id}`).set(authed(adminToken)).send({ version: created.version, name: 'Cũ' });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('orderableOnly: loại gói sắp áp dụng và gói đã ngừng; mặc định ẩn gói ngừng, includeInactive hiện lại', async () => {
      const future = await createPackage({ name: 'Gói tương lai', pricingMode: 'FIXED', fixedPrice: 1, effectiveFrom: '2099-01-01', items: [exam()] });
      const stopped = await createPackage({ name: 'Gói đã ngừng', pricingMode: 'FIXED', fixedPrice: 1, effectiveFrom: '2020-01-01', isActive: false, items: [exam()] });
      expect(future.status).toBe('UPCOMING');
      expect(stopped.status).toBe('STOPPED');

      const orderable = await http().get(PACKAGES).query({ orderableOnly: 'true' }).set(authed(doctorToken));
      const ids = orderable.body.data.items.map((i: { id: string }) => i.id);
      expect(ids).not.toContain(future.id);
      expect(ids).not.toContain(stopped.id);

      const defaults = await http().get(PACKAGES).set(authed(doctorToken));
      expect(defaults.body.data.items.map((i: { id: string }) => i.id)).not.toContain(stopped.id);
      const all = await http().get(PACKAGES).query({ includeInactive: 'true' }).set(authed(doctorToken));
      expect(all.body.data.items.map((i: { id: string }) => i.id)).toContain(stopped.id);
    });

    it('cách ly tenant: tenant B không thấy gói của tenant A (404) và danh sách trống', async () => {
      const created = await createPackage({ name: 'Gói riêng tenant A', pricingMode: 'FIXED', fixedPrice: 1, effectiveFrom: '2020-01-01', items: [exam()] });
      expect((await http().get(`${PACKAGES}/${created.id}`).set(authed(tenantBAdminToken))).status).toBe(404);
      const list = await http().get(PACKAGES).set(authed(tenantBAdminToken));
      expect(list.body.data.items.map((i: { id: string }) => i.id)).not.toContain(created.id);
      expect((await http().patch(`${PACKAGES}/${created.id}`).set(authed(tenantBAdminToken)).send({ version: 1, name: 'x' })).status).toBe(404);
    });
  });

  describe('bảng giá có thời hạn', () => {
    it('tạo bảng trộn đủ 5 loại: mã BG tự sinh, dòng có giá mặc định + giá áp dụng làm tròn về 1 đồng', async () => {
      const pkg = await createPackage({ name: 'Gói cho bảng giá', pricingMode: 'FIXED', fixedPrice: 1_200_000, effectiveFrom: '2020-01-01', items: [exam(), tech(imagingId)] });
      const list = await createPriceList({
        name: 'Khuyến mại Tết 2030',
        effectiveFrom: '2030-02-01',
        effectiveTo: '2030-02-14',
        priority: 100,
        lines: [
          { itemKind: 'EXAM_TYPE', examTypeCode: examCode, mode: 'PERCENT_OFF', value: 20 },
          { itemKind: 'TECHNICAL_SERVICE', technicalServiceId: imagingId, priceTypeCode: 'THUONG', mode: 'NEW_PRICE', value: 350_000 },
          { itemKind: 'PACKAGE', servicePackageId: pkg.id, mode: 'PERCENT_OFF', value: 15 },
          { itemKind: 'DRUG', drugId: medicineId, unitCode: 'HOP', mode: 'NEW_PRICE', value: 165_000 },
          { itemKind: 'MEDICAL_SUPPLY', drugId: supplyId, mode: 'PERCENT_OFF', value: 10 },
        ],
      });
      expect(list.code).toMatch(/^BG/);
      expect(list.status).toBe('UPCOMING');
      expect(list.itemCount).toBe(5);
      const byKind = (k: string) => list.lines.find((l: { itemKind: string }) => l.itemKind === k);
      expect(byKind('EXAM_TYPE')).toMatchObject({ baseAmount: 150_000, finalAmount: 120_000 });
      expect(byKind('TECHNICAL_SERVICE')).toMatchObject({ baseAmount: 420_000, finalAmount: 350_000 });
      expect(byKind('PACKAGE')).toMatchObject({ baseAmount: 1_200_000, finalAmount: 1_020_000 });
      expect(byKind('DRUG')).toMatchObject({ unitCode: 'HOP', baseAmount: 200_000, finalAmount: 165_000 });
      expect(byKind('MEDICAL_SUPPLY')).toMatchObject({ baseAmount: 3_500, finalAmount: 3_150 });
    });

    it('validate: ưu tiên 0, ngày ngược, Giá mới thiếu Loại giá/Đơn vị, Giảm % kèm đơn vị, dòng trùng phạm vi, mặt hàng lạ, sai loại thuốc/vật tư → 400', async () => {
      const base = { name: 'Bảng lỗi', effectiveFrom: '2030-03-01', effectiveTo: '2030-03-31', priority: 10 };
      const post = (body: Record<string, unknown>) => http().post(LISTS).set(authed(adminToken)).send({ ...base, ...body });
      expect((await post({ priority: 0 })).status).toBe(400);
      expect((await post({ effectiveTo: '2030-02-01' })).status).toBe(400);
      expect((await post({ lines: [{ itemKind: 'EXAM_TYPE', examTypeCode: examCode, mode: 'NEW_PRICE', value: 1 }] })).status).toBe(400);
      expect((await post({ lines: [{ itemKind: 'DRUG', drugId: medicineId, mode: 'NEW_PRICE', value: 1 }] })).status).toBe(400);
      expect((await post({ lines: [{ itemKind: 'DRUG', drugId: medicineId, unitCode: 'HOP', mode: 'PERCENT_OFF', value: 10 }] })).status).toBe(400);
      expect((await post({ lines: [{ itemKind: 'EXAM_TYPE', examTypeCode: examCode, mode: 'PERCENT_OFF', value: 101 }] })).status).toBe(400);
      expect(
        (await post({ lines: [{ itemKind: 'EXAM_TYPE', examTypeCode: examCode, mode: 'PERCENT_OFF', value: 10 }, { itemKind: 'EXAM_TYPE', examTypeCode: examCode, priceTypeCode: 'THUONG', mode: 'NEW_PRICE', value: 1 }] })).status,
      ).toBe(400);
      expect((await post({ lines: [{ itemKind: 'TECHNICAL_SERVICE', technicalServiceId: randomUUID(), mode: 'PERCENT_OFF', value: 10 }] })).status).toBe(400);
      expect((await post({ lines: [{ itemKind: 'MEDICAL_SUPPLY', drugId: medicineId, mode: 'PERCENT_OFF', value: 10 }] })).status).toBe(400);
      expect((await post({ lines: [{ itemKind: 'DRUG', drugId: medicineId, unitCode: 'KHONGCO', mode: 'NEW_PRICE', value: 1 }] })).status).toBe(400);
    });

    it('cùng mặt hàng được 2 dòng khi khác phạm vi (2 Loại giá khác nhau)', async () => {
      const res = await http()
        .post(LISTS)
        .set(authed(adminToken))
        .send({
          name: 'Hai Loại giá',
          effectiveFrom: '2030-04-01',
          effectiveTo: '2030-04-30',
          priority: 5,
          lines: [
            { itemKind: 'EXAM_TYPE', examTypeCode: examCode, priceTypeCode: 'THUONG', mode: 'NEW_PRICE', value: 100_000 },
            { itemKind: 'EXAM_TYPE', examTypeCode: examCode, priceTypeCode: 'BAO_HIEM', mode: 'NEW_PRICE', value: 90_000 },
          ],
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.itemCount).toBe(2);
    });

    it('danh sách: dòng "Bảng giá chung" ảo ưu tiên 0 + đếm theo trạng thái; lọc theo status', async () => {
      const stopped = await createPriceList({ name: 'Bảng đã ngừng', effectiveFrom: '2030-05-01', effectiveTo: '2030-05-31', priority: 7 });
      const patched = await http().patch(`${LISTS}/${stopped.id}`).set(authed(adminToken)).send({ version: stopped.version, isActive: false });
      expect(patched.status).toBe(200);
      expect(patched.body.data.status).toBe('STOPPED');

      const list = await http().get(LISTS).set(authed(doctorToken));
      expect(list.body.data.general).toMatchObject({ code: 'BG0000', priority: 0 });
      expect(list.body.data.general.itemCount).toBeGreaterThanOrEqual(5);
      expect(list.body.data.counts.all).toBe(list.body.data.items.length);
      expect(list.body.data.counts.STOPPED).toBeGreaterThanOrEqual(1);

      const onlyStopped = await http().get(LISTS).query({ status: 'STOPPED' }).set(authed(doctorToken));
      expect(onlyStopped.body.data.items.every((i: { status: string }) => i.status === 'STOPPED')).toBe(true);
      expect(onlyStopped.body.data.items.map((i: { id: string }) => i.id)).toContain(stopped.id);

      const resumed = await http().patch(`${LISTS}/${stopped.id}`).set(authed(adminToken)).send({ version: patched.body.data.version, isActive: true });
      expect(resumed.body.data.status).toBe('UPCOMING');
    });

    it('xuất Excel: file .xlsx đúng tên mã bảng, có dòng tiêu đề + từng mặt hàng với giá mặc định/giá áp dụng; lễ tân (price_list.read) xuất được', async () => {
      const created = await createPriceList({
        name: 'Bảng xuất Excel',
        effectiveFrom: '2030-07-01',
        effectiveTo: '2030-07-31',
        priority: 4,
        lines: [{ itemKind: 'EXAM_TYPE', examTypeCode: examCode, mode: 'PERCENT_OFF', value: 20 }],
      });
      const res = await http()
        .get(`${LISTS}/${created.id}/export`)
        .set(authed(receptionistToken))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain(`${created.code}.xlsx`);
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const sheet = wb.getWorksheet('Bảng giá')!;
      const rows: unknown[][] = [];
      sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
      expect(String(rows[0]?.[0])).toContain(created.code);
      expect(rows.find((r) => r[0] === 'Dịch vụ khám')).toEqual(expect.arrayContaining([examCode, 150_000, 'Giảm %', '20%', 120_000]));
      expect((await http().get(`${LISTS}/${created.id}/export`).set(authed(tenantBAdminToken))).status).toBe(404);
    });

    it('sửa: thay toàn bộ dòng, version cũ → 409', async () => {
      const created = await createPriceList({
        name: 'Bảng sửa',
        effectiveFrom: '2030-06-01',
        effectiveTo: '2030-06-30',
        priority: 3,
        lines: [{ itemKind: 'EXAM_TYPE', examTypeCode: examCode, mode: 'PERCENT_OFF', value: 5 }],
      });
      const updated = await http()
        .patch(`${LISTS}/${created.id}`)
        .set(authed(adminToken))
        .send({ version: created.version, lines: [{ itemKind: 'MEDICAL_SUPPLY', drugId: supplyId, mode: 'PERCENT_OFF', value: 50 }] });
      expect(updated.status).toBe(200);
      expect(updated.body.data.lines).toHaveLength(1);
      expect(updated.body.data.lines[0].itemKind).toBe('MEDICAL_SUPPLY');
      const stale = await http().patch(`${LISTS}/${created.id}`).set(authed(adminToken)).send({ version: created.version, name: 'Cũ' });
      expect(stale.status).toBe(409);
    });
  });

  describe('tính giá áp dụng (resolve) + tra thử giá (lookup)', () => {
    let tetId: string;
    let quyId: string;

    beforeAll(async () => {
      // Tết (ưu tiên 100) đè Quý 1 (ưu tiên 50) trên cùng dịch vụ khám — đúng ví dụ ở mockup "Tra thử giá".
      const quy = await createPriceList({
        name: 'Giá ưu đãi quý 1/2031',
        effectiveFrom: '2031-01-01',
        effectiveTo: '2031-03-31',
        priority: 50,
        lines: [{ itemKind: 'EXAM_TYPE', examTypeCode: examCode, priceTypeCode: 'THUONG', mode: 'NEW_PRICE', value: 140_000 }],
      });
      const tet = await createPriceList({
        name: 'Khuyến mại Tết 2031',
        effectiveFrom: '2031-02-01',
        effectiveTo: '2031-02-14',
        priority: 100,
        lines: [
          { itemKind: 'EXAM_TYPE', examTypeCode: examCode, mode: 'PERCENT_OFF', value: 20 },
          { itemKind: 'DRUG', drugId: medicineId, unitCode: 'HOP', mode: 'NEW_PRICE', value: 165_000 },
          { itemKind: 'MEDICAL_SUPPLY', drugId: supplyId, mode: 'PERCENT_OFF', value: 10 },
        ],
      });
      quyId = quy.id;
      tetId = tet.id;
    });

    it('trong khoảng ngày: bảng ưu tiên cao thắng; hết hạn Tết thì quay về bảng Quý 1; hết cả hai thì về giá mặc định', async () => {
      const item = { itemKind: 'EXAM_TYPE', ref: examCode, priceTypeCode: 'THUONG' };
      const [duringTet] = await resolve('2031-02-05', [item]);
      expect(duringTet).toMatchObject({ baseAmount: 150_000, amount: 120_000 });
      expect(duringTet?.applied).toMatchObject({ name: 'Khuyến mại Tết 2031', priority: 100 });

      const [afterTet] = await resolve('2031-02-15', [item]);
      expect(afterTet).toMatchObject({ amount: 140_000 });
      expect(afterTet?.applied?.name).toBe('Giá ưu đãi quý 1/2031');

      const [afterAll] = await resolve('2031-04-01', [item]);
      expect(afterAll).toMatchObject({ baseAmount: 150_000, amount: 150_000, applied: null });
      const [before] = await resolve('2030-12-31', [item]);
      expect(before?.applied).toBeNull();
    });

    it('ngày biên: cả ngày bắt đầu lẫn ngày kết thúc đều thuộc bảng giá', async () => {
      const item = { itemKind: 'EXAM_TYPE', ref: examCode, priceTypeCode: 'THUONG' };
      expect((await resolve('2031-02-01', [item]))[0]?.applied?.priority).toBe(100);
      expect((await resolve('2031-02-14', [item]))[0]?.applied?.priority).toBe(100);
    });

    it('bảng đã ngừng thì không áp dù còn trong khoảng ngày', async () => {
      const detail = await http().get(`${LISTS}/${tetId}`).set(authed(adminToken));
      const stop = await http().patch(`${LISTS}/${tetId}`).set(authed(adminToken)).send({ version: detail.body.data.version, isActive: false });
      expect(stop.status).toBe(200);
      const [r] = await resolve('2031-02-05', [{ itemKind: 'EXAM_TYPE', ref: examCode, priceTypeCode: 'THUONG' }]);
      expect(r?.applied?.name).toBe('Giá ưu đãi quý 1/2031');
      const resume = await http().patch(`${LISTS}/${tetId}`).set(authed(adminToken)).send({ version: stop.body.data.version, isActive: true });
      expect(resume.status).toBe(200);
    });

    it('thuốc: "Giá mới" bậc Hộp chỉ áp đúng bậc Hộp; Giảm % áp mọi bậc; vật tư giảm %', async () => {
      const [hop, vi, supply] = await resolve('2031-02-05', [
        { itemKind: 'DRUG', ref: medicineId, unitCode: 'HOP' },
        { itemKind: 'DRUG', ref: medicineId, unitCode: 'VI' },
        { itemKind: 'MEDICAL_SUPPLY', ref: supplyId },
      ]);
      expect(hop).toMatchObject({ baseAmount: 200_000, amount: 165_000 });
      expect(vi).toMatchObject({ baseAmount: 20_000, amount: 20_000, applied: null });
      expect(supply).toMatchObject({ baseAmount: 3_500, amount: 3_150 });
    });

    it('mặt hàng không tồn tại → giá null (không lỗi); tenant B không thấy mặt hàng/bảng giá của tenant A', async () => {
      const [missing] = await resolve('2031-02-05', [{ itemKind: 'TECHNICAL_SERVICE', ref: randomUUID() }]);
      expect(missing).toEqual({ baseAmount: null, amount: null, applied: null });
      const [cross] = await resolve('2031-02-05', [{ itemKind: 'EXAM_TYPE', ref: examCode, priceTypeCode: 'THUONG' }], tenantBAdminToken);
      expect(cross?.applied).toBeNull();
      expect((await http().get(`${LISTS}/${quyId}`).set(authed(tenantBAdminToken))).status).toBe(404);
    });

    it('lookup: liệt kê mọi bảng chứa mặt hàng, đánh dấu bảng thắng/bị đè, Bảng giá chung ở cuối', async () => {
      const res = await http().get(`${LISTS}/lookup`).query({ itemKind: 'EXAM_TYPE', ref: examCode, date: '2031-02-05', priceTypeCode: 'THUONG' }).set(authed(receptionistToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const entries = res.body.data.entries as { name: string; priority: number; isApplied: boolean; inEffect: boolean; amount: number | null; priceListId: string | null }[];
      const tet = entries.find((e) => e.name === 'Khuyến mại Tết 2031');
      const quy = entries.find((e) => e.name === 'Giá ưu đãi quý 1/2031');
      expect(tet).toMatchObject({ isApplied: true, inEffect: true, amount: 120_000 });
      expect(quy).toMatchObject({ isApplied: false, inEffect: true, amount: 140_000 });
      expect(entries[entries.length - 1]).toMatchObject({ priceListId: null, priority: 0, amount: 150_000, isApplied: false });
      expect(entries.map((e) => e.priority)).toEqual([...entries.map((e) => e.priority)].sort((a, b) => b - a));
      expect(res.body.data.result.amount).toBe(120_000);

      // Ngày ngoài mọi bảng → Bảng giá chung thắng; các bảng vẫn hiện nhưng inEffect=false
      const outside = await http().get(`${LISTS}/lookup`).query({ itemKind: 'EXAM_TYPE', ref: examCode, date: '2031-06-01', priceTypeCode: 'THUONG' }).set(authed(receptionistToken));
      const general = outside.body.data.entries.find((e: { priceListId: string | null }) => e.priceListId === null);
      expect(general.isApplied).toBe(true);
      expect(outside.body.data.entries.filter((e: { inEffect: boolean }) => e.inEffect)).toHaveLength(1);
    });

    it('lookup mặt hàng không tồn tại → 404', async () => {
      const res = await http().get(`${LISTS}/lookup`).query({ itemKind: 'TECHNICAL_SERVICE', ref: randomUUID(), date: '2031-02-05' }).set(authed(adminToken));
      expect(res.status).toBe(404);
    });
  });

  describe('tìm mặt hàng để thêm vào bảng giá', () => {
    it('tìm theo tên không dấu ở nhiều loại, kèm mức giá mặc định từng Loại giá/Bậc đơn vị', async () => {
      const res = await http().get(`${LISTS}/items/search`).query({ q: 'bang gia' }).set(authed(adminToken));
      expect(res.status).toBe(200);
      const items = res.body.data.items as { itemKind: string; ref: string; scopes: { priceTypeCode: string | null; unitCode: string | null; amount: number | null }[] }[];
      const kinds = new Set(items.map((i) => i.itemKind));
      expect(kinds.has('EXAM_TYPE')).toBe(true);
      expect(kinds.has('TECHNICAL_SERVICE')).toBe(true);
      expect(kinds.has('DRUG')).toBe(true);
      expect(kinds.has('MEDICAL_SUPPLY')).toBe(true);
      const medicine = items.find((i) => i.ref === medicineId);
      expect(medicine?.scopes.map((s) => s.unitCode)).toEqual(['VIEN', 'VI', 'HOP']);
      expect(medicine?.scopes.map((s) => s.amount)).toEqual([2_000, 20_000, 200_000]);
      const lab = items.find((i) => i.ref === labId);
      expect(lab?.scopes).toEqual([{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 150_000 }]);
    });

    it('lọc theo loại; không có kết quả → mảng rỗng', async () => {
      const onlySupply = await http().get(`${LISTS}/items/search`).query({ q: 'bang gia', kind: 'MEDICAL_SUPPLY' }).set(authed(adminToken));
      expect(onlySupply.body.data.items.every((i: { itemKind: string }) => i.itemKind === 'MEDICAL_SUPPLY')).toBe(true);
      const none = await http().get(`${LISTS}/items/search`).query({ q: 'zzzkhongco' }).set(authed(adminToken));
      expect(none.body.data.items).toEqual([]);
    });
  });

  describe('thêm hàng loạt: theo nhóm + nhập Excel', () => {
    const groupsOf = async (token = adminToken) => {
      const res = await http().get(`${LISTS}/items/groups`).set(authed(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.groups as { kind: string; code: string | null; name: string; itemCount: number }[];
    };

    async function buildXlsx(rows: (string | number)[][], header = ['Loại mặt hàng (*)', 'Mã mặt hàng (*)', 'Loại giá / Đơn vị', 'Cách tính (*)', 'Giá trị (*)']): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Mặt hàng');
      ws.addRow(header);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    }
    const preview = (buffer: Buffer, token = adminToken) => http().post(`${LISTS}/import/preview`).set(authed(token)).attach('file', buffer, 'bang-gia.xlsx');

    it('liệt kê nhóm: dịch vụ khám/gói là 1 nhóm "tất cả", thuốc/vật tư theo Nhóm thuốc kèm số lượng; cần quyền price_list.read', async () => {
      expect((await http().get(`${LISTS}/items/groups`)).status).toBe(401);
      const groups = await groupsOf();
      expect(groups.find((g) => g.kind === 'EXAM_TYPE')).toMatchObject({ code: null, name: 'Tất cả dịch vụ khám' });
      expect(groups.find((g) => g.kind === 'EXAM_TYPE')!.itemCount).toBeGreaterThanOrEqual(1);
      const drugGroup = groups.find((g) => g.kind === 'DRUG' && g.code === 'TEST_GROUP');
      expect(drugGroup!.itemCount).toBeGreaterThanOrEqual(1);
      expect(groups.some((g) => g.kind === 'MEDICAL_SUPPLY')).toBe(true);
      // Nhóm trống bị ẩn.
      expect(groups.every((g) => g.itemCount > 0)).toBe(true);
    });

    it('mặt hàng theo nhóm: đúng mặt hàng của nhóm đã chọn (kèm giá mặc định), không trùng khi chọn nhiều nhóm; tenant khác không thấy', async () => {
      const res = await http()
        .post(`${LISTS}/items/by-groups`)
        .set(authed(adminToken))
        .send({ groups: [{ kind: 'DRUG', code: 'TEST_GROUP' }, { kind: 'DRUG', code: 'TEST_GROUP' }, { kind: 'MEDICAL_SUPPLY', code: null }] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as { itemKind: string; ref: string; scopes: { amount: number | null }[] }[];
      const medicine = items.find((i) => i.ref === medicineId)!;
      expect(medicine.itemKind).toBe('DRUG');
      expect(medicine.scopes.some((sc) => sc.amount === 2_000)).toBe(true);
      expect(items.find((i) => i.ref === supplyId)?.itemKind).toBe('MEDICAL_SUPPLY');
      expect(new Set(items.map((i) => `${i.itemKind}:${i.ref}`)).size).toBe(items.length);

      const other = await http().post(`${LISTS}/items/by-groups`).set(authed(tenantBAdminToken)).send({ groups: [{ kind: 'DRUG', code: 'TEST_GROUP' }] });
      expect(other.status).toBe(200);
      expect(other.body.data.items.some((i: { ref: string }) => i.ref === medicineId)).toBe(false);

      expect((await http().post(`${LISTS}/items/by-groups`).set(authed(adminToken)).send({ groups: [] })).status).toBe(400);
    });

    it('tải file mẫu: xlsx 3 sheet (Mặt hàng có dòng ví dụ VD-, Hướng dẫn, Danh mục hiện có chứa mã mặt hàng)', async () => {
      const res = await http().get(`${LISTS}/import-template`).set(authed(adminToken)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('mau-nhap-bang-gia.xlsx');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Mặt hàng', 'Hướng dẫn', 'Danh mục hiện có']);
      expect(String(wb.getWorksheet('Mặt hàng')!.getCell(2, 2).value)).toMatch(/^VD-/);
      const catalogCodes: string[] = [];
      wb.getWorksheet('Danh mục hiện có')!.eachRow((row) => catalogCodes.push(String(row.getCell(2).value ?? '')));
      expect(catalogCodes).toContain(examCode);
    });

    it('xem trước nhập Excel: dòng hợp lệ (Giảm %, Giá mới theo Loại giá/Đơn vị), dòng ví dụ bị bỏ qua, lỗi từng dòng có số dòng', async () => {
      const medicineCode = (await http().get(`${LISTS}/items/search`).query({ q: 'Paracetamol bang gia', kind: 'DRUG' }).set(authed(adminToken))).body.data.items[0].code as string;
      const buffer = await buildXlsx([
        ['Dịch vụ khám', examCode, 'Mọi loại giá', 'Giảm %', '15'],
        ['thuốc', medicineCode.toLowerCase(), 'HOP', 'Giá mới', '1.500'],
        ['Thuốc', 'KHONG-CO-MA', '', 'Giảm %', '10'],
        ['Vật tư y tế', 'VD-BO-QUA', '', 'Giảm %', '10'],
        ['Dịch vụ khám', examCode, '', 'Giảm %', '20'],
        ['Món lạ', examCode, '', 'Giảm %', '20'],
        ['Thuốc', medicineCode, '', 'Giảm %', '150'],
        ['Thuốc', medicineCode, '', 'Giá mới', 'abc'],
        ['Dịch vụ khám', 'XXX', '', 'Tăng', '10'],
      ]);
      const res = await preview(buffer);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { rows, errors, exampleRowCount } = res.body.data as {
        rows: { rowNumber: number; item: { code: string }; priceTypeCode: string | null; unitCode: string | null; mode: string; value: number }[];
        errors: { rowNumber: number; message: string }[];
        exampleRowCount: number;
      };
      expect(exampleRowCount).toBe(1);
      expect(rows.map((r) => r.rowNumber), JSON.stringify(errors)).toEqual([2, 3]);
      expect(rows[0]).toMatchObject({ mode: 'PERCENT_OFF', value: 15, unitCode: null });
      expect(rows[1]).toMatchObject({ mode: 'NEW_PRICE', value: 1500, unitCode: 'HOP' });
      expect(errors.map((e) => e.rowNumber)).toEqual([4, 6, 7, 8, 9, 10]);
      expect(errors.find((e) => e.rowNumber === 4)!.message).toContain('Không tìm thấy mã');
      expect(errors.find((e) => e.rowNumber === 6)!.message).toContain('xuất hiện ở dòng trên');
      expect(errors.find((e) => e.rowNumber === 7)!.message).toContain('không hợp lệ');
      expect(errors.find((e) => e.rowNumber === 8)!.message).toContain('1 đến 100');
      expect(errors.find((e) => e.rowNumber === 9)!.message).toContain('số nguyên');
    });

    it('"Giá mới" thiếu đơn vị: thuốc nhiều bậc → lỗi; vật tư chỉ 1 bậc → tự điền; sai tiêu đề cột/không phải xlsx/không có file → 400; chỉ xem được khi có quyền', async () => {
      const medicineCode = (await http().get(`${LISTS}/items/search`).query({ q: 'Paracetamol bang gia', kind: 'DRUG' }).set(authed(adminToken))).body.data.items[0].code as string;
      const supplyCode = (await http().get(`${LISTS}/items/search`).query({ q: 'Bom tiem 5ml bang gia', kind: 'MEDICAL_SUPPLY' }).set(authed(adminToken))).body.data.items[0].code as string;
      const res = await preview(await buildXlsx([['Thuốc', medicineCode, '', 'Giá mới', '1000'], ['Vật tư y tế', supplyCode, '', 'Giá mới', '3000']]));
      expect(res.body.data.errors).toHaveLength(1);
      expect(res.body.data.errors[0].message).toContain('Đơn vị');
      expect(res.body.data.rows[0]).toMatchObject({ mode: 'NEW_PRICE', value: 3000, unitCode: 'CAI' });

      const wrongHeader = await preview(await buildXlsx([], ['Cột A', 'Cột B', 'Cột C', 'Cột D', 'Cột E']));
      expect(wrongHeader.status).toBe(400);
      const notXlsx = await preview(Buffer.from('không phải excel'));
      expect(notXlsx.status).toBe(400);
      expect((await http().post(`${LISTS}/import/preview`).set(authed(adminToken))).status).toBe(400);
      expect((await http().post(`${LISTS}/import/preview`)).status).toBe(401);
    });
  });
});
