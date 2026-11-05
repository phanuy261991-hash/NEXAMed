import { Inject, Injectable } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  FOLLOW_UP_OVERDUE_DAYS,
  REFERENCE_CATALOG_READER_PORT,
  REVENUE_GROUPS,
  addDaysToDateString,
  allocateCollectionToGroups,
  averagePerActiveDay,
  computeDelta,
  computeDiscountAmount,
  computeInvoiceDiscount,
  fillDailySeries,
  getVietnamDateString,
  listDateStrings,
  percentOf,
  resolveReportPeriod,
  sameSpanPreviousMonth,
  summarizeDoctorEncounters,
  summarizeInvoiceLineNames,
  summarizePayments,
  summarizeReceptionAppointments,
  vietnamDateRangeHalfOpenUtc,
  type ClinicConfigReaderPort,
  type ReferenceCatalogReaderPort,
  type RevenueGroup,
  type RevenueLineInput,
} from '@nexamed/core';
import type { CashierDashboard, DashboardKpi, DashboardPeriod, DashboardPeriodKind, DoctorDashboard, OwnerDashboard, ReceptionDashboard } from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { DashboardRepository } from './dashboard.repository';

const TOP_SERVICE_COUNT = 5;
const EXPIRY_WINDOW_DAYS = 30;
const SERIES_DAYS = 7;
/** Số phiếu chờ thu hiện trên Tổng quan thu ngân; còn lại báo "+N phiếu" và mở danh sách đầy đủ ở màn Thu ngân. */
const PENDING_LIST_LIMIT = 8;
/** Số lịch hẹn sắp tới hiện trên Tổng quan lễ tân; còn lại báo "+N" và mở trang Lịch hẹn. */
const UPCOMING_LIMIT = 5;
/** Mã Loại tiếp nhận (`reference_catalog` RECEPTION_TYPE) mặc định của hệ thống: Khám mới / Tái khám. */
const RECEPTION_TYPE_NEW = 'RT_NEW';
const RECEPTION_TYPE_RETURN = 'RT_RETURN';
/** Số bệnh nhân chờ / kết quả mới hiện trên Tổng quan bác sĩ; còn lại báo "+N". */
const DOCTOR_WAITING_LIMIT = 5;
const DOCTOR_UNSEEN_LIMIT = 4;
/** Số ngày trước hôm nay dùng tính "trung bình lượt/ngày" và nhìn lại kết quả chưa xem. */
const DOCTOR_LOOKBACK_DAYS = 7;

interface Actor {
  tenantId: string;
  branchId: string | null;
}

interface DoctorActor extends Actor {
  userId: string;
}

/** Kỳ báo cáo + kỳ so sánh theo giờ Việt Nam. Tháng này so với CÙNG KHOẢNG NGÀY của tháng trước (mùng 1 → hôm nay). */
export function resolveDashboardPeriod(kind: DashboardPeriodKind, today: string): DashboardPeriod {
  if (kind === 'today') {
    const yesterday = addDaysToDateString(today, -1)!;
    return { kind, from: today, to: today, compareFrom: yesterday, compareTo: yesterday };
  }
  if (kind === 'week') {
    const from = addDaysToDateString(today, -6)!;
    return { kind, from, to: today, compareFrom: addDaysToDateString(from, -7)!, compareTo: addDaysToDateString(from, -1)! };
  }
  const from = resolveReportPeriod('month', today).from;
  const previous = sameSpanPreviousMonth(from, today);
  return { kind, from, to: today, compareFrom: previous.from, compareTo: previous.to };
}

function sumRange(byDate: Map<string, number>, from: string, to: string): number {
  return listDateStrings(from, to).reduce((sum, d) => sum + (byDate.get(d) ?? 0), 0);
}

function toDateMap(rows: ReadonlyArray<{ date: string; count?: number; amount?: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.date, (map.get(r.date) ?? 0) + (r.count ?? r.amount ?? 0));
  return map;
}

/**
 * Trang Tổng quan dành cho CHỦ PHÒNG KHÁM (một chi nhánh đang làm việc) — docs/DECISIONS.md #279, mockup "Chủ phòng khám". Một request = MỘT transaction, không gọi port.
 * Mọi công thức tiền dùng `@nexamed/core`: `dueAmount` qua `computeInvoiceDiscount` (đã trừ chiết khấu), thực thu = thu trừ hoàn (`payment.type`), KHÔNG dùng `invoice.total_amount`.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: DashboardRepository,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  /**
   * Trang Tổng quan của BÁC SĨ (docs/DECISIONS.md #286): chỉ HÔM NAY, chỉ lượt khám do CHÍNH bác sĩ đăng nhập khám (`doctor_id` = actor), ở chi nhánh đang làm việc. Số tiền (doanh thu sinh ra) chỉ
   * tính và gửi khi phòng khám bật công tắc — đọc công tắc qua port TRƯỚC khi mở transaction (một request = MỘT transaction, #264); tiền là `dueAmount` sau chiết khấu qua `computeInvoiceDiscount`.
   */
  async getDoctorDashboard(actor: DoctorActor, now: Date = new Date()): Promise<DoctorDashboard> {
    const branchId = requireBranchId(actor);
    const today = getVietnamDateString(now);
    const range = vietnamDateRangeHalfOpenUtc(today, today);
    const previous = vietnamDateRangeHalfOpenUtc(addDaysToDateString(today, -DOCTOR_LOOKBACK_DAYS)!, addDaysToDateString(today, -1)!);
    const unseenRange = vietnamDateRangeHalfOpenUtc(addDaysToDateString(today, -(DOCTOR_LOOKBACK_DAYS - 1))!, today);
    const overdueFrom = addDaysToDateString(today, -FOLLOW_UP_OVERDUE_DAYS)!;
    const moneyEnabled = await this.clinicConfigReader.getDoctorDashboardMoneyEnabled(actor.tenantId);

    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const departmentId = await this.repository.getUserDepartmentId(tx, actor.tenantId, actor.userId);
      const [encounters, previousDays, commonQueue, unseen, followUp, invoices] = await Promise.all([
        this.repository.listDoctorEncountersForDay(tx, actor.tenantId, branchId, actor.userId, range.startUtc, range.endUtc),
        this.repository.countDoctorEncountersByDay(tx, actor.tenantId, branchId, actor.userId, previous.startUtc, previous.endUtc),
        departmentId ? this.repository.countCommonQueue(tx, actor.tenantId, branchId, departmentId, range.startUtc, range.endUtc) : Promise.resolve(0),
        this.repository.listDoctorUnseenResults(tx, actor.tenantId, branchId, actor.userId, unseenRange.startUtc, unseenRange.endUtc, DOCTOR_UNSEEN_LIMIT),
        this.repository.countFollowUps(tx, actor.tenantId, branchId, today, overdueFrom, actor.userId),
        moneyEnabled ? this.repository.listDoctorInvoices(tx, actor.tenantId, branchId, actor.userId, range.startUtc, range.endUtc) : Promise.resolve([]),
      ]);
      return { encounters, previousDays, commonQueue, unseen, followUp, invoices };
    });

    const summary = summarizeDoctorEncounters(data.encounters, now, today, DOCTOR_WAITING_LIMIT);
    const revenue = moneyEnabled
      ? {
          amount: data.invoices.reduce(
            (sum, row) => sum + computeInvoiceDiscount({ totalAmount: row.totalAmount, discountType: row.discountType, discountValue: row.discountValue, lines: row.lines }).dueAmount,
            0,
          ),
        }
      : null;

    return {
      generatedAt: now.toISOString(),
      date: today,
      total: { count: summary.total, averagePerDay: averagePerActiveDay(data.previousDays.map((d) => d.count)) },
      waiting: summary.waiting,
      inProgress: summary.inProgress,
      done: summary.done,
      waitingList: summary.waitingList,
      commonQueue: { count: data.commonQueue },
      unseenResults: {
        count: data.unseen.total,
        items: data.unseen.items.map((i) => ({ name: i.name, patientName: i.patientName, resultedAt: i.resultedAt.toISOString() })),
        moreCount: Math.max(0, data.unseen.total - data.unseen.items.length),
      },
      hourly: summary.hourly,
      followUp: { ...data.followUp, overdueWithinDays: FOLLOW_UP_OVERDUE_DAYS },
      revenue,
    };
  }

  /**
   * Trang Tổng quan của THU NGÂN (docs/DECISIONS.md #283): chỉ HÔM NAY của chi nhánh đang làm việc. Tiền đã thu/hoàn theo NGÀY THU (cùng định nghĩa "thực thu" của chủ phòng khám),
   * phiếu chờ thu = phiếu chưa thanh toán của các lượt khám tiếp nhận hôm nay, `dueAmount` sau chiết khấu qua `computeInvoiceDiscount` — KHÔNG dùng `invoice.total_amount`.
   * Tên phương thức thanh toán đọc qua port TRƯỚC khi mở transaction (một request = MỘT transaction, #264).
   */
  async getCashierDashboard(actor: Actor, now: Date = new Date()): Promise<CashierDashboard> {
    const branchId = requireBranchId(actor);
    const today = getVietnamDateString(now);
    const range = vietnamDateRangeHalfOpenUtc(today, today);
    const methods = await this.referenceCatalogReader.listByCategory(actor.tenantId, 'PAYMENT_METHOD');
    const methodNames = new Map(methods.map((m) => [m.code, m.name]));

    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const [unpaid, paymentGroups, invoiceCounts] = await Promise.all([
        this.repository.listUnpaidInvoices(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
        this.repository.listPaymentGroups(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
        this.repository.countInvoicesByPaymentType(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
      ]);
      return { unpaid, paymentGroups, invoiceCounts };
    });

    const pendingRows = data.unpaid.map((row) => ({
      row,
      dueAmount: computeInvoiceDiscount({ totalAmount: row.totalAmount, discountType: row.discountType, discountValue: row.discountValue, lines: row.lines }).dueAmount,
    }));
    const totals = summarizePayments(data.paymentGroups, methodNames);

    return {
      generatedAt: now.toISOString(),
      date: today,
      pending: {
        invoiceCount: pendingRows.length,
        amount: pendingRows.reduce((s, r) => s + r.dueAmount, 0),
        items: pendingRows.slice(0, PENDING_LIST_LIMIT).map(({ row, dueAmount }) => ({
          invoiceId: row.invoiceId,
          encounterId: row.encounterId,
          invoiceNo: row.invoiceNo,
          invoiceType: row.invoiceType,
          patientName: row.patientName,
          summary: summarizeInvoiceLineNames(row.lines.map((l) => (l.isDrug ? 'Thuốc' : l.name))),
          dueAmount,
        })),
        moreCount: Math.max(0, pendingRows.length - PENDING_LIST_LIMIT),
      },
      collected: { invoiceCount: data.invoiceCounts.collected, amount: totals.collectedAmount },
      refunded: { invoiceCount: data.invoiceCounts.refunded, amount: totals.refundedAmount },
      net: totals.netAmount,
      byMethod: totals.byMethod,
      hourly: totals.hourly,
    };
  }

  /**
   * Trang Tổng quan của LỄ TÂN (docs/DECISIONS.md #284): chỉ HÔM NAY của chi nhánh đang làm việc. Lịch hẹn đang hiệu lực = chưa đến + đã chuyển khám; hàng đợi dùng chung nguồn với
   * Tổng quan chủ phòng khám; cảnh báo bác sĩ nghỉ theo đúng quy tắc trùng giờ của trang Lịch hẹn. Một request = MỘT transaction, không gọi port.
   */
  async getReceptionDashboard(actor: Actor, now: Date = new Date()): Promise<ReceptionDashboard> {
    const branchId = requireBranchId(actor);
    const today = getVietnamDateString(now);
    const range = vietnamDateRangeHalfOpenUtc(today, today);
    const overdueFrom = addDaysToDateString(today, -FOLLOW_UP_OVERDUE_DAYS)!;

    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const [appointments, leaves, types, queue, followUp] = await Promise.all([
        this.repository.listAppointmentsForDay(tx, actor.tenantId, branchId, range.startUtc, range.endUtc),
        this.repository.listApprovedLeaves(tx, actor.tenantId, branchId, today),
        this.repository.countEncountersByReceptionType(tx, actor.tenantId, branchId, range.startUtc, range.endUtc, [RECEPTION_TYPE_NEW, RECEPTION_TYPE_RETURN]),
        this.repository.listQueue(tx, actor.tenantId, branchId, range.startUtc, range.endUtc, today),
        this.repository.countFollowUps(tx, actor.tenantId, branchId, today, overdueFrom),
      ]);
      return { appointments, leaves, types, queue, followUp };
    });

    const summary = summarizeReceptionAppointments(data.appointments, data.leaves, today, now, UPCOMING_LIMIT);
    const queueRows = data.queue.map((r) => ({ doctorName: r.doctorName, roomName: r.roomName, inProgress: r.inProgress, waiting: r.waiting }));
    const totalWaiting = queueRows.reduce((s, r) => s + r.waiting, 0);

    return {
      generatedAt: now.toISOString(),
      date: today,
      appointments: { total: summary.total, arrived: summary.arrived, notArrived: summary.notArrived },
      waiting: totalWaiting,
      reception: { newCount: data.types.get(RECEPTION_TYPE_NEW) ?? 0, returnCount: data.types.get(RECEPTION_TYPE_RETURN) ?? 0 },
      leaveAlerts: summary.leaveAlerts,
      upcoming: summary.upcoming,
      hourly: summary.hourly,
      queue: { rows: queueRows, totalInProgress: queueRows.reduce((s, r) => s + r.inProgress, 0), totalWaiting },
      followUp: { ...data.followUp, overdueWithinDays: FOLLOW_UP_OVERDUE_DAYS },
    };
  }

  async getOwnerDashboard(actor: Actor, kind: DashboardPeriodKind, now: Date = new Date()): Promise<OwnerDashboard> {
    const branchId = requireBranchId(actor);
    const today = getVietnamDateString(now);
    const period = resolveDashboardPeriod(kind, today);
    const seriesDates = listDateStrings(addDaysToDateString(today, -(SERIES_DAYS - 1))!, today);
    const seriesFrom = seriesDates[0]!;

    // Khoảng rộng bao cả kỳ, kỳ so sánh và 7 ngày gần nhất: truy vấn MỘT lần theo ngày rồi cộng lại từng khoảng (ít câu SQL hơn nhiều lần gọi).
    const wideFrom = [period.from, period.compareFrom, seriesFrom].sort()[0]!;
    const wide = vietnamDateRangeHalfOpenUtc(wideFrom, today);
    const unpaidRange = vietnamDateRangeHalfOpenUtc([period.from, seriesFrom].sort()[0]!, today);
    const periodRange = vietnamDateRangeHalfOpenUtc(period.from, period.to);
    const todayRange = vietnamDateRangeHalfOpenUtc(today, today);
    const untilDate = addDaysToDateString(today, EXPIRY_WINDOW_DAYS)!;

    const data = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const [encounters, newPatients, hourly, collectedDaily, collectedLines, unpaid, services, openShifts, expiring, belowMin, queue] = await Promise.all([
        this.repository.countEncountersByDay(tx, actor.tenantId, branchId, wide.startUtc, wide.endUtc),
        this.repository.countNewPatientsByDay(tx, actor.tenantId, branchId, wide.startUtc, wide.endUtc),
        this.repository.countEncountersByHour(tx, actor.tenantId, branchId, periodRange.startUtc, periodRange.endUtc),
        this.repository.sumCollectedByDay(tx, actor.tenantId, branchId, wide.startUtc, wide.endUtc),
        this.repository.listCollectedWithLines(tx, actor.tenantId, branchId, periodRange.startUtc, periodRange.endUtc),
        this.repository.listUnpaidInvoices(tx, actor.tenantId, branchId, unpaidRange.startUtc, unpaidRange.endUtc),
        this.repository.listServiceLineGroups(tx, actor.tenantId, branchId, periodRange.startUtc, periodRange.endUtc),
        this.repository.listOpenCashierShifts(tx, actor.tenantId, branchId),
        this.repository.countExpiringBatches(tx, actor.tenantId, branchId, today, untilDate),
        this.repository.countBelowMinStock(tx, actor.tenantId, branchId),
        this.repository.listQueue(tx, actor.tenantId, branchId, todayRange.startUtc, todayRange.endUtc, today),
      ]);
      return { encounters, newPatients, hourly, collectedDaily, collectedLines, unpaid, services, openShifts, expiring, belowMin, queue };
    });

    const encountersByDate = toDateMap(data.encounters);
    const newByDate = toDateMap(data.newPatients);
    const collectedByDate = toDateMap(data.collectedDaily);

    const kpi = (byDate: Map<string, number>): DashboardKpi => {
      const value = sumRange(byDate, period.from, period.to);
      const previous = sumRange(byDate, period.compareFrom, period.compareTo);
      const delta = computeDelta(value, previous);
      return { value, previous, diff: delta.diff, diffPercent: delta.percent, direction: delta.direction, series: seriesDates.map((d) => byDate.get(d) ?? 0) };
    };

    const encountersKpi = kpi(encountersByDate);
    const newPatientsKpi = { ...kpi(newByDate), shareOfEncountersPercent: percentOf(sumRange(newByDate, period.from, period.to), encountersKpi.value) };

    // Phiếu chưa thu: số cho kỳ, và chuỗi theo ngày tiếp nhận cho đường nhỏ.
    const dueOf = (row: (typeof data.unpaid)[number]): number =>
      computeInvoiceDiscount({ totalAmount: row.totalAmount, discountType: row.discountType, discountValue: row.discountValue, lines: row.lines }).dueAmount;
    let pendingCount = 0;
    let pendingAmount = 0;
    const pendingByDate = new Map<string, number>();
    for (const row of data.unpaid) {
      const due = dueOf(row);
      if (row.date >= period.from && row.date <= period.to) {
        pendingCount += 1;
        pendingAmount += due;
      }
      pendingByDate.set(row.date, (pendingByDate.get(row.date) ?? 0) + due);
    }

    // Thực thu theo nhóm: chia số thực thu ròng của từng phiếu theo tỉ trọng dòng.
    const linesByInvoice = new Map<string, { net: number; lines: RevenueLineInput[] }>();
    for (const row of data.collectedLines) {
      const entry = linesByInvoice.get(row.invoiceId) ?? { net: row.net, lines: [] };
      if (row.lineTotal !== null) {
        entry.lines.push({
          lineTotal: row.lineTotal,
          discountType: row.discountType,
          discountValue: row.discountValue,
          sourceServiceItemId: row.sourceServiceItemId,
          sourceStockIssueLineId: row.sourceStockIssueLineId,
          sourceOrderItemId: row.sourceOrderItemId,
          sourceOrderPackageId: row.sourceOrderPackageId,
        });
      }
      linesByInvoice.set(row.invoiceId, entry);
    }
    const groupTotals: Record<RevenueGroup, number> = { EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 };
    for (const { net, lines } of linesByInvoice.values()) {
      const parts = allocateCollectionToGroups(net, lines);
      for (const g of REVENUE_GROUPS) groupTotals[g] += parts[g];
    }
    const groupSum = REVENUE_GROUPS.reduce((s, g) => s + groupTotals[g], 0);

    // Dịch vụ dùng nhiều: giá trị ròng từng dòng sau chiết khấu RIÊNG của dòng.
    const byName = new Map<string, { count: number; amount: number }>();
    for (const g of data.services) {
      const net = g.lineTotal - computeDiscountAmount(g.lineTotal, g.discountType, g.discountValue);
      const entry = byName.get(g.name) ?? { count: 0, amount: 0 };
      entry.count += g.count;
      entry.amount += net * g.count;
      byName.set(g.name, entry);
    }
    const allServices = [...byName.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount || b.count - a.count || a.name.localeCompare(b.name, 'vi'));
    const top = allServices.slice(0, TOP_SERVICE_COUNT);
    const totalServiceAmount = allServices.reduce((s, x) => s + x.amount, 0);
    const topAmount = top.reduce((s, x) => s + x.amount, 0);

    // Hàng đợi.
    const queueRows = data.queue.map((r) => ({
      doctorName: r.doctorName,
      roomName: r.roomName,
      inProgress: r.inProgress,
      waiting: r.waiting,
      longestWaitMinutes: r.oldestWaitingAt ? Math.max(0, Math.floor((now.getTime() - r.oldestWaitingAt.getTime()) / 60_000)) : null,
    }));
    const waits = queueRows.map((r) => r.longestWaitMinutes).filter((m): m is number => m !== null);

    const collectedSeries = fillDailySeries(seriesDates, data.collectedDaily.map((r) => ({ date: r.date, value: r.amount })));
    const hourlyFull = Array.from({ length: 24 }, (_, hour) => ({ hour, count: data.hourly.find((h) => h.hour === hour)?.count ?? 0 }));

    return {
      generatedAt: now.toISOString(),
      period,
      encounters: encountersKpi,
      collected: kpi(collectedByDate),
      newPatients: newPatientsKpi,
      pending: { invoiceCount: pendingCount, amount: pendingAmount, series: seriesDates.map((d) => pendingByDate.get(d) ?? 0) },
      hourly: hourlyFull,
      collectedByGroup: REVENUE_GROUPS.map((group) => ({ group, amount: groupTotals[group], percent: percentOf(groupTotals[group], groupSum) })),
      collectedDaily: seriesDates.map((date, i) => ({ date, amount: collectedSeries[i] ?? 0 })),
      needsAttention: {
        unpaidInvoices: { count: pendingCount, amount: pendingAmount },
        openShifts: data.openShifts.map((s) => ({ label: s.label, openedAt: s.openedAt.toISOString() })),
        expiringBatches: { count: data.expiring, withinDays: EXPIRY_WINDOW_DAYS },
        belowMinStockItems: { count: data.belowMin },
      },
      topServices: {
        items: top,
        totalCount: top.reduce((s, x) => s + x.count, 0),
        totalAmount: topAmount,
        shareOfServiceAmountPercent: percentOf(topAmount, totalServiceAmount),
      },
      queue: {
        rows: queueRows,
        totalInProgress: queueRows.reduce((s, r) => s + r.inProgress, 0),
        totalWaiting: queueRows.reduce((s, r) => s + r.waiting, 0),
        longestWaitMinutes: waits.length > 0 ? Math.max(...waits) : null,
        doctorsInProgress: queueRows.filter((r) => r.inProgress > 0 && r.doctorName !== null).length,
      },
    };
  }
}

