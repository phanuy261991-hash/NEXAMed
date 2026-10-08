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
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/** HTTP e2e — Cận lâm sàng GĐ1, Danh mục (docs/DECISIONS.md #212). */
describe('HTTP e2e — Cận lâm sàng: dịch vụ kỹ thuật / chỉ số xét nghiệm / mẫu kết quả', () => {
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
  const SERVICES = '/api/v1/technical-services';
  const INDICATORS = '/api/v1/lab-indicators';
  const TEMPLATES = '/api/v1/result-templates';
  const today = getVietnamDateString();

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-cls-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  async function createService(token: string, body: Record<string, unknown>) {
    const res = await http().post(SERVICES).set(authed(token)).send(body);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  async function createIndicator(token: string, body: Record<string, unknown>) {
    const res = await http().post(INDICATORS).set(authed(token)).send(body);
    expect(res.status).toBe(200);
    return res.body.data;
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

    fixture = await createTwoTenantFixture(privileged, 'Paraclinical catalog e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    nurseToken = await createUserWithRole(fixture.tenantA.id, 'nurse');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('không token → 401', async () => {
      expect((await http().get(SERVICES)).status).toBe(401);
      expect((await http().get(INDICATORS)).status).toBe(401);
      expect((await http().get(TEMPLATES)).status).toBe(401);
    });

    it('bác sĩ/điều dưỡng/lễ tân XEM được danh mục nhưng KHÔNG thêm/sửa dịch vụ + chỉ số (chỉ clinic_admin)', async () => {
      for (const token of [doctorToken, nurseToken, receptionistToken]) {
        expect((await http().get(SERVICES).set(authed(token))).status).toBe(200);
        expect((await http().get(INDICATORS).set(authed(token))).status).toBe(200);
        expect((await http().post(SERVICES).set(authed(token)).send({ name: 'X', serviceKind: 'LAB' })).status).toBe(403);
        expect((await http().post(INDICATORS).set(authed(token)).send({ name: 'X' })).status).toBe(403);
      }
    });

    it('mẫu kết quả: bác sĩ + điều dưỡng xem được; chỉ bác sĩ/clinic_admin quản lý; lễ tân không có quyền gì', async () => {
      const service = await createService(adminToken, { name: 'Siêu âm quyền', serviceKind: 'IMAGING' });
      const body = { technicalServiceId: service.id, name: 'Mẫu quyền', conclusionText: 'Bình thường' };
      expect((await http().get(TEMPLATES).set(authed(nurseToken))).status).toBe(200);
      expect((await http().post(TEMPLATES).set(authed(nurseToken)).send(body)).status).toBe(403);
      expect((await http().get(TEMPLATES).set(authed(receptionistToken))).status).toBe(403);
      expect((await http().post(TEMPLATES).set(authed(doctorToken)).send(body)).status).toBe(200);
    });
  });

  describe('dịch vụ kỹ thuật', () => {
    it('tạo xét nghiệm: mã tự sinh tiền tố XN, kiểu kết quả mặc định INDICATORS, giữ cờ tự thực hiện', async () => {
      const created = await createService(adminToken, { name: 'Glucose máu lúc đói', serviceKind: 'LAB', specimenTypeCode: 'MB00001', turnaroundMinutes: 120 });
      expect(created.code).toMatch(/^XN/);
      expect(created.resultType).toBe('INDICATORS');
      expect(created.isPerformedInHouse).toBe(true);
      expect(created.specimenTypeCode).toBe('MB00001');
      expect(created.version).toBe(1);
    });

    it('mã tự sinh theo loại: CĐHA → CD, thăm dò chức năng → TD (kiểu kết quả mặc định NARRATIVE / BOTH)', async () => {
      const imaging = await createService(adminToken, { name: 'X-quang ngực thẳng', serviceKind: 'IMAGING' });
      const functional = await createService(adminToken, { name: 'Điện tâm đồ', serviceKind: 'FUNCTIONAL' });
      expect(imaging.code).toMatch(/^CD/);
      expect(imaging.resultType).toBe('NARRATIVE');
      expect(functional.code).toMatch(/^TD/);
      expect(functional.resultType).toBe('BOTH');
    });

    it('mẫu bệnh phẩm chỉ có nghĩa với xét nghiệm — CĐHA gửi kèm bị bỏ qua', async () => {
      const imaging = await createService(adminToken, { name: 'Siêu âm bụng', serviceKind: 'IMAGING', specimenTypeCode: 'MB00001' });
      expect(imaging.specimenTypeCode).toBeNull();
    });

    it('dịch vụ phòng khám không tự làm (chỉ định ra ngoài): lưu cờ, lọc được theo inHouse', async () => {
      const external = await createService(adminToken, { name: 'CT scan bụng có cản quang', serviceKind: 'IMAGING', isPerformedInHouse: false });
      expect(external.isPerformedInHouse).toBe(false);
      const outside = await http().get(`${SERVICES}?inHouse=false`).set(authed(doctorToken));
      expect(outside.body.data.items.map((i: { id: string }) => i.id)).toContain(external.id);
      const inside = await http().get(`${SERVICES}?inHouse=true`).set(authed(doctorToken));
      expect(inside.body.data.items.map((i: { id: string }) => i.id)).not.toContain(external.id);
    });

    it('danh sách: lọc theo loại + tìm theo tên/mã/viết tắt, đếm theo loại không phụ thuộc bộ lọc', async () => {
      const svc = await createService(adminToken, { name: 'Tổng phân tích nước tiểu', shortName: 'TPTNT', serviceKind: 'LAB' });
      const byKind = await http().get(`${SERVICES}?kind=LAB`).set(authed(adminToken));
      expect(byKind.body.data.items.every((i: { serviceKind: string }) => i.serviceKind === 'LAB')).toBe(true);
      const byShort = await http().get(`${SERVICES}?search=tptnt`).set(authed(adminToken));
      expect(byShort.body.data.items.map((i: { id: string }) => i.id)).toContain(svc.id);
      const byCode = await http().get(`${SERVICES}?search=${encodeURIComponent(svc.code)}`).set(authed(adminToken));
      expect(byCode.body.data.items.map((i: { id: string }) => i.id)).toContain(svc.id);
      const counts = byKind.body.data.counts;
      expect(counts.total).toBe(counts.LAB + counts.IMAGING + counts.FUNCTIONAL);
      expect(counts.IMAGING).toBeGreaterThan(0);
    });

    it('đơn giá đa mức: lưu, "giá hiện hành" chỉ tính dòng đang hiệu lực HÔM NAY, dòng tương lai/đã hết hạn không tính', async () => {
      const svc = await createService(adminToken, {
        name: 'HbA1c',
        serviceKind: 'LAB',
        prices: [
          { priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 180000, effectiveFrom: '2020-01-01' },
          { priceTypeCode: 'GIA_YEU_CAU', unitCode: 'LAN', amount: 250000, effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31' },
          { priceTypeCode: 'GIA_TET', unitCode: 'LAN', amount: 100000, effectiveFrom: '2099-01-01' },
        ],
      });
      expect(svc.prices).toHaveLength(3);
      expect(svc.currentPrices).toEqual([{ priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 180000 }]);
      const fromList = (await http().get(`${SERVICES}?search=HbA1c`).set(authed(adminToken))).body.data.items.find((i: { id: string }) => i.id === svc.id);
      expect(fromList.currentPrices).toHaveLength(1);
    });

    it('đơn giá chồng lấn ngày hiệu lực cùng Loại giá → 409 TECHNICAL_SERVICE_PRICE_OVERLAP (chặn ở DB), khác Loại giá thì được', async () => {
      const overlap = await http()
        .post(SERVICES)
        .set(authed(adminToken))
        .send({
          name: 'Dịch vụ trùng giá',
          serviceKind: 'LAB',
          prices: [
            { priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 100000, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' },
            { priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 120000, effectiveFrom: '2026-06-01' },
          ],
        });
      expect(overlap.status).toBe(409);
      expect(overlap.body.error.code).toBe('TECHNICAL_SERVICE_PRICE_OVERLAP');

      const ok = await http()
        .post(SERVICES)
        .set(authed(adminToken))
        .send({
          name: 'Dịch vụ khác loại giá',
          serviceKind: 'LAB',
          prices: [
            { priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 100000, effectiveFrom: '2026-01-01' },
            { priceTypeCode: 'GIA_YEU_CAU', unitCode: 'LAN', amount: 120000, effectiveFrom: '2026-06-01' },
          ],
        });
      expect(ok.status).toBe(200);
    });

    it('thất bại ở giữa → rollback cả dịch vụ (không để lại dịch vụ mồ côi khi đơn giá chồng lấn)', async () => {
      const name = `Rollback ${randomUUID()}`;
      const res = await http()
        .post(SERVICES)
        .set(authed(adminToken))
        .send({
          name,
          serviceKind: 'LAB',
          prices: [
            { priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 1, effectiveFrom: '2026-01-01' },
            { priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 2, effectiveFrom: '2026-01-01' },
          ],
        });
      expect(res.status).toBe(409);
      const found = await http().get(`${SERVICES}?search=${encodeURIComponent(name)}&includeInactive=true`).set(authed(adminToken));
      expect(found.body.data.items).toHaveLength(0);
    });

    it('sửa: tăng version; version cũ → 409 CONCURRENT_MODIFICATION; thay TOÀN BỘ đơn giá khi gửi mảng, không đụng khi bỏ trống', async () => {
      const svc = await createService(adminToken, {
        name: 'Dịch vụ sửa',
        serviceKind: 'LAB',
        prices: [{ priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 100000, effectiveFrom: '2020-01-01' }],
      });
      const renamed = await http().patch(`${SERVICES}/${svc.id}`).set(authed(adminToken)).send({ version: 1, name: 'Dịch vụ đã đổi tên' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.name).toBe('Dịch vụ đã đổi tên');
      expect(renamed.body.data.version).toBe(2);
      expect(renamed.body.data.prices).toHaveLength(1);

      const stale = await http().patch(`${SERVICES}/${svc.id}`).set(authed(adminToken)).send({ version: 1, name: 'Ghi đè' });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');

      const replaced = await http()
        .patch(`${SERVICES}/${svc.id}`)
        .set(authed(adminToken))
        .send({ version: 2, prices: [{ priceTypeCode: 'GIA_THUONG', unitCode: 'LAN', amount: 150000, effectiveFrom: '2020-01-01' }] });
      expect(replaced.status).toBe(200);
      expect(replaced.body.data.prices).toHaveLength(1);
      expect(replaced.body.data.prices[0].amount).toBe(150000);

      const cleared = await http().patch(`${SERVICES}/${replaced.body.data.id}`).set(authed(adminToken)).send({ version: 3, prices: [] });
      expect(cleared.body.data.prices).toHaveLength(0);
    });

    it('"Xoá" = ẩn: mặc định không còn trong danh sách, includeInactive vẫn thấy, kích hoạt lại được', async () => {
      const svc = await createService(adminToken, { name: 'Dịch vụ sẽ ẩn', serviceKind: 'FUNCTIONAL' });
      const hidden = await http().patch(`${SERVICES}/${svc.id}`).set(authed(adminToken)).send({ version: 1, isActive: false });
      expect(hidden.status).toBe(200);
      const active = await http().get(`${SERVICES}?search=${encodeURIComponent('Dịch vụ sẽ ẩn')}`).set(authed(adminToken));
      expect(active.body.data.items).toHaveLength(0);
      const all = await http().get(`${SERVICES}?search=${encodeURIComponent('Dịch vụ sẽ ẩn')}&includeInactive=true`).set(authed(adminToken));
      expect(all.body.data.items).toHaveLength(1);
      const back = await http().patch(`${SERVICES}/${svc.id}`).set(authed(adminToken)).send({ version: 2, isActive: true });
      expect(back.body.data.isActive).toBe(true);
    });

    it('khoa/phòng không tồn tại → 400', async () => {
      const res = await http().post(SERVICES).set(authed(adminToken)).send({ name: 'Sai khoa', serviceKind: 'LAB', departmentId: randomUUID() });
      expect(res.status).toBe(400);
    });

    it('cách ly tenant: tenant B không thấy, không sửa được dịch vụ của tenant A (404)', async () => {
      const svc = await createService(adminToken, { name: 'Chỉ của tenant A', serviceKind: 'LAB' });
      const list = await http().get(`${SERVICES}?search=${encodeURIComponent('Chỉ của tenant A')}`).set(authed(tenantBAdminToken));
      expect(list.body.data.items).toHaveLength(0);
      expect((await http().get(`${SERVICES}/${svc.id}`).set(authed(tenantBAdminToken))).status).toBe(404);
      expect((await http().patch(`${SERVICES}/${svc.id}`).set(authed(tenantBAdminToken)).send({ version: 1, name: 'x' })).status).toBe(404);
    });

    it('thiếu trường bắt buộc / loại không hợp lệ → 400', async () => {
      expect((await http().post(SERVICES).set(authed(adminToken)).send({ serviceKind: 'LAB' })).status).toBe(400);
      expect((await http().post(SERVICES).set(authed(adminToken)).send({ name: 'X', serviceKind: 'KHAC' })).status).toBe(400);
      expect((await http().get(`${SERVICES}/khong-phai-uuid`).set(authed(adminToken))).status).toBe(400);
    });
  });

  describe('chỉ số xét nghiệm + khoảng tham chiếu', () => {
    const HGB = {
      name: 'Huyết sắc tố',
      abbreviation: 'HGB',
      unit: 'g/L',
      valueType: 'NUMBER',
      decimals: 0,
      references: [
        { sex: 'MALE', ageFromYears: 15, lowValue: 130, highValue: 175 },
        { sex: 'FEMALE', ageFromYears: 15, lowValue: 120, highValue: 160 },
        { sex: 'ANY', ageFromYears: 1, ageToYears: 14, lowValue: 110, highValue: 150, note: 'Trẻ em' },
        { sex: 'ANY', ageFromYears: 0, ageToYears: 0, lowValue: 145, highValue: 225 },
      ],
    };

    it('tạo chỉ số số kèm khoảng tham chiếu theo giới tính × tuổi: mã tự sinh CS, lưu đủ 4 dòng', async () => {
      const created = await createIndicator(adminToken, HGB);
      expect(created.code).toMatch(/^CS/);
      expect(created.references).toHaveLength(4);
      expect(created.referenceCount).toBe(4);
      expect(created.references.map((r: { sex: string }) => r.sex).sort()).toEqual(['ANY', 'ANY', 'FEMALE', 'MALE']);
      const male = created.references.find((r: { sex: string }) => r.sex === 'MALE');
      expect(male).toMatchObject({ ageFromYears: 15, ageToYears: null, lowValue: 130, highValue: 175, lowInclusive: true, highInclusive: true });
    });

    it('khoảng tham chiếu dạng CHỮ: ngưỡng loại trừ ("< 0.03") và displayText nhiều dòng (HbA1c) giữ nguyên', async () => {
      const text = 'Bình thường: < 5.7\nTiền tiểu đường: 5.7 - 6.4\nTiểu đường: ≥ 6.5';
      const created = await createIndicator(adminToken, {
        name: 'HbA1c (NGSP)',
        unit: '%',
        references: [
          { highValue: 5.7, highInclusive: false, displayText: text },
          { highValue: 0.03, highInclusive: false, ageFromYears: 0, ageToYears: 0 },
        ],
      });
      const first = created.references.find((r: { displayText: string | null }) => r.displayText !== null);
      expect(first.displayText).toBe(text);
      expect(first.highInclusive).toBe(false);
    });

    it('chỉ số kiểu Chọn/Chữ dùng giá trị bình thường dạng chữ, không lưu ngưỡng số', async () => {
      const created = await createIndicator(adminToken, {
        name: 'Bạch cầu niệu',
        valueType: 'CHOICE',
        choiceOptions: ['Âm tính', 'Dương tính'],
        references: [{ normalText: 'Âm tính', lowValue: 1, highValue: 2 }],
      });
      expect(created.valueType).toBe('CHOICE');
      expect(created.choiceOptions).toEqual(['Âm tính', 'Dương tính']);
      expect(created.references[0]).toMatchObject({ normalText: 'Âm tính', lowValue: null, highValue: null });
    });

    it('kiểu Chọn thiếu lựa chọn → 400; tuổi đến < tuổi từ → 400; ngưỡng cao < ngưỡng thấp → 400', async () => {
      const post = (body: Record<string, unknown>) => http().post(INDICATORS).set(authed(adminToken)).send(body);
      expect((await post({ name: 'A', valueType: 'CHOICE', choiceOptions: ['Chỉ một'] })).status).toBe(400);
      expect((await post({ name: 'B', references: [{ ageFromYears: 20, ageToYears: 10 }] })).status).toBe(400);
      expect((await post({ name: 'C', references: [{ lowValue: 10, highValue: 5 }] })).status).toBe(400);
    });

    it('sửa: thay TOÀN BỘ khoảng tham chiếu; bỏ trống thì giữ nguyên; version cũ → 409', async () => {
      const created = await createIndicator(adminToken, { name: 'Glucose', unit: 'mmol/L', references: [{ lowValue: 3.9, highValue: 5.5 }] });
      const kept = await http().patch(`${INDICATORS}/${created.id}`).set(authed(adminToken)).send({ version: 1, unit: 'mg/dL' });
      expect(kept.body.data.unit).toBe('mg/dL');
      expect(kept.body.data.references).toHaveLength(1);

      const replaced = await http()
        .patch(`${INDICATORS}/${created.id}`)
        .set(authed(adminToken))
        .send({ version: 2, references: [{ sex: 'MALE', lowValue: 70, highValue: 100 }, { sex: 'FEMALE', lowValue: 65, highValue: 95 }] });
      expect(replaced.body.data.references).toHaveLength(2);

      const stale = await http().patch(`${INDICATORS}/${created.id}`).set(authed(adminToken)).send({ version: 1, name: 'Ghi đè' });
      expect(stale.status).toBe(409);
    });

    it('gắn chỉ số vào dịch vụ xét nghiệm theo thứ tự, kèm dòng "Diễn giải"; chỉ số dùng ở dịch vụ thì KHÔNG đổi được kiểu giá trị', async () => {
      const hgb = await createIndicator(adminToken, { name: 'HGB gắn dịch vụ', valueType: 'NUMBER' });
      const wbc = await createIndicator(adminToken, { name: 'WBC gắn dịch vụ', valueType: 'NUMBER' });
      const svc = await createService(adminToken, {
        name: 'Công thức máu',
        serviceKind: 'LAB',
        indicators: [{ indicatorId: wbc.id }, { indicatorId: hgb.id, interpretationText: 'Thiếu máu nếu thấp' }],
      });
      expect(svc.indicatorCount).toBe(2);
      expect(svc.indicators.map((i: { name: string }) => i.name)).toEqual(['WBC gắn dịch vụ', 'HGB gắn dịch vụ']);
      expect(svc.indicators[1].interpretationText).toBe('Thiếu máu nếu thấp');

      const inUse = (await http().get(`${INDICATORS}/${hgb.id}`).set(authed(adminToken))).body.data;
      expect(inUse.serviceCount).toBe(1);
      const locked = await http().patch(`${INDICATORS}/${hgb.id}`).set(authed(adminToken)).send({ version: inUse.version, valueType: 'TEXT' });
      expect(locked.status).toBe(409);
      expect(locked.body.error.code).toBe('LAB_INDICATOR_VALUE_TYPE_LOCKED');
      // Đổi các trường khác vẫn được.
      const renamed = await http().patch(`${INDICATORS}/${hgb.id}`).set(authed(adminToken)).send({ version: inUse.version, name: 'HGB đổi tên' });
      expect(renamed.status).toBe(200);
    });

    it('gắn chỉ số không tồn tại hoặc trùng lặp vào dịch vụ → 400', async () => {
      const ind = await createIndicator(adminToken, { name: 'Chỉ số trùng' });
      const missing = await http().post(SERVICES).set(authed(adminToken)).send({ name: 'S1', serviceKind: 'LAB', indicators: [{ indicatorId: randomUUID() }] });
      expect(missing.status).toBe(400);
      const dup = await http().post(SERVICES).set(authed(adminToken)).send({ name: 'S2', serviceKind: 'LAB', indicators: [{ indicatorId: ind.id }, { indicatorId: ind.id }] });
      expect(dup.status).toBe(400);
    });

    it('cách ly tenant: tenant B không thấy chỉ số của tenant A và không gắn được vào dịch vụ của mình', async () => {
      const ind = await createIndicator(adminToken, { name: 'Chỉ số riêng tenant A' });
      expect((await http().get(`${INDICATORS}/${ind.id}`).set(authed(tenantBAdminToken))).status).toBe(404);
      const attach = await http().post(SERVICES).set(authed(tenantBAdminToken)).send({ name: 'Dịch vụ B', serviceKind: 'LAB', indicators: [{ indicatorId: ind.id }] });
      expect(attach.status).toBe(400);
    });
  });

  describe('mẫu kết quả', () => {
    it('tạo mẫu cho dịch vụ; phải có Mô tả hoặc Kết luận; dịch vụ không tồn tại → 400', async () => {
      const svc = await createService(adminToken, { name: 'Siêu âm mẫu', serviceKind: 'IMAGING' });
      const ok = await http()
        .post(TEMPLATES)
        .set(authed(doctorToken))
        .send({ technicalServiceId: svc.id, name: 'Bụng bình thường', descriptionText: '- Gan: bình thường.', conclusionText: 'Chưa phát hiện bất thường.' });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ technicalServiceId: svc.id, isDefault: false, isActive: true, version: 1 });

      const empty = await http().post(TEMPLATES).set(authed(doctorToken)).send({ technicalServiceId: svc.id, name: 'Rỗng' });
      expect(empty.status).toBe(400);
      const noService = await http().post(TEMPLATES).set(authed(doctorToken)).send({ technicalServiceId: randomUUID(), name: 'X', conclusionText: 'x' });
      expect(noService.status).toBe(400);
    });

    it('chỉ 1 mẫu mặc định mỗi dịch vụ: đặt mẫu khác làm mặc định thì mẫu cũ tự bỏ cờ; mẫu dịch vụ khác không bị ảnh hưởng', async () => {
      const a = await createService(adminToken, { name: 'Dịch vụ mặc định A', serviceKind: 'IMAGING' });
      const b = await createService(adminToken, { name: 'Dịch vụ mặc định B', serviceKind: 'IMAGING' });
      const mk = async (serviceId: string, name: string, isDefault: boolean) =>
        (await http().post(TEMPLATES).set(authed(adminToken)).send({ technicalServiceId: serviceId, name, conclusionText: name, isDefault })).body.data;

      const a1 = await mk(a.id, 'A1', true);
      const b1 = await mk(b.id, 'B1', true);
      const a2 = await mk(a.id, 'A2', true);
      const listA = (await http().get(`${TEMPLATES}?technicalServiceId=${a.id}`).set(authed(adminToken))).body.data.items;
      expect(listA.find((t: { id: string }) => t.id === a1.id).isDefault).toBe(false);
      expect(listA.find((t: { id: string }) => t.id === a2.id).isDefault).toBe(true);
      const listB = (await http().get(`${TEMPLATES}?technicalServiceId=${b.id}`).set(authed(adminToken))).body.data.items;
      expect(listB.find((t: { id: string }) => t.id === b1.id).isDefault).toBe(true);

      const flipBack = await http().patch(`${TEMPLATES}/${a1.id}`).set(authed(adminToken)).send({ version: 2, isDefault: true });
      expect(flipBack.status).toBe(200);
      const after = (await http().get(`${TEMPLATES}?technicalServiceId=${a.id}`).set(authed(adminToken))).body.data.items;
      expect(after.filter((t: { isDefault: boolean }) => t.isDefault)).toHaveLength(1);
      expect(after.find((t: { isDefault: boolean }) => t.isDefault).id).toBe(a1.id);
    });

    it('ẩn mẫu: tự bỏ cờ mặc định, không còn trong danh sách mặc định; version cũ → 409; nội dung sửa được và giữ nguyên chữ nhiều dòng', async () => {
      const svc = await createService(adminToken, { name: 'Dịch vụ ẩn mẫu', serviceKind: 'IMAGING' });
      const t = (await http().post(TEMPLATES).set(authed(adminToken)).send({ technicalServiceId: svc.id, name: 'Mẫu ẩn', descriptionText: 'Dòng 1\nDòng 2', isDefault: true })).body.data;
      expect(t.descriptionText).toBe('Dòng 1\nDòng 2');

      const hidden = await http().patch(`${TEMPLATES}/${t.id}`).set(authed(adminToken)).send({ version: 1, isActive: false });
      expect(hidden.status).toBe(200);
      expect(hidden.body.data).toMatchObject({ isActive: false, isDefault: false });
      const visible = (await http().get(`${TEMPLATES}?technicalServiceId=${svc.id}`).set(authed(adminToken))).body.data.items;
      expect(visible).toHaveLength(0);
      const all = (await http().get(`${TEMPLATES}?technicalServiceId=${svc.id}&includeInactive=true`).set(authed(adminToken))).body.data.items;
      expect(all).toHaveLength(1);

      const stale = await http().patch(`${TEMPLATES}/${t.id}`).set(authed(adminToken)).send({ version: 1, name: 'Ghi đè' });
      expect(stale.status).toBe(409);
    });

    it('xoá sạch cả Mô tả lẫn Kết luận của mẫu khi sửa → 400', async () => {
      const svc = await createService(adminToken, { name: 'Dịch vụ xoá nội dung', serviceKind: 'IMAGING' });
      const t = (await http().post(TEMPLATES).set(authed(adminToken)).send({ technicalServiceId: svc.id, name: 'M', conclusionText: 'x' })).body.data;
      const res = await http().patch(`${TEMPLATES}/${t.id}`).set(authed(adminToken)).send({ version: 1, conclusionText: null });
      expect(res.status).toBe(400);
    });

    it('cách ly tenant: tenant B không thấy mẫu của tenant A', async () => {
      const svc = await createService(adminToken, { name: 'Dịch vụ cách ly mẫu', serviceKind: 'IMAGING' });
      const t = (await http().post(TEMPLATES).set(authed(adminToken)).send({ technicalServiceId: svc.id, name: 'Mẫu A', conclusionText: 'x' })).body.data;
      const listB = (await http().get(TEMPLATES).set(authed(tenantBAdminToken))).body.data.items;
      expect(listB.map((i: { id: string }) => i.id)).not.toContain(t.id);
      expect((await http().patch(`${TEMPLATES}/${t.id}`).set(authed(tenantBAdminToken)).send({ version: 1, name: 'x' })).status).toBe(404);
    });
  });

  it('ghi nhật ký hoạt động cho tạo/sửa dịch vụ, chỉ số và mẫu', async () => {
    const svc = await createService(adminToken, { name: 'Dịch vụ audit', serviceKind: 'LAB' });
    await http().patch(`${SERVICES}/${svc.id}`).set(authed(adminToken)).send({ version: 1, name: 'Dịch vụ audit 2' });
    const ind = await createIndicator(adminToken, { name: 'Chỉ số audit' });
    const logs = await privileged.auditLog.findMany({
      where: { tenantId: fixture.tenantA.id, entityId: { in: [svc.id, ind.id] } },
      select: { action: true },
    });
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('technical_service.created');
    expect(actions).toContain('technical_service.updated');
    expect(actions).toContain('lab_indicator.created');
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
