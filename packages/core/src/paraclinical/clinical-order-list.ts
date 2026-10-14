/**
 * Logic thuần của hai màn tra cứu cận lâm sàng (docs/DECISIONS.md #232): tiến độ + thanh toán của một dòng "Phiếu chỉ định" (phiếu × nhóm dịch vụ), và tóm tắt kết quả
 * của dòng "Tra cứu kết quả". Không phụ thuộc framework — API dùng ở service; web chỉ hiển thị phần đã tính.
 */

export type OrderListGroup = 'LAB' | 'IMAGING' | 'EXTERNAL';
export type OrderListItemStatus = 'ORDERED' | 'IN_PROGRESS' | 'RESULTED' | 'COMPLETED' | 'CANCELLED';
export type OrderRowProgressState = 'WAITING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'EXTERNAL';
export type OrderRowPayment = 'PAID' | 'UNPAID' | 'REFUNDED' | 'NOT_CHARGED';

export interface OrderRowProgress {
  state: OrderRowProgressState;
  done: number;
  total: number;
}

/**
 * Tiến độ của các dịch vụ thuộc MỘT nhóm trong MỘT phiếu. Dòng đã huỷ không tính vào tổng; tất cả đã huỷ → `CANCELLED` (total = 0). Nhóm ra ngoài không có tiến độ.
 * Chờ = mọi dịch vụ chưa bắt đầu; Xong = mọi dịch vụ đã có kết quả được duyệt; còn lại = đang thực hiện (kể cả xong một phần).
 */
export function deriveOrderRowProgress(group: OrderListGroup, statuses: readonly OrderListItemStatus[]): OrderRowProgress {
  const live = statuses.filter((s) => s !== 'CANCELLED');
  if (group === 'EXTERNAL') return { state: live.length === 0 ? 'CANCELLED' : 'EXTERNAL', done: 0, total: live.length };
  if (live.length === 0) return { state: 'CANCELLED', done: 0, total: 0 };
  const done = live.filter((s) => s === 'COMPLETED').length;
  if (done === live.length) return { state: 'DONE', done, total: live.length };
  if (live.every((s) => s === 'ORDERED')) return { state: 'WAITING', done, total: live.length };
  return { state: 'IN_PROGRESS', done, total: live.length };
}

export interface OrderRowPaymentItem {
  status: OrderListItemStatus;
  /** Trạng thái các hoá đơn chứa tiền của dịch vụ (dòng lẻ hoặc gói chứa nó); rỗng = chưa có dòng hoá đơn nào. */
  invoiceStatuses: readonly string[];
}

/**
 * Thanh toán của các dịch vụ thuộc nhóm. Nhóm ra ngoài hoặc không dịch vụ nào có tiền → `NOT_CHARGED`. Có hoá đơn đã hoàn tiền → `REFUNDED`. Mọi dịch vụ (chưa huỷ) có tiền đều nằm trên
 * hoá đơn đã thu → `PAID`; còn lại `UNPAID`. Dịch vụ đã huỷ không tính, trừ khi hoá đơn của nó đã hoàn tiền.
 */
export function deriveOrderRowPayment(group: OrderListGroup, items: readonly OrderRowPaymentItem[]): OrderRowPayment {
  if (group === 'EXTERNAL') return 'NOT_CHARGED';
  if (items.some((i) => i.invoiceStatuses.includes('REFUNDED'))) return 'REFUNDED';
  const live = items.filter((i) => i.status !== 'CANCELLED');
  if (live.length === 0) return 'NOT_CHARGED';
  const charged = live.filter((i) => i.invoiceStatuses.length > 0);
  if (charged.length === 0) return live.length > 0 ? 'UNPAID' : 'NOT_CHARGED';
  const everyChargedPaid = charged.every((i) => i.invoiceStatuses.every((s) => s === 'PAID'));
  return everyChargedPaid && charged.length === live.length ? 'PAID' : 'UNPAID';
}

export type LookupSummary = 'ABNORMAL' | 'NORMAL' | 'HAS_CONCLUSION' | 'NONE';

/** Tóm tắt kết quả: xét nghiệm có chỉ số cao/thấp/bất thường → `ABNORMAL`; có chỉ số được đánh giá mà không bất thường → `NORMAL`; CĐHA/thăm dò có kết luận → `HAS_CONCLUSION`. */
export function summarizeLookupResult(input: { isLab: boolean; abnormalCount: number; evaluatedCount: number; hasConclusion: boolean }): LookupSummary {
  if (input.isLab) {
    if (input.abnormalCount > 0) return 'ABNORMAL';
    return input.evaluatedCount > 0 ? 'NORMAL' : 'NONE';
  }
  return input.hasConclusion ? 'HAS_CONCLUSION' : 'NONE';
}

/** Cờ vượt khoảng tham chiếu (cao/thấp/bất thường chữ) tính là "bất thường". */
export function isAbnormalFlag(flag: string | null | undefined): boolean {
  return flag === 'LOW' || flag === 'HIGH' || flag === 'ABNORMAL';
}
