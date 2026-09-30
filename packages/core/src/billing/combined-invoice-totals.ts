import { computeDailyBillingTotals, type InvoiceLifecycleStatus } from './invoice-lifecycle';

/**
 * In gộp nhiều phiếu thu cùng 1 lượt khám (Phiếu thu tổng hợp) — tổng hợp số tiền cho phần cuối
 * bản in. Hàm THUẦN, tái dùng `computeDailyBillingTotals()` cho phần chia theo trạng thái (đã thu /
 * đã hoàn / còn phải thu) để KHÔNG có 2 nguồn quy ước khác nhau về phiếu `REFUNDED` (vẫn tính vào
 * "đã thu" rồi trừ ra ở "thực thu" — đối soát két không lệch).
 *
 * Phiếu `CANCELLED` bị loại khỏi bản in gộp (chứng từ đã vô hiệu) nên cũng không tính vào bất kỳ
 * tổng nào ở đây — người gọi nên lọc trước, hàm này vẫn bỏ qua phòng vệ.
 */
export interface CombinedInvoiceInput {
  status: InvoiceLifecycleStatus;
  /** Tổng TRƯỚC chiết khấu (gross). */
  totalAmount: number;
  /** Tổng tiền chiết khấu đã tính (0 nếu không chiết khấu). */
  discountAmount: number;
  /** `totalAmount - discountAmount` — số tiền THẬT thu/hoàn/còn chờ thu. */
  dueAmount: number;
  /** Hoàn một phần (#203) — tổng đã hoàn của phiếu còn `PAID`; bỏ trống = chưa hoàn. */
  refundedAmount?: number;
}

export interface CombinedInvoiceTotals {
  /** Số phiếu thực sự có trong bản in (không tính `CANCELLED`). */
  invoiceCount: number;
  /** Tổng gross trước chiết khấu của mọi phiếu trong bản in. */
  grossAmount: number;
  /** Tổng chiết khấu của mọi phiếu trong bản in. */
  discountAmount: number;
  /** Tổng đã thu — gồm cả phiếu sau đó bị hoàn. */
  paidAmount: number;
  /** Tổng đã hoàn tiền. */
  refundedAmount: number;
  /** Còn phải thu — tổng các phiếu `UNPAID`. */
  unpaidAmount: number;
}

export function computeCombinedInvoiceTotals(invoices: readonly CombinedInvoiceInput[]): CombinedInvoiceTotals {
  const included = invoices.filter((i) => i.status !== 'CANCELLED');
  const byStatus = computeDailyBillingTotals(included);
  return {
    invoiceCount: included.length,
    grossAmount: included.reduce((sum, i) => sum + i.totalAmount, 0),
    discountAmount: included.reduce((sum, i) => sum + i.discountAmount, 0),
    paidAmount: byStatus.paidTotalAmount,
    refundedAmount: byStatus.refundedTotalAmount,
    unpaidAmount: byStatus.unpaidTotalAmount,
  };
}
