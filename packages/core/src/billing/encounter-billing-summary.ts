/**
 * Tổng hợp chi phí của MỘT lượt khám từ các hoá đơn của nó (khám, thuốc, cận lâm sàng) cho tab "Lịch sử khám chữa bệnh" ở hồ sơ bệnh nhân (docs/DECISIONS.md #223).
 * Hàm thuần — nhận `dueAmount` ĐÃ tính (sau chiết khấu, xem `computeInvoiceDiscount`) và tổng đã hoàn của từng hoá đơn, không đụng DB.
 *
 * - Hoá đơn `CANCELLED` bỏ qua (không phát sinh tiền). Không còn hoá đơn nào → không có tóm tắt (`null`, giao diện hiện "—").
 * - `netAmount` = tổng phải thu − tổng đã hoàn, không âm.
 * - `paymentState`: còn hoá đơn chưa thu → `UNPAID`; còn lại, có hoàn tiền (một phần hoặc toàn phần) → `REFUNDED`; ngược lại `PAID`.
 */
export type EncounterPaymentState = 'PAID' | 'UNPAID' | 'REFUNDED';

export type InvoiceStatusForSummary = 'UNPAID' | 'PAID' | 'CANCELLED' | 'REFUNDED';

export interface InvoiceForBillingSummary {
  status: InvoiceStatusForSummary;
  dueAmount: number;
  refundedAmount: number;
}

export interface EncounterBillingSummary {
  netAmount: number;
  paymentState: EncounterPaymentState;
}

export function summarizeEncounterInvoices(invoices: readonly InvoiceForBillingSummary[]): EncounterBillingSummary | null {
  const live = invoices.filter((i) => i.status !== 'CANCELLED');
  if (live.length === 0) return null;
  const due = live.reduce((sum, i) => sum + i.dueAmount, 0);
  const refunded = live.reduce((sum, i) => sum + i.refundedAmount, 0);
  const paymentState: EncounterPaymentState = live.some((i) => i.status === 'UNPAID') ? 'UNPAID' : refunded > 0 ? 'REFUNDED' : 'PAID';
  return { netAmount: Math.max(due - refunded, 0), paymentState };
}
