import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  diffDateStrings,
  getVietnamDateString,
  isValidDateString,
  listMonthKeys,
  overdueDays,
  summarizeDemographics,
  summarizeNewReturning,
  vietnamDateRangeHalfOpenUtc,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import {
  PATIENT_NOT_RETURNING_LIST_LIMIT,
  REVENUE_MAX_RANGE_DAYS,
  type PatientDemographicsReport,
  type PatientNewReturningReport,
  type PatientNotReturningReport,
  type PatientReportQuery,
} from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildReportExportContext, writeReportExportAudit } from '../../common/report-export-support';
import type { RequestMeta } from '../../common/request-meta';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { PatientReportRepository, type PatientPeriod } from './patient-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/** Số tỉnh/thành và phường/xã hiện trong bảng địa bàn. */
const TOP_PROVINCES = 15;
const TOP_WARDS = 20;

/**
 * Trang báo cáo "Bệnh nhân" (docs/DECISIONS.md #287): Bệnh nhân mới và cũ, Tuổi giới và địa bàn, Bệnh nhân không quay lại. Quyền `patient_report.read` (mặc định chỉ quản lý phòng khám).
 * Phạm vi chi nhánh từ `ReportBranchScopeService` (#235: `all`/`pick` cần `company_report.read`, id lạ → 404). Một request = MỘT transaction: phạm vi, tên phòng khám và người xuất đọc
 * qua service/port TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264). Ngày theo lịch Việt Nam.
 */
@Injectable()
export class PatientReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: PatientReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  private async resolve(actor: Actor, query: PatientReportQuery): Promise<{ period: PatientPeriod; scope: ReportBranchScope }> {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const span = diffDateStrings(query.from, query.to);
    if (span === null || span + 1 > REVENUE_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${REVENUE_MAX_RANGE_DAYS} ngày một lần.`);
    const scope = await this.reportBranchScope.resolve(actor, query);
    const window = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    return { period: { tenantId: actor.tenantId, branchIds: scope.branchIds, start: window.startUtc, end: window.endUtc, from: query.from, to: query.to }, scope };
  }

  private header(scope: ReportBranchScope, query: { from: string; to: string }, now: Date) {
    return { generatedAt: now.toISOString(), from: query.from, to: query.to, branchCount: scope.branchIds.length };
  }

  // ---- Bệnh nhân mới và cũ ----

  async getNewReturning(actor: Actor, query: PatientReportQuery, now: Date = new Date()): Promise<{ report: PatientNewReturningReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolve(actor, query);
    const { groups, months } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      groups: await this.repository.newReturningGroups(tx, period),
      months: await this.repository.monthRows(tx, period),
    }));
    const { summary, frequency, gap } = summarizeNewReturning(groups);
    const byKey = new Map(months.map((m) => [m.month, m]));
    const byMonth = listMonthKeys(query.from, query.to).map((month) => {
      const m = byKey.get(month);
      return { month, patients: m?.patients ?? 0, newPatients: m?.newPatients ?? 0, returningPatients: (m?.patients ?? 0) - (m?.newPatients ?? 0), visits: m?.visits ?? 0 };
    });
    return { report: { ...this.header(scope, query, now), summary, frequency, gap, byMonth }, scope };
  }

  // ---- Tuổi, giới và địa bàn ----

  async getDemographics(actor: Actor, query: PatientReportQuery, now: Date = new Date()): Promise<{ report: PatientDemographicsReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolve(actor, query);
    const { demographics, provinces, wards } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      demographics: await this.repository.demographicRows(tx, period),
      provinces: await this.repository.provinceRows(tx, period),
      wards: await this.repository.wardRows(tx, period, TOP_WARDS),
    }));
    const summary = summarizeDemographics(demographics);
    const known = provinces.filter((p) => p.code !== '');
    const report: PatientDemographicsReport = {
      ...this.header(scope, query, now),
      patients: summary.patients,
      genders: summary.genders,
      ageBands: summary.ageBands,
      unknownAge: summary.unknownAge,
      provinces: known.slice(0, TOP_PROVINCES),
      wards,
      unknownProvince: provinces.filter((p) => p.code === '').reduce((s, p) => s + p.patients, 0),
    };
    return { report, scope };
  }

  // ---- Bệnh nhân không quay lại ----

  async getNotReturning(actor: Actor, query: PatientReportQuery, now: Date = new Date()): Promise<{ report: PatientNotReturningReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolve(actor, query);
    const today = getVietnamDateString(now);
    const filter = { tenantId: actor.tenantId, branchIds: period.branchIds, from: query.from, to: query.to, today };
    const { summary, list, names } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const summary = await this.repository.notReturningSummary(tx, filter);
      const list = await this.repository.notReturningList(tx, filter, PATIENT_NOT_RETURNING_LIST_LIMIT);
      const ids = [...new Set(list.map((r) => r.doctorId).filter((id): id is string => id !== null))];
      return { summary, list, names: await this.repository.doctorNames(tx, actor.tenantId, ids) };
    });
    const report: PatientNotReturningReport = {
      ...this.header(scope, query, now),
      summary: { patients: summary.patients, reminded: summary.reminded, markedNotReturning: summary.markedNotReturning, avgOverdueDays: summary.avgOverdueDays === null ? null : Math.round(summary.avgOverdueDays) },
      totalCount: summary.patients,
      items: list.map((r) => ({
        patientId: r.patientId,
        patientCode: r.patientCode,
        patientName: r.patientName,
        phone: r.phone,
        encounterId: r.encounterId,
        visitDate: r.visitDate,
        dueDate: r.dueDate,
        overdueDays: overdueDays(r.dueDate, today),
        doctorName: r.doctorId ? (names.get(r.doctorId) ?? null) : null,
        branchName: scope.names.get(r.branchId) ?? '',
        reminderCount: r.reminderCount,
        lastReminderResult: r.lastReminderResult,
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
      writeReportExportAudit(tx, actor, { action: 'patient_report.exported', entityType: 'patient_report_export' }, report, query, resolvedBranchIds, meta, extra),
    );
  }
}
