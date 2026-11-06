import { isValidDateString } from '../date/vietnam-period';
import { addDaysToDateString, diffDateStrings } from '../encounter/follow-up-date';
import { allocateCollectionToGroups, computeDelta, REVENUE_GROUPS, type RevenueGroup, type RevenueLineInput } from './dashboard-math';

/**
 * Phép tính thuần của trang báo cáo "Toàn hệ thống" (docs/DECISIONS.md #287): kỳ so sánh, phần trăm thay đổi, thực thu theo nhóm, cảnh báo "Cần chú ý", ghép xếp hạng nhiều chi nhánh. Không biết gì về DB hay HTTP.
 */

const MONTH_RE = /^(\d{4})-(\d{2})$/;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `{ from, to }` của tháng `YYYY-MM` (ngày đầu và ngày cuối tháng); `null` khi sai định dạng. */
export function monthRange(month: string): { from: string; to: string } | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${pad2(lastDayOfMonth(year, mm))}` };
}

/** Tháng liền trước của `YYYY-MM` (`"2026-01"` → `"2025-12"`). */
export function previousMonth(month: string): string {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Tháng không hợp lệ (cần YYYY-MM): "${month}"`);
  const year = Number(m[1]);
  const mm = Number(m[2]);
  return mm === 1 ? `${year - 1}-12` : `${year}-${pad2(mm - 1)}`;
}

/** `count` tháng kết thúc ở `endMonth`, cũ nhất trước (`("2026-02", 3)` → `["2025-12", "2026-01", "2026-02"]`). */
export function lastMonths(endMonth: string, count: number): string[] {
  const months: string[] = [endMonth];
  while (months.length < count) months.unshift(previousMonth(months[0]!));
  return months;
}

/** Số tháng nguyên (từ ngày 1 đến ngày cuối tháng) mà khoảng `from..to` phủ; `null` nếu khoảng không khớp ranh giới tháng. */
function wholeMonthSpan(from: string, to: string): number | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!f || !t || f[3] !== '01') return null;
  const ty = Number(t[1]);
  const tm = Number(t[2]);
  if (Number(t[3]) !== lastDayOfMonth(ty, tm)) return null;
  const span = (ty - Number(f[1])) * 12 + (tm - Number(f[2])) + 1;
  return span >= 1 ? span : null;
}

/**
 * Kỳ so sánh của `from..to`: khoảng tròn tháng (1 tháng, quý = 3 tháng, năm = 12 tháng) so với đúng số tháng liền trước (tháng 10/2026 so với tháng 09/2026); khoảng khác
 * (hôm nay, 7 ngày, từ đầu tháng đến nay...) so với khoảng CÙNG ĐỘ DÀI liền trước nó.
 */
export function previousComparablePeriod(from: string, to: string): { from: string; to: string } {
  if (!isValidDateString(from) || !isValidDateString(to) || from > to) throw new Error('Khoảng ngày không hợp lệ.');
  const months = wholeMonthSpan(from, to);
  if (months !== null) {
    const f = /^(\d{4})-(\d{2})/.exec(from)!;
    const index = Number(f[1]) * 12 + (Number(f[2]) - 1) - months;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const prevFrom = `${year}-${pad2(month)}-01`;
    return { from: prevFrom, to: addDaysToDateString(from, -1)! };
  }
  const length = (diffDateStrings(from, to) ?? 0) + 1;
  return { from: addDaysToDateString(from, -length)!, to: addDaysToDateString(from, -1)! };
}

export interface KpiWithPrevious {
  value: number;
  previous: number;
  /** % thay đổi so với kỳ trước (1 chữ số thập phân); `null` khi kỳ trước bằng 0. */
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
}

export function kpiWithPrevious(value: number, previous: number): KpiWithPrevious {
  const delta = computeDelta(value, previous);
  return { value, previous, percent: delta.percent, direction: delta.direction };
}

// ---- Thực thu theo nhóm ----

export interface CollectedLineInput extends RevenueLineInput {
  invoiceId: string;
  /** Thực thu ròng của phiếu trong kỳ (thu trừ hoàn). */
  net: number;
  /** `null` khi phiếu không còn dòng nào (dữ liệu bất thường). */
  lineTotal: number;
}

export interface CollectedRowInput {
  invoiceId: string;
  net: number;
  lineTotal: number | null;
  discountType: RevenueLineInput['discountType'];
  discountValue: number | null;
  sourceServiceItemId: string | null;
  sourceStockIssueLineId: string | null;
  sourceOrderItemId: string | null;
  sourceOrderPackageId: string | null;
}

/** Chia số THỰC THU ròng của từng phiếu vào bốn nhóm theo tỉ trọng dòng, cộng cả kỳ (tổng bốn nhóm luôn bằng tổng thực thu của các phiếu). */
export function collectedByGroup(rows: readonly CollectedRowInput[]): Record<RevenueGroup, number> {
  const byInvoice = new Map<string, { net: number; lines: RevenueLineInput[] }>();
  for (const row of rows) {
    const entry = byInvoice.get(row.invoiceId) ?? { net: row.net, lines: [] };
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
    byInvoice.set(row.invoiceId, entry);
  }
  const totals: Record<RevenueGroup, number> = { EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 };
  for (const { net, lines } of byInvoice.values()) {
    const parts = allocateCollectionToGroups(net, lines);
    for (const group of REVENUE_GROUPS) totals[group] += parts[group];
  }
  return totals;
}

// ---- Cần chú ý ----

/** Phiếu chưa thu quá bao nhiêu ngày thì tính là "quá hạn". */
export const OVERDUE_UNPAID_DAYS = 3;
/** Lô thuốc hết hạn trong bao nhiêu ngày tới thì cảnh báo. */
export const EXPIRING_BATCH_DAYS = 30;
/** Thời gian chờ trung bình (phút) từ mức này mới nêu chi nhánh chờ lâu nhất. */
export const LONG_AVERAGE_WAIT_MINUTES = 20;

export type SystemAlertKind = 'OPEN_SHIFTS' | 'OVERDUE_UNPAID' | 'EXPIRING_BATCHES' | 'LONG_WAIT';

export interface SystemAlert {
  kind: SystemAlertKind;
  branchId: string;
  branchName: string;
  text: string;
  count: number;
}

export interface BranchAlertInput {
  branchId: string;
  branchName: string;
  /** Số ca thu ngân còn mở từ trước hôm nay (đáng lẽ đã chốt). */
  staleOpenShifts: number;
  /** Số phiếu chưa thu quá `OVERDUE_UNPAID_DAYS` ngày trong kỳ. */
  overdueUnpaid: number;
  /** Số lô còn tồn sẽ hết hạn trong `EXPIRING_BATCH_DAYS` ngày. */
  expiringBatches: number;
  /** Thời gian chờ trung bình (phút) của chi nhánh trong kỳ; `null` khi chưa đo được. */
  averageWaitMinutes: number | null;
}

const ALERT_ORDER: Record<SystemAlertKind, number> = { OPEN_SHIFTS: 0, OVERDUE_UNPAID: 1, EXPIRING_BATCHES: 2, LONG_WAIT: 3 };

/**
 * Danh sách "Cần chú ý" của màn Toàn hệ thống: mỗi chi nhánh một dòng cho mỗi vấn đề có thật (ca chưa chốt, phiếu chưa thu quá hạn, lô sắp hết hạn) và, khi có từ hai chi nhánh, MỘT dòng nêu chi
 * nhánh chờ lâu nhất nếu thời gian chờ trung bình từ `LONG_AVERAGE_WAIT_MINUTES` phút. Sắp theo loại vấn đề rồi theo số lượng giảm dần.
 */
export function buildSystemAlerts(branches: readonly BranchAlertInput[]): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  for (const b of branches) {
    if (b.staleOpenShifts > 0) alerts.push({ kind: 'OPEN_SHIFTS', branchId: b.branchId, branchName: b.branchName, count: b.staleOpenShifts, text: `${b.staleOpenShifts} ca thu ngân chưa chốt từ hôm qua` });
    if (b.overdueUnpaid > 0) alerts.push({ kind: 'OVERDUE_UNPAID', branchId: b.branchId, branchName: b.branchName, count: b.overdueUnpaid, text: `${b.overdueUnpaid} phiếu chưa thu quá ${OVERDUE_UNPAID_DAYS} ngày` });
    if (b.expiringBatches > 0) alerts.push({ kind: 'EXPIRING_BATCHES', branchId: b.branchId, branchName: b.branchName, count: b.expiringBatches, text: `${b.expiringBatches} lô thuốc hết hạn trong ${EXPIRING_BATCH_DAYS} ngày` });
  }
  if (branches.length >= 2) {
    const measured = branches.filter((b): b is BranchAlertInput & { averageWaitMinutes: number } => b.averageWaitMinutes !== null);
    const slowest = measured.sort((a, b) => b.averageWaitMinutes - a.averageWaitMinutes)[0];
    if (slowest && slowest.averageWaitMinutes >= LONG_AVERAGE_WAIT_MINUTES) {
      alerts.push({ kind: 'LONG_WAIT', branchId: slowest.branchId, branchName: slowest.branchName, count: Math.round(slowest.averageWaitMinutes), text: `Thời gian chờ trung bình ${Math.round(slowest.averageWaitMinutes)} phút, cao nhất hệ thống` });
    }
  }
  return alerts.sort((a, b) => ALERT_ORDER[a.kind] - ALERT_ORDER[b.kind] || b.count - a.count || a.branchName.localeCompare(b.branchName, 'vi'));
}

// ---- Xếp hạng nhiều chi nhánh ----

export interface RankInput {
  key: string;
  name: string;
  /** Chữ phụ dưới tên (nhóm dịch vụ, Khoa, loại mặt hàng). */
  subtitle: string;
  quantity: number;
  /** Số dùng để xếp hạng (ghi nhận, doanh thu sinh ra, lãi gộp). */
  amount: number;
}

export interface RankRow {
  key: string;
  name: string;
  subtitle: string;
  quantity: number;
  total: number;
  /** Giá trị của từng chi nhánh, đúng thứ tự `branchIds` truyền vào. */
  byBranch: number[];
}

/**
 * Ghép bảng xếp hạng của từng chi nhánh thành MỘT bảng toàn phạm vi: cộng theo khoá, xếp giảm dần theo tổng (bằng nhau thì theo tên), giữ `limit` dòng đầu, kèm giá trị từng chi nhánh.
 * Giá trị âm (lãi gộp lỗ) vẫn được xếp, đứng cuối.
 */
export function mergeBranchRankings(perBranch: ReadonlyArray<readonly RankInput[]>, limit: number): RankRow[] {
  const merged = new Map<string, RankRow>();
  perBranch.forEach((items, index) => {
    for (const item of items) {
      const row = merged.get(item.key) ?? { key: item.key, name: item.name, subtitle: item.subtitle, quantity: 0, total: 0, byBranch: perBranch.map(() => 0) };
      row.quantity += item.quantity;
      row.total += item.amount;
      row.byBranch[index] = (row.byBranch[index] ?? 0) + item.amount;
      merged.set(item.key, row);
    }
  });
  return [...merged.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'vi')).slice(0, limit);
}
