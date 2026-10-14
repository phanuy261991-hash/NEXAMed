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
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — hai menu mới "Phiếu chỉ định" (`GET /clinical-orders`) và "Tra cứu kết quả" (`GET /paraclinical/{lab,imaging}/results`), cùng việc vá LỌC CHI NHÁNH cho hàng đợi/kết quả cận lâm sàng
 * hiện có (docs/DECISIONS.md #232, #231). Dữ liệu 2 chi nhánh trong CÙNG một công ty dựng qua Prisma đặc quyền (phiếu, dòng, kết quả đã ký); danh mục dịch vụ/chỉ số tạo qua HTTP.
 * Trọng tâm: chi nhánh khác không bao giờ lọt vào danh sách, mở bằng id → 404; phân quyền theo nhóm; chia nhóm Xét nghiệm / CĐHA / Ra ngoài; tiến độ, tìm kiếm, khoảng ngày, phân trang.
 */
describe('HTTP e2e — Phiếu chỉ định + Tra cứu kết quả + lọc chi nhánh cận lâm sàng (#232)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let adminToken: string; // clinic_admin, chi nhánh A
  let receptionistToken: string; // A
  let labTechToken: string; // A
  let imagingTechToken: string; // A
  let branchBToken: string; // clinic_admin chỉ gán chi nhánh B
  let tenantBAdminToken: string; // công ty khác

  let indicatorId: string;
  let labServiceId: string;
  let labService2Id: string;
  let imagingServiceId: string;
  let patientId: string;
  let patientCode: string;

  // Mã phiếu của từng kịch bản.
  type OrderKey = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'B1' | 'B2';
  const orderNo = {} as Record<OrderKey, string>;
  let labItemA1: string;
  let imagingItemA1: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const suffix = randomUUID().slice(0, 6);
  const today = () => new Date().toISOString().slice(0, 10);

  async function createUser(tenantId: string, roleName: string, label: string, branchIds: string[]) {
    const username = `e2e-lk-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const branchId of branchIds) {
      await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    return { id: user.id as string, username };
  }

  async function login(tenantId: string, username: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function createEncounter(branchId: string, status: 'CHECKED_IN' | 'COMPLETED' = 'CHECKED_IN') {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    return privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        patientId,
        departmentId: department.id,
        encounterNo: `LK-LK-${Math.floor(Math.random() * 1_000_000_000)}`,
        status,
        checkedInAt: new Date(),
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  type ItemSpec = {
    serviceId?: string;
    name: string;
    status: 'ORDERED' | 'IN_PROGRESS' | 'RESULTED' | 'COMPLETED' | 'CANCELLED';
    performance?: 'IN_HOUSE' | 'EXTERNAL';
    /** Kết quả ĐÃ KÝ kèm theo (chỉ khi COMPLETED). */
    signed?: { daysAgo?: number; conclusion?: string; valueText?: string; amended?: boolean };
  };

  /** Dựng 1 phiếu chỉ định cho 1 lượt khám mới ở chi nhánh `branchId`; trả mã phiếu, id phiếu và id các dòng theo thứ tự `items`. */
  async function seedOrder(key: OrderKey, branchId: string, items: ItemSpec[], createdDaysAgo = 0): Promise<{ orderId: string; itemIds: string[] }> {
    const encounter = await createEncounter(branchId);
    const no = `CLS-${key}-${suffix}`;
    orderNo[key] = no;
    const created = await privileged.clinicalOrder.create({
      data: {
        tenantId: fixture.tenantA.id,
        orderNo: no,
        encounterId: encounter.id,
        createdAt: new Date(Date.now() - createdDaysAgo * 86_400_000),
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const itemIds: string[] = [];
    for (const [index, spec] of items.entries()) {
      const item = await privileged.clinicalOrderItem.create({
        data: {
          tenantId: fixture.tenantA.id,
          clinicalOrderId: created.id,
          itemKind: spec.serviceId ? 'TECHNICAL_SERVICE' : 'FREE_TEXT',
          technicalServiceId: spec.serviceId ?? null,
          freeTextName: spec.serviceId ? null : spec.name,
          name: spec.name,
          performance: spec.performance ?? 'IN_HOUSE',
          // Ràng buộc DB: dòng lẻ làm tại phòng khám PHẢI có đơn giá; chỉ định ra ngoài thì không.
          ...((spec.performance ?? 'IN_HOUSE') === 'IN_HOUSE' ? { unitPrice: 100_000n, priceTypeCode: 'THUONG', unitCode: 'LUOT' } : {}),
          status: spec.status,
          sortOrder: index,
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
      itemIds.push(item.id);
      if (spec.signed) {
        const signedAt = new Date(Date.now() - (spec.signed.daysAgo ?? 0) * 86_400_000);
        let supersedesId: string | null = null;
        if (spec.signed.amended) {
          // Bản gốc đã ký bị thay (soft-delete) rồi bản đính chính trỏ về nó — đúng luồng đính chính thật.
          const original = await privileged.paraclinicalResult.create({
            data: {
              tenantId: fixture.tenantA.id,
              clinicalOrderItemId: item.id,
              conclusionText: 'Bản gốc',
              resultedAt: signedAt,
              signedAt,
              signedBy: SYSTEM_TEST_ACTOR,
              deletedAt: new Date(),
              deletedReason: 'Đính chính: test',
              createdBy: SYSTEM_TEST_ACTOR,
              updatedBy: SYSTEM_TEST_ACTOR,
            },
          });
          supersedesId = original.id;
        }
        const result = await privileged.paraclinicalResult.create({
          data: {
            tenantId: fixture.tenantA.id,
            clinicalOrderItemId: item.id,
            conclusionText: spec.signed.conclusion ?? null,
            resultedAt: signedAt,
            // Trigger DB chặn thêm chỉ số vào kết quả ĐÃ KÝ → tạo bản nháp, thêm chỉ số rồi mới ký (đúng luồng thật).
            supersedesId,
            amendmentReason: supersedesId ? 'test' : null,
            createdBy: SYSTEM_TEST_ACTOR,
            updatedBy: SYSTEM_TEST_ACTOR,
          },
        });
        if (spec.signed.valueText !== undefined) {
          await privileged.paraclinicalResultValue.create({
            data: {
              tenantId: fixture.tenantA.id,
              resultId: result.id,
              labIndicatorId: indicatorId,
              indicatorCode: 'GLU',
              indicatorName: 'Glucose',
              unit: 'mmol/L',
              valueType: 'NUMBER',
              valueText: spec.signed.valueText,
              referenceSnapshot: { sex: 'ANY', ageFromYears: 0, ageToYears: null, lowValue: 3.9, highValue: 5.5, lowInclusive: true, highInclusive: true, normalText: null, displayText: null },
              createdBy: SYSTEM_TEST_ACTOR,
              updatedBy: SYSTEM_TEST_ACTOR,
            },
          });
        }
        await privileged.paraclinicalResult.update({ where: { id: result.id }, data: { signedAt, signedBy: SYSTEM_TEST_ACTOR } });
      }
    }
    return { orderId: created.id, itemIds };
  }

  async function bookOf(token: string, params: Record<string, string | number> = {}) {
    const res = await http().get('/api/v1/clinical-orders').set(authed(token)).query(params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as {
      items: { orderId: string; orderNo: string; primaryDiagnosis: { code: string; name: string } | null; serviceNames: string[]; serviceCount: number; progress: { state: string; done: number; total: number }; payment: string; patientCode: string }[];
      nextCursor: string | null;
    };
  }
  const bookNos = async (token: string, params: Record<string, string | number> = {}): Promise<string[]> => (await bookOf(token, params)).items.map((r) => r.orderNo);

  async function lookupOf(group: 'lab' | 'imaging', token: string, params: Record<string, string | number> = {}) {
    const res = await http().get(`/api/v1/paraclinical/${group}/results`).set(authed(token)).query(params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as {
      items: { key: string; itemIds: string[]; orderNo: string; serviceNames: string[]; serviceCount: number; status: string; summary: string; abnormalCount: number }[];
      nextCursor: string | null;
    };
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

    fixture = await createTwoTenantFixture(privileged, 'ParaclinicalLookup e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    // Danh mục dịch vụ + chỉ số: tạo khi công ty còn 1 chi nhánh (token admin mang chi nhánh A).
    const admin = await createUser(fixture.tenantA.id, 'clinic_admin', 'admin', []);
    adminToken = await login(fixture.tenantA.id, admin.username);
    const indicator = await http()
      .post('/api/v1/lab-indicators')
      .set(authed(adminToken))
      .send({ name: `Glucose (tra cứu ${suffix})`, unit: 'mmol/L', valueType: 'NUMBER', references: [{ lowValue: 3.9, highValue: 5.5 }] });
    expect(indicator.status, JSON.stringify(indicator.body)).toBe(200);
    indicatorId = indicator.body.data.id as string;
    const service = async (name: string, serviceKind: 'LAB' | 'IMAGING') => {
      const res = await http()
        .post('/api/v1/technical-services')
        .set(authed(adminToken))
        .send({
          name,
          serviceKind,
          isPerformedInHouse: true,
          ...(serviceKind === 'LAB' ? { indicators: [{ indicatorId }] } : {}),
          prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 100_000, effectiveFrom: '2020-01-01' }],
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.id as string;
    };
    labServiceId = await service(`Glucose máu (tra cứu ${suffix})`, 'LAB');
    labService2Id = await service(`HbA1c (tra cứu ${suffix})`, 'LAB');
    imagingServiceId = await service(`Siêu âm (tra cứu ${suffix})`, 'IMAGING');

    const patient = await privileged.patient.create({
      data: {
        tenantId: fixture.tenantA.id,
        patientCode: `BN-LK-${suffix}`,
        fullName: `Bệnh nhân tra cứu ${suffix}`,
        dob: new Date('1980-05-05'),
        gender: 'female',
        phone: '0912345678',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    patientId = patient.id;
    patientCode = patient.patientCode;

    // Chi nhánh thứ hai của CÙNG công ty + tài khoản theo từng chi nhánh (mỗi người chỉ gán đúng một nơi → đăng nhập tự vào chi nhánh đó).
    const b = await privileged.branch.create({
      data: { tenantId: fixture.tenantA.id, code: 'CN00002', name: 'Chi nhánh B (tra cứu)', isDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    branchB = b.id;
    await privileged.userBranch.create({ data: { tenantId: fixture.tenantA.id, userId: admin.id, branchId: branchA, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const receptionist = await createUser(fixture.tenantA.id, 'receptionist', 'recep', [branchA]);
    const labTech = await createUser(fixture.tenantA.id, 'lab_technician', 'lab', [branchA]);
    const imagingTech = await createUser(fixture.tenantA.id, 'imaging_technician', 'img', [branchA]);
    const adminB = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminB', [branchB]);
    const tenantBAdmin = await createUser(fixture.tenantB.id, 'clinic_admin', 'tenantB', []);
    receptionistToken = await login(fixture.tenantA.id, receptionist.username);
    labTechToken = await login(fixture.tenantA.id, labTech.username);
    imagingTechToken = await login(fixture.tenantA.id, imagingTech.username);
    branchBToken = await login(fixture.tenantA.id, adminB.username);
    tenantBAdminToken = await login(fixture.tenantB.id, tenantBAdmin.username);

    // ---- Dữ liệu chi nhánh A ----
    // A1: phiếu đã có đủ kết quả — 2 xét nghiệm (1 chỉ số cao) + 1 siêu âm có kết luận.
    const a1 = await seedOrder('A1', branchA, [
      { serviceId: labServiceId, name: 'Glucose máu', status: 'COMPLETED', signed: { valueText: '8.2' } },
      { serviceId: labService2Id, name: 'HbA1c', status: 'COMPLETED', signed: { valueText: '5.0' } },
      { serviceId: imagingServiceId, name: 'Siêu âm bụng', status: 'COMPLETED', signed: { conclusion: 'Gan nhiễm mỡ độ 1' } },
    ]);
    // Chẩn đoán chính của lượt khám A1 — chỉ người có encounter.read_clinical mới thấy trên sổ phiếu.
    const a1Order = await privileged.clinicalOrder.findFirstOrThrow({ where: { id: a1.orderId }, select: { encounterId: true } });
    await privileged.diagnosis.create({ data: { tenantId: fixture.tenantA.id, encounterId: a1Order.encounterId, icd10Code: 'J20.9', type: 'PRIMARY', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    labItemA1 = a1.itemIds[0]!;
    imagingItemA1 = a1.itemIds[2]!;
    // A2: xét nghiệm chờ làm, chưa lên hoá đơn.
    await seedOrder('A2', branchA, [{ serviceId: labServiceId, name: 'Glucose máu', status: 'ORDERED' }]);
    // A3: chỉ định ra ngoài (tên tự do).
    await seedOrder('A3', branchA, [{ name: 'Nội soi tai mũi họng (làm ở nơi khác)', status: 'ORDERED', performance: 'EXTERNAL' }]);
    // A4: phiếu cũ 3 ngày trước, đã có kết quả bình thường duyệt cách đây 3 ngày.
    await seedOrder('A4', branchA, [{ serviceId: labServiceId, name: 'Glucose máu', status: 'COMPLETED', signed: { daysAgo: 3, valueText: '4.5' } }], 3);
    // A5: kết quả duyệt quá 7 ngày trước (ngoài cửa sổ mặc định của Tra cứu kết quả).
    await seedOrder('A5', branchA, [{ serviceId: labServiceId, name: 'Glucose máu', status: 'COMPLETED', signed: { daysAgo: 10, valueText: '4.5' } }], 10);
    // A6: kết quả đã ĐÍNH CHÍNH.
    await seedOrder('A6', branchA, [{ serviceId: labServiceId, name: 'Glucose máu', status: 'COMPLETED', signed: { valueText: '4.8', amended: true } }]);
    // A7: phiếu đã huỷ toàn bộ.
    await seedOrder('A7', branchA, [{ serviceId: labServiceId, name: 'Glucose máu', status: 'CANCELLED' }]);
    // ---- Dữ liệu chi nhánh B (CÙNG công ty) ----
    await seedOrder('B1', branchB, [{ serviceId: labServiceId, name: 'Glucose máu', status: 'COMPLETED', signed: { valueText: '9.9' } }]);
    await seedOrder('B2', branchB, [{ serviceId: labServiceId, name: 'Glucose máu', status: 'ORDERED' }]);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('Phiếu chỉ định — GET /clinical-orders', () => {
    it('phân quyền: không token 401; kỹ thuật viên không có clinical_order.read → 403; lễ tân/quản lý/bác sĩ đọc được', async () => {
      expect((await http().get('/api/v1/clinical-orders')).status).toBe(401);
      expect((await http().get('/api/v1/clinical-orders').set(authed(labTechToken))).status).toBe(403);
      expect((await http().get('/api/v1/clinical-orders').set(authed(imagingTechToken))).status).toBe(403);
      expect((await http().get('/api/v1/clinical-orders').set(authed(receptionistToken))).status).toBe(200);
    });

    it('chia nhóm: tab Xét nghiệm chỉ phiếu có xét nghiệm (và chỉ liệt kê dịch vụ xét nghiệm); CĐHA chỉ dịch vụ hình ảnh; Ra ngoài chỉ chỉ định ngoài', async () => {
      const lab = await bookOf(adminToken, { group: 'LAB' });
      const a1Lab = lab.items.find((r) => r.orderNo === orderNo.A1)!;
      expect(a1Lab.serviceNames.sort()).toEqual(['Glucose máu', 'HbA1c']);
      expect(a1Lab.serviceCount).toBe(2);
      expect(a1Lab.patientCode).toBe(patientCode);
      expect(lab.items.map((r) => r.orderNo)).not.toContain(orderNo.A3);

      const imaging = await bookOf(adminToken, { group: 'IMAGING' });
      expect(imaging.items.map((r) => r.orderNo)).toEqual([orderNo.A1]);
      expect(imaging.items[0]!.serviceNames).toEqual(['Siêu âm bụng']);

      const external = await bookOf(adminToken, { group: 'EXTERNAL' });
      expect(external.items.map((r) => r.orderNo)).toEqual([orderNo.A3]);
      expect(external.items[0]!.progress.state).toBe('EXTERNAL');
      expect(external.items[0]!.payment).toBe('NOT_CHARGED');
    });

    it('chẩn đoán chính chỉ gửi cho tài khoản có encounter.read_clinical (quản lý thấy, lễ tân KHÔNG)', async () => {
      const admin = (await bookOf(adminToken, { group: 'LAB' })).items.find((r) => r.orderNo === orderNo.A1)!;
      expect(admin.primaryDiagnosis?.code).toBe('J20.9');
      expect(admin.primaryDiagnosis?.name).toBeTruthy();
      const recep = (await bookOf(receptionistToken, { group: 'LAB' })).items.find((r) => r.orderNo === orderNo.A1)!;
      expect(recep.primaryDiagnosis).toBeNull();
    });

    it('tiến độ và thanh toán của dòng; bộ lọc tiến độ (Chờ / Đã có kết quả / Đã huỷ)', async () => {
      const lab = await bookOf(adminToken, { group: 'LAB' });
      expect(lab.items.find((r) => r.orderNo === orderNo.A1)!.progress).toEqual({ state: 'DONE', done: 2, total: 2 });
      const a2 = lab.items.find((r) => r.orderNo === orderNo.A2)!;
      expect(a2.progress).toEqual({ state: 'WAITING', done: 0, total: 1 });
      expect(a2.payment).toBe('UNPAID');

      expect(await bookNos(adminToken, { group: 'LAB', progress: 'WAITING' })).toEqual([orderNo.A2]);
      expect((await bookNos(adminToken, { group: 'LAB', progress: 'DONE' })).sort()).toEqual([orderNo.A1, orderNo.A6].sort());
      expect(await bookNos(adminToken, { group: 'LAB', progress: 'CANCELLED' })).toEqual([orderNo.A7]);
    });

    it('mặc định chỉ hôm nay; đổi khoảng ngày lấy được phiếu cũ; tìm theo mã phiếu và mã bệnh nhân', async () => {
      expect(await bookNos(adminToken, { group: 'LAB' })).not.toContain(orderNo.A4);
      const wide = await bookNos(adminToken, { group: 'LAB', dateFrom: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10), dateTo: today() });
      expect(wide).toContain(orderNo.A4);
      expect(wide).not.toContain(orderNo.A5); // 10 ngày trước vẫn ngoài khoảng

      expect(await bookNos(adminToken, { group: 'LAB', q: orderNo.A2 })).toEqual([orderNo.A2]);
      const byPatient = await bookNos(adminToken, { group: 'LAB', q: patientCode });
      expect(byPatient).toContain(orderNo.A1);
      expect(byPatient).not.toContain(orderNo.B1);
      expect(await bookNos(adminToken, { group: 'LAB', q: 'khong-co-ma-nay' })).toEqual([]);
    });

    it('phân trang cursor: trang 1 có nextCursor, trang 2 không trùng trang 1', async () => {
      const first = await bookOf(adminToken, { group: 'LAB', limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await bookOf(adminToken, { group: 'LAB', limit: 2, cursor: first.nextCursor! });
      expect(second.items.length).toBeGreaterThan(0);
      const firstNos = new Set(first.items.map((r) => r.orderNo));
      for (const r of second.items) expect(firstNos.has(r.orderNo)).toBe(false);
    });

    it('CÔ LẬP CHI NHÁNH: tài khoản chi nhánh B chỉ thấy phiếu chi nhánh B; chi nhánh A không thấy phiếu B; công ty khác không thấy gì', async () => {
      const aNos = await bookNos(adminToken, { group: 'LAB' });
      expect(aNos).not.toContain(orderNo.B1);
      expect(aNos).not.toContain(orderNo.B2);

      const bNos = (await bookNos(branchBToken, { group: 'LAB' })).sort();
      expect(bNos).toEqual([orderNo.B1, orderNo.B2].sort());
      expect(bNos).not.toContain(orderNo.A1);

      expect((await bookOf(tenantBAdminToken, { group: 'LAB' })).items).toEqual([]);
    });
  });

  describe('Tra cứu kết quả — GET /paraclinical/{lab,imaging}/results', () => {
    it('phân quyền theo nhóm: kỹ thuật viên xét nghiệm chỉ tab Xét nghiệm, kỹ thuật viên CĐHA chỉ tab CĐHA; lễ tân xem được cả hai danh sách; không token 401', async () => {
      expect((await http().get('/api/v1/paraclinical/lab/results')).status).toBe(401);
      expect((await http().get('/api/v1/paraclinical/lab/results').set(authed(labTechToken))).status).toBe(200);
      expect((await http().get('/api/v1/paraclinical/imaging/results').set(authed(labTechToken))).status).toBe(403);
      expect((await http().get('/api/v1/paraclinical/imaging/results').set(authed(imagingTechToken))).status).toBe(200);
      expect((await http().get('/api/v1/paraclinical/lab/results').set(authed(imagingTechToken))).status).toBe(403);
      expect((await http().get('/api/v1/paraclinical/lab/results').set(authed(receptionistToken))).status).toBe(200);
      expect((await http().get('/api/v1/paraclinical/imaging/results').set(authed(receptionistToken))).status).toBe(200);
    });

    it('chỉ kết quả ĐÃ DUYỆT; xét nghiệm gộp 1 dòng/phiếu kèm số chỉ số bất thường; đúng cửa sổ 7 ngày mặc định', async () => {
      const lab = await lookupOf('lab', adminToken);
      const nos = lab.items.map((r) => r.orderNo);
      expect(nos).toContain(orderNo.A1);
      expect(nos).toContain(orderNo.A6);
      expect(nos).not.toContain(orderNo.A2); // chưa có kết quả
      expect(nos).not.toContain(orderNo.A5); // duyệt 10 ngày trước
      expect(nos).not.toContain(orderNo.A7); // đã huỷ

      const a1 = lab.items.find((r) => r.orderNo === orderNo.A1)!;
      expect(a1.serviceCount).toBe(2);
      expect(a1.summary).toBe('ABNORMAL');
      expect(a1.abnormalCount).toBe(1); // glucose 8.2 > 5.5; HbA1c 5.0 trong khoảng
      expect(a1.status).toBe('APPROVED');
      expect(lab.items.find((r) => r.orderNo === orderNo.A4)!.summary).toBe('NORMAL');
    });

    it('bộ lọc: chỉ có chỉ số bất thường; trạng thái Đã đính chính; tìm kiếm; khoảng ngày rộng lấy kết quả cũ', async () => {
      const abnormal = await lookupOf('lab', adminToken, { abnormalOnly: 'true' });
      expect(abnormal.items.map((r) => r.orderNo)).toEqual([orderNo.A1]);

      const amended = await lookupOf('lab', adminToken, { status: 'AMENDED' });
      expect(amended.items.map((r) => r.orderNo)).toEqual([orderNo.A6]);
      expect((await lookupOf('lab', adminToken, { status: 'APPROVED' })).items.map((r) => r.orderNo)).not.toContain(orderNo.A6);

      expect((await lookupOf('lab', adminToken, { q: orderNo.A4 })).items.map((r) => r.orderNo)).toEqual([orderNo.A4]);
      const wide = await lookupOf('lab', adminToken, { dateFrom: new Date(Date.now() - 12 * 86_400_000).toISOString().slice(0, 10), dateTo: today() });
      expect(wide.items.map((r) => r.orderNo)).toContain(orderNo.A5);
    });

    it('CĐHA & thăm dò: mỗi dịch vụ 1 dòng, tóm tắt "có kết luận"; xét nghiệm không lẫn sang tab này', async () => {
      const imaging = await lookupOf('imaging', adminToken);
      expect(imaging.items.map((r) => r.orderNo)).toEqual([orderNo.A1]);
      expect(imaging.items[0]).toMatchObject({ key: imagingItemA1, serviceNames: ['Siêu âm bụng'], summary: 'HAS_CONCLUSION', serviceCount: 1 });
      const lab = await lookupOf('lab', adminToken);
      expect(lab.items.find((r) => r.orderNo === orderNo.A1)!.itemIds).not.toContain(imagingItemA1);
    });

    it('CÔ LẬP CHI NHÁNH: tài khoản chi nhánh B chỉ thấy kết quả chi nhánh B; chi nhánh A không thấy kết quả B; công ty khác rỗng', async () => {
      expect((await lookupOf('lab', adminToken)).items.map((r) => r.orderNo)).not.toContain(orderNo.B1);
      expect((await lookupOf('lab', branchBToken)).items.map((r) => r.orderNo)).toEqual([orderNo.B1]);
      expect((await lookupOf('imaging', branchBToken)).items).toEqual([]);
      expect((await lookupOf('lab', tenantBAdminToken)).items).toEqual([]);
    });
  });

  describe('Lọc chi nhánh cho hàng đợi + kết quả cận lâm sàng hiện có (vá #232)', () => {
    type QueueRow = { orderNo: string; itemIds: string[] };
    const queueOf = async (token: string, params: Record<string, string> = {}): Promise<QueueRow[]> => {
      const res = await http().get('/api/v1/paraclinical/lab/queue').set(authed(token)).query(params);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.items as QueueRow[];
    };

    it('hàng đợi xét nghiệm chỉ gồm lượt khám của chi nhánh đang làm việc', async () => {
      const a = (await queueOf(adminToken)).map((r) => r.orderNo);
      expect(a).toContain(orderNo.A2);
      expect(a).not.toContain(orderNo.B2);
      const b = (await queueOf(branchBToken)).map((r) => r.orderNo);
      expect(b).toContain(orderNo.B2);
      expect(b).not.toContain(orderNo.A2);
    });

    it('mở/in/nhập kết quả của dòng thuộc chi nhánh khác bằng id → 404; cùng chi nhánh → 200', async () => {
      const own = await http().get(`/api/v1/paraclinical/lab/items/${labItemA1}/result`).set(authed(adminToken));
      expect(own.status, JSON.stringify(own.body)).toBe(200);

      const cross = await http().get(`/api/v1/paraclinical/lab/items/${labItemA1}/result`).set(authed(branchBToken));
      expect(cross.status).toBe(404);
      expect((await http().post(`/api/v1/paraclinical/lab/items/${labItemA1}/result/print`).set(authed(branchBToken))).status).toBe(404);
      expect((await http().get(`/api/v1/paraclinical/imaging/items/${imagingItemA1}/result`).set(authed(branchBToken))).status).toBe(404);
      // công ty khác cũng 404 (RLS + lọc tenant)
      expect((await http().get(`/api/v1/paraclinical/lab/items/${labItemA1}/result`).set(authed(tenantBAdminToken))).status).toBe(404);
    });

    it('lấy mẫu / xem ống ở chi nhánh khác → 404 (không lộ phiếu tồn tại)', async () => {
      const order = await privileged.clinicalOrder.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, orderNo: orderNo.A2 } });
      const cross = await http().post(`/api/v1/paraclinical/lab/orders/${order.id}/specimen-collection/open`).set(authed(branchBToken)).send();
      expect(cross.status).toBe(404);
    });
  });
});
