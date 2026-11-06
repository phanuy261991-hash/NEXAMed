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

/**
 * HTTP e2e — "Gửi mẫu đối tác" giai đoạn 1: nền (docs/DECISIONS.md #291). Công tắc "Dùng đối tác xét nghiệm", đối tác = nhà cung cấp có cờ `isLabPartner` (mã tiền tố DT),
 * "Gửi đối tác" ở dịch vụ kỹ thuật, giá trả theo cặp (dịch vụ × đối tác), cô lập công ty.
 */
describe('HTTP e2e — Gửi mẫu đối tác: công tắc, đối tác, giá trả theo dịch vụ', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let doctorToken: string;
  let tenantBAdminToken: string;

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());
  const SERVICES = '/api/v1/technical-services';
  const SUPPLIERS = '/api/v1/suppliers';
  const SETTINGS = '/api/v1/clinic-settings';
  const SUMMARY = '/api/v1/lab-partners/summary';

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-labp-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  /** Vai trò tuỳ biến chỉ có đúng các quyền nêu — kiểm quyền nhà cung cấp tách khỏi kho thuốc (#291). */
  async function createUserWithPermissions(tenantId: string, perms: [string, string][]) {
    const role = await privileged.role.create({ data: { tenantId, name: `e2e-labp-custom-${randomUUID()}`, isSystemDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const [module, action] of perms) {
      const permission = await privileged.permission.findFirstOrThrow({ where: { module, action } });
      await privileged.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: permission.id, dataScope: 'global', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    const username = `e2e-labp-cu-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: 'User tuỳ biến', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  async function setToggle(token: string, value: boolean) {
    const res = await http().patch(SETTINGS).set(authed(token)).send({ labPartnerEnabled: value });
    expect(res.status).toBe(200);
  }

  async function createSupplier(token: string, body: Record<string, unknown>) {
    const res = await http().post(SUPPLIERS).set(authed(token)).send(body);
    expect(res.status).toBe(200);
    return res.body.data as { id: string; code: string; version: number; isLabPartner: boolean };
  }

  async function createLab(token: string, body: Record<string, unknown> = {}) {
    const res = await http().post(SERVICES).set(authed(token)).send({ name: `XN gửi ${randomUUID().slice(0, 8)}`, serviceKind: 'LAB', ...body });
    return res;
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

    fixture = await createTwoTenantFixture(privileged, 'Lab partner config e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('công tắc "Dùng đối tác xét nghiệm"', () => {
    it('mặc định TẮT; bật/tắt được qua cấu hình chung', async () => {
      const before = await http().get(SETTINGS).set(authed(adminToken));
      expect(before.status).toBe(200);
      expect(before.body.data.labPartnerEnabled).toBe(false);
      await setToggle(adminToken, true);
      expect((await http().get(SETTINGS).set(authed(adminToken))).body.data.labPartnerEnabled).toBe(true);
      await setToggle(adminToken, false);
      expect((await http().get(SETTINGS).set(authed(adminToken))).body.data.labPartnerEnabled).toBe(false);
    });

    it('công tắc TẮT: bật "Gửi đối tác" hoặc gán giá trả → 409 LAB_PARTNER_DISABLED; dịch vụ thường vẫn tạo được', async () => {
      await setToggle(adminToken, false);
      const partner = await createSupplier(adminToken, { name: 'Đối tác công tắc tắt', isLabPartner: true });
      const sent = await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partner.id, amount: 100000 }] });
      expect(sent.status).toBe(409);
      expect(sent.body.error.code).toBe('LAB_PARTNER_DISABLED');
      const pricedOnly = await createLab(adminToken, { partnerPrices: [{ supplierId: partner.id, amount: 100000 }] });
      expect(pricedOnly.status).toBe(409);
      expect((await createLab(adminToken)).status).toBe(200);
    });
  });

  describe('đối tác = nhà cung cấp có cờ', () => {
    it('tạo đối tác: mã tiền tố DT; nhà cung cấp thường vẫn NCC', async () => {
      const partner = await createSupplier(adminToken, { name: 'Phòng xét nghiệm Bình Minh', isLabPartner: true });
      const normal = await createSupplier(adminToken, { name: 'Công ty dược thường' });
      expect(partner.code).toMatch(/^DT\d+$/);
      expect(partner.isLabPartner).toBe(true);
      expect(normal.code).toMatch(/^NCC\d+$/);
      expect(normal.isLabPartner).toBe(false);
    });

    it('bác sĩ không tạo được đối tác (thiếu quyền kho thuốc)', async () => {
      const res = await http().post(SUPPLIERS).set(authed(doctorToken)).send({ name: 'Không được', isLabPartner: true });
      expect(res.status).toBe(403);
    });
  });

  describe('"Gửi đối tác" + giá trả theo cặp (công tắc BẬT)', () => {
    let partnerA: { id: string; version: number };
    let partnerB: { id: string };
    let normalSupplier: { id: string };

    beforeAll(async () => {
      await setToggle(adminToken, true);
      partnerA = await createSupplier(adminToken, { name: 'Đối tác A giá trả', isLabPartner: true });
      partnerB = await createSupplier(adminToken, { name: 'Đối tác B giá trả', isLabPartner: true });
      normalSupplier = await createSupplier(adminToken, { name: 'NCC thường giá trả' });
    });

    it('tạo xét nghiệm gửi đối tác: lưu giá từng đối tác, dòng đầu tự là mặc định, chi tiết trả mã/tên đối tác', async () => {
      const res = await createLab(adminToken, {
        sentToPartner: true,
        partnerPrices: [
          { supplierId: partnerA.id, amount: 150000 },
          { supplierId: partnerB.id, amount: 135000 },
        ],
      });
      expect(res.status).toBe(200);
      const detail = res.body.data;
      expect(detail.sentToPartner).toBe(true);
      expect(detail.partnerPrices).toHaveLength(2);
      const a = detail.partnerPrices.find((p: { supplierId: string }) => p.supplierId === partnerA.id);
      const b = detail.partnerPrices.find((p: { supplierId: string }) => p.supplierId === partnerB.id);
      expect(a.amount).toBe(150000);
      expect(a.isDefault).toBe(true);
      expect(a.supplierName).toBe('Đối tác A giá trả');
      expect(a.supplierCode).toMatch(/^DT/);
      expect(b.amount).toBe(135000);
      expect(b.isDefault).toBe(false);
    });

    it('chỉ định đối tác mặc định tường minh; đặt hai mặc định → 400', async () => {
      const ok = await createLab(adminToken, {
        sentToPartner: true,
        partnerPrices: [
          { supplierId: partnerA.id, amount: 1000 },
          { supplierId: partnerB.id, amount: 2000, isDefault: true },
        ],
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data.partnerPrices.find((p: { supplierId: string }) => p.supplierId === partnerB.id).isDefault).toBe(true);
      const two = await createLab(adminToken, {
        sentToPartner: true,
        partnerPrices: [
          { supplierId: partnerA.id, amount: 1000, isDefault: true },
          { supplierId: partnerB.id, amount: 2000, isDefault: true },
        ],
      });
      expect(two.status).toBe(400);
    });

    it('từ chối: không có đối tác nào / trùng đối tác / nhà cung cấp thường / không phải xét nghiệm / dịch vụ chỉ định ra ngoài', async () => {
      expect((await createLab(adminToken, { sentToPartner: true })).status).toBe(400);
      expect((await createLab(adminToken, { sentToPartner: true, partnerPrices: [] })).status).toBe(400);
      expect(
        (await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partnerA.id, amount: 1 }, { supplierId: partnerA.id, amount: 2 }] })).status,
      ).toBe(400);
      expect((await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: normalSupplier.id, amount: 1 }] })).status).toBe(400);
      const imaging = await http()
        .post(SERVICES)
        .set(authed(adminToken))
        .send({ name: 'Siêu âm không gửi', serviceKind: 'IMAGING', sentToPartner: true, partnerPrices: [{ supplierId: partnerA.id, amount: 1 }] });
      expect(imaging.status).toBe(400);
      const outside = await createLab(adminToken, { isPerformedInHouse: false, sentToPartner: true, partnerPrices: [{ supplierId: partnerA.id, amount: 1 }] });
      expect(outside.status).toBe(400);
      expect((await createLab(adminToken, { partnerPrices: [{ supplierId: randomUUID(), amount: 1 }] })).status).toBe(400);
    });

    it('sửa: thay TOÀN BỘ giá trả, bỏ trống thì giữ nguyên; xoá hết giá khi đang gửi đối tác → 400', async () => {
      const created = (await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partnerA.id, amount: 1000 }] })).body.data;
      const keep = await http().patch(`${SERVICES}/${created.id}`).set(authed(adminToken)).send({ version: created.version, name: 'Đổi tên giữ giá' });
      expect(keep.status).toBe(200);
      expect(keep.body.data.partnerPrices).toHaveLength(1);
      expect(keep.body.data.partnerPrices[0].amount).toBe(1000);

      const replaced = await http()
        .patch(`${SERVICES}/${keep.body.data.id}`)
        .set(authed(adminToken))
        .send({ version: keep.body.data.version, partnerPrices: [{ supplierId: partnerB.id, amount: 7000 }] });
      expect(replaced.status).toBe(200);
      expect(replaced.body.data.partnerPrices).toHaveLength(1);
      expect(replaced.body.data.partnerPrices[0].supplierId).toBe(partnerB.id);
      expect(replaced.body.data.partnerPrices[0].amount).toBe(7000);

      const emptied = await http()
        .patch(`${SERVICES}/${replaced.body.data.id}`)
        .set(authed(adminToken))
        .send({ version: replaced.body.data.version, partnerPrices: [] });
      expect(emptied.status).toBe(400);
    });

    it('tắt "Gửi đối tác" rồi vẫn giữ giá đã nhập; đổi sang "chỉ định ra ngoài" khi đang gửi đối tác → 400', async () => {
      const created = (await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partnerA.id, amount: 5000 }] })).body.data;
      const bad = await http().patch(`${SERVICES}/${created.id}`).set(authed(adminToken)).send({ version: created.version, isPerformedInHouse: false });
      expect(bad.status).toBe(400);
      const off = await http().patch(`${SERVICES}/${created.id}`).set(authed(adminToken)).send({ version: created.version, sentToPartner: false });
      expect(off.status).toBe(200);
      expect(off.body.data.sentToPartner).toBe(false);
      expect(off.body.data.partnerPrices).toHaveLength(1);
    });

    it('bỏ đánh dấu "Đối tác XN" khi còn giá trả → 409 LAB_PARTNER_IN_USE; gỡ giá rồi bỏ được', async () => {
      const partner = await createSupplier(adminToken, { name: 'Đối tác bỏ cờ', isLabPartner: true });
      const service = (await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partner.id, amount: 100 }] })).body.data;
      const blocked = await http().patch(`${SUPPLIERS}/${partner.id}`).set(authed(adminToken)).send({ version: partner.version, isLabPartner: false });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('LAB_PARTNER_IN_USE');

      const cleared = await http().patch(`${SERVICES}/${service.id}`).set(authed(adminToken)).send({ version: service.version, sentToPartner: false, partnerPrices: [] });
      expect(cleared.status).toBe(200);
      const ok = await http().patch(`${SUPPLIERS}/${partner.id}`).set(authed(adminToken)).send({ version: partner.version, isLabPartner: false });
      expect(ok.status).toBe(200);
      expect(ok.body.data.isLabPartner).toBe(false);
    });

    it('tổng hợp số dịch vụ theo đối tác: đếm đúng, chỉ dòng còn hiệu lực', async () => {
      const partner = await createSupplier(adminToken, { name: 'Đối tác đếm', isLabPartner: true });
      for (let i = 0; i < 3; i += 1) {
        expect((await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partner.id, amount: 100 + i }] })).status).toBe(200);
      }
      const summary = await http().get(SUMMARY).set(authed(adminToken));
      expect(summary.status).toBe(200);
      expect(summary.body.data.items.find((i: { supplierId: string }) => i.supplierId === partner.id).serviceCount).toBe(3);
    });
  });

  describe('cô lập công ty và quyền', () => {
    it('công ty B không thấy số liệu đối tác của A và không gán được đối tác của A', async () => {
      await setToggle(adminToken, true);
      await setToggle(tenantBAdminToken, true);
      const partnerA = await createSupplier(adminToken, { name: 'Đối tác riêng của A', isLabPartner: true });
      const serviceA = (await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partnerA.id, amount: 1 }] })).body.data;
      expect(serviceA.id).toBeTruthy();

      const summaryB = await http().get(SUMMARY).set(authed(tenantBAdminToken));
      expect(summaryB.status).toBe(200);
      expect(summaryB.body.data.items.some((i: { supplierId: string }) => i.supplierId === partnerA.id)).toBe(false);

      const cross = await createLab(tenantBAdminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partnerA.id, amount: 1 }] });
      expect(cross.status).toBe(400);
      expect((await http().get(`${SUPPLIERS}/${partnerA.id}`).set(authed(tenantBAdminToken))).status).toBe(404);
      expect((await http().get(`${SERVICES}/${serviceA.id}`).set(authed(tenantBAdminToken))).status).toBe(404);
    });

    it('giá TRẢ đối tác không hiện cho bác sĩ/lễ tân khi xem dịch vụ; người cấu hình và người xem công nợ vẫn thấy (#291)', async () => {
      await setToggle(adminToken, true);
      const partner = await createSupplier(adminToken, { name: 'Đối tác che giá vốn', isLabPartner: true });
      const service = (await createLab(adminToken, { sentToPartner: true, partnerPrices: [{ supplierId: partner.id, amount: 123000 }] })).body.data;
      expect(service.partnerPrices).toHaveLength(1);

      const asDoctor = await http().get(`${SERVICES}/${service.id}`).set(authed(doctorToken));
      expect(asDoctor.status).toBe(200);
      expect(asDoctor.body.data.sentToPartner).toBe(true);
      expect(asDoctor.body.data.partnerPrices).toEqual([]);

      const viewer = await createUserWithPermissions(fixture.tenantA.id, [['technical_service', 'read']]);
      expect((await http().get(`${SERVICES}/${service.id}`).set(authed(viewer))).body.data.partnerPrices).toEqual([]);
      const debtViewer = await createUserWithPermissions(fixture.tenantA.id, [['technical_service', 'read'], ['supplier_debt', 'read']]);
      expect((await http().get(`${SERVICES}/${service.id}`).set(authed(debtViewer))).body.data.partnerPrices).toHaveLength(1);
      const adminView = await http().get(`${SERVICES}/${service.id}`).set(authed(adminToken));
      expect(adminView.body.data.partnerPrices[0].amount).toBe(123000);
    });

    it('quyền nhà cung cấp RIÊNG, không gắn kho thuốc: chỉ supplier.read xem được và không sửa; chỉ drug.read không còn xem được nhà cung cấp (#291)', async () => {
      const supplier = await createSupplier(adminToken, { name: 'NCC kiểm quyền riêng' });
      const onlySupplierRead = await createUserWithPermissions(fixture.tenantA.id, [['supplier', 'read']]);
      expect((await http().get(SUPPLIERS).set(authed(onlySupplierRead))).status).toBe(200);
      expect((await http().get(`${SUPPLIERS}/${supplier.id}`).set(authed(onlySupplierRead))).status).toBe(200);
      expect((await http().post(SUPPLIERS).set(authed(onlySupplierRead)).send({ name: 'Không được' })).status).toBe(403);
      expect((await http().patch(`${SUPPLIERS}/${supplier.id}`).set(authed(onlySupplierRead)).send({ version: supplier.version, name: 'Đổi' })).status).toBe(403);

      const onlyDrugRead = await createUserWithPermissions(fixture.tenantA.id, [['drug', 'read']]);
      expect((await http().get(SUPPLIERS).set(authed(onlyDrugRead))).status).toBe(403);

      const supplierManager = await createUserWithPermissions(fixture.tenantA.id, [['supplier', 'read'], ['supplier', 'create'], ['supplier', 'update']]);
      const created = await http().post(SUPPLIERS).set(authed(supplierManager)).send({ name: 'Tạo bằng quyền nhà cung cấp' });
      expect(created.status).toBe(200);
      expect((await http().patch(`${SUPPLIERS}/${created.body.data.id}`).set(authed(supplierManager)).send({ version: created.body.data.version, name: 'Sửa bằng quyền nhà cung cấp' })).status).toBe(200);
    });

    it('bác sĩ xem được tổng hợp (quyền xem dịch vụ kỹ thuật) nhưng không sửa dịch vụ; không token → 401', async () => {
      expect((await http().get(SUMMARY).set(authed(doctorToken))).status).toBe(200);
      expect((await http().get(SUMMARY)).status).toBe(401);
      const svc = (await createLab(adminToken)).body.data;
      expect((await http().patch(`${SERVICES}/${svc.id}`).set(authed(doctorToken)).send({ version: svc.version, sentToPartner: false })).status).toBe(403);
    });
  });
});
