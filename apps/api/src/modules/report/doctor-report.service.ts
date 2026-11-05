import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  diffDateStrings,
  isValidDateString,
  recognizeInvoice,
  shiftWorkMinutes,
  splitIntoMonthChunks,
  summarizeDoctorHours,
  summarizeDoctorOrderMix,
  summarizeDoctorPerformance,
  vietnamDateRangeHalfOpenUtc,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import {
  DOCTOR_TOP_LIST_SIZE,
  REVENUE_MAX_RANGE_DAYS,
  type DoctorHoursReport,
  type DoctorOrderMixReport,
  type DoctorPerformanceReport,
  type DoctorReportQuery,
} from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildReportExportContext, writeReportExportAudit } from '../../common/report-export-support';
import type { RequestMeta } from '../../common/request-meta';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { DoctorReportRepository, type DoctorRange } from './doctor-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Trang báo cáo "Bác sĩ" (docs/DECISIONS.md #287): Hiệu suất theo bác sĩ, Cơ cấu kê đơn và chỉ định, Giờ làm việc và lượt khám. Quyền `doctor_report.read` (mặc định chỉ quản lý phòng khám; bác sĩ không
 * xem trang này). Phạm vi chi nhánh từ `ReportBranchScopeService` (#235: `all`/`pick` cần `company_report.read`, id lạ → 404). Một request = MỘT transaction: phạm vi, danh bạ bác sĩ và tên
 * Khoa đọc qua port TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264). "Lượt khám" = lượt đã hoàn tất có bác sĩ, theo ngày tiếp nhận giờ Việt Nam. Doanh thu sinh ra = GHI NHẬN
 * (`dueAmount` sau chiết khấu, KHÔNG `invoice.total_amount`) của các lượt đó; phiếu được nạp từng đoạn một tháng lịch để kỳ một năm không giữ cả năm trong bộ nhớ.
 */
@Injectable()
export class DoctorReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: DoctorReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  private async resolve(actor: Actor, query: DoctorReportQuery): Promise<{ range: DoctorRange; scope: ReportBranchScope }> {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const span = diffDateStrings(query.from, query.to);
    if (span === null || span + 1 > REVENUE_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${REVENUE_MAX_RANGE_DAYS} ngày một lần.`);
    const scope = await this.reportBranchScope.resolve(actor, query);
    const window = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    return { range: { tenantId: actor.tenantId, branchIds: scope.branchIds, start: window.startUtc, end: window.endUtc, departmentId: query.departmentId ?? null }, scope };
  }

  private header(scope: ReportBranchScope, query: { from: string; to: string }, now: Date) {
    return { generatedAt: now.toISOString(), from: query.from, to: query.to, branchCount: scope.branchIds.length };
  }

  private chunks(range: DoctorRange, query: { from: string; to: string }): DoctorRange[] {
    return splitIntoMonthChunks(query.from, query.to).map((c) => {
      const w = vietnamDateRangeHalfOpenUtc(c.from, c.to);
      return { ...range, start: w.startUtc, end: w.endUtc };
    });
  }

  // ---- Hiệu suất theo bác sĩ ----

  async getPerformance(actor: Actor, query: DoctorReportQuery, now: Date = new Date()): Promise<{ report: DoctorPerformanceReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const { stats, revenue } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const stats = await this.repository.statsByDoctor(tx, range);
      const revenue = new Map<string, number>();
      for (const chunk of this.chunks(range, query)) {
        for (const invoice of await this.repository.listDoctorInvoices(tx, chunk)) {
          revenue.set(invoice.doctorId, (revenue.get(invoice.doctorId) ?? 0) + recognizeInvoice(invoice).due);
        }
      }
      return { stats, revenue };
    });
    const { rows, totals } = summarizeDoctorPerformance(stats, revenue);
    return { report: { ...this.header(scope, query, now), rows, totals }, scope };
  }

  // ---- Cơ cấu kê đơn và chỉ định ----

  async getOrderMix(actor: Actor, query: DoctorReportQuery, now: Date = new Date()): Promise<{ report: DoctorOrderMixReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const { stats, topDrugs, topOrders } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      stats: await this.repository.statsByDoctor(tx, range),
      topDrugs: await this.repository.topDrugs(tx, range, DOCTOR_TOP_LIST_SIZE),
      topOrders: await this.repository.topOrders(tx, range, DOCTOR_TOP_LIST_SIZE),
    }));
    const { rows, totals } = summarizeDoctorOrderMix(stats);
    return { report: { ...this.header(scope, query, now), rows, totals, topDrugs, topOrders }, scope };
  }

  // ---- Giờ làm việc và lượt khám ----

  async getHours(actor: Actor, query: DoctorReportQuery, now: Date = new Date()): Promise<{ report: DoctorHoursReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    // Danh bạ bác sĩ đang hoạt động ở các chi nhánh của phạm vi + tên Khoa: đọc qua port TRƯỚC transaction (#264).
    const [perBranch, departmentNames] = await Promise.all([
      Promise.all(scope.branchIds.map((branchId) => this.doctorDirectory.listActiveDoctors(actor.tenantId, branchId))),
      this.doctorDirectory.getDepartmentNames(actor.tenantId),
    ]);
    const directory = new Map<string, { name: string; departmentId: string | null }>();
    for (const list of perBranch) for (const d of list) directory.set(d.id, { name: d.displayName ?? d.fullName, departmentId: d.departmentId });
    const wantedDepartment = query.departmentId ?? null;

    const { stats, assignments, leaves } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      stats: await this.repository.statsByDoctor(tx, range),
      assignments: await this.repository.listAssignments(tx, { tenantId: actor.tenantId, branchIds: scope.branchIds, from: query.from, to: query.to }),
      leaves: await this.repository.listApprovedLeaves(tx, { tenantId: actor.tenantId, branchIds: scope.branchIds, from: query.from, to: query.to }),
    }));

    // Bác sĩ trong báo cáo: bác sĩ đang hoạt động của phạm vi (lọc Khoa) + bác sĩ có khám trong kỳ (kể cả đã ngưng).
    const people = new Map<string, { name: string; departmentId: string | null; departmentName: string }>();
    for (const [id, d] of directory) {
      if (wantedDepartment !== null && d.departmentId !== wantedDepartment) continue;
      people.set(id, { name: d.name, departmentId: d.departmentId, departmentName: d.departmentId ? (departmentNames.get(d.departmentId) ?? '') : '' });
    }
    const statById = new Map(stats.map((s) => [s.doctorId, s]));
    for (const s of stats) people.set(s.doctorId, { name: s.doctorName, departmentId: s.departmentId, departmentName: s.departmentName });

    const scheduled = new Map<string, { days: Set<string>; minutes: number }>();
    for (const a of assignments) {
      if (!people.has(a.userId)) continue;
      const entry = scheduled.get(a.userId) ?? { days: new Set<string>(), minutes: 0 };
      entry.days.add(a.workDate);
      entry.minutes += shiftWorkMinutes(a.startTime, a.endTime, a.restMinutes, a.standardWorkMinutes);
      scheduled.set(a.userId, entry);
    }
    const leave = new Map<string, { days: Set<string>; minutes: number }>();
    for (const l of leaves) {
      if (!people.has(l.userId)) continue;
      const entry = leave.get(l.userId) ?? { days: new Set<string>(), minutes: 0 };
      entry.days.add(l.leaveDate);
      entry.minutes += l.minutes;
      leave.set(l.userId, entry);
    }

    const inputs = [...people.entries()].map(([doctorId, p]) => {
      const s = statById.get(doctorId);
      return {
        doctorId,
        doctorName: p.name,
        departmentId: p.departmentId,
        departmentName: p.departmentName,
        scheduledDays: scheduled.get(doctorId)?.days.size ?? 0,
        scheduledMinutes: scheduled.get(doctorId)?.minutes ?? 0,
        leaveDays: leave.get(doctorId)?.days.size ?? 0,
        leaveMinutes: leave.get(doctorId)?.minutes ?? 0,
        activeDays: s?.activeDays ?? 0,
        visits: s?.visits ?? 0,
        consultMinutes: Math.round(s?.sumMinutes ?? 0),
      };
    });
    const { rows, totals } = summarizeDoctorHours(inputs);
    return { report: { ...this.header(scope, query, now), rows, totals }, scope };
  }

  // ---- Dùng chung cho xuất Excel ----

  async exportContext(actor: Actor, scope: ReportBranchScope, now: Date) {
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, actor.branchId), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);
    return buildReportExportContext(header.name, header.branchName ?? null, scope, names.get(actor.userId) ?? 'Không rõ', now);
  }

  /** Tên Khoa đang lọc (nếu có) để ghi lên đầu Excel. */
  async departmentLabel(actor: Actor, departmentId: string | undefined): Promise<string | null> {
    if (!departmentId) return null;
    const names = await this.doctorDirectory.getDepartmentNames(actor.tenantId);
    return names.get(departmentId) ?? null;
  }

  async recordExportAudit(actor: Actor, report: string, query: { from: string; to: string }, resolvedBranchIds: string[], meta: RequestMeta, extra: Record<string, unknown> = {}): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeReportExportAudit(tx, actor, { action: 'doctor_report.exported', entityType: 'doctor_report_export' }, report, query, resolvedBranchIds, meta, extra),
    );
  }
}
