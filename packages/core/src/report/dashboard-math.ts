import { computeDiscountAmount, type DiscountType } from '../billing/invoice-discount';

/**
 * Phép tính thuần cho Trang Tổng quan và các báo cáo (docs/DECISIONS.md #279) — không biết gì về DB hay HTTP, để máy chủ tính đúng một nơi và test được kỹ.
 */

/** Bốn nhóm doanh thu của Trang Tổng quan, suy ra từ NGUỒN của dòng hoá đơn (`invoice_line`). */
export type RevenueGroup = 'EXAM' | 'PARACLINICAL' | 'DRUG' | 'PACKAGE';

export const REVENUE_GROUPS: readonly RevenueGroup[] = ['EXAM', 'PARACLINICAL', 'DRUG', 'PACKAGE'];

export interface InvoiceLineSource {
  sourceServiceItemId: string | null;
  sourceStockIssueLineId: string | null;
  sourceOrderItemId: string | null;
  sourceOrderPackageId: string | null;
}

/**
 * Dòng hoá đơn thuộc nhóm nào: dòng nguồn từ dịch vụ khám → Khám bệnh; từ Phiếu xuất kho → Thuốc và vật tư; từ chỉ định lẻ → Cận lâm sàng; từ gói → Gói dịch vụ
 * (CSDL có CHECK đúng-1-trong-4 nguồn). Không nguồn nào (dữ liệu cũ bất thường) thì xếp Khám bệnh để không làm mất tiền khỏi tổng.
 */
export function classifyInvoiceLine(line: InvoiceLineSource): RevenueGroup {
  if (line.sourceStockIssueLineId) return 'DRUG';
  if (line.sourceOrderPackageId) return 'PACKAGE';
  if (line.sourceOrderItemId) return 'PARACLINICAL';
  return 'EXAM';
}

/**
 * Chia `amount` (số nguyên đồng, có thể ÂM khi hoàn nhiều hơn thu) theo tỉ lệ `weights` — phương pháp phần dư lớn nhất để TỔNG các phần luôn đúng bằng `amount`
 * (không lệch 1 đồng do làm tròn từng phần). Mọi trọng số bằng 0 (hoặc rỗng): phần đầu nhận cả số tiền.
 */
export function allocateAmountByWeights(amount: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (totalWeight <= 0 || amount === 0) return weights.map((_, i) => (i === 0 ? amount : 0));

  const sign = amount < 0 ? -1 : 1;
  const absAmount = Math.abs(amount);
  const exact = weights.map((w) => (Math.max(0, w) * absAmount) / totalWeight);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = absAmount - floors.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder -= 1;
  }
  return floors.map((x) => sign * x);
}

export interface RevenueLineInput extends InvoiceLineSource {
  lineTotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
}

/** Giá trị dòng sau chiết khấu RIÊNG của dòng (chiết khấu toàn phiếu tỉ lệ đều nên không làm đổi tỉ trọng giữa các nhóm). */
export function lineNetWeight(line: Pick<RevenueLineInput, 'lineTotal' | 'discountType' | 'discountValue'>): number {
  return Math.max(0, line.lineTotal - computeDiscountAmount(line.lineTotal, line.discountType, line.discountValue));
}

/**
 * Chia số tiền THỰC THU của MỘT phiếu (đã thu trừ đã hoàn trong kỳ) vào bốn nhóm doanh thu theo tỉ trọng giá trị các dòng. Phiếu không có dòng thì dồn vào Khám bệnh.
 * Tổng bốn nhóm luôn đúng bằng `collectedAmount`.
 */
export function allocateCollectionToGroups(collectedAmount: number, lines: readonly RevenueLineInput[]): Record<RevenueGroup, number> {
  const result: Record<RevenueGroup, number> = { EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 };
  if (lines.length === 0) {
    result.EXAM = collectedAmount;
    return result;
  }
  const parts = allocateAmountByWeights(collectedAmount, lines.map(lineNetWeight));
  lines.forEach((line, index) => {
    result[classifyInvoiceLine(line)] += parts[index] ?? 0;
  });
  return result;
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface Delta {
  /** `current − previous`. */
  diff: number;
  /** Phần trăm so với kỳ trước, làm tròn 1 chữ số; `null` khi kỳ trước bằng 0 (không chia được). */
  percent: number | null;
  direction: DeltaDirection;
}

export function computeDelta(current: number, previous: number): Delta {
  const diff = current - previous;
  const percent = previous === 0 ? null : Math.round((diff / Math.abs(previous)) * 1000) / 10;
  return { diff, percent, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
}

/** Tỉ lệ phần trăm nguyên (làm tròn), 0 khi mẫu số 0. */
export function percentOf(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

/** Điền chuỗi theo ngày: mỗi ngày trong `dates` lấy giá trị của hàng cùng ngày, ngày không có hàng = 0 (để biểu đồ không bị "đứt" ngày). */
export function fillDailySeries(dates: readonly string[], rows: readonly { date: string; value: number }[]): number[] {
  const byDate = new Map<string, number>();
  for (const row of rows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.value);
  return dates.map((d) => byDate.get(d) ?? 0);
}

/** Giờ đông nhất trong chuỗi theo giờ; `null` khi không có lượt nào. Hoà thì lấy giờ sớm hơn. */
export function findPeakHour(hourly: readonly { hour: number; count: number }[]): { hour: number; count: number } | null {
  let best: { hour: number; count: number } | null = null;
  for (const item of hourly) {
    if (item.count > 0 && (best === null || item.count > best.count)) best = item;
  }
  return best;
}
