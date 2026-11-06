import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { diffDateStrings, getVietnamDateString, vietnamDayStartUtc } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — trang báo cáo "Chất lượng và tuân thủ" (`/reports/quality/*`, docs/DECISIONS.md #290). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong tháng 09/2026 (đã qua). Trọng tâm:
 * "Lượt khám chưa hoàn tất" là ảnh chụp đến HÔM NAY (chỉ lượt chờ khám/đang khám từ các ngày trước, ca thu ngân mở từ các ngày trước, phiếu chưa thu của lượt từ các ngày trước — lượt hôm nay,
 * lượt đã hoàn tất/huỷ không tính); "Liên thông đơn thuốc" theo ngày ký đơn (đã gửi gồm cả bản sửa; tồn = chờ gửi + cổng từ chối); phạm vi nhiều chi nhánh cần `company_report.read`; cô lập CHI NHÁNH
 * và CÔNG TY; chỉ quản lý (`quality_report.read`) xem được; Excel + nhật ký.
 */
describe('HTTP e2e — Chất lượng và tuân thủ (/api/v1/reports/quality)', () => {
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
  let docA: string;
  let docB: string;
  const enc: Record<string, { id: string; no: string; patientCode: string }> = {};
  const sub: Record<string, string> = {};

  const SEP = 'from=2026-09-01&to=2026-09-30';
  const today = getVietnamDateString(new Date());
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const daysTo = (date: string): number => diffDateStrings(date, today) ?? -1;
  const get = (token: string, path: string, query = SEP) => http().get(`/api/v1/reports/quality/${path}?${query}`).set(authed(token));

  async function makeEncounter(key: string, opts: { at: Date; status: 'CHECKED_IN' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED'; branchId?: string; doctorId?: string }) {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patientCode = `BN-QL-${n}`;
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode, fullName: `Bệnh nhân chất lượng ${key} ${n}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const no = `LK-QL-${randomUUID().slice(0, 10)}`;
    const e = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId: patient.id,
        doctorId: opts.doctorId ?? null,
        departmentId: department.id,
        encounterNo: no,
        status: opts.status,
        checkedInAt: opts.at,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    enc[key] = { id: e.id, no, patientCode };
    return e.id;
  }

  async function makeInvoice(encounterId: string, status: 'UNPAID' | 'PAID' | 'CANCELLED') {
    await privileged.invoice.create({
      data: { tenantId: fixture.tenantA.id, encounterId, invoiceNo: `PT-QL-${randomUUID().slice(0, 10)}`, status, totalAmount: 500_000n, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
  }

  async function makeShift(cashierId: string, openedAt: Date, branchId: string) {
    await privileged.cashierShift.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        shiftNo: `CA-QL-${randomUUID().slice(0, 8)}`,
        cashierId,
        shiftLabel: 'Ca thử',
        status: 'OPEN',
        openedAt,
        openingFloatActual: 0n,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  async function makeSubmission(
    key: string,
    opts: { signedAt: Date; status: 'PENDING' | 'SENT' | 'FAILED' | 'AMENDED'; doctorId: string; branchId?: string; attempts?: number; lastHttpStatus?: number; errors?: string[] },
  ) {
    const branchId = opts.branchId ?? branchA;
    const encounterId = await makeEncounter(`sub-${key}`, { at: opts.signedAt, status: 'COMPLETED', branchId, doctorId: opts.doctorId });
    const prescription = await privileged.prescription.create({ data: { tenantId: fixture.tenantA.id, encounterId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    // Ràng buộc DB: 12 chữ số + '-' + loại đơn (C/N/H/Y), ký tự cuối khớp `kind`.
    const nationalCode = `${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}-C`;
    const doc = await privileged.prescriptionDocument.create({ data: { tenantId: fixture.tenantA.id, prescriptionId: prescription.id, kind: 'C', nationalCode, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const row = await privileged.prescriptionSubmission.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        encounterId,
        prescriptionDocumentId: doc.id,
        nationalCode,
        kind: 'C',
        doctorUserId: opts.doctorId,
        signedAt: opts.signedAt,
        status: opts.status,
        attempts: opts.attempts ?? 0,
        lastHttpStatus: opts.lastHttpStatus ?? null,
        errors: opts.errors ?? [],
        // Ràng buộc DB: SENT/AMENDED có giờ gửi, trạng thái khác thì không.
        sentAt: opts.status === 'SENT' || opts.status === 'AMENDED' ? new Date(opts.signedAt.getTime() + 60_000) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    sub[key] = row.id;
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

    fixture = await createTwoTenantFixture(privileged, 'Quality report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZQL2', name: 'Chi nhánh B chất lượng', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'ql-admin', [branchA]);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-chat-luong-chi-nhanh', [['quality_report', 'read']]);
    const viewer = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'ql-viewer', [branchA]);
    viewerToken = await h.login(fixture.tenantA.id, viewer.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'ql-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'ql-doctor-a', [branchA, branchB]);
    docA = doctor.id;
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    docB = (await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'ql-doctor-b', [branchA, branchB])).id;
    const cashier1 = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'ql-cashier-1', [branchA]);
    const cashier2 = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'ql-cashier-2', [branchA]);
    const cashier3 = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'ql-cashier-3', [branchB]);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'ql-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    // ── Lượt khám (chi nhánh A) ──
    await makeEncounter('s1', { at: at('2026-09-10', '09:00'), status: 'CHECKED_IN' }); // chờ khám từ ngày trước → treo
    await makeEncounter('s2', { at: at('2026-09-20', '09:00'), status: 'IN_CONSULTATION', doctorId: docA }); // đang khám từ ngày trước → treo
    const s3 = await makeEncounter('s3', { at: at('2026-09-10', '10:00'), status: 'COMPLETED' }); // đã hoàn tất → không treo
    const s4 = await makeEncounter('s4', { at: at('2026-09-11', '10:00'), status: 'CANCELLED' }); // đã huỷ → không treo
    const s5 = await makeEncounter('s5', { at: new Date(), status: 'CHECKED_IN' }); // hôm nay → chưa phải "từ ngày trước"
    // Chi nhánh B: một lượt treo và một phiếu chưa thu — chỉ thấy khi gộp.
    const s6 = await makeEncounter('s6', { at: at('2026-09-15', '09:00'), status: 'CHECKED_IN', branchId: branchB });
    // ── Phiếu thu: chỉ phiếu CHƯA THU của lượt từ ngày trước mới tính ──
    await makeInvoice(s3, 'UNPAID');
    await makeInvoice(s4, 'CANCELLED');
    await makeInvoice(s5, 'UNPAID');
    await makeInvoice(s6, 'UNPAID');
    // ── Ca thu ngân: chỉ ca MỞ từ ngày trước mới tính ──
    await makeShift(cashier1.id, at('2026-09-10', '07:30'), branchA);
    await makeShift(cashier2.id, new Date(), branchA);
    await makeShift(cashier3.id, at('2026-09-12', '07:30'), branchB);

    // ── Liên thông đơn thuốc ──
    await makeSubmission('p1', { signedAt: at('2026-09-10', '09:30'), status: 'SENT', doctorId: docA });
    await makeSubmission('p2', { signedAt: at('2026-09-11', '09:30'), status: 'AMENDED', doctorId: docA });
    await makeSubmission('p3', { signedAt: at('2026-09-12', '09:30'), status: 'PENDING', doctorId: docB, errors: ['Chưa đủ dữ liệu để gửi'] });
    await makeSubmission('p4', { signedAt: at('2026-09-13', '09:30'), status: 'FAILED', doctorId: docB, attempts: 3, lastHttpStatus: 400, errors: ['Mã thuốc không hợp lệ', 'Thiếu tuổi bệnh nhân'] });
    await makeSubmission('p5', { signedAt: at('2026-10-05', '09:30'), status: 'SENT', doctorId: docA }); // ngoài kỳ tháng 9
    await makeSubmission('p6', { signedAt: at('2026-09-14', '09:30'), status: 'PENDING', doctorId: docB, branchId: branchB }); // chi nhánh B
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền và kiểm tra đầu vào', () => {
    it('chưa đăng nhập → 401; lễ tân và bác sĩ → 403; quản trị và vai trò có quality_report.read → 200, cho cả 2 báo cáo', async () => {
      for (const path of ['incomplete', 'interop']) {
        expect((await http().get(`/api/v1/reports/quality/${path}?${SEP}`)).status, path).toBe(401);
        expect((await get(receptionistToken, path)).status, path).toBe(403);
        expect((await get(doctorToken, path)).status, path).toBe(403);
        expect((await get(adminToken, path)).status, path).toBe(200);
        expect((await get(viewerToken, path)).status, path).toBe(200);
      }
    });

    it('Liên thông: khoảng ngày sai → lỗi kiểm tra đầu vào, không phải 500', async () => {
      for (const q of ['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-09-01', 'from=2026-02-31&to=2026-03-01', 'from=2026-09-01']) {
        expect([400, 422], q).toContain((await get(adminToken, 'interop', q)).status);
      }
    });
  });

  describe('Lượt khám chưa hoàn tất', () => {
    it('chỉ lượt chờ khám/đang khám từ ngày trước (cũ nhất trước); không tính lượt hôm nay, đã hoàn tất, đã huỷ; số ngày treo tính đến hôm nay', async () => {
      const res = await get(adminToken, 'incomplete');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.asOf).toBe(today);
      expect(d.branchCount).toBe(1);
      expect(d.encounters.map((r: { encounterNo: string }) => r.encounterNo)).toEqual([enc.s1!.no, enc.s2!.no]);
      expect(d.encounters[0]).toMatchObject({ status: 'CHECKED_IN', visitDate: '2026-09-10', daysOpen: daysTo('2026-09-10'), doctorName: null, patientCode: enc.s1!.patientCode });
      expect(d.encounters[1]).toMatchObject({ status: 'IN_CONSULTATION', visitDate: '2026-09-20', daysOpen: daysTo('2026-09-20') });
      expect(d.encounters[1].doctorName).toEqual(expect.any(String));
      expect(d.summary).toMatchObject({ staleEncounters: 2, oldestEncounterDays: daysTo('2026-09-10') });
    });

    it('ca thu ngân mở từ ngày trước; phiếu chưa thu của lượt từ ngày trước (không tính phiếu hôm nay, đã huỷ, chi nhánh khác)', async () => {
      const d = (await get(adminToken, 'incomplete')).body.data;
      expect(d.summary).toMatchObject({ openShifts: 1, unpaidInvoices: 1 });
      expect(d.shifts).toHaveLength(1);
      expect(d.shifts[0]).toMatchObject({ daysOpen: daysTo('2026-09-10'), cashierName: expect.any(String) });
      expect(new Date(d.shifts[0].openedAt).getTime()).toBe(at('2026-09-10', '07:30').getTime());
    });

    it('là ảnh chụp đến hôm nay: tham số from/to gửi kèm bị bỏ qua', async () => {
      const d = (await get(adminToken, 'incomplete', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(d.summary.staleEncounters).toBe(2);
    });
  });

  describe('Liên thông đơn thuốc', () => {
    it('tổng quan theo ngày ký: đã gửi gồm bản sửa, chờ gửi, cổng từ chối; không tính đơn ngoài kỳ và chi nhánh khác', async () => {
      const res = await get(adminToken, 'interop');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.branchCount).toBe(1);
      expect(d.summary).toEqual({ total: 4, sent: 2, pending: 1, failed: 1, sentPercent: 50, oldestUnsentDays: daysTo('2026-09-12') });
      // Bác sĩ B có 2 đơn tồn nên đứng trước bác sĩ A (2 đơn đã gửi hết).
      expect(d.byDoctor.map((r: { total: number; sent: number; pending: number; failed: number }) => [r.total, r.sent, r.pending, r.failed])).toEqual([
        [2, 0, 1, 1],
        [2, 2, 0, 0],
      ]);
    });

    it('danh sách đơn tồn: cũ nhất trước, kèm số lần thử, mã lỗi HTTP và nguyên văn lỗi', async () => {
      const d = (await get(adminToken, 'interop')).body.data;
      expect(d.problemTotal).toBe(2);
      expect(d.problems.map((r: { encounterNo: string }) => r.encounterNo)).toEqual([enc['sub-p3']!.no, enc['sub-p4']!.no]);
      expect(d.problems[0]).toMatchObject({ status: 'PENDING', attempts: 0, lastHttpStatus: null, errors: ['Chưa đủ dữ liệu để gửi'], nextAttemptAt: null, patientCode: enc['sub-p3']!.patientCode });
      expect(d.problems[1]).toMatchObject({ status: 'FAILED', attempts: 3, lastHttpStatus: 400, errors: ['Mã thuốc không hợp lệ', 'Thiếu tuổi bệnh nhân'] });
      expect(d.problems[0].nationalCode).toMatch(/^\d{12}-C$/);
    });

    it('kỳ không có đơn nào → mọi số 0, tỉ lệ null, danh sách rỗng', async () => {
      const d = (await get(adminToken, 'interop', 'from=2026-01-01&to=2026-01-31')).body.data;
      expect(d.summary).toEqual({ total: 0, sent: 0, pending: 0, failed: 0, sentPercent: null, oldestUnsentDays: null });
      expect(d.byDoctor).toEqual([]);
      expect(d.problems).toEqual([]);
    });
  });

  describe('phạm vi nhiều chi nhánh', () => {
    it('chi nhánh đang làm chỉ thấy số của mình; gộp mới thấy chi nhánh B (có company_report.read)', async () => {
      const inc = (await get(adminToken, 'incomplete', 'scope=all')).body.data;
      expect(inc.branchCount).toBeGreaterThanOrEqual(2);
      expect(inc.summary).toMatchObject({ staleEncounters: 3, openShifts: 2, unpaidInvoices: 2 });
      const interop = (await get(adminToken, 'interop', `${SEP}&scope=all`)).body.data;
      expect(interop.summary).toMatchObject({ total: 5, pending: 2 });
      const pickB = (await get(adminToken, 'interop', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(pickB.summary).toMatchObject({ total: 1, pending: 1 });
      expect(pickB.problems[0].branchName).toBe('Chi nhánh B chất lượng');
    });

    it('thiếu company_report.read: scope=all và scope=pick đều 403 dù tự gửi tham số', async () => {
      for (const path of ['incomplete', 'interop']) {
        expect((await get(viewerToken, path, `${SEP}&scope=all`)).status, path).toBe(403);
        expect((await get(viewerToken, path, `${SEP}&scope=pick&branchIds=${branchB}`)).status, path).toBe(403);
      }
      expect((await get(viewerToken, 'interop')).body.data.summary.total).toBe(4);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào', async () => {
      expect([400, 422]).toContain((await get(adminToken, 'interop', `${SEP}&scope=pick`)).status);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0 ở cả 2 báo cáo; không đọc được chi nhánh của công ty này (404)', async () => {
      expect((await get(tenantBAdminToken, 'incomplete')).body.data).toMatchObject({ summary: { staleEncounters: 0, openShifts: 0, unpaidInvoices: 0 }, encounters: [], shifts: [] });
      expect((await get(tenantBAdminToken, 'interop')).body.data).toMatchObject({ summary: { total: 0 }, problems: [] });
      expect((await get(tenantBAdminToken, 'interop', `${SEP}&scope=pick&branchIds=${branchA}`)).status).toBe(404);
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
        ['incomplete', 'Lượt khám chưa hoàn tất', [enc.s1!.no, enc.s2!.no, 'Đang khám', 'CA-QL-', 'LƯỢT KHÁM TREO']],
        ['interop', 'Liên thông đơn thuốc', [enc['sub-p4']!.no, 'Cổng từ chối', 'Mã thuốc không hợp lệ; Thiếu tuổi bệnh nhân', 'THEO BÁC SĨ']],
      ];
      for (const [path, sheetName, expected] of cases) {
        const res = await h.download(`/api/v1/reports/quality/${path}/export?${SEP}`, adminToken);
        expect(res.status, path).toBe(200);
        expect(res.headers['content-type'], path).toContain('spreadsheetml');
        const sheet = await readSheet(res.body as Buffer);
        expect(sheet.names, path).toEqual([sheetName]);
        for (const token of expected) expect(sheet.text, `${path} ${token}`).toContain(token);
      }
    });

    it('ghi nhật ký xuất đúng chi nhánh đã đọc; thiếu quyền → 403 và không ghi nhật ký mới', async () => {
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'quality_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('quality_report_export');
      expect(JSON.stringify(audit?.afterJson)).toContain(branchA);
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'quality_report.exported' } });
      expect((await h.download(`/api/v1/reports/quality/interop/export?${SEP}`, doctorToken)).status).toBe(403);
      expect((await h.download(`/api/v1/reports/quality/incomplete/export?scope=all`, viewerToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'quality_report.exported' } })).toBe(before);
    });
  });
});
