import { Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  REFERENCE_CATALOG_READER_PORT,
  addDaysToDateString,
  combineDailyBranches,
  computeShiftDiscrepancy,
  computeInvoiceDiscount,
  getVietnamDateString,
  summarizeDailyCollection,
  summarizeDailyVisits,
  summarizeRecognizedRevenue,
  vietnamDateRangeHalfOpenUtc,
  type DailyBranchReport,
  type DoctorDirectoryPort,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import type { DailyReport, DailyReportQuery } from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { buildDailyReportExcel } from './daily-report-export';
import { DailyReportRepository } from './daily-report.repository';
import { DashboardRepository } from './dashboard.repository';

/** Mã Loại tiếp nhận (`reference_catalog` RECEPTION_TYPE) mặc định của hệ thống — cùng mã với Tổng quan lễ tân. */
const RECEPTION_TYPE_NEW = 'RT_NEW';
const RECEPTION_TYPE_RETURN = 'RT_RETURN';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * "Báo cáo ngày" (docs/DECISIONS.md #287). Phạm vi chi nhánh lấy từ `ReportBranchScopeService` (#235: `all`/`pick` cần `company_report.read`, id lạ → 404), HÔM NAY hoặc HÔM QUA giờ Việt Nam.
 * Một request = MỘT transaction: phạm vi và danh mục phương thức thanh toán đọc TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264); tên người thu ngân lấy bằng JOIN trong chính truy vấn.
 * Tiền: ghi nhận = `dueAmount` sau chiết khấu (KHÔNG `invoice.total_amount`); thực thu = thu trừ hoàn theo ngày thu; chưa thu = phiếu chưa thanh toán của lượt khám trong ngày.
 */
@Injectable()
export class DailyReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly dashboardRepository: DashboardRepository,
    private readonly repository: DailyReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /** Báo cáo + phạm vi đã giải quyết (dùng chung cho xem và xuất Excel để audit ghi đúng chi nhánh thật đã đọc). */
  async load(actor: Actor, query: DailyReportQuery, now: Date = new Date()): Promise<{ report: DailyReport; scope: ReportBranchScope }> {
    const scope = await this.reportBranchScope.resolve(actor, query);
    const methods = await this.referenceCatalogReader.listByCategory(actor.tenantId, 'PAYMENT_METHOD');
    const methodNames = new Map(methods.map((m) => [m.code, m.name]));

    const today = getVietnamDateString(now);
    const date = query.day === 'yesterday' ? addDaysToDateString(today, -1)! : today;
    const range = vietnamDateRangeHalfOpenUtc(date, date);

    const branches = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const result: DailyBranchReport[] = [];
      // Tuần tự từng chi nhánh trong CÙNG một transaction (phạm vi thường 1–5 chi nhánh).
      for (const branchId of scope.branchIds) {
        const [statusCounts, typeCounts, paymentGroups, recognizedInvoices, unpaid, shifts, counter] = await Promise.all([
          this.repository.countEncountersByStatus(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
          this.dashboardRepository.countEncountersByReceptionType(tx, actor.tenantId, branchId, range.startUtc, range.endUtc, [RECEPTION_TYPE_NEW, RECEPTION_TYPE_RETURN]),
          this.dashboardRepository.listPaymentGroups(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
          this.repository.listRecognizedInvoices(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
          this.dashboardRepository.listUnpaidInvoices(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
          this.repository.listShiftsOpenedInDay(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
          this.repository.sumCounterVouchers(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
        ]);
        result.push({
          branchId,
          branchName: scope.names.get(branchId) ?? '',
          visits: summarizeDailyVisits(statusCounts, typeCounts.get(RECEPTION_TYPE_NEW) ?? 0, typeCounts.get(RECEPTION_TYPE_RETURN) ?? 0),
          collection: summarizeDailyCollection(paymentGroups, methodNames),
          recognized: summarizeRecognizedRevenue(recognizedInvoices),
          unpaid: {
            invoiceCount: unpaid.length,
            amount: unpaid.reduce(
              (sum, row) => sum + computeInvoiceDiscount({ totalAmount: row.totalAmount, discountType: row.discountType, discountValue: row.discountValue, lines: row.lines }).dueAmount,
              0,
            ),
          },
          shifts: shifts.map((s) => ({
            shiftNo: s.shiftNo,
            label: s.label,
            cashierName: s.cashierName,
            openedAt: s.openedAt.toISOString(),
            closedAt: s.closedAt ? s.closedAt.toISOString() : null,
            status: s.status === 'OPEN' ? 'OPEN' : 'CLOSED',
            expectedCash: s.expectedCash,
            countedCash: s.countedCash,
            discrepancy: computeShiftDiscrepancy(s.expectedCash, s.countedCash),
          })),
          counterVouchers: counter,
        });
      }
      return result;
    });

    const report: DailyReport = { generatedAt: now.toISOString(), date, branches, totals: combineDailyBranches(branches) };
    return { report, scope };
  }

  async getReport(actor: Actor, query: DailyReportQuery, now: Date = new Date()): Promise<DailyReport> {
    return (await this.load(actor, query, now)).report;
  }

  /** Bản Excel cùng số liệu với màn hình. Tên phòng khám, người xuất đọc qua service/port TRƯỚC (một request = MỘT transaction). */
  async exportExcel(actor: Actor, query: DailyReportQuery, now: Date = new Date()): Promise<{ buffer: Buffer; scope: ReportBranchScope; date: string }> {
    const { report, scope } = await this.load(actor, query, now);
    const [header, names] = await Promise.all([
      this.clinicProfileService.getPrintHeader(actor.tenantId, actor.branchId),
      this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId]),
    ]);
    const multiBranch = report.branches.length > 1;
    const buffer = await buildDailyReportExcel(report, {
      clinicName: header.name,
      singleBranchName: header.branchName ?? null,
      scopeLabel: multiBranch ? `${report.branches.map((b) => b.branchName).join(', ')}` : null,
      exportedByName: names.get(actor.userId) ?? 'Không rõ',
      exportedAt: now,
    });
    return { buffer, scope, date: report.date };
  }

  /** Ghi nhật ký xuất Excel: ai xuất, ngày nào, chi nhánh nào thật sự đã đọc. */
  async recordExportAudit(actor: Actor, query: DailyReportQuery, resolvedBranchIds: string[], meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'daily_report.exported',
        entityType: 'daily_report_export',
        entityId: actor.tenantId,
        afterJson: { day: query.day, scope: query.scope, resolvedBranchIds },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
