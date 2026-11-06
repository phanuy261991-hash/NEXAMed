import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DOCTOR_DIRECTORY_PORT, diffDateStrings, isValidDateString, minutesBetween, summarizeCls, summarizeDiagnoses, vietnamDateRangeHalfOpenUtc, type DoctorDirectoryPort } from '@nexamed/core';
import {
  CLINICAL_CHAPTER_LIST_LIMIT,
  CLINICAL_DIAGNOSIS_LIST_LIMIT,
  CLINICAL_OVERDUE_LIST_LIMIT,
  CLINICAL_TOP_SERVICE_LIMIT,
  REVENUE_MAX_RANGE_DAYS,
  type ClinicalDiagnosisReport,
  type ClinicalParaclinicalReport,
  type ClinicalReportQuery,
} from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildReportExportContext, writeReportExportAudit } from '../../common/report-export-support';
import type { RequestMeta } from '../../common/request-meta';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { ClinicalReportRepository, type ClinicalPeriod } from './clinical-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Trang báo cáo "Chuyên môn" (docs/DECISIONS.md #287): Cơ cấu chẩn đoán ICD-10 và Cận lâm sàng (tab "Dịch vụ đã dùng" dẫn sang báo cáo Doanh thu, không có route riêng ở đây). Quyền
 * `clinical_report.read` (mặc định chỉ quản lý phòng khám). Phạm vi chi nhánh từ `ReportBranchScopeService` (#235: `all`/`pick` cần `company_report.read`, id lạ → 404). Một request = MỘT
 * transaction: phạm vi, tên phòng khám và người xuất đọc qua service/port TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264). Ngày theo lịch Việt Nam.
 */
@Injectable()
export class ClinicalReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ClinicalReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  private async resolve(actor: Actor, query: ClinicalReportQuery): Promise<{ period: ClinicalPeriod; scope: ReportBranchScope }> {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const span = diffDateStrings(query.from, query.to);
    if (span === null || span + 1 > REVENUE_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${REVENUE_MAX_RANGE_DAYS} ngày một lần.`);
    const scope = await this.reportBranchScope.resolve(actor, query);
    const window = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    return { period: { tenantId: actor.tenantId, branchIds: scope.branchIds, start: window.startUtc, end: window.endUtc }, scope };
  }

  private header(scope: ReportBranchScope, query: { from: string; to: string }, now: Date) {
    return { generatedAt: now.toISOString(), from: query.from, to: query.to, branchCount: scope.branchIds.length };
  }

  // ---- Cơ cấu chẩn đoán ICD-10 ----

  async getDiagnoses(actor: Actor, query: ClinicalReportQuery, now: Date = new Date()): Promise<{ report: ClinicalDiagnosisReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolve(actor, query);
    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      totals: await this.repository.diagnosisTotals(tx, period),
      rows: await this.repository.topDiagnoses(tx, period, CLINICAL_DIAGNOSIS_LIST_LIMIT),
      chapters: await this.repository.chapterRows(tx, period, CLINICAL_CHAPTER_LIST_LIMIT),
    }));
    const { summary, rows, chapters } = summarizeDiagnoses({ ...data.totals, rows: data.rows, chapters: data.chapters });
    return { report: { ...this.header(scope, query, now), summary, rows, chapters }, scope };
  }

  // ---- Cận lâm sàng ----

  async getParaclinical(actor: Actor, query: ClinicalReportQuery, now: Date = new Date()): Promise<{ report: ClinicalParaclinicalReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolve(actor, query);
    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      groups: await this.repository.clsGroups(tx, period, now),
      top: await this.repository.clsTopServices(tx, period, now, CLINICAL_TOP_SERVICE_LIMIT),
      overdue: await this.repository.clsOverdueOpen(tx, period, now, CLINICAL_OVERDUE_LIST_LIMIT),
    }));
    const { summary, byKind } = summarizeCls(data.groups);
    const report: ClinicalParaclinicalReport = {
      ...this.header(scope, query, now),
      summary,
      byKind,
      topServices: data.top.map((t) => ({ name: t.name, kind: t.kind, ordered: t.ordered, completed: t.completed, avgMinutes: t.measured > 0 ? Math.round(t.sumMinutes / t.measured) : null, overdue: t.overdue })),
      overdueItems: data.overdue.map((o) => ({
        orderItemId: o.orderItemId,
        encounterId: o.encounterId,
        patientCode: o.patientCode,
        patientName: o.patientName,
        serviceName: o.serviceName,
        kind: o.kind,
        branchName: scope.names.get(o.branchId) ?? '',
        orderedAt: o.orderedAt.toISOString(),
        turnaroundMinutes: o.turnaroundMinutes,
        waitedMinutes: minutesBetween(o.orderedAt, now),
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
      writeReportExportAudit(tx, actor, { action: 'clinical_report.exported', entityType: 'clinical_report_export' }, report, query, resolvedBranchIds, meta, extra),
    );
  }
}
