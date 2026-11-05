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
 * HTTP e2e — trang báo cáo "Thuốc và vật tư" (`/reports/pharmacy/*`, docs/DECISIONS.md #287). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định trong tháng 09/2026 (đã qua, nên kết quả
 * không đổi theo ngày chạy). Trọng tâm: Đã phát (chỉ phiếu xuất bán theo đơn đã ghi sổ, phiếu huỷ không tính, khách trả lại trừ ra); Lãi gộp (tiền bán sau chiết khấu trừ phần hoàn, giá vốn thẻ kho,
 * hàng trả nhập lại kho trả vốn, phiếu đã huỷ/hoàn không tính, ngoài kỳ không tính); Kiểm soát đặc biệt (chỉ thuốc có phân loại, tồn đầu kỳ/nhập/phát/xuất khác/cuối kỳ, từng lượt phát);
 * phạm vi nhiều chi nhánh cần `company_report.read`; cô lập CHI NHÁNH và CÔNG TY; chỉ `pharmacy_report.read` xem được; Excel + nhật ký.
 */
describe('HTTP e2e — Thuốc và vật tư (/api/v1/reports/pharmacy)', () => {
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
  let warehouseA: string;
  let warehouseB: string;
  let para: string;
  let glove: string;
  let morphin: string;
  let diazepam: string;
  let morphinIssueNo: string;
  let morphinPatientCode: string;

  const SEP = 'from=2026-09-01&to=2026-09-30';
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const get = (token: string, path: string, query = SEP) => http().get(`/api/v1/reports/pharmacy/${path}?${query}`).set(authed(token));
  const byCode = <T extends { code: string }>(rows: T[], code: string): T | undefined => rows.find((r) => r.code === code);

  async function makeDrug(code: string, name: string, extra: { itemType?: 'MEDICINE' | 'SUPPLY'; controlType?: 'NORMAL' | 'NARCOTIC' | 'PSYCHOTROPIC' } = {}): Promise<string> {
    const d = await privileged.drug.create({
      data: { tenantId: fixture.tenantA.id, code, name, itemType: extra.itemType ?? 'MEDICINE', controlType: extra.controlType ?? 'NORMAL', baseUnitCode: 'VIEN', isBatchManaged: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return d.id;
  }

  async function makeWarehouse(branchId: string, code: string): Promise<string> {
    const w = await privileged.warehouse.create({ data: { tenantId: fixture.tenantA.id, branchId, code, name: `Kho ${code}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return w.id;
  }

  async function makeEncounter(opts: { at: Date; branchId?: string }): Promise<{ encounterId: string; patientCode: string }> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patientCode = `BN-PH-${n}`;
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode, fullName: `Bệnh nhân thuốc ${n}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const e = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId: patient.id,
        departmentId: department.id,
        encounterNo: `LK-PH-${randomUUID().slice(0, 10)}`,
        status: 'COMPLETED',
        checkedInAt: opts.at,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return { encounterId: e.id, patientCode };
  }

  interface SaleLine {
    drugId: string;
    quantity: number;
    sellPrice: number;
    unitCost: number;
  }

  /**
   * Một lượt bán thuốc: lượt khám + đơn thuốc + phiếu xuất bán theo đơn + hoá đơn (có thể kèm một dòng khám 300.000). Trả về id dòng hoá đơn thuốc theo thứ tự `lines` để dựng hoàn tiền.
   */
  async function makeSale(opts: {
    date: string;
    branchId?: string;
    warehouseId: string;
    lines: SaleLine[];
    invoiceStatus?: 'UNPAID' | 'PAID' | 'CANCELLED' | 'REFUNDED';
    discountPercent?: number;
    withExamLine?: boolean;
    issueStatus?: 'POSTED' | 'VOIDED';
  }): Promise<{ invoiceLineIds: string[]; issueNo: string; patientCode: string }> {
    const when = at(opts.date, '09:30');
    const { encounterId, patientCode } = await makeEncounter({ at: when, branchId: opts.branchId });
    const prescription = await privileged.prescription.create({ data: { tenantId: fixture.tenantA.id, encounterId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const issueNo = `PX-PH-${randomUUID().slice(0, 10)}`;
    const voided = opts.issueStatus === 'VOIDED';
    const issue = await privileged.stockIssue.create({
      data: {
        tenantId: fixture.tenantA.id,
        issueNo,
        warehouseId: opts.warehouseId,
        prescriptionId: prescription.id,
        issueType: 'RETAIL_SALE',
        status: opts.issueStatus ?? 'POSTED',
        occurredAt: when,
        totalAmount: BigInt(opts.lines.reduce((s, l) => s + l.quantity * l.sellPrice, 0)),
        ...(voided ? { voidedBy: SYSTEM_TEST_ACTOR, voidedAt: when, voidReason: 'Huỷ thử' } : {}),
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const drugTotal = opts.lines.reduce((s, l) => s + l.quantity * l.sellPrice, 0);
    const examTotal = opts.withExamLine ? 300_000 : 0;
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        invoiceNo: `PT-PH-${randomUUID().slice(0, 10)}`,
        status: opts.invoiceStatus ?? 'PAID',
        totalAmount: BigInt(drugTotal + examTotal),
        discountType: opts.discountPercent ? 'PERCENT' : null,
        discountValue: opts.discountPercent ? BigInt(opts.discountPercent) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    if (opts.withExamLine) {
      const item = await privileged.encounterServiceItem.create({
        data: { tenantId: fixture.tenantA.id, encounterId, examTypeCode: 'KHAM', examTypeName: 'Khám nội', examTypePrice: 300_000n, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      await privileged.invoiceLine.create({
        data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, sourceServiceItemId: item.id, examTypeCode: 'KHAM', examTypeName: 'Khám nội', unitPrice: 300_000n, quantity: 1, lineTotal: 300_000n, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    const invoiceLineIds: string[] = [];
    for (const line of opts.lines) {
      const issueLine = await privileged.stockIssueLine.create({
        data: {
          tenantId: fixture.tenantA.id,
          issueId: issue.id,
          drugId: line.drugId,
          quantity: line.quantity,
          unitCost: BigInt(line.unitCost),
          sellPrice: BigInt(line.sellPrice),
          lineAmount: BigInt(line.quantity * line.sellPrice),
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
      const drug = await privileged.drug.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, id: line.drugId } });
      const invoiceLine = await privileged.invoiceLine.create({
        data: {
          tenantId: fixture.tenantA.id,
          invoiceId: invoice.id,
          sourceStockIssueLineId: issueLine.id,
          examTypeCode: drug.code,
          examTypeName: drug.name,
          unitPrice: BigInt(line.sellPrice),
          quantity: line.quantity,
          lineTotal: BigInt(line.quantity * line.sellPrice),
          // Huỷ phiếu xuất (chỉ khi phiếu thu còn chưa thu) xoá mềm dòng hoá đơn tương ứng.
          ...(voided ? { deletedAt: when, deletedReason: 'Huỷ phiếu xuất' } : {}),
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
      invoiceLineIds.push(invoiceLine.id);
    }
    return { invoiceLineIds, issueNo, patientCode };
  }

  /** Hoàn một phần theo dòng thuốc (#203): `restocked` = có nhập lại kho. */
  async function refundLine(invoiceLineId: string, opts: { quantity: number; amount: number; restocked: boolean }) {
    const line = await privileged.invoiceLine.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, id: invoiceLineId } });
    const refund = await privileged.invoiceRefund.create({
      data: { tenantId: fixture.tenantA.id, invoiceId: line.invoiceId, refundNo: `PHT-PH-${randomUUID().slice(0, 8)}`, reason: 'Khách trả thuốc', refundedAt: at('2026-09-20', '10:00'), totalAmount: BigInt(opts.amount), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    // Ràng buộc DB: dòng hoàn có nhập lại kho phải trỏ tới phiếu nhập hoàn trả; không nhập lại thì không được có phiếu.
    const receipt = opts.restocked
      ? await privileged.stockReceipt.create({
          data: { tenantId: fixture.tenantA.id, receiptNo: `PN-PH-${randomUUID().slice(0, 8)}`, warehouseId: warehouseA, receiptType: 'RETURN_FROM_USE', status: 'POSTED', occurredAt: at('2026-09-20', '10:00'), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
        })
      : null;
    await privileged.invoiceRefundLine.create({
      data: { tenantId: fixture.tenantA.id, refundId: refund.id, invoiceLineId, quantity: opts.quantity, amount: BigInt(opts.amount), restocked: opts.restocked, stockReceiptId: receipt?.id ?? null, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
  }

  async function ledger(drugId: string, warehouseId: string, quantityChange: number, reason: 'RECEIPT_PURCHASE' | 'ISSUE_RETAIL_SALE' | 'RECEIPT_RETURN_FROM_USE' | 'ISSUE_WRITE_OFF', date: string) {
    await privileged.stockLedger.create({
      data: { tenantId: fixture.tenantA.id, drugId, warehouseId, quantityChange, unitCost: 1000n, reason, occurredAt: at(date, '08:00'), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
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

    fixture = await createTwoTenantFixture(privileged, 'Pharmacy report e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZPH2', name: 'Chi nhánh B thuốc', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
    warehouseA = await makeWarehouse(branchA, 'ZZPHA');
    warehouseB = await makeWarehouse(branchB, 'ZZPHB');

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'ph-admin', [branchA]);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    // Vai trò xem được báo cáo thuốc nhưng KHÔNG có `company_report.read`: chỉ xem chi nhánh đang làm.
    const viewerRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'bao-cao-thuoc-chi-nhanh', [['pharmacy_report', 'read']]);
    const viewer = await h.createUser(fixture.tenantA.id, { id: viewerRole }, 'ph-viewer', [branchA]);
    viewerToken = await h.login(fixture.tenantA.id, viewer.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'ph-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'ph-doctor', [branchA]);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'ph-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    para = await makeDrug('PH-PARA', 'Paracetamol 500mg');
    glove = await makeDrug('PH-GANG', 'Găng tay y tế', { itemType: 'SUPPLY' });
    morphin = await makeDrug('PH-MOR', 'Morphin 10mg', { controlType: 'NARCOTIC' });
    diazepam = await makeDrug('PH-DIA', 'Diazepam 5mg', { controlType: 'PSYCHOTROPIC' });

    // ── Chi nhánh A, tháng 09/2026 ──
    // S1: 10/09, phiếu ĐÃ THU: khám 300.000 + Paracetamol 100 × 1.000 (vốn 500) + Găng tay 10 × 2.000 (vốn 1.300).
    await makeSale({ date: '2026-09-10', warehouseId: warehouseA, withExamLine: true, lines: [{ drugId: para, quantity: 100, sellPrice: 1000, unitCost: 500 }, { drugId: glove, quantity: 10, sellPrice: 2000, unitCost: 1300 }] });
    // S2: 11/09, phiếu CHƯA THU giảm 10%: Paracetamol 50 × 1.000 (vốn 500) → phải thu 45.000.
    await makeSale({ date: '2026-09-11', warehouseId: warehouseA, invoiceStatus: 'UNPAID', discountPercent: 10, lines: [{ drugId: para, quantity: 50, sellPrice: 1000, unitCost: 500 }] });
    // S3: 12/09, Morphin 5 × 20.000 (vốn 12.000); hoàn 2 viên (40.000) và NHẬP LẠI KHO.
    const s3 = await makeSale({ date: '2026-09-12', warehouseId: warehouseA, lines: [{ drugId: morphin, quantity: 5, sellPrice: 20_000, unitCost: 12_000 }] });
    await refundLine(s3.invoiceLineIds[0]!, { quantity: 2, amount: 40_000, restocked: true });
    morphinIssueNo = s3.issueNo;
    morphinPatientCode = s3.patientCode;
    // Không tính: phiếu xuất ĐÃ HUỶ, phiếu hoá đơn ĐÃ HUỶ, phiếu ĐÃ HOÀN toàn phần.
    await makeSale({ date: '2026-09-13', warehouseId: warehouseA, issueStatus: 'VOIDED', lines: [{ drugId: para, quantity: 999, sellPrice: 1000, unitCost: 500 }] });
    await makeSale({ date: '2026-09-14', warehouseId: warehouseA, invoiceStatus: 'CANCELLED', lines: [{ drugId: glove, quantity: 7, sellPrice: 2000, unitCost: 1300 }] });
    await makeSale({ date: '2026-09-14', warehouseId: warehouseA, invoiceStatus: 'REFUNDED', lines: [{ drugId: glove, quantity: 3, sellPrice: 2000, unitCost: 1300 }] });
    // Ngoài kỳ (tháng 10): không được vào báo cáo tháng 09.
    await makeSale({ date: '2026-10-05', warehouseId: warehouseA, lines: [{ drugId: para, quantity: 1000, sellPrice: 1000, unitCost: 500 }] });
    // ── Chi nhánh B: Paracetamol 20 × 1.000 (vốn 600) — chỉ thấy khi gộp chi nhánh ──
    await makeSale({ date: '2026-09-15', branchId: branchB, warehouseId: warehouseB, lines: [{ drugId: para, quantity: 20, sellPrice: 1000, unitCost: 600 }] });

    // ── Thẻ kho thuốc kiểm soát đặc biệt (kho A) ──
    // Morphin: đầu kỳ 50; trong kỳ nhập 20 + nhận lại 2 (hoàn tiền nhập lại kho), phát 5, huỷ 3 → cuối kỳ 64.
    await ledger(morphin, warehouseA, 50, 'RECEIPT_PURCHASE', '2026-08-20');
    await ledger(morphin, warehouseA, 20, 'RECEIPT_PURCHASE', '2026-09-05');
    await ledger(morphin, warehouseA, -5, 'ISSUE_RETAIL_SALE', '2026-09-12');
    await ledger(morphin, warehouseA, 2, 'RECEIPT_RETURN_FROM_USE', '2026-09-12');
    await ledger(morphin, warehouseA, -3, 'ISSUE_WRITE_OFF', '2026-09-20');
    // Sau kỳ: không được tính vào tồn cuối kỳ tháng 09.
    await ledger(morphin, warehouseA, -9, 'ISSUE_WRITE_OFF', '2026-10-02');
    // Diazepam: chỉ nhập 10 trong kỳ, chưa phát lượt nào.
    await ledger(diazepam, warehouseA, 10, 'RECEIPT_PURCHASE', '2026-09-08');
    // Thuốc thường có thẻ kho — không được vào báo cáo kiểm soát đặc biệt.
    await ledger(para, warehouseA, 500, 'RECEIPT_PURCHASE', '2026-09-01');
    // Kho chi nhánh B: Morphin nhập 7 — chỉ thấy khi gộp chi nhánh.
    await ledger(morphin, warehouseB, 7, 'RECEIPT_PURCHASE', '2026-09-14');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền và kiểm tra đầu vào', () => {
    it('chưa đăng nhập → 401; lễ tân và bác sĩ → 403; quản trị và vai trò có pharmacy_report.read → 200, cho cả 3 báo cáo', async () => {
      for (const path of ['dispensed', 'margin', 'controlled']) {
        expect((await http().get(`/api/v1/reports/pharmacy/${path}?${SEP}`)).status, path).toBe(401);
        expect((await get(receptionistToken, path)).status, path).toBe(403);
        expect((await get(doctorToken, path)).status, path).toBe(403);
        expect((await get(adminToken, path)).status, path).toBe(200);
        expect((await get(viewerToken, path)).status, path).toBe(200);
      }
    });

    it('khoảng ngày sai, Loại và Phân loại lạ → lỗi kiểm tra đầu vào, không phải 500', async () => {
      for (const q of ['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-09-01', 'from=2026-02-31&to=2026-03-01', 'from=2026-09-01', `${SEP}&itemType=KHAC`]) {
        expect([400, 422], q).toContain((await get(adminToken, 'dispensed', q)).status);
        expect([400, 422], q).toContain((await get(adminToken, 'margin', q)).status);
      }
      expect([400, 422]).toContain((await get(adminToken, 'controlled', `${SEP}&controlType=KHAC`)).status);
    });
  });

  describe('Đã phát', () => {
    it('chỉ phiếu xuất bán theo đơn đã ghi sổ trong kỳ; khách trả lại trừ ra; xếp theo giá trị thực phát', async () => {
      const res = await get(adminToken, 'dispensed');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.branchCount).toBe(1);
      expect(d.itemType).toBe('ALL');
      expect(d.rows.map((r: { code: string }) => r.code)).toEqual(['PH-PARA', 'PH-MOR', 'PH-GANG']);
      expect(byCode(d.rows, 'PH-PARA')).toMatchObject({ itemType: 'MEDICINE', quantity: 150, returnedQuantity: 0, netQuantity: 150, issueCount: 2, amount: 150_000 });
      expect(byCode(d.rows, 'PH-MOR')).toMatchObject({ quantity: 5, returnedQuantity: 2, netQuantity: 3, issueCount: 1, amount: 60_000 });
      // Phiếu thuộc hoá đơn đã huỷ/đã hoàn vẫn là hàng đã xuất khỏi kho: phiếu xuất còn hiệu lực nên vẫn tính vào Đã phát (chỉ phiếu xuất ĐÃ HUỶ mới bị loại).
      expect(byCode(d.rows, 'PH-GANG')).toMatchObject({ itemType: 'SUPPLY', quantity: 20, issueCount: 3, amount: 40_000 });
      expect(d).toMatchObject({ itemCount: 3, issueCount: 5, amount: 250_000, returnedAmount: 40_000 });
    });

    it('lọc theo Loại: Vật tư y tế chỉ có găng tay; Thuốc không có găng tay; tổng khớp bộ lọc', async () => {
      const supply = (await get(adminToken, 'dispensed', `${SEP}&itemType=SUPPLY`)).body.data;
      expect(supply.rows.map((r: { code: string }) => r.code)).toEqual(['PH-GANG']);
      expect(supply).toMatchObject({ itemCount: 1, issueCount: 3, amount: 40_000, returnedAmount: 0 });
      const medicine = (await get(adminToken, 'dispensed', `${SEP}&itemType=MEDICINE`)).body.data;
      expect(medicine.rows.map((r: { code: string }) => r.code).sort()).toEqual(['PH-MOR', 'PH-PARA']);
      expect(medicine).toMatchObject({ itemCount: 2, issueCount: 3, amount: 210_000, returnedAmount: 40_000 });
    });

    it('phiếu xuất ĐÃ HUỶ và phiếu ngoài kỳ không tính', async () => {
      const rows: Array<{ code: string; quantity: number }> = (await get(adminToken, 'dispensed')).body.data.rows;
      expect(byCode(rows, 'PH-PARA')?.quantity).toBe(150); // không cộng 999 của phiếu huỷ, không cộng 1.000 của tháng 10
    });
  });

  describe('Lãi gộp', () => {
    it('tiền bán sau chiết khấu trừ phần hoàn, giá vốn theo phiếu xuất (hàng nhập lại kho trả vốn), phiếu huỷ/hoàn/ngoài kỳ không tính, xếp theo lãi gộp', async () => {
      const res = await get(adminToken, 'margin');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.rows.map((r: { code: string }) => r.code)).toEqual(['PH-PARA', 'PH-MOR', 'PH-GANG']);
      // Paracetamol: 100.000 (phiếu thu) + 45.000 (chưa thu, giảm 10%); vốn 50.000 + 25.000.
      expect(byCode(d.rows, 'PH-PARA')).toMatchObject({ quantity: 150, sell: 145_000, cost: 75_000, margin: 70_000, marginPercent: 48.3, unitName: expect.any(String) });
      // Morphin: bán 100.000 − hoàn 40.000 = 60.000; vốn 12.000 × (5 − 2 nhập lại) = 36.000.
      expect(byCode(d.rows, 'PH-MOR')).toMatchObject({ quantity: 3, sell: 60_000, cost: 36_000, margin: 24_000, marginPercent: 40 });
      // Găng tay: chỉ phiếu S1 (phiếu đã huỷ và đã hoàn không tính).
      expect(byCode(d.rows, 'PH-GANG')).toMatchObject({ itemType: 'SUPPLY', quantity: 10, sell: 20_000, cost: 13_000, margin: 7_000, marginPercent: 35 });
      expect(d.totals).toEqual({ sell: 225_000, cost: 124_000, margin: 101_000, marginPercent: 44.9, itemCount: 3 });
    });

    it('chiết khấu toàn phiếu chỉ tính phần của dòng thuốc: phiếu khám + thuốc không bị tính tiền khám vào tiền bán', async () => {
      // S1 có dòng khám 300.000 nhưng tiền bán thuốc chỉ gồm 100.000 + 20.000 của dòng thuốc.
      const d = (await get(adminToken, 'margin', 'from=2026-09-10&to=2026-09-10')).body.data;
      expect(d.totals).toMatchObject({ sell: 120_000, cost: 63_000, margin: 57_000, itemCount: 2 });
    });

    it('lọc theo Loại: tổng và dòng chỉ gồm loại đang xem', async () => {
      const medicine = (await get(adminToken, 'margin', `${SEP}&itemType=MEDICINE`)).body.data;
      expect(medicine.rows.map((r: { code: string }) => r.code).sort()).toEqual(['PH-MOR', 'PH-PARA']);
      expect(medicine.totals).toMatchObject({ sell: 205_000, cost: 111_000, margin: 94_000, itemCount: 2 });
      const supply = (await get(adminToken, 'margin', `${SEP}&itemType=SUPPLY`)).body.data;
      expect(supply.rows.map((r: { code: string }) => r.code)).toEqual(['PH-GANG']);
      expect(supply.totals).toMatchObject({ sell: 20_000, cost: 13_000, margin: 7_000, itemCount: 1 });
    });

    it('kỳ không có bán thuốc → không dòng nào, biên không xác định', async () => {
      const d = (await get(adminToken, 'margin', 'from=2026-07-01&to=2026-07-31')).body.data;
      expect(d.rows).toEqual([]);
      expect(d.totals).toEqual({ sell: 0, cost: 0, margin: 0, marginPercent: null, itemCount: 0 });
    });
  });

  describe('Kiểm soát đặc biệt', () => {
    it('chỉ thuốc có phân loại: tồn đầu kỳ, nhập, phát, xuất khác, tồn cuối kỳ; thuốc thường và biến động sau kỳ không tính', async () => {
      const res = await get(adminToken, 'controlled');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.itemCount).toBe(2);
      expect(byCode(d.rows, 'PH-MOR')).toMatchObject({ controlType: 'NARCOTIC', openingQuantity: 50, receivedQuantity: 22, dispensedQuantity: 5, otherOutQuantity: 3, closingQuantity: 64 });
      expect(byCode(d.rows, 'PH-DIA')).toMatchObject({ controlType: 'PSYCHOTROPIC', openingQuantity: 0, receivedQuantity: 10, dispensedQuantity: 0, otherOutQuantity: 0, closingQuantity: 10 });
      expect(byCode(d.rows, 'PH-PARA')).toBeUndefined();
    });

    it('từng lượt phát cho người bệnh: ngày, số phiếu xuất, mặt hàng, số lượng, bệnh nhân', async () => {
      const d = (await get(adminToken, 'controlled')).body.data;
      expect(d.entryCount).toBe(1);
      expect(d.entries[0]).toMatchObject({ date: '2026-09-12', issueNo: morphinIssueNo, drugCode: 'PH-MOR', controlType: 'NARCOTIC', quantity: 5, patientCode: morphinPatientCode });
    });

    it('lọc theo Phân loại', async () => {
      const narcotic = (await get(adminToken, 'controlled', `${SEP}&controlType=NARCOTIC`)).body.data;
      expect(narcotic.rows.map((r: { code: string }) => r.code)).toEqual(['PH-MOR']);
      expect(narcotic.entryCount).toBe(1);
      const psychotropic = (await get(adminToken, 'controlled', `${SEP}&controlType=PSYCHOTROPIC`)).body.data;
      expect(psychotropic.rows.map((r: { code: string }) => r.code)).toEqual(['PH-DIA']);
      expect(psychotropic.entryCount).toBe(0);
      expect((await get(adminToken, 'controlled', `${SEP}&controlType=PRECURSOR`)).body.data).toMatchObject({ rows: [], entries: [], entryCount: 0 });
    });

    it('thuốc không có biến động và không có tồn thì không vào sổ', async () => {
      const d = (await get(adminToken, 'controlled', 'from=2026-07-01&to=2026-07-31')).body.data;
      // Tháng 07: Morphin chưa nhập (nhập 20/08) → không tồn, không biến động.
      expect(d.rows).toEqual([]);
    });
  });

  describe('phạm vi nhiều chi nhánh', () => {
    it('chi nhánh đang làm chỉ thấy số của mình; gộp mới thấy chi nhánh B (có company_report.read)', async () => {
      const own = (await get(adminToken, 'margin')).body.data;
      expect(byCode(own.rows, 'PH-PARA')).toMatchObject({ quantity: 150, sell: 145_000, cost: 75_000 });
      const all = (await get(adminToken, 'margin', `${SEP}&scope=all`)).body.data;
      expect(all.branchCount).toBeGreaterThanOrEqual(2);
      expect(byCode(all.rows, 'PH-PARA')).toMatchObject({ quantity: 170, sell: 165_000, cost: 87_000 });
      const pickB = (await get(adminToken, 'margin', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(pickB.rows.map((r: { code: string }) => r.code)).toEqual(['PH-PARA']);
      expect(pickB.totals).toMatchObject({ sell: 20_000, cost: 12_000, margin: 8_000 });

      const dispensedB = (await get(adminToken, 'dispensed', `${SEP}&scope=pick&branchIds=${branchB}`)).body.data;
      expect(dispensedB).toMatchObject({ itemCount: 1, issueCount: 1, amount: 20_000 });
      const controlledAll = (await get(adminToken, 'controlled', `${SEP}&scope=all`)).body.data;
      expect(byCode(controlledAll.rows, 'PH-MOR')).toMatchObject({ openingQuantity: 50, receivedQuantity: 29, closingQuantity: 71 });
    });

    it('thiếu company_report.read: scope=all và scope=pick đều 403 dù tự gửi tham số', async () => {
      for (const path of ['dispensed', 'margin', 'controlled']) {
        expect((await get(viewerToken, path, `${SEP}&scope=all`)).status, path).toBe(403);
        expect((await get(viewerToken, path, `${SEP}&scope=pick&branchIds=${branchB}`)).status, path).toBe(403);
      }
      const own = await get(viewerToken, 'margin');
      expect(own.status).toBe(200);
      expect(own.body.data.branchCount).toBe(1);
      expect(own.body.data.totals.sell).toBe(225_000);
    });

    it('scope=pick không có chi nhánh → lỗi kiểm tra đầu vào', async () => {
      expect([400, 422]).toContain((await get(adminToken, 'margin', `${SEP}&scope=pick`)).status);
    });
  });

  describe('cô lập công ty', () => {
    it('quản trị công ty khác thấy số 0 ở cả 3 báo cáo; không đọc được chi nhánh của công ty này (404)', async () => {
      expect((await get(tenantBAdminToken, 'dispensed')).body.data).toMatchObject({ rows: [], itemCount: 0, issueCount: 0, amount: 0 });
      expect((await get(tenantBAdminToken, 'margin')).body.data).toMatchObject({ rows: [], totals: { sell: 0, itemCount: 0 } });
      expect((await get(tenantBAdminToken, 'controlled')).body.data).toMatchObject({ rows: [], entries: [], entryCount: 0 });
      expect((await get(tenantBAdminToken, 'margin', `${SEP}&scope=pick&branchIds=${branchA}`)).status).toBe(404);
    });
  });

  describe('xuất Excel', () => {
    async function readSheet(buffer: Buffer): Promise<{ names: string[]; text: string }> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const text = wb.worksheets.map((s) => s.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|')).join('\n');
      return { names: wb.worksheets.map((s) => s.name), text };
    }

    it('3 báo cáo xuất được, tên sheet đúng, ô tiền ghi SỐ khớp màn hình', async () => {
      const cases: Array<[string, string, string[]]> = [
        ['dispensed', 'Đã phát', ['Paracetamol 500mg', '150000', '60000']],
        ['margin', 'Lãi gộp', ['Morphin 10mg', '145000', '75000', '70000', '101000']],
        ['controlled', 'Kiểm soát đặc biệt', ['Morphin 10mg', 'Gây nghiện', 'Diazepam 5mg', 'Hướng thần', morphinIssueNo]],
      ];
      for (const [path, sheetName, expected] of cases) {
        const res = await h.download(`/api/v1/reports/pharmacy/${path}/export?${SEP}`, adminToken);
        expect(res.status, path).toBe(200);
        expect(res.headers['content-type'], path).toContain('spreadsheetml');
        const sheet = await readSheet(res.body as Buffer);
        expect(sheet.names, path).toEqual([sheetName]);
        for (const token of expected) expect(sheet.text, `${path} ${token}`).toContain(token);
      }
    });

    it('ghi nhật ký xuất đúng chi nhánh đã đọc; thiếu quyền → 403 và không ghi nhật ký mới', async () => {
      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'pharmacy_report.exported' }, orderBy: { occurredAt: 'desc' } });
      expect(audit?.entityType).toBe('pharmacy_report_export');
      expect(JSON.stringify(audit?.afterJson)).toContain(branchA);
      const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'pharmacy_report.exported' } });
      expect((await h.download(`/api/v1/reports/pharmacy/margin/export?${SEP}`, doctorToken)).status).toBe(403);
      expect((await h.download(`/api/v1/reports/pharmacy/margin/export?${SEP}&scope=all`, viewerToken)).status).toBe(403);
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'pharmacy_report.exported' } })).toBe(before);
    });
  });
});
