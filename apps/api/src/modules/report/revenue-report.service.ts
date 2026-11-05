import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  REFERENCE_CATALOG_READER_PORT,
  computeInvoiceDiscount,
  createRevenuePeriodAccumulator,
  createServiceBreakdownAccumulator,
  diffDateStrings,
  getVietnamDateString,
  isValidDateString,
  sharePercent,
  splitIntoMonthChunks,
  vietnamDateRangeHalfOpenUtc,
  type DoctorDirectoryPort,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import {
  REVENUE_MAX_RANGE_DAYS,
  REVENUE_SHIFT_ROW_LIMIT,
  REVENUE_UNPAID_ROW_LIMIT,
  type RevenueByCashierReport,
  type RevenueByMethodReport,
  type RevenueByPeriodQuery,
  type RevenueByPeriodReport,
  type RevenueByServiceReport,
  type RevenuePeriodQuery,
  type RevenueUnpaidReport,
} from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { RevenueReportRepository, type RevenueRange } from './revenue-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/** Số dịch vụ tối đa trả về ở tab "Theo nhóm và dịch vụ"; phần còn lại cắt (tổng vẫn tính trên tất cả). */
export const REVENUE_SERVICE_ROW_LIMIT = 1000;

const AGING_BUCKETS: ReadonlyArray<{ label: string; maxDays: number }> = [
  { label: 'Trong ngày', maxDays: 0 },
  { label: '1–7 ngày', maxDays: 7 },
  { label: '8–30 ngày', maxDays: 30 },
  { label: '31–90 ngày', maxDays: 90 },
  { label: 'Trên 90 ngày', maxDays: Number.POSITIVE_INFINITY },
];

/**
 * Trang báo cáo "Doanh thu" (docs/DECISIONS.md #287): Theo kỳ, Theo nhóm và dịch vụ, Theo phương thức, Phiếu chưa thu, Theo thu ngân và chốt ca. Quyền `revenue_report.read` (mặc định chỉ quản lý
 * phòng khám). Phạm vi chi nhánh từ `ReportBranchScopeService` (#235: `all`/`pick` cần `company_report.read`, id lạ → 404). Một request = MỘT transaction: phạm vi và danh mục phương thức
 * thanh toán đọc TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264). Tiền: GHI NHẬN = `dueAmount` sau chiết khấu của phiếu chưa huỷ theo ngày khám (KHÔNG `invoice.total_amount`);
 * THỰC THU = thu trừ hoàn theo ngày thu. Phiếu được nạp từng đoạn một tháng lịch để kỳ một năm không giữ cả năm trong bộ nhớ.
 */
@Injectable()
export class RevenueReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: RevenueReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /** Kiểm khoảng ngày rồi giải quyết phạm vi chi nhánh. */
  private async resolve(actor: Actor, query: RevenuePeriodQuery): Promise<{ range: RevenueRange; scope: ReportBranchScope }> {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const span = diffDateStrings(query.from, query.to);
    if (span === null || span + 1 > REVENUE_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${REVENUE_MAX_RANGE_DAYS} ngày một lần.`);
    const scope = await this.reportBranchScope.resolve(actor, query);
    const window = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    return { range: { tenantId: actor.tenantId, branchIds: scope.branchIds, start: window.startUtc, end: window.endUtc }, scope };
  }

  private header(scope: ReportBranchScope, query: { from: string; to: string }, now: Date) {
    return { generatedAt: now.toISOString(), from: query.from, to: query.to, branchCount: scope.branchIds.length };
  }

  /** Các đoạn một tháng của kỳ, mỗi đoạn kèm khoảng thời gian UTC nửa mở. */
  private chunks(range: RevenueRange, query: { from: string; to: string }): RevenueRange[] {
    return splitIntoMonthChunks(query.from, query.to).map((c) => {
      const w = vietnamDateRangeHalfOpenUtc(c.from, c.to);
      return { tenantId: range.tenantId, branchIds: range.branchIds, start: w.startUtc, end: w.endUtc };
    });
  }

  // ---- Theo kỳ ----

  async getByPeriod(actor: Actor, query: RevenueByPeriodQuery, now: Date = new Date()): Promise<{ report: RevenueByPeriodReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const acc = createRevenuePeriodAccumulator(query.from, query.to, query.groupBy);
    await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      for (const chunk of this.chunks(range, query)) acc.addInvoices(await this.repository.listRecognizedInvoices(tx, chunk));
      acc.addPayments(await this.repository.sumPaymentsByDay(tx, range));
    });
    const { rows, totals } = acc.finish();
    return { report: { ...this.header(scope, query, now), groupBy: query.groupBy, rows, totals }, scope };
  }

  // ---- Theo nhóm và dịch vụ ----

  async getByService(actor: Actor, query: RevenuePeriodQuery, now: Date = new Date()): Promise<{ report: RevenueByServiceReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const acc = createServiceBreakdownAccumulator();
    await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      for (const chunk of this.chunks(range, query)) acc.addInvoices(await this.repository.listServiceInvoices(tx, chunk));
    });
    const { rows, byGroup } = acc.finish();
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
    const report: RevenueByServiceReport = {
      ...this.header(scope, query, now),
      totalAmount,
      groups: (['EXAM', 'PARACLINICAL', 'DRUG', 'PACKAGE'] as const).map((group) => ({ group, quantity: byGroup[group].quantity, amount: byGroup[group].amount, sharePercent: sharePercent(byGroup[group].amount, totalAmount) })),
      rows: rows.slice(0, REVENUE_SERVICE_ROW_LIMIT).map((r) => ({ ...r, sharePercent: sharePercent(r.amount, totalAmount) })),
      rowTotal: rows.length,
    };
    return { report, scope };
  }

  // ---- Theo phương thức ----

  async getByMethod(actor: Actor, query: RevenuePeriodQuery, now: Date = new Date()): Promise<{ report: RevenueByMethodReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const methods = await this.referenceCatalogReader.listByCategory(actor.tenantId, 'PAYMENT_METHOD');
    const methodNames = new Map(methods.map((m) => [m.code, m.name]));
    const raw = await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) => this.repository.sumPaymentsByMethod(tx, range));

    const byMethod = new Map<string, RevenueByMethodReport['rows'][number]>();
    for (const r of raw) {
      const row = byMethod.get(r.methodCode) ?? { methodCode: r.methodCode, methodName: methodNames.get(r.methodCode) ?? r.methodCode, paymentCount: 0, collected: 0, refundCount: 0, refunded: 0, net: 0, sharePercent: null };
      if (r.type === 'PAYMENT') {
        row.paymentCount += r.paymentCount;
        row.collected += r.amount;
      } else {
        row.refundCount += r.paymentCount;
        row.refunded += r.amount;
      }
      row.net = row.collected - row.refunded;
      byMethod.set(r.methodCode, row);
    }
    const rows = [...byMethod.values()].sort((a, b) => b.net - a.net || a.methodName.localeCompare(b.methodName, 'vi'));
    const totals = rows.reduce(
      (t, r) => ({ paymentCount: t.paymentCount + r.paymentCount, collected: t.collected + r.collected, refundCount: t.refundCount + r.refundCount, refunded: t.refunded + r.refunded, net: t.net + r.net }),
      { paymentCount: 0, collected: 0, refundCount: 0, refunded: 0, net: 0 },
    );
    for (const r of rows) r.sharePercent = sharePercent(r.net, totals.net);
    return { report: { ...this.header(scope, query, now), rows, totals }, scope };
  }

  // ---- Phiếu chưa thu ----

  async getUnpaid(actor: Actor, query: RevenuePeriodQuery, now: Date = new Date()): Promise<{ report: RevenueUnpaidReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const raw = await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) => this.repository.listUnpaidInvoices(tx, range));
    const today = getVietnamDateString(now);

    const all = raw.map((i) => ({
      invoiceId: i.invoiceId,
      invoiceNo: i.invoiceNo,
      invoiceType: i.invoiceType,
      patientCode: i.patientCode,
      patientName: i.patientName,
      date: i.date,
      ageDays: Math.max(0, diffDateStrings(i.date, today) ?? 0),
      branchId: i.branchId,
      branchName: scope.names.get(i.branchId) ?? '',
      amount: computeInvoiceDiscount({ totalAmount: i.totalAmount, discountType: i.discountType, discountValue: i.discountValue, lines: i.lines }).dueAmount,
    }));
    const aging = AGING_BUCKETS.map((b) => ({ label: b.label, invoiceCount: 0, amount: 0 }));
    for (const row of all) {
      const index = AGING_BUCKETS.findIndex((b) => row.ageDays <= b.maxDays);
      aging[index]!.invoiceCount += 1;
      aging[index]!.amount += row.amount;
    }
    const report: RevenueUnpaidReport = {
      ...this.header(scope, query, now),
      totalCount: all.length,
      totalAmount: all.reduce((s, r) => s + r.amount, 0),
      oldestAgeDays: all.length === 0 ? null : Math.max(...all.map((r) => r.ageDays)),
      aging,
      rows: all.slice(0, REVENUE_UNPAID_ROW_LIMIT),
    };
    return { report, scope };
  }

  // ---- Theo thu ngân và chốt ca ----

  async getByCashier(actor: Actor, query: RevenuePeriodQuery, now: Date = new Date()): Promise<{ report: RevenueByCashierReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const { payments, shifts } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      payments: await this.repository.sumPaymentsByCashier(tx, range),
      shifts: await this.repository.listShifts(tx, range),
    }));

    const byUser = new Map<string, RevenueByCashierReport['cashiers'][number]>();
    const rowOf = (userId: string, name: string) => {
      const row = byUser.get(userId) ?? { userId, name, shiftCount: 0, paymentCount: 0, collected: 0, refunded: 0, net: 0, discrepancy: 0, discrepancyShiftCount: 0 };
      byUser.set(userId, row);
      return row;
    };
    for (const p of payments) {
      const row = rowOf(p.userId, p.name);
      row.paymentCount += p.paymentCount;
      if (p.type === 'PAYMENT') row.collected += p.amount;
      else row.refunded += p.amount;
      row.net = row.collected - row.refunded;
    }
    const shiftRows = shifts.map((s) => {
      const discrepancy = s.expectedCash === null || s.countedCash === null ? null : s.countedCash - s.expectedCash;
      const row = rowOf(s.cashierId, s.cashierName);
      row.shiftCount += 1;
      if (discrepancy !== null) {
        row.discrepancy += discrepancy;
        if (discrepancy !== 0) row.discrepancyShiftCount += 1;
      }
      return {
        shiftNo: s.shiftNo,
        label: s.label,
        cashierName: s.cashierName,
        branchId: s.branchId,
        branchName: scope.names.get(s.branchId) ?? '',
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        status: s.status,
        expectedCash: s.expectedCash,
        countedCash: s.countedCash,
        discrepancy,
      };
    });
    const cashiers = [...byUser.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'vi'));
    const totals = cashiers.reduce(
      (t, c) => ({
        shiftCount: t.shiftCount + c.shiftCount,
        collected: t.collected + c.collected,
        refunded: t.refunded + c.refunded,
        net: t.net + c.net,
        discrepancy: t.discrepancy + c.discrepancy,
        discrepancyShiftCount: t.discrepancyShiftCount + c.discrepancyShiftCount,
      }),
      { shiftCount: 0, collected: 0, refunded: 0, net: 0, discrepancy: 0, discrepancyShiftCount: 0 },
    );
    return { report: { ...this.header(scope, query, now), cashiers, totals, shifts: shiftRows.slice(0, REVENUE_SHIFT_ROW_LIMIT), shiftTotal: shiftRows.length }, scope };
  }

  // ---- Dùng chung cho xuất Excel ----

  /** Tên phòng khám, tên chi nhánh và người xuất cho đầu báo cáo — đọc qua service/port TRƯỚC transaction chính. */
  async exportContext(actor: Actor, scope: ReportBranchScope, now: Date) {
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, actor.branchId), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);
    const multi = scope.branchIds.length > 1;
    return {
      clinicName: header.name,
      branchName: multi ? null : (header.branchName ?? null),
      scopeLabel: multi ? scope.branchIds.map((id) => scope.names.get(id) ?? '').join(', ') : null,
      exportedByName: names.get(actor.userId) ?? 'Không rõ',
      exportedAt: now,
    };
  }

  /** Ghi nhật ký xuất Excel: ai xuất, báo cáo nào, kỳ nào, chi nhánh nào thật sự đã đọc. */
  async recordExportAudit(actor: Actor, report: string, query: { from: string; to: string }, resolvedBranchIds: string[], meta: RequestMeta, extra: Record<string, unknown> = {}): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'revenue_report.exported',
        entityType: 'revenue_report_export',
        entityId: actor.tenantId,
        afterJson: { report, from: query.from, to: query.to, resolvedBranchIds, ...extra },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
