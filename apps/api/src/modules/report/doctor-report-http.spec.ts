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
 * HTTP e2e — trang báo cáo "Bác sĩ" (`/reports/doctors/*`, docs/DECISIONS.md #287). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong tháng 09/2026 (đã qua, nên kết quả không đổi
 * theo ngày chạy). Trọng tâm: số liệu từng tab đúng định nghĩa (chỉ lượt ĐÃ HOÀN TẤT có bác sĩ; doanh thu ghi nhận sau chiết khấu; chỉ định đã huỷ không tính; ca đã xếp trừ giờ nghỉ; chỉ nghỉ phép
 * ĐÃ DUYỆT); lọc Khoa; phạm vi nhiều chi nhánh cần `company_report.read`; cô lập CHI NHÁNH và CÔNG TY; chỉ quản lý (`doctor_report.read`) xem được — bác sĩ và lễ tân bị chặn; Excel + nhật ký.
 */
describe('HTTP e2e — Bác sĩ (/api/v1/reports/doctors)', () => {
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
  let adminId: string;
  let docA: string;
  let docB: string;
  let docC: string;
  let deptNoi: string;
  let deptNhi: string;

  const SEP = 'from=2026-09-01&to=2026-09-30';
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const get = (token: string, path: string, query = SEP) => http().get(`/api/v1/reports/doctors/${path}?${query}`).set(authed(token));

  async function makeEncounter(opts: { doctorId: string | null; at: Date; minutes?: number; status?: 'COMPLETED' | 'CANCELLED'; branchId?: string }): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-DR-${n}`, fullName: `Bệnh nhân bác sĩ ${n}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const e = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId: patient.id,
        doctorId: opts.doctorId,
        departmentId: department.id,
        encounterNo: `LK-DR-${randomUUID().slice(0, 10)}`,
        status: opts.status ?? 'COMPLETED',
        checkedInAt: opts.at,
        startedAt: opts.minutes === undefined ? null : opts.at,
        completedAt: opts.minutes === undefined ? null : new Date(opts.at.getTime() + opts.minutes * 60_000),
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return e.id;
  }

  async function makeInvoice(encounterId: string, opts: { status: 'UNPAID' | 'PAID'; total: number; discountPercent?: number }) {
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        invoiceNo: `PT-DR-${randomUUID().slice(0, 10)}`,
        status: opts.status,
        totalAmount: BigInt(opts.total),
        discountType: opts.discountPercent ? 'PERCENT' : null,
        discountValue: opts.discountPercent ? BigInt(opts.discountPercent) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const item = await privileged.encounterServiceItem.create({
      data: { tenantId: fixture.tenantA.id, encounterId, examTypeCode: 'KHAM', examTypeName: 'Khám nội', examTypePrice: BigInt(opts.total), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.invoiceLine.create({
      data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, sourceServiceItemId: item.id, examTypeCode: 'KHAM', examTypeName: 'Khám nội', unitPrice: BigInt(opts.total), quantity: 1, lineTotal: BigInt(opts.total), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
  }

  /** Dịch vụ kỹ thuật cho dòng chỉ định tại phòng khám (ràng buộc DB: dòng kiểu dịch vụ kỹ thuật phải trỏ tới một dịch vụ có thật). */
  async function technicalService(name: string): Promise<string> {
    const created = await privileged.technicalService.create({ data: { tenantId: fixture.tenantA.id, code: `DV-${randomUUID().slice(0, 8)}`, name, serviceKind: 'LAB', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return created.id;
  }

  async function makeOrder(encounterId: string, items: Array<{ name: string; performance: 'IN_HOUSE' | 'EXTERNAL'; status?: 'ORDERED' | 'CANCELLED' }>) {
    const order = await privileged.clinicalOrder.create({ data: { tenantId: fixture.tenantA.id, orderNo: `CLS-DR-${randomUUID().slice(0, 8)}`, encounterId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const [index, spec] of items.entries()) {
      await privileged.clinicalOrderItem.create({
        data: {
          tenantId: fixture.tenantA.id,
          clinicalOrderId: order.id,
          // Ràng buộc DB: tên tự do chỉ cho chỉ định RA NGOÀI; dòng tại phòng khám là dịch vụ kỹ thuật.
          itemKind: spec.performance === 'EXTERNAL' ? 'FREE_TEXT' : 'TECHNICAL_SERVICE',
          freeTextName: spec.performance === 'EXTERNAL' ? spec.name : null,
          technicalServiceId: spec.performance === 'EXTERNAL' ? null : (await technicalService(spec.name)),
          name: spec.name,
          performance: spec.performance,
          ...(spec.performance === 'IN_HOUSE' ? { unitPrice: 100_000n, priceTypeCode: 'THUONG', unitCode: 'LUOT' } : {}),
          status: spec.status ?? 'ORDERED',
          sortOrder: index,
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
    }
  }

  async function makePrescription(encounterId: string, items: Array<{ drugId?: string; freeText?: string }>) {
    const prescription = await privileged.prescription.create({ data: { tenantId: fixture.tenantA.id, encounterId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const spec of items) {
      await privileged.prescriptionItem.create({
        data: { tenantId: fixture.tenantA.id, prescriptionId: prescription.id, drugId: spec.drugId ?? null, freeTextDrugName: spec.freeText ?? null, doseMorning: 1, durationDays: 3, quantity: 3, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
  }

  async function makeFollowUp(encounterId: string) {
    await privileged.encounterTreatmentPlan.create({
      data: { tenantId: fixture.tenantA.id, encounterId, directions: ['FOLLOW_UP'], followUpDate: new Date('2026-10-20'), signedAt: new Date(), signedBy: SYSTEM_TEST_ACTOR, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
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

    fixture = await createTwoTenantFixture(privileged, 'Doctor report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZDR2', name: 'Chi nhánh B bác sĩ', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
    deptNoi = (await privileged.department.create({ data: { tenantId: fixture.tenantA.id, name: 'Khoa Nội e2e', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
    deptNhi = (await privileged.department.create({ data: { tenantId: fixture.tenantA.id, name: 'Khoa Nhi e2e', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'dr-admin', [branchA]);
    adminId = admin.id;
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    // Vai trò xem được báo cáo bác sĩ nhưng KHÔNG có `company_report.read`: chỉ xem chi nhánh đang làm.
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-bac-si-chi-nhanh', [['doctor_report', 'read']]);
    const viewer = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'dr-viewer', [branchA]);
    viewerToken = await h.login(fixture.tenantA.id, viewer.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'dr-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'dr-doctor-a', [branchA, branchB]);
    docA = doctor.id;
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    docB = (await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'dr-doctor-b', [branchA])).id;
    docC = (await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'dr-doctor-c', [branchA])).id;
    await privileged.userAccount.updateMany({ where: { tenantId: fixture.tenantA.id, id: docA }, data: { departmentId: deptNoi } });
    await privileged.userAccount.updateMany({ where: { tenantId: fixture.tenantA.id, id: docB }, data: { departmentId: deptNhi } });
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'dr-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    const drugId = await h.createDrug(adminToken);

    // ── Bác sĩ A (Nội), chi nhánh A, tháng 09/2026 ──
    // E1: 10/09 09:00, khám 20 phút, phiếu ĐÃ THU 500.000; chỉ định 1 tại phòng khám + 1 ra ngoài; đơn 3 dòng (1 thuốc danh mục + 2 tên tự do); có hẹn tái khám.
    const e1 = await makeEncounter({ doctorId: docA, at: at('2026-09-10', '09:00'), minutes: 20 });
    await makeInvoice(e1, { status: 'PAID', total: 500_000 });
    await makeOrder(e1, [{ name: 'Công thức máu', performance: 'IN_HOUSE' }, { name: 'Chụp X-quang ngoài', performance: 'EXTERNAL' }]);
    await makePrescription(e1, [{ drugId }, { freeText: 'Thuốc tự do X' }, { freeText: 'Thuốc tự do Y' }]);
    await makeFollowUp(e1);
    // E2: 10/09 14:00, khám 10 phút, phiếu CHƯA THU 600.000 giảm 10% = 540.000; đơn 1 dòng; không chỉ định, không hẹn tái khám.
    const e2 = await makeEncounter({ doctorId: docA, at: at('2026-09-10', '14:00'), minutes: 10 });
    await makeInvoice(e2, { status: 'UNPAID', total: 600_000, discountPercent: 10 });
    await makePrescription(e2, [{ drugId }]);
    // E3: 11/09, khám 15 phút, không phiếu, không gì cả.
    await makeEncounter({ doctorId: docA, at: at('2026-09-11', '10:00'), minutes: 15 });
    // Không tính: lượt đã huỷ có phiếu, lượt hoàn tất chưa gán bác sĩ có phiếu.
    await makeEncounter({ doctorId: docA, at: at('2026-09-12', '09:00'), status: 'CANCELLED' }).then((e) => makeInvoice(e, { status: 'PAID', total: 777_000 }));
    await makeEncounter({ doctorId: null, at: at('2026-09-12', '10:00'), minutes: 5 }).then((e) => makeInvoice(e, { status: 'PAID', total: 888_000 }));
    // ── Bác sĩ B (Nhi): E4 12/09, khám 30 phút, phiếu ĐÃ THU 1.000.000; chỉ định ĐÃ HUỶ (không tính) ──
    const e4 = await makeEncounter({ doctorId: docB, at: at('2026-09-12', '09:00'), minutes: 30 });
    await makeInvoice(e4, { status: 'PAID', total: 1_000_000 });
    await makeOrder(e4, [{ name: 'Siêu âm bụng', performance: 'IN_HOUSE', status: 'CANCELLED' }]);
    // ── Chi nhánh B: bác sĩ A khám 15/09, phiếu 400.000 — chỉ thấy khi gộp chi nhánh ──
    const e5 = await makeEncounter({ doctorId: docA, at: at('2026-09-15', '09:00'), minutes: 12, branchId: branchB });
    await makeInvoice(e5, { status: 'PAID', total: 400_000 });

    // ── Lịch làm việc chi nhánh A ──
    const shiftBase = { tenantId: fixture.tenantA.id, color: 'blue', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR };
    const morning = await privileged.workShift.create({ data: { ...shiftBase, name: 'Ca sáng dr', code: `CS${randomUUID().slice(0, 6)}`, startTime: '08:00', endTime: '12:00' } });
    const afternoon = await privileged.workShift.create({ data: { ...shiftBase, name: 'Ca chiều dr', code: `CC${randomUUID().slice(0, 6)}`, startTime: '13:00', endTime: '17:00', restMinutes: 30 } });
    const assign = (userId: string, workShiftId: string, workDate: string) =>
      privileged.workShiftAssignment.create({ data: { tenantId: fixture.tenantA.id, branchId: branchA, userId, workShiftId, workDate: new Date(workDate), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await assign(docA, morning.id, '2026-09-10');
    await assign(docA, morning.id, '2026-09-11');
    await assign(docA, afternoon.id, '2026-09-10');
    // Người không phải bác sĩ có ca — không được xuất hiện trong báo cáo giờ làm việc.
    await assign(adminId, morning.id, '2026-09-10');
    const leave = (date: string, status: string, startMinute: number, endMinute: number) =>
      privileged.leaveRequest.create({ data: { tenantId: fixture.tenantA.id, branchId: branchA, userId: docA, leaveDate: new Date(date), workShiftId: null, startMinute, endMinute, status, reason: 'Nghỉ e2e', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await leave('2026-09-12', 'APPROVED', 480, 720);
    await leave('2026-09-13', 'PENDING', 480, 720);
    await leave('2026-10-02', 'APPROVED', 480, 720);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  const row = <T extends { doctorId: string }>(rows: T[], id: string): T | undefined => rows.find((r) => r.doctorId === id);

  describe('phân quyền và kiểm tra đầu vào', () => {
    it('chưa đăng nhập → 401; lễ tân và bác sĩ → 403; quản trị và vai trò có doctor_report.read → 200, cho cả 3 báo cáo', async () => {
      for (const path of ['performance', 'order-mix', 'hours']) {
        expect((await http().get(`/api/v1/reports/doctors/${path}?${SEP}`)).status, path).toBe(401);
        expect((await get(receptionistToken, path)).status, path).toBe(403);
        expect((await get(doctorToken, path)).status, path).toBe(403);
        expect((await get(adminToken, path)).status, path).toBe(200);
        expect((await get(viewerToken, path)).status, path).toBe(200);
      }
    });

    it('khoảng ngày sai và mã Khoa sai định dạng → lỗi kiểm tra đầu vào, không phải 500', async () => {
      for (const q of ['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-09-01', 'from=2026-02-31&to=2026-03-01', 'from=2026-09-01', `${SEP}&departmentId=khong-phai-uuid`]) {
        expect([400, 422], q).toContain((await get(adminToken, 'performance', q)).status);
      }
    });
  });

  describe('Hiệu suất theo bác sĩ', () => {
    it('chỉ lượt ĐÃ HOÀN TẤT có bác sĩ; phút/lượt; doanh thu ghi nhận sau chiết khấu; tỉ lệ có CLS/thuốc/hẹn tái khám; xếp theo doanh thu', async () => {
      const res = await get(adminToken, 'performance');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.branchCount).toBe(1);
      expect(d.rows.map((r: { doctorId: string }) => r.doctorId)).toEqual([docA, docB]);
      expect(row<{ doctorId: string }>(d.rows, docA)).toMatchObject({ rank: 1, departmentId: deptNoi, departmentName: 'Khoa Nội e2e', visits: 3, avgMinutes: 15, revenue: 1_040_000, revenuePerVisit: 346_667, clsPercent: 33.3, drugPercent: 66.7, followUpPercent: 33.3 });
      expect(row<{ doctorId: string }>(d.rows, docB)).toMatchObject({ rank: 2, departmentName: 'Khoa Nhi e2e', visits: 1, avgMinutes: 30, revenue: 1_000_000, revenuePerVisit: 1_000_000, clsPercent: 0, drugPercent: 0, followUpPercent: 0 });
      expect(d.totals).toMatchObject({ doctorCount: 2, visits: 4, visitsPerDoctor: 2, avgMinutes: 19, revenue: 2_040_000, revenuePerVisit: 510_000, clsPercent: 25, drugPercent: 50, followUpPercent: 25 });
    });

    it('lọc theo Khoa: chỉ bác sĩ của Khoa đó và số cộng tính lại', async () => {
      const d = (await get(adminToken, 'performance', `${SEP}&departmentId=${deptNhi}`)).body.data;
      expect(d.rows.map((r: { doctorId: string }) => r.doctorId)).toEqual([docB]);
      expect(d.totals).toMatchObject({ doctorCount: 1, visits: 1, revenue: 1_000_000 });
    });

    it('kỳ không có lượt khám nào → danh sách rỗng, mọi tỉ lệ null', async () => {
      const d = (await get(adminToken, 'performance', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(d.rows).toEqual([]);
      expect(d.totals).toMatchObject({ doctorCount: 0, visits: 0, visitsPerDoctor: null, avgMinutes: null, revenuePerVisit: null, clsPercent: null });
    });
  });

  describe('Cơ cấu kê đơn và chỉ định', () => {
    it('đếm lượt có thuốc, dòng thuốc, chỉ định tại phòng khám/ra ngoài (không tính dòng đã huỷ), hẹn tái khám', async () => {
      const d = (await get(adminToken, 'order-mix')).body.data;
      expect(d.rows.map((r: { doctorId: string }) => r.doctorId)).toEqual([docA, docB]);
      expect(row<{ doctorId: string }>(d.rows, docA)).toMatchObject({ visits: 3, withPrescription: 2, prescriptionItems: 4, itemsPerPrescription: 2, withCls: 1, clsInHouse: 1, clsExternal: 1, withFollowUp: 1 });
      expect(row<{ doctorId: string }>(d.rows, docB)).toMatchObject({ visits: 1, withPrescription: 0, prescriptionItems: 0, itemsPerPrescription: null, withCls: 0, clsInHouse: 0, clsExternal: 0, withFollowUp: 0 });
      expect(d.totals).toMatchObject({ visits: 4, withPrescription: 2, prescriptionItems: 4, itemsPerPrescription: 2, withCls: 1, clsInHouse: 1, clsExternal: 1, withFollowUp: 1 });
    });

    it('thuốc kê nhiều nhất (tên danh mục + tên tự do) và chỉ định nhiều nhất; dòng đã huỷ không có mặt', async () => {
      const d = (await get(adminToken, 'order-mix')).body.data;
      expect(d.topDrugs[0]).toEqual({ name: 'Paracetamol 500mg', count: 2, doctorCount: 1 });
      expect(d.topDrugs.map((x: { name: string }) => x.name).sort()).toEqual(['Paracetamol 500mg', 'Thuốc tự do X', 'Thuốc tự do Y']);
      expect(d.topOrders.map((x: { name: string }) => x.name).sort()).toEqual(['Chụp X-quang ngoài', 'Công thức máu']);
      expect(d.topOrders.every((x: { count: number; doctorCount: number }) => x.count === 1 && x.doctorCount === 1)).toBe(true);
    });

    it('lọc theo Khoa Nhi: không còn thuốc hay chỉ định của bác sĩ Nội', async () => {
      const d = (await get(adminToken, 'order-mix', `${SEP}&departmentId=${deptNhi}`)).body.data;
      expect(d.rows.map((r: { doctorId: string }) => r.doctorId)).toEqual([docB]);
      expect(d.topDrugs).toEqual([]);
      expect(d.topOrders).toEqual([]);
    });
  });

  describe('Giờ làm việc và lượt khám', () => {
    it('ca đã xếp (trừ giờ nghỉ), nghỉ phép ĐÃ DUYỆT trong kỳ, ngày/lượt/phút khám thực tế, tỉ lệ sử dụng; bác sĩ không có ca vẫn hiện', async () => {
      const d = (await get(adminToken, 'hours')).body.data;
      // 2 ca sáng (240) + ca chiều 240 − nghỉ 30 = 210 → 690 phút trên 2 ngày có ca.
      expect(row<{ doctorId: string }>(d.rows, docA)).toMatchObject({
        departmentName: 'Khoa Nội e2e',
        scheduledDays: 2,
        scheduledMinutes: 690,
        leaveDays: 1,
        leaveMinutes: 240,
        activeDays: 2,
        visits: 3,
        visitsPerActiveDay: 1.5,
        consultMinutes: 45,
        utilizationPercent: 6.5,
      });
      expect(row<{ doctorId: string }>(d.rows, docB)).toMatchObject({ scheduledDays: 0, scheduledMinutes: 0, activeDays: 1, visits: 1, consultMinutes: 30, utilizationPercent: null });
      expect(row<{ doctorId: string }>(d.rows, docC)).toMatchObject({ scheduledDays: 0, leaveDays: 0, activeDays: 0, visits: 0, visitsPerActiveDay: null, consultMinutes: 0, utilizationPercent: null });
      expect(d.rows.some((r: { doctorId: string }) => r.doctorId === adminId)).toBe(false);
      expect(d.totals.utilizationPercent).toBe(6.5);
      expect(d.totals.doctorCount).toBeGreaterThanOrEqual(3);
    });

    it('lọc theo Khoa Nhi: chỉ bác sĩ Khoa Nhi (kể cả khi không có ca)', async () => {
      const d = (await get(adminToken, 'hours', `${SEP}&departmentId=${deptNhi}`)).body.data;
      expect(d.rows.map((r: { doctorId: string }) => r.doctorId)).toEqual([docB]);
    });
  });

  describe('phạm vi nhiều chi nhánh', () => {
    it('chi nhánh đang làm chỉ thấy số của mình; gộp mới thấy lượt ở chi nhánh B (có company_report.read)', async () => {
      const own = (await get(adminToken, 'performance')).body.data;
      expect(row<{ doctorId: string }>(own.rows, docA)).toMatchObject({ visits: 3, revenue: 1_040_000 });
      const all = (await get(adminToken, 'performance', `${SEP}&scope=all`)).body.data;
      expect(all.branchCount).toBeGreaterThanOrEqual(2);
      expect(row<{ doctorId: string }>(all.rows, docA)).toMatchObject({ visits: 4, revenue: 1_440_000 });
      const pickB = (await get(adminToken, 'performance', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(pickB.rows.map((r: { doctorId: string }) => r.doctorId)).toEqual([docA]);
      expect(pickB.totals).toMatchObject({ visits: 1, revenue: 400_000 });
    });

    it('thiếu company_report.read: scope=all và scope=pick đều 403 dù tự gửi tham số', async () => {
      for (const path of ['performance', 'order-mix', 'hours']) {
        expect((await get(viewerToken, path, `${SEP}&scope=all`)).status, path).toBe(403);
        expect((await get(viewerToken, path, `${SEP}&scope=pick&branchIds=${branchB}`)).status, path).toBe(403);
      }
      const own = await get(viewerToken, 'performance');
      expect(own.status).toBe(200);
      expect(own.body.data.branchCount).toBe(1);
      expect(own.body.data.totals.revenue).toBe(2_040_000);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào', async () => {
      expect([400, 422]).toContain((await get(adminToken, 'performance', `${SEP}&scope=pick`)).status);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0 ở cả 3 báo cáo; không đọc được chi nhánh của công ty này (404)', async () => {
      expect((await get(tenantBAdminToken, 'performance')).body.data).toMatchObject({ rows: [], totals: { visits: 0 } });
      expect((await get(tenantBAdminToken, 'order-mix')).body.data).toMatchObject({ rows: [], topDrugs: [], topOrders: [] });
      expect((await get(tenantBAdminToken, 'hours')).body.data.rows.some((r: { doctorId: string }) => r.doctorId === docA)).toBe(false);
      expect((await get(tenantBAdminToken, 'performance', `${SEP}&scope=pick&branchIds=${branchA}`)).status).toBe(404);
    });
  });

  describe('xuất Excel', () => {
    async function readSheet(buffer: Buffer): Promise<{ names: string[]; text: string }> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const text = wb.worksheets.map((s) => s.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|')).join('\n');
      return { names: wb.worksheets.map((s) => s.name), text };
    }

    it('3 báo cáo xuất được, tên sheet đúng, ô tiền ghi SỐ khớp màn hình, đầu báo cáo ghi Khoa đang lọc', async () => {
      const cases: Array<[string, string, string[]]> = [
        ['performance', 'Hiệu suất theo bác sĩ', ['1040000', '1000000', '2040000']],
        ['order-mix', 'Cơ cấu kê đơn và chỉ định', ['Paracetamol 500mg', 'Chụp X-quang ngoài']],
        ['hours', 'Giờ làm việc và lượt khám', ['690', '240']],
      ];
      for (const [path, sheetName, expected] of cases) {
        const res = await h.download(`/api/v1/reports/doctors/${path}/export?${SEP}`, adminToken);
        expect(res.status, path).toBe(200);
        expect(res.headers['content-type'], path).toContain('spreadsheetml');
        const sheet = await readSheet(res.body as Buffer);
        expect(sheet.names, path).toEqual([sheetName]);
        for (const token of expected) expect(sheet.text, `${path} ${token}`).toContain(token);
      }
      const filtered = await h.download(`/api/v1/reports/doctors/performance/export?${SEP}&departmentId=${deptNhi}`, adminToken);
      expect((await readSheet(filtered.body as Buffer)).text).toContain('Khoa: Khoa Nhi e2e');
    });

    it('ghi nhật ký xuất đúng chi nhánh đã đọc; thiếu quyền → 403 và không ghi nhật ký mới', async () => {
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'doctor_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('doctor_report_export');
      expect(JSON.stringify(audit?.afterJson)).toContain(branchA);
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'doctor_report.exported' } });
      expect((await h.download(`/api/v1/reports/doctors/performance/export?${SEP}`, doctorToken)).status).toBe(403);
      expect((await h.download(`/api/v1/reports/doctors/performance/export?${SEP}&scope=all`, viewerToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'doctor_report.exported' } })).toBe(before);
    });
  });
});
