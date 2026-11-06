import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DOCTOR_DIRECTORY_PORT, diffDateStrings, getVietnamDateString, isValidDateString, summarizeInterop, vietnamDateRangeHalfOpenUtc, vietnamDayStartUtc, type DoctorDirectoryPort } from '@nexamed/core';
import {
  QUALITY_INTEROP_LIST_LIMIT,
  QUALITY_SHIFT_LIST_LIMIT,
  QUALITY_STALE_LIST_LIMIT,
  REVENUE_MAX_RANGE_DAYS,
  type QualityIncompleteQuery,
  type QualityIncompleteReport,
  type QualityInteropQuery,
  type QualityInteropReport,
} from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildReportExportContext, writeReportExportAudit } from '../../common/report-export-support';
import type { RequestMeta } from '../../common/request-meta';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { QualityReportRepository, type QualityInteropPeriod } from './quality-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

const NO_DOCTOR_NAME = 'Chưa gán bác sĩ';

/** Số ngày từ `from` đến `to` (cả hai `YYYY-MM-DD`), không âm. */
const daysBetween = (from: string, to: string): number => Math.max(0, diffDateStrings(from, to) ?? 0);

/**
 * Trang báo cáo "Chất lượng và tuân thủ" (docs/DECISIONS.md #290): Lượt khám chưa hoàn tất (ảnh chụp đến hôm nay) và Liên thông đơn thuốc (theo kỳ ký đơn); tab Nhật ký kiểm toán dẫn sang trang cũ.
 * Quyền `quality_report.read` (mặc định chỉ quản lý phòng khám). Phạm vi chi nhánh từ `ReportBranchScopeService` (#235: `all`/`pick` cần `company_report.read`, id lạ → 404). Một request = MỘT
 * transaction: phạm vi, tên phòng khám và người xuất đọc qua service/port TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264). Ngày theo lịch Việt Nam.
 */
@Injectable()
export class QualityReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: QualityReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  // ---- Lượt khám chưa hoàn tất ----

  async getIncomplete(actor: Actor, query: QualityIncompleteQuery, now: Date = new Date()): Promise<{ report: QualityIncompleteReport; scope: ReportBranchScope }> {
    const scope = await this.reportBranchScope.resolve(actor, query);
    const today = getVietnamDateString(now);
    const todayStart = vietnamDayStartUtc(today);
    const s = { tenantId: actor.tenantId, branchIds: scope.branchIds };
    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const staleTotal = await this.repository.staleCount(tx, s, todayStart);
      const stale = await this.repository.staleList(tx, s, todayStart, QUALITY_STALE_LIST_LIMIT);
      const shiftTotal = await this.repository.openShiftCount(tx, s, todayStart);
      const shifts = await this.repository.openShiftList(tx, s, todayStart, QUALITY_SHIFT_LIST_LIMIT);
      const unpaid = await this.repository.unpaidOldCount(tx, s, todayStart);
      const ids = [...new Set(stale.map((r) => r.doctorId).filter((id): id is string => id !== null))];
      return { staleTotal, stale, shiftTotal, shifts, unpaid, names: await this.repository.userNames(tx, actor.tenantId, ids) };
    });
    const encounters = data.stale.map((r) => ({
      encounterId: r.encounterId,
      encounterNo: r.encounterNo,
      patientCode: r.patientCode,
      patientName: r.patientName,
      status: r.status,
      visitDate: r.visitDate,
      daysOpen: daysBetween(r.visitDate, today),
      doctorName: r.doctorId ? (data.names.get(r.doctorId) ?? null) : null,
      branchName: scope.names.get(r.branchId) ?? '',
    }));
    const report: QualityIncompleteReport = {
      generatedAt: now.toISOString(),
      asOf: today,
      branchCount: scope.branchIds.length,
      summary: { staleEncounters: data.staleTotal, openShifts: data.shiftTotal, unpaidInvoices: data.unpaid, oldestEncounterDays: encounters[0]?.daysOpen ?? null },
      encounters,
      shifts: data.shifts.map((r) => ({
        shiftId: r.shiftId,
        shiftNo: r.shiftNo,
        cashierName: r.cashierName,
        openedAt: r.openedAt.toISOString(),
        daysOpen: daysBetween(getVietnamDateString(r.openedAt), today),
        branchName: scope.names.get(r.branchId) ?? '',
      })),
    };
    return { report, scope };
  }

  // ---- Liên thông đơn thuốc ----

  private async resolveInterop(actor: Actor, query: QualityInteropQuery): Promise<{ period: QualityInteropPeriod; scope: ReportBranchScope }> {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const span = diffDateStrings(query.from, query.to);
    if (span === null || span + 1 > REVENUE_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${REVENUE_MAX_RANGE_DAYS} ngày một lần.`);
    const scope = await this.reportBranchScope.resolve(actor, query);
    const window = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    return { period: { tenantId: actor.tenantId, branchIds: scope.branchIds, start: window.startUtc, end: window.endUtc }, scope };
  }

  async getInterop(actor: Actor, query: QualityInteropQuery, now: Date = new Date()): Promise<{ report: QualityInteropReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolveInterop(actor, query);
    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const statusCounts = await this.repository.interopStatusCounts(tx, period);
      const doctorCounts = await this.repository.interopDoctorCounts(tx, period, NO_DOCTOR_NAME);
      const problemInfo = await this.repository.interopProblemTotal(tx, period);
      const problems = await this.repository.interopProblemList(tx, period, QUALITY_INTEROP_LIST_LIMIT);
      const ids = [...new Set(problems.map((r) => r.doctorId).filter((id): id is string => id !== null))];
      return { statusCounts, doctorCounts, problemInfo, problems, names: await this.repository.userNames(tx, actor.tenantId, ids) };
    });
    const { summary, byDoctor } = summarizeInterop(data.statusCounts, data.doctorCounts);
    const today = getVietnamDateString(now);
    const report: QualityInteropReport = {
      generatedAt: now.toISOString(),
      from: query.from,
      to: query.to,
      branchCount: scope.branchIds.length,
      summary: { ...summary, oldestUnsentDays: data.problemInfo.oldest ? daysBetween(getVietnamDateString(data.problemInfo.oldest), today) : null },
      byDoctor,
      problemTotal: data.problemInfo.total,
      problems: data.problems.map((r) => ({
        submissionId: r.submissionId,
        encounterId: r.encounterId,
        encounterNo: r.encounterNo,
        patientCode: r.patientCode,
        patientName: r.patientName,
        doctorName: r.doctorId ? (data.names.get(r.doctorId) ?? null) : null,
        nationalCode: r.nationalCode,
        status: r.status,
        attempts: r.attempts,
        lastHttpStatus: r.lastHttpStatus,
        errors: r.errors,
        signedAt: r.signedAt.toISOString(),
        nextAttemptAt: r.nextAttemptAt ? r.nextAttemptAt.toISOString() : null,
        branchName: scope.names.get(r.branchId) ?? '',
      })),
    };
    return { report, scope };
  }

  // ---- Dùng chung cho xuất Excel ----

  async exportContext(actor: Actor, scope: ReportBranchScope, now: Date) {
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, actor.branchId), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);
    return buildReportExportContext(header.name, header.branchName ?? null, scope, names.get(actor.userId) ?? 'Không rõ', now);
  }

  async recordExportAudit(actor: Actor, report: string, query: { from: string; to: string }, resolvedBranchIds: string[], meta: RequestMeta, extra: Record<string, unknown> = {}): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeReportExportAudit(tx, actor, { action: 'quality_report.exported', entityType: 'quality_report_export' }, report, query, resolvedBranchIds, meta, extra),
    );
  }
}
