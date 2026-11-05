import { computeInvoiceDiscount, type DiscountType } from '../billing/invoice-discount';
import { allocateCollectionToGroups, REVENUE_GROUPS, type RevenueGroup, type RevenueLineInput } from './dashboard-math';
import { summarizePayments, type PaymentGroupInput } from './cashier-dashboard-math';

/**
 * Phép tính thuần cho "Báo cáo ngày" (docs/DECISIONS.md #287) — không biết gì về DB hay HTTP. Một báo cáo gồm số liệu của TỪNG chi nhánh trong phạm vi và dòng cộng;
 * dòng cộng luôn là tổng đúng của các chi nhánh (cùng một hàm `combineDailyBranches`), không tính lại bằng đường khác.
 */

/** Tên bốn nhóm doanh thu trên bản Excel/in của báo cáo (web có bản riêng vì chỉ được import KIỂU từ shared). */
export const REVENUE_GROUP_LABEL: Record<RevenueGroup, string> = {
  EXAM: 'Khám bệnh',
  PARACLINICAL: 'Cận lâm sàng',
  DRUG: 'Thuốc và vật tư',
  PACKAGE: 'Gói dịch vụ',
};

export interface DailyVisits {
  /** Lượt khám đã tiếp nhận trong ngày (đang chờ, đang khám, đã xong). */
  received: number;
  /** Khám mới / tái khám theo Loại tiếp nhận; lượt không có Loại tiếp nhận không tính vào cả hai. */
  newCount: number;
  returnCount: number;
  completed: number;
  /** Đang chờ hoặc đang khám tại thời điểm xem. */
  stillOpen: number;
  cancelled: number;
  noShow: number;
}

/** Số lượt khám trong ngày theo trạng thái (`encounter.status`). Trạng thái lạ bị bỏ qua. */
export function summarizeDailyVisits(statusCounts: ReadonlyMap<string, number>, newCount: number, returnCount: number): DailyVisits {
  const n = (status: string) => statusCounts.get(status) ?? 0;
  const checkedIn = n('CHECKED_IN');
  const inConsultation = n('IN_CONSULTATION');
  const completed = n('COMPLETED');
  return {
    received: checkedIn + inConsultation + completed,
    newCount,
    returnCount,
    completed,
    stillOpen: checkedIn + inConsultation,
    cancelled: n('CANCELLED'),
    noShow: n('NO_SHOW'),
  };
}

export interface DailyMethodTotal {
  methodCode: string;
  methodName: string;
  paymentCount: number;
  amount: number;
}

export interface DailyCollection {
  byMethod: DailyMethodTotal[];
  collectedCount: number;
  collectedAmount: number;
  refundedCount: number;
  refundedAmount: number;
  /** Thực thu = thu trừ hoàn. */
  netAmount: number;
}

/** Tiền thu/hoàn trong ngày theo NGÀY THU. Đếm lượt thu và lượt hoàn riêng (một phiếu trả nhiều lần có nhiều lượt). */
export function summarizeDailyCollection(groups: readonly PaymentGroupInput[], methodNames: ReadonlyMap<string, string>): DailyCollection {
  const totals = summarizePayments(groups, methodNames);
  const refundedCount = groups.filter((g) => g.type === 'REFUND').reduce((s, g) => s + g.paymentCount, 0);
  const byMethod = totals.byMethod.map((m) => ({ methodCode: m.methodCode, methodName: m.methodName, paymentCount: m.paymentCount, amount: m.amount }));
  return {
    byMethod,
    collectedCount: byMethod.reduce((s, m) => s + m.paymentCount, 0),
    collectedAmount: totals.collectedAmount,
    refundedCount,
    refundedAmount: totals.refundedAmount,
    netAmount: totals.netAmount,
  };
}

export interface RecognizedInvoiceInput {
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: readonly RevenueLineInput[];
}

export interface DailyRecognized {
  /** Tổng `dueAmount` (sau chiết khấu) của các phiếu chưa huỷ của lượt khám trong ngày — KHÔNG phải `invoice.total_amount`. */
  total: number;
  byGroup: Record<RevenueGroup, number>;
}

/** Doanh thu GHI NHẬN theo ngày khám: `dueAmount` từng phiếu, chia vào bốn nhóm theo tỉ trọng dòng. Tổng bốn nhóm luôn bằng `total`. */
export function summarizeRecognizedRevenue(invoices: readonly RecognizedInvoiceInput[]): DailyRecognized {
  const byGroup: Record<RevenueGroup, number> = { EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 };
  let total = 0;
  for (const invoice of invoices) {
    const due = computeInvoiceDiscount({ totalAmount: invoice.totalAmount, discountType: invoice.discountType, discountValue: invoice.discountValue, lines: invoice.lines }).dueAmount;
    total += due;
    const parts = allocateCollectionToGroups(due, invoice.lines);
    for (const group of REVENUE_GROUPS) byGroup[group] += parts[group];
  }
  return { total, byGroup };
}

export interface DailyShift {
  shiftNo: string;
  label: string;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  status: 'OPEN' | 'CLOSED';
  /** `null` khi ca chưa chốt (chưa có số dự kiến). */
  expectedCash: number | null;
  countedCash: number | null;
  /** `countedCash − expectedCash`; `null` khi ca chưa chốt hoặc chưa kiểm đếm. */
  discrepancy: number | null;
}

export function computeShiftDiscrepancy(expectedCash: number | null, countedCash: number | null): number | null {
  return expectedCash === null || countedCash === null ? null : countedCash - expectedCash;
}

export interface DailyBranchReport {
  branchId: string;
  branchName: string;
  visits: DailyVisits;
  collection: DailyCollection;
  recognized: DailyRecognized;
  unpaid: { invoiceCount: number; amount: number };
  shifts: DailyShift[];
  /** Phiếu thu/chi tại quầy (ngoài dịch vụ khám) đã ghi sổ trong ngày, không gồm Chuyển quỹ. */
  counterVouchers: { incomeAmount: number; expenseAmount: number };
}

export interface DailyTotals {
  visits: DailyVisits;
  collection: DailyCollection;
  recognized: DailyRecognized;
  unpaid: { invoiceCount: number; amount: number };
  counterVouchers: { incomeAmount: number; expenseAmount: number };
  /** Tổng chênh lệch kiểm đếm của các ca đã chốt. */
  shiftDiscrepancy: number;
}

/** Cộng số liệu các chi nhánh. Phương thức thanh toán gộp theo mã, sắp theo số tiền giảm dần (bằng nhau thì theo tên). */
export function combineDailyBranches(branches: readonly DailyBranchReport[]): DailyTotals {
  const visits: DailyVisits = { received: 0, newCount: 0, returnCount: 0, completed: 0, stillOpen: 0, cancelled: 0, noShow: 0 };
  const methods = new Map<string, DailyMethodTotal>();
  const collection: DailyCollection = { byMethod: [], collectedCount: 0, collectedAmount: 0, refundedCount: 0, refundedAmount: 0, netAmount: 0 };
  const recognized: DailyRecognized = { total: 0, byGroup: { EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 } };
  const unpaid = { invoiceCount: 0, amount: 0 };
  const counterVouchers = { incomeAmount: 0, expenseAmount: 0 };
  let shiftDiscrepancy = 0;

  for (const b of branches) {
    for (const key of Object.keys(visits) as Array<keyof DailyVisits>) visits[key] += b.visits[key];
    for (const m of b.collection.byMethod) {
      const entry = methods.get(m.methodCode) ?? { ...m, paymentCount: 0, amount: 0 };
      entry.paymentCount += m.paymentCount;
      entry.amount += m.amount;
      methods.set(m.methodCode, entry);
    }
    collection.collectedCount += b.collection.collectedCount;
    collection.collectedAmount += b.collection.collectedAmount;
    collection.refundedCount += b.collection.refundedCount;
    collection.refundedAmount += b.collection.refundedAmount;
    collection.netAmount += b.collection.netAmount;
    recognized.total += b.recognized.total;
    for (const group of REVENUE_GROUPS) recognized.byGroup[group] += b.recognized.byGroup[group];
    unpaid.invoiceCount += b.unpaid.invoiceCount;
    unpaid.amount += b.unpaid.amount;
    counterVouchers.incomeAmount += b.counterVouchers.incomeAmount;
    counterVouchers.expenseAmount += b.counterVouchers.expenseAmount;
    for (const shift of b.shifts) shiftDiscrepancy += shift.discrepancy ?? 0;
  }
  collection.byMethod = [...methods.values()].sort((a, b) => b.amount - a.amount || a.methodName.localeCompare(b.methodName, 'vi'));
  return { visits, collection, recognized, unpaid, counterVouchers, shiftDiscrepancy };
}
