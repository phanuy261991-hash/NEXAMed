import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  OVERDUE_UNPAID_DAYS,
  EXPIRING_BATCH_DAYS,
  buildSystemAlerts,
  collectedByGroup,
  computeInvoiceDiscount,
  createMarginAccumulator,
  createServiceBreakdownAccumulator,
  diffDateStrings,
  fillDailySeries,
  getVietnamDateString,
  isValidDateString,
  kpiWithPrevious,
  lastMonths,
  mergeBranchRankings,
  monthRange,
  previousComparablePeriod,
  previousMonth,
  recognizeInvoice,
  roundPercent,
  sharePercent,
  splitIntoMonthChunks,
  summarizeDoctorPerformance,
  summarizeRecognizedRevenue,
  listDateStrings,
  vietnamDateRangeHalfOpenUtc,
  vietnamDayStartUtc,
  type DoctorDirectoryPort,
  type RankInput,
  type RevenueGroup,
} from '@nexamed/core';
import {
  PHARMACY_ITEM_TYPE_LABEL,
  SYSTEM_CROSS_ROW_LIMIT,
  SYSTEM_GROUP_LABEL,
  SYSTEM_MAX_RANGE_DAYS,
  SYSTEM_RANKING_LIMIT,
  SYSTEM_TREND_MONTHS,
  type SystemBranchRow,
  type SystemCrossReport,
  type SystemMonthlyQuery,
  type SystemMonthlyReport,
  type SystemOverviewReport,
  type SystemPeriodQuery,
  type SystemRankingReport,
} from '@nexamed/shared';
import type { Prisma } from '@prisma/client';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildReportExportContext, writeReportExportAudit } from '../../common/report-export-support';
import type { RequestMeta } from '../../common/request-meta';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { DailyReportRepository } from './daily-report.repository';
import { DashboardRepository } from './dashboard.repository';
import { DoctorReportRepository } from './doctor-report.repository';
import { OperationsReportRepository } from './operations-report.repository';
import { PharmacyReportRepository } from './pharmacy-report.repository';
import { RevenueReportRepository } from './revenue-report.repository';
import { ServiceConsumptionReportService } from './service-consumption-report.service';
import { SystemReportRepository } from './system-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

const GROUPS: readonly RevenueGroup[] = ['EXAM', 'PARACLINICAL', 'DRUG', 'PACKAGE'];

/** Số liệu nhẹ của một chi nhánh trong một khoảng ngày (đủ cho kỳ so sánh và dải xu hướng). */
interface LiteMetrics {
  visits: number;
  newPatients: number;
  recognized: number;
  collected: number;
  collectedByDay: Array<{ date: string; amount: number }>;
}

/**
 * Trang báo cáo "Toàn hệ thống" (docs/DECISIONS.md #287): So sánh chi nhánh, Xếp hạng, Tổng hợp tháng, Khám chéo chi nhánh. Quyền `company_report.read` ở controller; phạm vi chi nhánh từ
 * `ReportBranchScopeService` (#235). KHÔNG viết lại công thức: mỗi chi nhánh được đọc bằng đúng các truy vấn của Báo cáo ngày, Doanh thu, Bác sĩ, Vận hành, Thuốc và vật tư rồi ghép bằng
 * `@nexamed/core`, nên con số khớp từng báo cáo riêng. Một request = MỘT transaction; phạm vi và danh bạ bác sĩ đọc TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264).
 */
@Injectable()
export class SystemReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    private readonly repository: SystemReportRepository,
    private readonly dashboard: DashboardRepository,
    private readonly daily: DailyReportRepository,
    private readonly revenue: RevenueReportRepository,
    private readonly operations: OperationsReportRepository,
    private readonly pharmacy: PharmacyReportRepository,
    private readonly doctors: DoctorReportRepository,
    private readonly serviceConsumption: ServiceConsumptionReportService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  private async resolveScope(actor: Actor, query: Parameters<ReportBranchScopeService['resolve']>[1]): Promise<ReportBranchScope> {
    return this.reportBranchScope.resolve(actor, query);
  }

  private assertRange(from: string, to: string): void {
    if (!isValidDateString(from) || !isValidDateString(to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (from > to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const span = diffDateStrings(from, to);
    if (span === null || span + 1 > SYSTEM_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${SYSTEM_MAX_RANGE_DAYS} ngày một lần.`);
  }

  private header(scope: ReportBranchScope, from: string, to: string, now: Date) {
    return { generatedAt: now.toISOString(), from, to, branchCount: scope.branchIds.length };
  }

  private rangeOf(tenantId: string, branchId: string, from: string, to: string) {
    const w = vietnamDateRangeHalfOpenUtc(from, to);
    return { tenantId, branchIds: [branchId], start: w.startUtc, end: w.endUtc };
  }

  /** Các đoạn một tháng lịch của khoảng, mỗi đoạn kèm khoảng thời gian UTC nửa mở. */
  private chunkRanges(tenantId: string, branchId: string, from: string, to: string) {
    return splitIntoMonthChunks(from, to).map((c) => this.rangeOf(tenantId, branchId, c.from, c.to));
  }

  // ---- Số liệu của một chi nhánh ----

  private async collectLite(tx: Prisma.TransactionClient, tenantId: string, branchId: string, from: string, to: string): Promise<LiteMetrics> {
    const whole = this.rangeOf(tenantId, branchId, from, to);
    const [visitDays, newDays, collectedByDay] = [
      await this.dashboard.countEncountersByDay(tx, tenantId, branchId, whole.start, whole.end),
      await this.dashboard.countNewPatientsByDay(tx, tenantId, branchId, whole.start, whole.end),
      await this.dashboard.sumCollectedByDay(tx, tenantId, branchId, whole.start, whole.end),
    ];
    let recognized = 0;
    for (const chunk of this.chunkRanges(tenantId, branchId, from, to)) {
      recognized += summarizeRecognizedRevenue(await this.daily.listRecognizedInvoices(tx, tenantId, branchId, chunk.start, chunk.end)).total;
    }
    return {
      visits: visitDays.reduce((s, d) => s + d.count, 0),
      newPatients: newDays.reduce((s, d) => s + d.count, 0),
      recognized,
      collected: collectedByDay.reduce((s, d) => s + d.amount, 0),
      collectedByDay,
    };
  }

  private async collectMargin(tx: Prisma.TransactionClient, tenantId: string, branchId: string, from: string, to: string): Promise<number> {
    const acc = createMarginAccumulator('ALL');
    for (const chunk of this.chunkRanges(tenantId, branchId, from, to)) acc.addInvoices(await this.pharmacy.listMarginInvoices(tx, chunk));
    return acc.finish().totals.margin;
  }

  /** Lãi gộp dịch vụ của một chi nhánh (#297 bổ sung 4): doanh thu ghi nhận trừ chi phí vật tư tiêu hao của các lượt đã ghi tiêu hao. */
  private async collectServiceMargin(tx: Prisma.TransactionClient, tenantId: string, branchId: string, from: string, to: string): Promise<number> {
    return this.serviceConsumption.sumServiceMargin(tx, this.rangeOf(tenantId, branchId, from, to));
  }

  private async collectGroups(tx: Prisma.TransactionClient, tenantId: string, branchId: string, from: string, to: string): Promise<Record<RevenueGroup, number>> {
    const w = vietnamDateRangeHalfOpenUtc(from, to);
    return collectedByGroup(await this.dashboard.listCollectedWithLines(tx, tenantId, branchId, w.startUtc, w.endUtc));
  }

  private groupRows(totals: Record<RevenueGroup, number>) {
    const groupTotal = GROUPS.reduce((s, g) => s + totals[g], 0);
    return { groupTotal, groups: GROUPS.map((group) => ({ group, amount: totals[group], sharePercent: sharePercent(totals[group], groupTotal) })) };
  }

  // ---- So sánh chi nhánh ----

  async getOverview(actor: Actor, query: SystemPeriodQuery, now: Date = new Date()): Promise<{ report: SystemOverviewReport; scope: ReportBranchScope }> {
    this.assertRange(query.from, query.to);
    const scope = await this.resolveScope(actor, query);
    const previous = previousComparablePeriod(query.from, query.to);
    const today = getVietnamDateString(now);
    const todayStart = vietnamDayStartUtc(today);
    const untilDate = new Date(Date.parse(`${today}T00:00:00Z`) + EXPIRING_BATCH_DAYS * 86_400_000).toISOString().slice(0, 10);
    const dates = listDateStrings(query.from, query.to, SYSTEM_MAX_RANGE_DAYS);

    const perBranch = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const result: Array<{ branchId: string; row: SystemBranchRow; lite: LiteMetrics; previous: LiteMetrics; groups: Record<RevenueGroup, number>; waitSum: number; waitCount: number; arrived: number; overdue: number; staleShifts: number; overdueUnpaid: number; expiring: number }> = [];
      for (const branchId of scope.branchIds) {
        const lite = await this.collectLite(tx, actor.tenantId, branchId, query.from, query.to);
        const prev = await this.collectLite(tx, actor.tenantId, branchId, previous.from, previous.to);
        const whole = this.rangeOf(actor.tenantId, branchId, query.from, query.to);
        const unpaidRows = await this.revenue.listUnpaidInvoices(tx, whole);
        let unpaidAmount = 0;
        let overdueUnpaid = 0;
        for (const invoice of unpaidRows) {
          unpaidAmount += computeInvoiceDiscount({ totalAmount: invoice.totalAmount, discountType: invoice.discountType, discountValue: invoice.discountValue, lines: invoice.lines }).dueAmount;
          if ((diffDateStrings(invoice.date, today) ?? 0) > OVERDUE_UNPAID_DAYS) overdueUnpaid += 1;
        }
        const waits = await this.operations.waitByDoctorAndDay(tx, whole);
        const waitSum = waits.reduce((s, w) => s + w.sumMinutes, 0);
        const waitCount = waits.reduce((s, w) => s + w.count, 0);
        const followUps = await this.operations.followUps(tx, { tenantId: actor.tenantId, branchIds: [branchId], from: query.from, to: query.to, today });
        const arrived = followUps.filter((f) => !f.notReturning && f.returned).reduce((s, f) => s + f.count, 0);
        const overdue = followUps.filter((f) => !f.notReturning && !f.returned && f.past).reduce((s, f) => s + f.count, 0);
        const drugMargin = await this.collectMargin(tx, actor.tenantId, branchId, query.from, query.to);
        const serviceMargin = await this.collectServiceMargin(tx, actor.tenantId, branchId, query.from, query.to);
        const groups = await this.collectGroups(tx, actor.tenantId, branchId, query.from, query.to);
        const openShifts = await this.dashboard.listOpenCashierShifts(tx, actor.tenantId, branchId);
        const expiring = await this.dashboard.countExpiringBatches(tx, actor.tenantId, branchId, today, untilDate);
        result.push({
          branchId,
          row: {
            branchId,
            branchName: scope.names.get(branchId) ?? '',
            visits: lite.visits,
            newPatients: lite.newPatients,
            recognized: lite.recognized,
            collected: lite.collected,
            unpaidAmount,
            unpaidCount: unpaidRows.length,
            averageWaitMinutes: waitCount > 0 ? Math.round(waitSum / waitCount) : null,
            followUpArrivalPercent: roundPercent(arrived, arrived + overdue),
            drugMargin,
            serviceMargin,
            totalMargin: drugMargin + serviceMargin,
          },
          lite,
          previous: prev,
          groups,
          waitSum,
          waitCount,
          arrived,
          overdue,
          staleShifts: openShifts.filter((s) => s.openedAt < todayStart).length,
          overdueUnpaid,
          expiring,
        });
      }
      return result;
    });

    const sum = <K extends 'visits' | 'newPatients' | 'recognized' | 'collected'>(list: LiteMetrics[], key: K) => list.reduce((s, m) => s + m[key], 0);
    const rows = perBranch.map((b) => b.row);
    const totalWaitCount = perBranch.reduce((s, b) => s + b.waitCount, 0);
    const totalArrived = perBranch.reduce((s, b) => s + b.arrived, 0);
    const totalOverdue = perBranch.reduce((s, b) => s + b.overdue, 0);
    const groupTotals: Record<RevenueGroup, number> = { EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 };
    for (const b of perBranch) for (const g of GROUPS) groupTotals[g] += b.groups[g];
    const lites = perBranch.map((b) => b.lite);
    const prevs = perBranch.map((b) => b.previous);
    const unpaidAmount = rows.reduce((s, r) => s + r.unpaidAmount, 0);
    const unpaidCount = rows.reduce((s, r) => s + r.unpaidCount, 0);

    const report: SystemOverviewReport = {
      ...this.header(scope, query.from, query.to, now),
      previousFrom: previous.from,
      previousTo: previous.to,
      kpis: {
        recognized: kpiWithPrevious(sum(lites, 'recognized'), sum(prevs, 'recognized')),
        collected: kpiWithPrevious(sum(lites, 'collected'), sum(prevs, 'collected')),
        visits: kpiWithPrevious(sum(lites, 'visits'), sum(prevs, 'visits')),
        newPatients: kpiWithPrevious(sum(lites, 'newPatients'), sum(prevs, 'newPatients')),
        unpaidAmount,
        unpaidCount,
      },
      rows,
      totals: {
        visits: sum(lites, 'visits'),
        newPatients: sum(lites, 'newPatients'),
        recognized: sum(lites, 'recognized'),
        collected: sum(lites, 'collected'),
        unpaidAmount,
        unpaidCount,
        averageWaitMinutes: totalWaitCount > 0 ? Math.round(perBranch.reduce((s, b) => s + b.waitSum, 0) / totalWaitCount) : null,
        followUpArrivalPercent: roundPercent(totalArrived, totalArrived + totalOverdue),
        drugMargin: rows.reduce((s, r) => s + r.drugMargin, 0),
        serviceMargin: rows.reduce((s, r) => s + r.serviceMargin, 0),
        totalMargin: rows.reduce((s, r) => s + r.totalMargin, 0),
      },
      daily: {
        dates,
        series: perBranch.map((b) => ({ branchId: b.branchId, branchName: scope.names.get(b.branchId) ?? '', values: fillDailySeries(dates, b.lite.collectedByDay.map((d) => ({ date: d.date, value: d.amount }))) })),
      },
      ...this.groupRows(groupTotals),
      alerts: buildSystemAlerts(
        perBranch.map((b) => ({ branchId: b.branchId, branchName: scope.names.get(b.branchId) ?? '', staleOpenShifts: b.staleShifts, overdueUnpaid: b.overdueUnpaid, expiringBatches: b.expiring, averageWaitMinutes: b.row.averageWaitMinutes })),
      ),
    };
    return { report, scope };
  }

  // ---- Xếp hạng ----

  async getRanking(actor: Actor, query: SystemPeriodQuery, now: Date = new Date()): Promise<{ report: SystemRankingReport; scope: ReportBranchScope }> {
    this.assertRange(query.from, query.to);
    const scope = await this.resolveScope(actor, query);

    const perBranch = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const result: Array<{ services: RankInput[]; doctors: RankInput[]; drugs: RankInput[]; serviceMargins: RankInput[] }> = [];
      for (const branchId of scope.branchIds) {
        const services = createServiceBreakdownAccumulator();
        const margin = createMarginAccumulator('ALL');
        const revenueByDoctor = new Map<string, number>();
        for (const chunk of this.chunkRanges(actor.tenantId, branchId, query.from, query.to)) {
          services.addInvoices(await this.revenue.listServiceInvoices(tx, chunk));
          margin.addInvoices(await this.pharmacy.listMarginInvoices(tx, chunk));
          for (const invoice of await this.doctors.listDoctorInvoices(tx, { ...chunk, departmentId: null })) {
            revenueByDoctor.set(invoice.doctorId, (revenueByDoctor.get(invoice.doctorId) ?? 0) + recognizeInvoice(invoice).due);
          }
        }
        const whole = this.rangeOf(actor.tenantId, branchId, query.from, query.to);
        const stats = await this.doctors.statsByDoctor(tx, { ...whole, departmentId: null });
        const serviceMargins = await this.serviceConsumption.sumServiceMarginByService(tx, whole);
        result.push({
          services: services
            .finish()
            .rows.filter((r) => r.group !== 'DRUG')
            .map((r) => ({ key: `${r.group}|${r.code}|${r.name}`, name: r.name, subtitle: SYSTEM_GROUP_LABEL[r.group], quantity: r.quantity, amount: r.amount })),
          doctors: summarizeDoctorPerformance(stats, revenueByDoctor).rows.map((r) => ({ key: r.doctorId, name: r.doctorName, subtitle: r.departmentName, quantity: r.visits, amount: r.revenue })),
          drugs: margin.finish().rows.map((r) => ({ key: r.drugId, name: r.name, subtitle: PHARMACY_ITEM_TYPE_LABEL[r.itemType], quantity: r.quantity, amount: r.margin })),
          serviceMargins: serviceMargins.map((r) => ({ key: r.key, name: r.name, subtitle: r.key.startsWith('TECHNICAL_SERVICE:') ? SYSTEM_GROUP_LABEL.PARACLINICAL : SYSTEM_GROUP_LABEL.EXAM, quantity: r.visitCount, amount: r.margin })),
        });
      }
      return result;
    });

    const report: SystemRankingReport = {
      ...this.header(scope, query.from, query.to, now),
      branches: scope.branchIds.map((id) => ({ branchId: id, branchName: scope.names.get(id) ?? '' })),
      services: mergeBranchRankings(perBranch.map((b) => b.services), SYSTEM_RANKING_LIMIT),
      doctors: mergeBranchRankings(perBranch.map((b) => b.doctors), SYSTEM_RANKING_LIMIT),
      drugs: mergeBranchRankings(perBranch.map((b) => b.drugs), SYSTEM_RANKING_LIMIT),
      serviceMargins: mergeBranchRankings(perBranch.map((b) => b.serviceMargins), SYSTEM_RANKING_LIMIT),
    };
    return { report, scope };
  }

  // ---- Tổng hợp tháng ----

  async getMonthly(actor: Actor, query: SystemMonthlyQuery, now: Date = new Date()): Promise<{ report: SystemMonthlyReport; scope: ReportBranchScope }> {
    const range = monthRange(query.month);
    if (!range) throw new BadRequestException('Tháng không hợp lệ.');
    const scope = await this.resolveScope(actor, query);
    const months = lastMonths(query.month, SYSTEM_TREND_MONTHS);
    const prevMonth = previousMonth(query.month);

    const perBranch = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const result: Array<{ branchId: string; byMonth: Map<string, LiteMetrics>; margin: Map<string, number>; serviceMargin: Map<string, number>; groups: Record<RevenueGroup, number> }> = [];
      for (const branchId of scope.branchIds) {
        const byMonth = new Map<string, LiteMetrics>();
        for (const month of months) {
          const r = monthRange(month)!;
          byMonth.set(month, await this.collectLite(tx, actor.tenantId, branchId, r.from, r.to));
        }
        const margin = new Map<string, number>();
        const serviceMargin = new Map<string, number>();
        for (const month of [query.month, prevMonth]) {
          const r = monthRange(month)!;
          margin.set(month, await this.collectMargin(tx, actor.tenantId, branchId, r.from, r.to));
          serviceMargin.set(month, await this.collectServiceMargin(tx, actor.tenantId, branchId, r.from, r.to));
        }
        result.push({ branchId, byMonth, margin, serviceMargin, groups: await this.collectGroups(tx, actor.tenantId, branchId, range.from, range.to) });
      }
      return result;
    });

    const metrics = (b: (typeof perBranch)[number], month: string) => {
      const m = b.byMonth.get(month)!;
      const drugMargin = b.margin.get(month) ?? 0;
      const serviceMargin = b.serviceMargin.get(month) ?? 0;
      return { visits: m.visits, newPatients: m.newPatients, recognized: m.recognized, collected: m.collected, drugMargin, serviceMargin, totalMargin: drugMargin + serviceMargin };
    };
    const rows = perBranch.map((b) => ({ branchId: b.branchId, branchName: scope.names.get(b.branchId) ?? '', current: metrics(b, query.month), previous: metrics(b, prevMonth) }));
    const total = (key: 'visits' | 'newPatients' | 'recognized' | 'collected' | 'drugMargin' | 'serviceMargin' | 'totalMargin', which: 'current' | 'previous') => rows.reduce((s, r) => s + r[which][key], 0);
    const groupTotals: Record<RevenueGroup, number> = { EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 };
    for (const b of perBranch) for (const g of GROUPS) groupTotals[g] += b.groups[g];

    const report: SystemMonthlyReport = {
      ...this.header(scope, range.from, range.to, now),
      month: query.month,
      previousMonth: prevMonth,
      kpis: {
        recognized: kpiWithPrevious(total('recognized', 'current'), total('recognized', 'previous')),
        collected: kpiWithPrevious(total('collected', 'current'), total('collected', 'previous')),
        visits: kpiWithPrevious(total('visits', 'current'), total('visits', 'previous')),
        newPatients: kpiWithPrevious(total('newPatients', 'current'), total('newPatients', 'previous')),
        drugMargin: kpiWithPrevious(total('drugMargin', 'current'), total('drugMargin', 'previous')),
        serviceMargin: kpiWithPrevious(total('serviceMargin', 'current'), total('serviceMargin', 'previous')),
        totalMargin: kpiWithPrevious(total('totalMargin', 'current'), total('totalMargin', 'previous')),
      },
      rows,
      ...this.groupRows(groupTotals),
      trend: months.map((month) => {
        const t = { visits: 0, newPatients: 0, recognized: 0, collected: 0 };
        for (const b of perBranch) {
          const m = b.byMonth.get(month)!;
          t.visits += m.visits;
          t.newPatients += m.newPatients;
          t.recognized += m.recognized;
          t.collected += m.collected;
        }
        return { month, ...t };
      }),
    };
    return { report, scope };
  }

  // ---- Khám chéo chi nhánh ----

  async getCross(actor: Actor, query: SystemPeriodQuery, now: Date = new Date()): Promise<{ report: SystemCrossReport; scope: ReportBranchScope }> {
    this.assertRange(query.from, query.to);
    const scope = await this.resolveScope(actor, query);
    const w = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    const range = { tenantId: actor.tenantId, branchIds: scope.branchIds, start: w.startUtc, end: w.endUtc };
    const { totals, pairs, patients } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      totals: await this.repository.crossTotals(tx, range),
      pairs: await this.repository.crossPairs(tx, range),
      patients: await this.repository.crossPatients(tx, range, SYSTEM_CROSS_ROW_LIMIT),
    }));
    const name = (id: string) => scope.names.get(id) ?? '';
    const report: SystemCrossReport = {
      ...this.header(scope, query.from, query.to, now),
      totals: { ...totals, crossPercent: roundPercent(totals.crossPatientCount, totals.patientCount) },
      pairs: pairs.map((p) => ({ branchAId: p.branchAId, branchAName: name(p.branchAId), branchBId: p.branchBId, branchBName: name(p.branchBId), patientCount: p.patientCount })),
      rows: patients.map((p) => ({
        patientId: p.patientId,
        patientCode: p.patientCode,
        patientName: p.patientName,
        branchCount: p.branchCount,
        visitCount: p.visitCount,
        lastVisitDate: p.lastVisitDate,
        branches: p.branches.map((b) => ({ branchName: name(b.branchId), visits: b.visits })),
      })),
      rowTotal: totals.crossPatientCount,
    };
    return { report, scope };
  }

  // ---- Dùng chung cho xuất Excel ----

  /** Tên phòng khám, tên chi nhánh và người xuất cho đầu báo cáo — đọc qua service/port TRƯỚC transaction chính. */
  async exportContext(actor: Actor, scope: ReportBranchScope, now: Date) {
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, actor.branchId), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);
    return buildReportExportContext(header.name, header.branchName ?? null, scope, names.get(actor.userId) ?? 'Không rõ', now);
  }

  /** Ghi nhật ký xuất Excel: ai xuất, báo cáo nào, kỳ nào, chi nhánh nào thật sự đã đọc. */
  async recordExportAudit(actor: Actor, report: string, query: { from: string; to: string }, resolvedBranchIds: string[], meta: RequestMeta, extra: Record<string, unknown> = {}): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeReportExportAudit(tx, actor, { action: 'system_report.exported', entityType: 'system_report_export' }, report, query, resolvedBranchIds, meta, extra),
    );
  }
}
