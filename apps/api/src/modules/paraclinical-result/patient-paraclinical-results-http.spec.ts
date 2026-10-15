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
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — tab "Kết quả cận lâm sàng" ở Hồ sơ bệnh nhân (docs/DECISIONS.md #234): `GET /paraclinical/{lab,imaging}/patients/:patientId/{results,indicators,indicators/trend,items/:itemId/result}`.
 * Trọng tâm: kết quả đi theo NGƯỜI BỆNH (đọc được mọi chi nhánh, dòng chi nhánh khác có cờ `isOtherBranch`), nhưng không lẫn bệnh nhân khác / tenant khác; lễ tân (chỉ có quyền Xem) bị chặn ở máy chủ;
 * chỉ số cùng mã khác đơn vị tách thành hai nhóm; mở/in kết quả liên chi nhánh đúng bệnh nhân và đã duyệt.
 */
describe('HTTP e2e — Tab Kết quả cận lâm sàng theo bệnh nhân (#234)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let adminToken: string; // clinic_admin, chi nhánh A
  let receptionistToken: string; // A — chỉ có quyền Xem kết quả
  let labTechToken: string; // A
  let imagingTechToken: string; // A
  let adminBToken: string; // clinic_admin chỉ gán chi nhánh B
  let tenantBAdminToken: string; // công ty khác

  let indicatorId: string;
  let labServiceId: string;
  let imagingServiceId: string;
  let patientId: string;
  let otherPatientId: string;

  const items = {} as Record<'o1' | 'o2' | 'o3' | 'o4' | 'o5' | 'img' | 'ordered' | 'other', string>;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const suffix = randomUUID().slice(0, 6);
  const base = (group: 'lab' | 'imaging', pid = patientId) => `/api/v1/paraclinical/${group}/patients/${pid}`;

  async function createUser(tenantId: string, roleName: string, label: string, branchIds: string[]) {
    const username = `e2e-pr-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
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

  async function createEncounter(branchId: string, forPatientId: string) {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    return privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        patientId: forPatientId,
        departmentId: department.id,
        encounterNo: `PR-${Math.floor(Math.random() * 1_000_000_000)}`,
        status: 'COMPLETED',
        checkedInAt: new Date(),
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  interface SeedSpec {
    key: keyof typeof items;
    branchId: string;
    patientId?: string;
    serviceId: string;
    name: string;
    status?: 'ORDERED' | 'COMPLETED';
    daysAgo?: number;
    /** Chỉ số xét nghiệm đã ký. */
    value?: { text: string; unit: string; low: number; high: number };
    conclusion?: string;
    amended?: boolean;
  }

  async function seed(spec: SeedSpec): Promise<void> {
    const encounter = await createEncounter(spec.branchId, spec.patientId ?? patientId);
    const order = await privileged.clinicalOrder.create({
      data: { tenantId: fixture.tenantA.id, orderNo: `PR-${spec.key}-${suffix}`, encounterId: encounter.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const item = await privileged.clinicalOrderItem.create({
      data: {
        tenantId: fixture.tenantA.id,
        clinicalOrderId: order.id,
        itemKind: 'TECHNICAL_SERVICE',
        technicalServiceId: spec.serviceId,
        name: spec.name,
        performance: 'IN_HOUSE',
        unitPrice: 100_000n,
        priceTypeCode: 'THUONG',
        unitCode: 'LUOT',
        status: spec.status ?? 'COMPLETED',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    items[spec.key] = item.id;
    if ((spec.status ?? 'COMPLETED') !== 'COMPLETED') return;

    const signedAt = new Date(Date.now() - (spec.daysAgo ?? 0) * 86_400_000);
    let supersedesId: string | null = null;
    if (spec.amended) {
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
    // Trigger DB chặn thêm chỉ số vào kết quả ĐÃ KÝ → tạo bản nháp, thêm chỉ số rồi mới ký (đúng luồng thật).
    const result = await privileged.paraclinicalResult.create({
      data: {
        tenantId: fixture.tenantA.id,
        clinicalOrderItemId: item.id,
        conclusionText: spec.conclusion ?? null,
        resultedAt: signedAt,
        supersedesId,
        amendmentReason: supersedesId ? 'test' : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    if (spec.value) {
      await privileged.paraclinicalResultValue.create({
        data: {
          tenantId: fixture.tenantA.id,
          resultId: result.id,
          labIndicatorId: indicatorId,
          indicatorCode: 'GLU',
          indicatorName: 'Glucose',
          unit: spec.value.unit,
          valueType: 'NUMBER',
          valueText: spec.value.text,
          referenceSnapshot: { sex: 'ANY', ageFromYears: 0, ageToYears: null, lowValue: spec.value.low, highValue: spec.value.high, lowInclusive: true, highInclusive: true, normalText: null, displayText: null },
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
    }
    await privileged.paraclinicalResult.update({ where: { id: result.id }, data: { signedAt, signedBy: SYSTEM_TEST_ACTOR } });
  }

  async function listOf(group: 'lab' | 'imaging', token: string, params: Record<string, string | number> = {}, pid = patientId) {
    const res = await http().get(`${base(group, pid)}/results`).set(authed(token)).query(params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as {
      items: { itemId: string; orderNo: string; serviceName: string; status: string; abnormals: { label: string; flag: string; valueText: string }[]; conclusionText: string | null; branchName: string | null; isOtherBranch: boolean; signedAt: string }[];
      nextCursor: string | null;
      summary: { totalApproved: number; abnormalResults: number; trackableIndicators: number; latestServiceNames: string[]; byCategory: { name: string; count: number }[] };
      multiBranch: boolean;
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

    fixture = await createTwoTenantFixture(privileged, 'PatientParaclinical e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    // Danh mục dịch vụ + chỉ số: tạo khi công ty còn 1 chi nhánh (token admin mang chi nhánh A).
    const admin = await createUser(fixture.tenantA.id, 'clinic_admin', 'admin', []);
    adminToken = await login(fixture.tenantA.id, admin.username);
    const indicator = await http()
      .post('/api/v1/lab-indicators')
      .set(authed(adminToken))
      .send({ name: `Glucose (bn ${suffix})`, unit: 'mmol/L', valueType: 'NUMBER', references: [{ lowValue: 3.9, highValue: 5.5 }] });
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
    labServiceId = await service(`Glucose máu (bn ${suffix})`, 'LAB');
    imagingServiceId = await service(`Siêu âm (bn ${suffix})`, 'IMAGING');

    const patient = async (code: string, name: string) =>
      (await privileged.patient.create({ data: { tenantId: fixture.tenantA.id, patientCode: `${code}-${suffix}`, fullName: name, dob: new Date('1980-05-05'), gender: 'female', phone: '0912345678', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
    patientId = await patient('BN-PR1', `Bệnh nhân theo dõi ${suffix}`);
    otherPatientId = await patient('BN-PR2', `Bệnh nhân khác ${suffix}`);

    const b = await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'CN00002', name: 'Chi nhánh B (kết quả)', isDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
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
    adminBToken = await login(fixture.tenantA.id, adminB.username);
    tenantBAdminToken = await login(fixture.tenantB.id, tenantBAdmin.username);

    const mmol = (text: string) => ({ text, unit: 'mmol/L', low: 3.9, high: 5.5 });
    await seed({ key: 'o1', branchId: branchA, serviceId: labServiceId, name: 'Glucose máu', daysAgo: 5, value: mmol('8.2') });
    await seed({ key: 'o2', branchId: branchA, serviceId: labServiceId, name: 'Glucose máu', daysAgo: 3, value: mmol('5.0') });
    await seed({ key: 'o3', branchId: branchB, serviceId: labServiceId, name: 'Glucose máu', daysAgo: 1, value: mmol('7.0') });
    await seed({ key: 'o4', branchId: branchA, serviceId: labServiceId, name: 'Glucose máu', daysAgo: 2, value: { text: '120', unit: 'mg/dL', low: 70, high: 99 } });
    await seed({ key: 'o5', branchId: branchA, serviceId: labServiceId, name: 'Glucose máu', daysAgo: 4, value: mmol('4.8'), amended: true });
    await seed({ key: 'img', branchId: branchA, serviceId: imagingServiceId, name: 'Siêu âm bụng', daysAgo: 2, conclusion: 'Gan nhiễm mỡ độ 1' });
    await seed({ key: 'ordered', branchId: branchA, serviceId: labServiceId, name: 'Glucose máu', status: 'ORDERED' });
    await seed({ key: 'other', branchId: branchA, patientId: otherPatientId, serviceId: labServiceId, name: 'Glucose máu', daysAgo: 1, value: mmol('9.9') });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('không token 401; lễ tân (chỉ có quyền Xem) bị chặn 403 ở mọi endpoint; người làm chuyên môn đọc được', async () => {
      expect((await http().get(`${base('lab')}/results`)).status).toBe(401);
      for (const url of [`${base('lab')}/results`, `${base('lab')}/indicators`, `${base('lab')}/indicators/trend?code=GLU`, `${base('lab')}/items/${items.o1}/result`, `${base('imaging')}/results`]) {
        expect((await http().get(url).set(authed(receptionistToken))).status, url).toBe(403);
      }
      expect((await http().post(`${base('lab')}/items/${items.o1}/result/print`).set(authed(receptionistToken)).send({})).status).toBe(403);
      expect((await http().get(`${base('lab')}/results`).set(authed(labTechToken))).status).toBe(200);
      expect((await http().get(`${base('imaging')}/results`).set(authed(imagingTechToken))).status).toBe(200);
    });

    it('kỹ thuật viên xét nghiệm không đọc được nhóm CĐHA và ngược lại (quyền theo nhóm)', async () => {
      expect((await http().get(`${base('imaging')}/results`).set(authed(labTechToken))).status).toBe(403);
      expect((await http().get(`${base('lab')}/results`).set(authed(imagingTechToken))).status).toBe(403);
    });
  });

  describe('danh sách kết quả', () => {
    it('xét nghiệm: gộp MỌI chi nhánh, mới nhất trước; không lẫn bệnh nhân khác, không có dòng chưa duyệt, không lẫn CĐHA', async () => {
      const lab = await listOf('lab', adminToken);
      // o3 (1 ngày), o4 (2), o2 (3), o5 (4, đã đính chính), o1 (5)
      expect(lab.items.map((r) => r.itemId)).toEqual([items.o3, items.o4, items.o2, items.o5, items.o1]);
      expect(lab.multiBranch).toBe(true);
      expect(lab.items.map((r) => r.itemId)).not.toContain(items.other);
      expect(lab.items.map((r) => r.itemId)).not.toContain(items.ordered);
      expect(lab.items.map((r) => r.itemId)).not.toContain(items.img);
    });

    it('chỉ số bất thường kèm cờ; dòng chi nhánh khác có isOtherBranch + tên chi nhánh (đứng từ chi nhánh A)', async () => {
      const lab = await listOf('lab', adminToken);
      const o3 = lab.items.find((r) => r.itemId === items.o3)!;
      expect(o3.isOtherBranch).toBe(true);
      expect(o3.branchName).toBe('Chi nhánh B (kết quả)');
      expect(o3.abnormals).toMatchObject([{ label: 'Glucose', flag: 'HIGH', valueText: '7.0' }]);
      const o2 = lab.items.find((r) => r.itemId === items.o2)!;
      expect(o2.isOtherBranch).toBe(false);
      expect(o2.abnormals).toEqual([]);
      // Đứng từ chi nhánh B thì ngược lại.
      const fromB = await listOf('lab', adminBToken);
      expect(fromB.items.find((r) => r.itemId === items.o3)!.isOtherBranch).toBe(false);
      expect(fromB.items.find((r) => r.itemId === items.o1)!.isOtherBranch).toBe(true);
    });

    it('dải số tính trên toàn bộ kết quả đã duyệt của nhóm (không phụ thuộc bộ lọc)', async () => {
      const filtered = await listOf('lab', adminToken, { abnormalOnly: 'true' });
      expect(filtered.summary.totalApproved).toBe(5);
      expect(filtered.summary.abnormalResults).toBe(3); // o1, o3, o4 (120 mg/dL > 99)
      expect(filtered.summary.latestServiceNames).toEqual(['Glucose máu']);
      // GLU mmol/L có 4 lần đo (o1,o2,o3,o5) → theo dõi được; GLU mg/dL chỉ 1 lần → chưa.
      expect(filtered.summary.trackableIndicators).toBe(1);
    });

    it('CĐHA: kết luận thay cho chỉ số; dải số đếm theo loại dịch vụ', async () => {
      const imaging = await listOf('imaging', adminToken);
      expect(imaging.items).toHaveLength(1);
      expect(imaging.items[0]).toMatchObject({ itemId: items.img, conclusionText: 'Gan nhiễm mỡ độ 1', abnormals: [] });
      expect(imaging.summary.totalApproved).toBe(1);
      expect(imaging.summary.abnormalResults).toBe(0);
    });

    it('bộ lọc: chỉ bất thường, trạng thái đính chính, khoảng ngày, tìm kiếm; phân trang theo con trỏ', async () => {
      expect((await listOf('lab', adminToken, { abnormalOnly: 'true' })).items.map((r) => r.itemId).sort()).toEqual([items.o1, items.o3, items.o4].sort());
      expect((await listOf('lab', adminToken, { status: 'AMENDED' })).items.map((r) => r.itemId)).toEqual([items.o5]);
      expect((await listOf('lab', adminToken, { status: 'APPROVED' })).items.map((r) => r.itemId)).not.toContain(items.o5);

      const day = (daysAgo: number) => new Date(Date.now() + 7 * 3_600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
      const range = await listOf('lab', adminToken, { dateFrom: day(3), dateTo: day(1) });
      expect(range.items.map((r) => r.itemId).sort()).toEqual([items.o2, items.o3, items.o4].sort());

      expect((await listOf('lab', adminToken, { q: 'glucose' })).items).toHaveLength(5);
      expect((await listOf('lab', adminToken, { q: `PR-o3-${suffix}` })).items.map((r) => r.itemId)).toEqual([items.o3]);
      expect((await listOf('lab', adminToken, { q: 'khong-co-gi-ca' })).items).toEqual([]);

      const page1 = await listOf('lab', adminToken, { limit: 2 });
      expect(page1.items.map((r) => r.itemId)).toEqual([items.o3, items.o4]);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listOf('lab', adminToken, { limit: 2, cursor: page1.nextCursor! });
      expect(page2.items.map((r) => r.itemId)).toEqual([items.o2, items.o5]);
      const page3 = await listOf('lab', adminToken, { limit: 2, cursor: page2.nextCursor! });
      expect(page3.items.map((r) => r.itemId)).toEqual([items.o1]);
      expect(page3.nextCursor).toBeNull();
    });

    it('cách ly: bệnh nhân khác không lẫn; tenant khác hỏi bệnh nhân này nhận danh sách rỗng', async () => {
      const other = await listOf('lab', adminToken, {}, otherPatientId);
      expect(other.items.map((r) => r.itemId)).toEqual([items.other]);
      const crossTenant = await listOf('lab', tenantBAdminToken);
      expect(crossTenant.items).toEqual([]);
      expect(crossTenant.summary.totalApproved).toBe(0);
    });
  });

  describe('diễn biến chỉ số', () => {
    it('gộp theo mã + đơn vị: mmol/L và mg/dL là hai mục riêng, mỗi mục có số lần đo và giá trị gần nhất', async () => {
      const res = await http().get(`${base('lab')}/indicators`).set(authed(adminToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const list = res.body.data.items as { code: string; unit: string | null; measureCount: number; latestValue: number; latestFlag: string | null }[];
      expect(list).toHaveLength(2);
      const mmol = list.find((i) => i.unit === 'mmol/L')!;
      expect(mmol).toMatchObject({ code: 'GLU', measureCount: 4, latestValue: 7, latestFlag: 'HIGH' });
      expect(list.find((i) => i.unit === 'mg/dL')).toMatchObject({ measureCount: 1, latestValue: 120 });
    });

    it('trend: điểm sắp cũ → mới, kèm cờ, khoảng tham chiếu ĐÃ ÁP từng lần và chi nhánh; unit chọn đúng nhóm', async () => {
      const res = await http().get(`${base('lab')}/indicators/trend`).query({ code: 'GLU', unit: 'mmol/L' }).set(authed(adminToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const trend = res.body.data as { multiBranch: boolean; points: { itemId: string; value: number; flag: string | null; referenceText: string; low: number | null; high: number | null; isOtherBranch: boolean }[] };
      expect(trend.points.map((p) => p.itemId)).toEqual([items.o1, items.o5, items.o2, items.o3]);
      expect(trend.points.map((p) => p.value)).toEqual([8.2, 4.8, 5, 7]);
      expect(trend.points.map((p) => p.flag)).toEqual(['HIGH', 'NORMAL', 'NORMAL', 'HIGH']);
      expect(trend.points[0]).toMatchObject({ low: 3.9, high: 5.5, referenceText: '3.9 - 5.5' });
      expect(trend.points.map((p) => p.isOtherBranch)).toEqual([false, false, false, true]);

      const mg = await http().get(`${base('lab')}/indicators/trend`).query({ code: 'GLU', unit: 'mg/dL' }).set(authed(adminToken));
      expect(mg.body.data.points).toHaveLength(1);
      expect(mg.body.data.points[0]).toMatchObject({ value: 120, low: 70, high: 99, flag: 'HIGH' });
    });

    it('chỉ số không có lần đo nào → 404; thiếu mã → 400; nhóm CĐHA không có đường dẫn diễn biến', async () => {
      expect((await http().get(`${base('lab')}/indicators/trend`).query({ code: 'KHONG-CO' }).set(authed(adminToken))).status).toBe(404);
      expect((await http().get(`${base('lab')}/indicators/trend`).set(authed(adminToken))).status).toBe(400);
      expect((await http().get(`${base('imaging')}/indicators`).set(authed(adminToken))).status).toBe(404);
    });
  });

  describe('mở và in một kết quả', () => {
    it('mở được kết quả của chi nhánh KHÁC khi đúng bệnh nhân (kết quả đi theo người bệnh)', async () => {
      const res = await http().get(`${base('lab')}/items/${items.o3}/result`).set(authed(adminToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.form.patientCode).toBe(`BN-PR1-${suffix}`);
      expect(res.body.data.form.sections[0].indicators[0]).toMatchObject({ valueText: '7.0', flag: 'HIGH' });
    });

    it('đường mở theo chi nhánh hiện có KHÔNG đổi: kết quả chi nhánh khác vẫn 404 ở menu cận lâm sàng', async () => {
      expect((await http().get(`/api/v1/paraclinical/lab/items/${items.o3}/result`).set(authed(adminToken))).status).toBe(404);
    });

    it('404 khi dòng không thuộc bệnh nhân trên đường dẫn, chưa duyệt, hoặc sai nhóm; tenant khác cũng 404', async () => {
      expect((await http().get(`${base('lab')}/items/${items.other}/result`).set(authed(adminToken))).status).toBe(404); // của bệnh nhân khác
      expect((await http().get(`${base('lab')}/items/${items.ordered}/result`).set(authed(adminToken))).status).toBe(404); // chưa làm
      expect((await http().get(`${base('lab')}/items/${items.img}/result`).set(authed(adminToken))).status).toBe(404); // CĐHA qua đường xét nghiệm
      expect((await http().get(`${base('imaging')}/items/${items.img}/result`).set(authed(adminToken))).status).toBe(200);
      expect((await http().get(`${base('lab')}/items/${items.o1}/result`).set(authed(tenantBAdminToken))).status).toBe(404);
    });

    it('in kết quả ghi nhật ký "đã in"; kết quả của bệnh nhân khác → 404 và không ghi gì', async () => {
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'paraclinical_result.printed' } });
      const ok = await http().post(`${base('lab')}/items/${items.o3}/result/print`).set(authed(adminToken)).send({});
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'paraclinical_result.printed' } })).toBe(before + 1);
      const wrong = await http().post(`${base('lab')}/items/${items.other}/result/print`).set(authed(adminToken)).send({});
      expect(wrong.status).toBe(404);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'paraclinical_result.printed' } })).toBe(before + 1);
    });
  });
});
