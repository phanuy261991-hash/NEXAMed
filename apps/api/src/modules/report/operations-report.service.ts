import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  ageInYears,
  buildPeakHours,
  getVietnamDateString,
  isValidDateString,
  listDateStrings,
  listVisitServiceNames,
  roundPercent,
  stripVietnameseDiacritics,
  sumVisitAmount,
  summarizeWaitGroup,
  summarizeWaiting,
  vietnamDateRangeHalfOpenUtc,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  BookingSourceReport,
  CancellationReport,
  FollowUpReport,
  OperationsPeriodQuery,
  PeakHoursReport,
  VisitBookExportQuery,
  VisitBookQuery,
  VisitBookResponse,
  VisitBookRow,
  WaitingReport,
} from '@nexamed/shared';
import { VISIT_BOOK_MAX_RANGE_DAYS } from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import { REPORT_EXPORT_ROW_LIMIT } from '../../common/report-table-excel';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { OperationsReportRepository, type OpsPeriod, type VisitBookCursor, type VisitBookFilter } from './operations-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

const NO_DOCTOR_NAME = 'Chưa gán bác sĩ';

function encodeCursor(row: { atText: string; encounterId: string }): string {
  return Buffer.from(JSON.stringify({ a: row.atText, i: row.encounterId }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): VisitBookCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { a?: unknown; i?: unknown };
    if (typeof parsed.a === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}$/.test(parsed.a) && typeof parsed.i === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.i)) return { at: parsed.a, id: parsed.i };
  } catch {
    // rơi xuống lỗi chung bên dưới
  }
  throw new BadRequestException('Con trỏ phân trang không hợp lệ.');
}

/** Gộp lý do huỷ viết khác hoa/thường hoặc dấu cách thừa; lý do rỗng được xếp riêng. Giữ cách viết của lần xuất hiện đầu tiên. */
function mergeReasons(encounters: Array<{ reason: string; count: number }>, appointments: Array<{ reason: string; count: number }>): CancellationReport['reasons'] {
  const merged = new Map<string, { reason: string; encounterCount: number; appointmentCount: number }>();
  const add = (reason: string, count: number, kind: 'encounterCount' | 'appointmentCount') => {
    const key = reason.replace(/\s+/g, ' ').trim().toLowerCase();
    const entry = merged.get(key) ?? { reason: reason.replace(/\s+/g, ' ').trim(), encounterCount: 0, appointmentCount: 0 };
    entry[kind] += count;
    merged.set(key, entry);
  };
  for (const r of encounters) add(r.reason, r.count, 'encounterCount');
  for (const r of appointments) add(r.reason, r.count, 'appointmentCount');
  return [...merged.values()].sort((a, b) => b.encounterCount + b.appointmentCount - (a.encounterCount + a.appointmentCount) || a.reason.localeCompare(b.reason, 'vi'));
}

/**
 * Nhóm báo cáo "Khám bệnh và vận hành" (docs/DECISIONS.md #287): Sổ khám bệnh, giờ cao điểm, thời gian chờ, huỷ và không đến, tái khám, nguồn đặt lịch. Quyền `operations_report.read`
 * (mặc định chỉ quản lý phòng khám). Phạm vi chi nhánh từ `ReportBranchScopeService` (#235: `all`/`pick` cần `company_report.read`, id lạ → 404). Một request = MỘT transaction: phạm vi
 * và tên phòng khám/người xuất đọc TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264). Ngày theo lịch Việt Nam.
 */
@Injectable()
export class OperationsReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: OperationsReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /** Kiểm khoảng ngày (đúng định dạng, không ngược, tối đa `VISIT_BOOK_MAX_RANGE_DAYS`) rồi giải quyết phạm vi chi nhánh. */
  private async resolvePeriod(actor: Actor, query: { from: string; to: string } & OperationsPeriodQuery): Promise<{ period: OpsPeriod; scope: ReportBranchScope }> {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    if (listDateStrings(query.from, query.to, 4000).length > VISIT_BOOK_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${VISIT_BOOK_MAX_RANGE_DAYS} ngày một lần.`);
    const scope = await this.reportBranchScope.resolve(actor, query);
    const range = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    return { period: { tenantId: actor.tenantId, branchIds: scope.branchIds, start: range.startUtc, end: range.endUtc }, scope };
  }

  private header(scope: ReportBranchScope, query: { from: string; to: string }, now: Date) {
    return { generatedAt: now.toISOString(), from: query.from, to: query.to, branchCount: scope.branchIds.length };
  }

  // ---- Giờ cao điểm ----

  async getPeakHours(actor: Actor, query: OperationsPeriodQuery, now: Date = new Date()): Promise<{ report: PeakHoursReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolvePeriod(actor, query);
    const [cells, waits] = await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) => Promise.all([this.repository.countByWeekdayAndHour(tx, period), this.repository.waitByHourAndBucket(tx, period)]));
    const heat = buildPeakHours(cells, query.from, query.to);
    return { report: { ...this.header(scope, query, now), ...heat, waiting: summarizeWaiting(waits) }, scope };
  }

  // ---- Thời gian chờ ----

  async getWaiting(actor: Actor, query: OperationsPeriodQuery, now: Date = new Date()): Promise<{ report: WaitingReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolvePeriod(actor, query);
    const { waits, groups, names } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const [waits, groups] = await Promise.all([this.repository.waitByHourAndBucket(tx, period), this.repository.waitByDoctorAndDay(tx, period)]);
      const ids = [...new Set(groups.map((g) => g.doctorId).filter((id): id is string => id !== null))];
      return { waits, groups, names: await this.repository.doctorNames(tx, actor.tenantId, ids) };
    });

    const doctorAcc = new Map<string, { doctorId: string | null; count: number; sumMinutes: number; over30Count: number }>();
    const dayAcc = new Map<string, { count: number; sumMinutes: number; over30Count: number }>();
    let maxMinutes: number | null = null;
    for (const g of groups) {
      const dKey = g.doctorId ?? '';
      const d = doctorAcc.get(dKey) ?? { doctorId: g.doctorId, count: 0, sumMinutes: 0, over30Count: 0 };
      d.count += g.count;
      d.sumMinutes += g.sumMinutes;
      d.over30Count += g.over30Count;
      doctorAcc.set(dKey, d);
      const day = dayAcc.get(g.date) ?? { count: 0, sumMinutes: 0, over30Count: 0 };
      day.count += g.count;
      day.sumMinutes += g.sumMinutes;
      day.over30Count += g.over30Count;
      dayAcc.set(g.date, day);
      maxMinutes = maxMinutes === null ? g.maxMinutes : Math.max(maxMinutes, g.maxMinutes);
    }
    const byDoctor = [...doctorAcc.values()]
      .map((d) => ({ doctorId: d.doctorId, doctorName: d.doctorId ? (names.get(d.doctorId) ?? NO_DOCTOR_NAME) : NO_DOCTOR_NAME, ...summarizeWaitGroup(d) }))
      .sort((a, b) => b.visits - a.visits || a.doctorName.localeCompare(b.doctorName, 'vi'));
    const byDay = [...dayAcc.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({ date, ...summarizeWaitGroup(v) }));
    return { report: { ...this.header(scope, query, now), summary: summarizeWaiting(waits), maxMinutes: maxMinutes === null ? null : Math.round(maxMinutes), byDoctor, byDay }, scope };
  }

  // ---- Huỷ và không đến ----

  async getCancellations(actor: Actor, query: OperationsPeriodQuery, now: Date = new Date()): Promise<{ report: CancellationReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolvePeriod(actor, query);
    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const [encounters, appointments, reasons] = await Promise.all([
        this.repository.encountersByStatusDoctorDay(tx, period),
        this.repository.appointmentsByStatusDoctorDay(tx, period),
        this.repository.cancelReasons(tx, period),
      ]);
      const ids = [...new Set([...encounters, ...appointments].map((r) => r.doctorId).filter((id): id is string => id !== null))];
      return { encounters, appointments, reasons, names: await this.repository.doctorNames(tx, actor.tenantId, ids) };
    });

    const sum = (rows: typeof data.encounters, status: string) => rows.filter((r) => r.status === status).reduce((s, r) => s + r.count, 0);
    type Counts = { encounterCancelled: number; encounterNoShow: number; appointmentCancelled: number; appointmentNoShow: number };
    const empty = (): Counts => ({ encounterCancelled: 0, encounterNoShow: 0, appointmentCancelled: 0, appointmentNoShow: 0 });
    const doctorAcc = new Map<string, Counts & { doctorId: string | null }>();
    const dayAcc = new Map<string, Counts>();
    const bump = (rows: typeof data.encounters, kind: 'encounter' | 'appointment') => {
      for (const r of rows) {
        const field = r.status === 'CANCELLED' ? (kind === 'encounter' ? 'encounterCancelled' : 'appointmentCancelled') : r.status === 'NO_SHOW' ? (kind === 'encounter' ? 'encounterNoShow' : 'appointmentNoShow') : null;
        if (field === null) continue;
        const dKey = r.doctorId ?? '';
        const d = doctorAcc.get(dKey) ?? { doctorId: r.doctorId, ...empty() };
        d[field] += r.count;
        doctorAcc.set(dKey, d);
        const day = dayAcc.get(r.date) ?? empty();
        day[field] += r.count;
        dayAcc.set(r.date, day);
      }
    };
    bump(data.encounters, 'encounter');
    bump(data.appointments, 'appointment');

    const report: CancellationReport = {
      ...this.header(scope, query, now),
      encounters: { total: data.encounters.reduce((s, r) => s + r.count, 0), cancelled: sum(data.encounters, 'CANCELLED'), noShow: sum(data.encounters, 'NO_SHOW') },
      appointments: { total: data.appointments.reduce((s, r) => s + r.count, 0), cancelled: sum(data.appointments, 'CANCELLED'), noShow: sum(data.appointments, 'NO_SHOW'), rescheduled: sum(data.appointments, 'RESCHEDULED') },
      reasons: mergeReasons(data.reasons.encounters, data.reasons.appointments),
      byDoctor: [...doctorAcc.values()]
        .map((d) => ({ ...d, doctorName: d.doctorId ? (data.names.get(d.doctorId) ?? NO_DOCTOR_NAME) : NO_DOCTOR_NAME }))
        .sort((a, b) => b.encounterCancelled + b.encounterNoShow + b.appointmentCancelled + b.appointmentNoShow - (a.encounterCancelled + a.encounterNoShow + a.appointmentCancelled + a.appointmentNoShow) || a.doctorName.localeCompare(b.doctorName, 'vi')),
      byDay: [...dayAcc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, v]) => ({ date, ...v })),
    };
    return { report, scope };
  }

  // ---- Tái khám ----

  async getFollowUps(actor: Actor, query: OperationsPeriodQuery, now: Date = new Date()): Promise<{ report: FollowUpReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolvePeriod(actor, query);
    const today = getVietnamDateString(now);
    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const [rows, reminders] = await Promise.all([
        this.repository.followUps(tx, { tenantId: actor.tenantId, branchIds: period.branchIds, from: query.from, to: query.to, today }),
        this.repository.followUpRemindersByResult(tx, period),
      ]);
      const ids = [...new Set(rows.map((r) => r.doctorId).filter((id): id is string => id !== null))];
      return { rows, reminders, names: await this.repository.doctorNames(tx, actor.tenantId, ids) };
    });

    const empty = () => ({ total: 0, arrived: 0, overdue: 0, pending: 0 });
    const totals = { ...empty(), notReturning: 0 };
    const doctorAcc = new Map<string, ReturnType<typeof empty> & { doctorId: string | null }>();
    for (const r of data.rows) {
      if (r.notReturning) {
        totals.notReturning += r.count;
        continue;
      }
      // Cùng quy tắc trạng thái của trang "Hẹn tái khám" (#285): đã quay lại → đã đến; chưa quay lại thì ngày hẹn đã qua → quá hạn, còn lại → còn chờ.
      const field = r.returned ? 'arrived' : r.past ? 'overdue' : 'pending';
      totals.total += r.count;
      totals[field] += r.count;
      const d = doctorAcc.get(r.doctorId ?? '') ?? { doctorId: r.doctorId, ...empty() };
      d.total += r.count;
      d[field] += r.count;
      doctorAcc.set(r.doctorId ?? '', d);
    }
    const report: FollowUpReport = {
      ...this.header(scope, query, now),
      summary: { ...totals, arrivalPercent: roundPercent(totals.arrived, totals.arrived + totals.overdue) },
      byDoctor: [...doctorAcc.values()]
        .map((d) => ({ ...d, doctorName: d.doctorId ? (data.names.get(d.doctorId) ?? NO_DOCTOR_NAME) : NO_DOCTOR_NAME, arrivalPercent: roundPercent(d.arrived, d.arrived + d.overdue) }))
        .sort((a, b) => b.total - a.total || a.doctorName.localeCompare(b.doctorName, 'vi')),
      reminders: data.reminders.sort((a, b) => b.count - a.count),
    };
    return { report, scope };
  }

  // ---- Nguồn đặt lịch ----

  async getBookingSources(actor: Actor, query: OperationsPeriodQuery, now: Date = new Date()): Promise<{ report: BookingSourceReport; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolvePeriod(actor, query);
    const rows = await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) => this.repository.appointmentsBySourceAndStatus(tx, period));
    const bySource = new Map<string, BookingSourceReport['sources'][number]>();
    for (const r of rows) {
      const s = bySource.get(r.source) ?? { source: r.source, total: 0, arrived: 0, pending: 0, cancelled: 0, noShow: 0, rescheduled: 0, arrivalPercent: null };
      s.total += r.count;
      if (r.status === 'CONVERTED') s.arrived += r.count;
      else if (r.status === 'SCHEDULED') s.pending += r.count;
      else if (r.status === 'CANCELLED') s.cancelled += r.count;
      else if (r.status === 'NO_SHOW') s.noShow += r.count;
      else if (r.status === 'RESCHEDULED') s.rescheduled += r.count;
      bySource.set(r.source, s);
    }
    const sources = [...bySource.values()].map((s) => ({ ...s, arrivalPercent: roundPercent(s.arrived, s.total) })).sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
    const total = sources.reduce((s, x) => s + x.total, 0);
    const arrived = sources.reduce((s, x) => s + x.arrived, 0);
    return { report: { ...this.header(scope, query, now), total, arrived, arrivalPercent: roundPercent(arrived, total), topSource: sources[0]?.source ?? null, sources }, scope };
  }

  // ---- Sổ khám bệnh ----

  private visitBookFilter(period: OpsPeriod, query: Pick<VisitBookExportQuery, 'doctorId' | 'icd10Code' | 'q'>): VisitBookFilter {
    const normalized = query.q ? stripVietnameseDiacritics(query.q).toLowerCase().trim() : '';
    return { ...period, doctorId: query.doctorId ?? null, icd10Prefix: query.icd10Code ? query.icd10Code.toUpperCase() : null, searchNormalized: normalized === '' ? null : normalized };
  }

  private async loadVisitBookRows(actor: Actor, filter: VisitBookFilter, scope: ReportBranchScope, cursor: VisitBookCursor | null, limit: number, withTotal: boolean) {
    return this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const [total, raw] = await Promise.all([withTotal ? this.repository.countVisitBook(tx, filter) : Promise.resolve(0), this.repository.listVisitBook(tx, filter, cursor, limit)]);
      const hasMore = raw.length > limit;
      const page = hasMore ? raw.slice(0, limit) : raw;
      const encounterIds = page.map((r) => r.encounterId);
      const doctorIds = [...new Set(page.map((r) => r.doctorId).filter((id): id is string => id !== null))];
      const [diagnoses, invoices, names] = await Promise.all([
        this.repository.primaryDiagnoses(tx, actor.tenantId, encounterIds),
        this.repository.invoicesByEncounter(tx, actor.tenantId, encounterIds),
        this.repository.doctorNames(tx, actor.tenantId, doctorIds),
      ]);
      const rows: VisitBookRow[] = page.map((r) => {
        const dx = diagnoses.get(r.encounterId);
        const inv = invoices.get(r.encounterId) ?? [];
        return {
          encounterId: r.encounterId,
          encounterNo: r.encounterNo,
          patientId: r.patientId,
          patientCode: r.patientCode,
          patientName: r.patientName,
          ageYears: ageInYears(r.dob, r.visitDate),
          gender: r.gender,
          visitDate: r.visitDate,
          branchId: r.branchId,
          branchName: scope.names.get(r.branchId) ?? '',
          diagnosisCode: dx?.code ?? null,
          diagnosisName: dx?.name ?? null,
          doctorId: r.doctorId,
          doctorName: r.doctorId ? (names.get(r.doctorId) ?? null) : null,
          services: listVisitServiceNames(inv),
          amount: sumVisitAmount(inv),
        };
      });
      return { rows, total, nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null };
    });
  }

  async listVisitBook(actor: Actor, query: VisitBookQuery, now: Date = new Date()): Promise<VisitBookResponse> {
    const { period, scope } = await this.resolvePeriod(actor, query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const { rows, total, nextCursor } = await this.loadVisitBookRows(actor, this.visitBookFilter(period, query), scope, cursor, query.limit, true);
    return { items: rows, nextCursor, total, generatedAt: now.toISOString(), branchCount: scope.branchIds.length };
  }

  /** Dòng của bản Excel: đúng bộ lọc đang xem, tối đa `REPORT_EXPORT_ROW_LIMIT` dòng (mới nhất trước), kèm tổng số dòng khớp để ghi chú khi bị cắt. */
  async loadVisitBookForExport(actor: Actor, query: VisitBookExportQuery): Promise<{ rows: VisitBookRow[]; total: number; scope: ReportBranchScope }> {
    const { period, scope } = await this.resolvePeriod(actor, query);
    const { rows, total } = await this.loadVisitBookRows(actor, this.visitBookFilter(period, query), scope, null, REPORT_EXPORT_ROW_LIMIT, true);
    return { rows, total, scope };
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

  /** Ghi nhật ký xuất Excel: ai xuất, báo cáo nào, kỳ nào, chi nhánh nào thật sự đã đọc (không ghi từ khoá tìm vì có thể là tên/SĐT). */
  async recordExportAudit(actor: Actor, report: string, query: { from: string; to: string }, resolvedBranchIds: string[], meta: RequestMeta, extra: Record<string, unknown> = {}): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'operations_report.exported',
        entityType: 'operations_report_export',
        entityId: actor.tenantId,
        afterJson: { report, from: query.from, to: query.to, resolvedBranchIds, ...extra },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
