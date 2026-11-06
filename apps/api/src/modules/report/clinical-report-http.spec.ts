import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { vietnamDayStartUtc } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — trang báo cáo "Chuyên môn" (`/reports/clinical/*`, docs/DECISIONS.md #287). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong tháng 09/2026 (đã qua, nên kết quả
 * không đổi theo ngày chạy). Trọng tâm: chẩn đoán CHÍNH hiện hành của lượt ĐÃ HOÀN TẤT (không tính mã phụ, lượt huỷ, mã đã bị thay khi đính chính); gom theo chương; cận lâm sàng — không tính
 * dòng đã huỷ, thời gian trả kết quả đến lần duyệt ĐẦU TIÊN (kể cả bản gốc đã bị thay khi đính chính), quá hạn theo thời gian đặt ở dịch vụ (dịch vụ chưa đặt thì không xét); phạm vi nhiều chi nhánh cần `company_report.read`;
 * cô lập CHI NHÁNH và CÔNG TY; chỉ quản lý (`clinical_report.read`) xem được; Excel + nhật ký.
 */
describe('HTTP e2e — Chuyên môn (/api/v1/reports/clinical)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let adminToken: string;
  let viewerToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let tenantBAdminToken: string;
  let branchA: string;
  let branchB: string;
  type IcdRow = { code: string; nameVi: string; chapterCode: string; chapterName: string; blockCode: string; blockName: string; groupCode: string; groupName: string };
  let x1: IcdRow;
  let x2: IcdRow;
  const icdCodes = () => [x1?.code, x2?.code].filter((c): c is string => !!c);
  let patientOfI3 = '';

  const SEP = 'from=2026-09-01&to=2026-09-30';
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const get = (token: string, path: string, query = SEP) => http().get(`/api/v1/reports/clinical/${path}?${query}`).set(authed(token));

  async function makePatient(): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    return (
      await privileged.patient.create({
        data: { tenantId: fixture.tenantA.id, patientCode: `BN-CM-${n}`, fullName: `Bệnh nhân chuyên môn ${n}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      })
    ).id;
  }

  async function makeEncounter(opts: { patientId?: string; at: Date; branchId?: string; status?: 'COMPLETED' | 'CANCELLED' }): Promise<{ id: string; patientId: string }> {
    const patientId = opts.patientId ?? (await makePatient());
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const e = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId,
        departmentId: department.id,
        encounterNo: `LK-CM-${randomUUID().slice(0, 10)}`,
        status: opts.status ?? 'COMPLETED',
        checkedInAt: opts.at,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return { id: e.id, patientId };
  }

  async function diagnose(encounterId: string, code: string, type: 'PRIMARY' | 'SECONDARY', deleted = false) {
    await privileged.diagnosis.create({
      data: { tenantId: fixture.tenantA.id, encounterId, icd10Code: code, type, deletedAt: deleted ? new Date() : null, deletedReason: deleted ? 'Đính chính' : null, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
  }

  async function service(name: string, kind: 'LAB' | 'IMAGING' | 'FUNCTIONAL', turnaroundMinutes: number | null): Promise<string> {
    return (await privileged.technicalService.create({ data: { tenantId: fixture.tenantA.id, code: `DV-${randomUUID().slice(0, 8)}`, name, serviceKind: kind, turnaroundMinutes, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
  }

  /** Một chỉ định; `signedAt` có thì ghi kết quả hiện hành đã duyệt vào lúc đó. */
  async function orderItem(
    encounterId: string,
    spec: { name: string; serviceId?: string; external?: boolean; status: 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'; createdAt: Date; signedAt?: Date },
  ): Promise<string> {
    // Mỗi lượt khám chỉ có MỘT phiếu chỉ định (ràng buộc DB) — các chỉ định sau dùng lại phiếu đó.
    const order =
      (await privileged.clinicalOrder.findFirst({ where: { tenantId: fixture.tenantA.id, encounterId } })) ??
      (await privileged.clinicalOrder.create({ data: { tenantId: fixture.tenantA.id, orderNo: `CLS-CM-${randomUUID().slice(0, 8)}`, encounterId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } }));
    const item = await privileged.clinicalOrderItem.create({
      data: {
        tenantId: fixture.tenantA.id,
        clinicalOrderId: order.id,
        itemKind: spec.external ? 'FREE_TEXT' : 'TECHNICAL_SERVICE',
        freeTextName: spec.external ? spec.name : null,
        technicalServiceId: spec.external ? null : (spec.serviceId ?? null),
        name: spec.name,
        performance: spec.external ? 'EXTERNAL' : 'IN_HOUSE',
        ...(spec.external ? {} : { unitPrice: 100_000n, priceTypeCode: 'THUONG', unitCode: 'LUOT' }),
        status: spec.status,
        createdAt: spec.createdAt,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    if (spec.signedAt) {
      await privileged.paraclinicalResult.create({ data: { tenantId: fixture.tenantA.id, clinicalOrderItemId: item.id, resultedAt: new Date(spec.signedAt.getTime() - 5 * 60_000), signedAt: spec.signedAt, signedBy: SYSTEM_TEST_ACTOR, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    return item.id;
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

    fixture = await createTwoTenantFixture(privileged, 'Clinical report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZCM2', name: 'Chi nhánh B chuyên môn', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'cm-admin', [branchA]);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-chuyen-mon-chi-nhanh', [['clinical_report', 'read']]);
    const viewer = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'cm-viewer', [branchA]);
    viewerToken = await h.login(fixture.tenantA.id, viewer.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'cm-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'cm-doctor', [branchA]);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'cm-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    // Hai mã ICD-10 riêng của lần chạy này, thuộc HAI chương khác nhau (danh mục ICD-10 dùng chung, không theo công ty — dọn ở afterAll).
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const make = (suffix: string, chapter: string): IcdRow => ({ code: `ZQ${tag}${suffix}`, nameVi: `Bệnh thử ${suffix} ${tag}`, chapterCode: `ZZ${tag}${chapter}`, chapterName: `Chương thử ${chapter}`, blockCode: `ZB${tag}${chapter}`, blockName: `Nhóm thử ${chapter}`, groupCode: `ZG${tag}${chapter}`, groupName: `Mã thử ${chapter}` });
    [x1, x2] = [make('1', 'A'), make('2', 'B')];
    await privileged.icd10Catalog.createMany({ data: [x1, x2] });

    // ── Chẩn đoán (chi nhánh A, tháng 09/2026) ──
    const p1 = await makePatient();
    const e1 = await makeEncounter({ patientId: p1, at: at('2026-09-10', '09:00') });
    await diagnose(e1.id, x1.code, 'PRIMARY');
    const e2 = await makeEncounter({ patientId: p1, at: at('2026-09-11', '09:00') });
    await diagnose(e2.id, x1.code, 'PRIMARY');
    const e8 = await makeEncounter({ at: at('2026-09-12', '09:00') });
    await diagnose(e8.id, x1.code, 'PRIMARY');
    const e3 = await makeEncounter({ at: at('2026-09-13', '09:00') });
    await diagnose(e3.id, x2.code, 'PRIMARY');
    await diagnose(e3.id, x1.code, 'SECONDARY'); // mã phụ — không tính
    await makeEncounter({ at: at('2026-09-13', '10:00') }); // E4: hoàn tất nhưng chưa có chẩn đoán
    const e5 = await makeEncounter({ at: at('2026-09-14', '09:00'), status: 'CANCELLED' });
    await diagnose(e5.id, x1.code, 'PRIMARY'); // lượt huỷ — không tính
    const e7 = await makeEncounter({ at: at('2026-09-15', '09:00') });
    await diagnose(e7.id, x1.code, 'PRIMARY', true); // mã gốc đã bị thay khi đính chính
    await diagnose(e7.id, x2.code, 'PRIMARY');
    // Chi nhánh B: một lượt có mã x2 — chỉ thấy khi gộp.
    const e6 = await makeEncounter({ at: at('2026-09-16', '09:00'), branchId: branchB });
    await diagnose(e6.id, x2.code, 'PRIMARY');

    // ── Cận lâm sàng ──
    const lab = await service('Xét nghiệm thử', 'LAB', 60);
    const imaging = await service('Siêu âm thử', 'IMAGING', 30);
    const functional = await service('Điện tim thử', 'FUNCTIONAL', null);
    const t0 = at('2026-09-10', '09:05');
    const plus = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
    // i1: duyệt lần đầu sau 45 phút (trong hạn), sau đó ĐÍNH CHÍNH lúc 120 phút — bản gốc bị xoá mềm, bản đính chính là bản hiện hành. Thời gian trả vẫn là 45 phút.
    const i1 = await orderItem(e1.id, { name: 'Công thức máu thử', serviceId: lab, status: 'COMPLETED', createdAt: t0 });
    const original = await privileged.paraclinicalResult.create({ data: { tenantId: fixture.tenantA.id, clinicalOrderItemId: i1, resultedAt: plus(40), signedAt: plus(45), signedBy: SYSTEM_TEST_ACTOR, deletedAt: new Date(), deletedReason: 'Đính chính', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await privileged.paraclinicalResult.create({ data: { tenantId: fixture.tenantA.id, clinicalOrderItemId: i1, resultedAt: plus(115), signedAt: plus(120), signedBy: SYSTEM_TEST_ACTOR, supersedesId: original.id, amendmentReason: 'Sửa số liệu', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await orderItem(e2.id, { name: 'Công thức máu thử', serviceId: lab, status: 'COMPLETED', createdAt: t0, signedAt: plus(90) }); // trả muộn
    await orderItem(e3.id, { name: 'Công thức máu thử', serviceId: lab, status: 'ORDERED', createdAt: t0 }); // đang chờ, đã quá hạn
    patientOfI3 = (await privileged.encounter.findFirstOrThrow({ where: { id: e3.id } })).patientId;
    await orderItem(e8.id, { name: 'Siêu âm bụng thử', serviceId: imaging, status: 'COMPLETED', createdAt: t0, signedAt: plus(20) });
    await orderItem(e8.id, { name: 'Điện tim thử', serviceId: functional, status: 'IN_PROGRESS', createdAt: t0 }); // không đặt thời gian trả → không xét quá hạn
    await orderItem(e1.id, { name: 'Chụp X-quang ngoài', external: true, status: 'ORDERED', createdAt: t0 });
    await orderItem(e2.id, { name: 'Công thức máu thử', serviceId: lab, status: 'CANCELLED', createdAt: t0 }); // đã huỷ — không tính
    await orderItem(e6.id, { name: 'Công thức máu thử', serviceId: lab, status: 'COMPLETED', createdAt: t0, signedAt: plus(30) }); // chi nhánh B
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.icd10Catalog.deleteMany({ where: { code: { in: icdCodes() } } });
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền và kiểm tra đầu vào', () => {
    it('chưa đăng nhập → 401; lễ tân và bác sĩ → 403; quản trị và vai trò có clinical_report.read → 200, cho cả 2 báo cáo', async () => {
      for (const path of ['diagnoses', 'paraclinical']) {
        expect((await http().get(`/api/v1/reports/clinical/${path}?${SEP}`)).status, path).toBe(401);
        expect((await get(receptionistToken, path)).status, path).toBe(403);
        expect((await get(doctorToken, path)).status, path).toBe(403);
        expect((await get(adminToken, path)).status, path).toBe(200);
        expect((await get(viewerToken, path)).status, path).toBe(200);
      }
    });

    it('khoảng ngày sai → lỗi kiểm tra đầu vào, không phải 500', async () => {
      for (const q of ['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-09-01', 'from=2026-02-31&to=2026-03-01', 'from=2026-09-01']) {
        for (const path of ['diagnoses', 'paraclinical']) expect([400, 422], `${path} ${q}`).toContain((await get(adminToken, path, q)).status);
      }
    });
  });

  describe('Cơ cấu chẩn đoán ICD-10', () => {
    it('chỉ mã CHÍNH hiện hành của lượt đã hoàn tất; số lượt, số bệnh nhân, tỉ lệ; tên từ danh mục; thiếu chẩn đoán được đếm riêng', async () => {
      const res = await get(adminToken, 'diagnoses');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.branchCount).toBe(1);
      expect(d.summary).toEqual({ completedVisits: 6, withDiagnosis: 5, withoutDiagnosis: 1, distinctCodes: 2, topCode: x1.code, topCodeName: x1.nameVi });
      // x1: e1, e2 (cùng một bệnh nhân), e8 → 3 lượt, 2 bệnh nhân. x2: e3 và e7 (đã đính chính) → 2 lượt.
      expect(d.rows).toEqual([
        { code: x1.code, name: x1.nameVi, visits: 3, patients: 2, percent: 60 },
        { code: x2.code, name: x2.nameVi, visits: 2, patients: 2, percent: 40 },
      ]);
      expect(d.chapters).toEqual([
        { chapterCode: x1.chapterCode, chapterName: expect.any(String), visits: 3, percent: 60 },
        { chapterCode: x2.chapterCode, chapterName: expect.any(String), visits: 2, percent: 40 },
      ]);
    });

    it('kỳ không có lượt khám → rỗng, tỉ lệ null', async () => {
      const d = (await get(adminToken, 'diagnoses', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(d.summary).toEqual({ completedVisits: 0, withDiagnosis: 0, withoutDiagnosis: 0, distinctCodes: 0, topCode: null, topCodeName: '' });
      expect(d.rows).toEqual([]);
      expect(d.chapters).toEqual([]);
    });
  });

  describe('Cận lâm sàng', () => {
    it('số chỉ định (không tính dòng đã huỷ), tại phòng khám/ra ngoài, đã trả, chưa trả, trung bình phút đến lần duyệt ĐẦU TIÊN (đính chính không làm trễ), quá hạn', async () => {
      const res = await get(adminToken, 'paraclinical');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      // Tại phòng khám: 3 xét nghiệm + 1 siêu âm + 1 điện tim = 5, ra ngoài 1. Đã trả 3 (45, 90, 20 phút → trung bình 52). Quá hạn: 1 trả muộn (90 > 60) + 1 đang chờ quá hạn.
      expect(d.summary).toEqual({ ordered: 6, inHouse: 5, external: 1, completed: 3, pending: 2, avgMinutes: 52, overdue: 2, overdueOpen: 1, lateCompleted: 1 });
      const byKind = Object.fromEntries(d.byKind.map((k: { kind: string }) => [k.kind, k]));
      expect(d.byKind.map((k: { kind: string }) => k.kind)).toEqual(['LAB', 'IMAGING', 'FUNCTIONAL', 'OTHER']);
      expect(byKind.LAB).toEqual({ kind: 'LAB', ordered: 3, inHouse: 3, external: 0, completed: 2, avgMinutes: 68, overdue: 2 });
      expect(byKind.IMAGING).toEqual({ kind: 'IMAGING', ordered: 1, inHouse: 1, external: 0, completed: 1, avgMinutes: 20, overdue: 0 });
      expect(byKind.FUNCTIONAL).toEqual({ kind: 'FUNCTIONAL', ordered: 1, inHouse: 1, external: 0, completed: 0, avgMinutes: null, overdue: 0 });
      expect(byKind.OTHER).toEqual({ kind: 'OTHER', ordered: 1, inHouse: 0, external: 1, completed: 0, avgMinutes: null, overdue: 0 });
    });

    it('dịch vụ chỉ định nhiều nhất gộp cùng tên; chỉ định đang chờ quá hạn có người bệnh, thời gian đặt và thời gian đã chờ', async () => {
      const d = (await get(adminToken, 'paraclinical')).body.data;
      expect(d.topServices[0]).toEqual({ name: 'Công thức máu thử', kind: 'LAB', ordered: 3, completed: 2, avgMinutes: 68, overdue: 2 });
      expect(d.overdueItems).toHaveLength(1);
      const o = d.overdueItems[0];
      expect(o).toMatchObject({ serviceName: 'Công thức máu thử', kind: 'LAB', turnaroundMinutes: 60, branchName: expect.any(String) });
      expect(o.patientCode).toBe((await privileged.patient.findFirstOrThrow({ where: { id: patientOfI3 } })).patientCode);
      expect(o.waitedMinutes).toBeGreaterThan(60 * 24);
      expect(new Date(o.orderedAt).getTime()).toBe(at('2026-09-10', '09:05').getTime());
    });

    it('kỳ không có chỉ định → mọi số 0, trung bình null, danh sách rỗng', async () => {
      const d = (await get(adminToken, 'paraclinical', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(d.summary).toMatchObject({ ordered: 0, completed: 0, pending: 0, avgMinutes: null, overdue: 0 });
      expect(d.byKind).toEqual([]);
      expect(d.topServices).toEqual([]);
      expect(d.overdueItems).toEqual([]);
    });
  });

  describe('phạm vi nhiều chi nhánh', () => {
    it('chi nhánh đang làm chỉ thấy số của mình; gộp mới thấy chi nhánh B (có company_report.read)', async () => {
      const dxAll = (await get(adminToken, 'diagnoses', `${SEP}&scope=all`)).body.data;
      expect(dxAll.branchCount).toBeGreaterThanOrEqual(2);
      expect(dxAll.summary).toMatchObject({ completedVisits: 7, withDiagnosis: 6 });
      expect(dxAll.rows.find((r: { code: string }) => r.code === x2.code).visits).toBe(3);
      const clsAll = (await get(adminToken, 'paraclinical', `${SEP}&scope=all`)).body.data;
      expect(clsAll.summary).toMatchObject({ ordered: 7, completed: 4 });
      const pickB = (await get(adminToken, 'paraclinical', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(pickB.summary).toMatchObject({ ordered: 1, completed: 1, avgMinutes: 30, overdue: 0 });
      expect(pickB.overdueItems).toEqual([]);
    });

    it('thiếu company_report.read: scope=all và scope=pick đều 403 dù tự gửi tham số', async () => {
      for (const path of ['diagnoses', 'paraclinical']) {
        expect((await get(viewerToken, path, `${SEP}&scope=all`)).status, path).toBe(403);
        expect((await get(viewerToken, path, `${SEP}&scope=pick&branchIds=${branchB}`)).status, path).toBe(403);
      }
      expect((await get(viewerToken, 'diagnoses')).body.data.summary.completedVisits).toBe(6);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào', async () => {
      expect([400, 422]).toContain((await get(adminToken, 'diagnoses', `${SEP}&scope=pick`)).status);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0 ở cả 2 báo cáo; không đọc được chi nhánh của công ty này (404)', async () => {
      expect((await get(tenantBAdminToken, 'diagnoses')).body.data).toMatchObject({ summary: { completedVisits: 0, withDiagnosis: 0 }, rows: [], chapters: [] });
      expect((await get(tenantBAdminToken, 'paraclinical')).body.data).toMatchObject({ summary: { ordered: 0 }, byKind: [], overdueItems: [] });
      expect((await get(tenantBAdminToken, 'diagnoses', `${SEP}&scope=pick&branchIds=${branchA}`)).status).toBe(404);
    });
  });

  describe('xuất Excel', () => {
    async function readSheet(buffer: Buffer): Promise<{ names: string[]; text: string }> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const text = wb.worksheets.map((s) => s.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|')).join('\n');
      return { names: wb.worksheets.map((s) => s.name), text };
    }

    it('2 báo cáo xuất được, tên sheet đúng, số khớp màn hình', async () => {
      const cases: Array<[string, string, string[]]> = [
        ['diagnoses', 'Cơ cấu chẩn đoán ICD-10', [x1.code, x2.code, 'THEO CHƯƠNG ICD-10']],
        ['paraclinical', 'Cận lâm sàng', ['Công thức máu thử', 'Xét nghiệm', 'Chẩn đoán hình ảnh', 'ĐANG CHỜ VÀ ĐÃ QUÁ HẠN']],
      ];
      for (const [path, sheetName, expected] of cases) {
        const res = await h.download(`/api/v1/reports/clinical/${path}/export?${SEP}`, adminToken);
        expect(res.status, path).toBe(200);
        expect(res.headers['content-type'], path).toContain('spreadsheetml');
        const sheet = await readSheet(res.body as Buffer);
        expect(sheet.names, path).toEqual([sheetName]);
        for (const token of expected) expect(sheet.text, `${path} ${token}`).toContain(token);
      }
    });

    it('ghi nhật ký xuất đúng chi nhánh đã đọc; thiếu quyền → 403 và không ghi nhật ký mới', async () => {
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'clinical_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('clinical_report_export');
      expect(JSON.stringify(audit?.afterJson)).toContain(branchA);
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'clinical_report.exported' } });
      expect((await h.download(`/api/v1/reports/clinical/paraclinical/export?${SEP}`, doctorToken)).status).toBe(403);
      expect((await h.download(`/api/v1/reports/clinical/diagnoses/export?${SEP}&scope=all`, viewerToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'clinical_report.exported' } })).toBe(before);
    });
  });
});
