import { computeInvoiceDiscount } from '../billing/invoice-discount';
import { allocateAmountByWeights, classifyInvoiceLine, lineNetWeight, REVENUE_GROUPS, type RevenueGroup, type RevenueLineInput } from './dashboard-math';
import type { RecognizedInvoiceInput } from './daily-report-math';

/**
 * Phép tính thuần của trang báo cáo "Doanh thu" (docs/DECISIONS.md #287). Hai cột tiền luôn tách bạch (điểm chốt 2 của kế hoạch báo cáo): GHI NHẬN = `dueAmount` sau chiết khấu
 * của phiếu chưa huỷ, theo NGÀY KHÁM; THỰC THU = thu trừ hoàn theo NGÀY THU. KHÔNG dùng `invoice.total_amount`. Không biết gì về DB hay HTTP.
 */

export type RevenueGroupBy = 'day' | 'week' | 'month' | 'quarter';

export const REVENUE_GROUP_BY_VALUES: readonly RevenueGroupBy[] = ['day', 'week', 'month', 'quarter'];

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Ngày không hợp lệ (cần YYYY-MM-DD): "${date}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Ngày đầu của khoảng gom chứa `date`: ngày, thứ Hai của tuần, mùng 1 của tháng, mùng 1 của tháng đầu quý. */
export function revenueBucketKey(date: string, groupBy: RevenueGroupBy): string {
  const ms = toUtcMs(date);
  switch (groupBy) {
    case 'day':
      return date;
    case 'week': {
      const isoDow = ((new Date(ms).getUTCDay() + 6) % 7) + 1;
      return fromUtcMs(ms - (isoDow - 1) * DAY_MS);
    }
    case 'month':
      return `${date.slice(0, 7)}-01`;
    case 'quarter': {
      const month = Number(date.slice(5, 7));
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return `${date.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
    }
  }
}

/** Các khoảng gom phủ `from..to`, theo thứ tự thời gian, không trùng. Khoảng đầu/cuối có thể lấn ra ngoài kỳ (tuần/tháng/quý cắt ngang) — số liệu chỉ gồm ngày trong kỳ. */
export function revenueBucketKeys(from: string, to: string, groupBy: RevenueGroupBy): string[] {
  const keys: string[] = [];
  const last = toUtcMs(to);
  for (let ms = toUtcMs(from); ms <= last; ms += DAY_MS) {
    const key = revenueBucketKey(fromUtcMs(ms), groupBy);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys;
}

/** Nhãn ngắn của khoảng gom: "05/11/2026", "02/11 – 08/11", "T11/2026", "Q4/2026". */
export function revenueBucketLabel(key: string, groupBy: RevenueGroupBy): string {
  const [y, m, d] = key.split('-');
  switch (groupBy) {
    case 'day':
      return `${d}/${m}/${y}`;
    case 'week': {
      const end = fromUtcMs(toUtcMs(key) + 6 * DAY_MS);
      return `${d}/${m} – ${end.slice(8, 10)}/${end.slice(5, 7)}`;
    }
    case 'month':
      return `T${Number(m)}/${y}`;
    case 'quarter':
      return `Q${Math.floor((Number(m) - 1) / 3) + 1}/${y}`;
  }
}

export interface InvoiceRecognition {
  /** Tổng gốc trước chiết khấu (`totalAmount`). */
  gross: number;
  discount: number;
  /** `dueAmount` — doanh thu ghi nhận của phiếu. */
  due: number;
  byGroup: Record<RevenueGroup, number>;
}

const emptyGroups = (): Record<RevenueGroup, number> => ({ EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 });

/** Ghi nhận của MỘT phiếu: số sau chiết khấu chia vào bốn nhóm theo tỉ trọng dòng (tổng bốn nhóm luôn bằng `due`). */
export function recognizeInvoice(invoice: RecognizedInvoiceInput): InvoiceRecognition {
  const result = computeInvoiceDiscount({ totalAmount: invoice.totalAmount, discountType: invoice.discountType, discountValue: invoice.discountValue, lines: invoice.lines });
  const byGroup = emptyGroups();
  if (invoice.lines.length === 0) {
    byGroup.EXAM = result.dueAmount;
  } else {
    const parts = allocateAmountByWeights(result.dueAmount, invoice.lines.map(lineNetWeight));
    invoice.lines.forEach((line, i) => {
      byGroup[classifyInvoiceLine(line)] += parts[i] ?? 0;
    });
  }
  return { gross: invoice.totalAmount, discount: result.discountAmount, due: result.dueAmount, byGroup };
}

export interface DatedInvoice extends RecognizedInvoiceInput {
  /** Ngày khám `YYYY-MM-DD` (giờ VN). */
  date: string;
}

export interface DatedPaymentTotal {
  /** Ngày thu `YYYY-MM-DD` (giờ VN). */
  date: string;
  type: 'PAYMENT' | 'REFUND';
  amount: number;
}

export interface RevenuePeriodRow {
  /** Ngày đầu của khoảng gom. */
  key: string;
  label: string;
  byGroup: Record<RevenueGroup, number>;
  recognized: number;
  discount: number;
  collected: number;
  refunded: number;
  /** Thực thu = thu trừ hoàn. */
  net: number;
  /** % thay đổi Thực thu so với khoảng liền trước; `null` ở khoảng đầu hoặc khi khoảng trước bằng 0. */
  netDeltaPercent: number | null;
}

export interface RevenuePeriodTotals {
  byGroup: Record<RevenueGroup, number>;
  recognized: number;
  discount: number;
  collected: number;
  refunded: number;
  net: number;
}

/**
 * Bộ cộng dồn doanh thu theo khoảng gom. Nạp phiếu và tiền thu từng lô (máy chủ đọc theo tháng để không giữ cả năm trong bộ nhớ), rồi `finish()` ra các dòng đã sắp thời gian.
 * Ngày ngoài `from..to` bị bỏ qua (an toàn khi một lô lấn ra ngoài kỳ).
 */
export function createRevenuePeriodAccumulator(from: string, to: string, groupBy: RevenueGroupBy) {
  const rows = new Map<string, RevenuePeriodRow>();
  for (const key of revenueBucketKeys(from, to, groupBy)) {
    rows.set(key, { key, label: revenueBucketLabel(key, groupBy), byGroup: emptyGroups(), recognized: 0, discount: 0, collected: 0, refunded: 0, net: 0, netDeltaPercent: null });
  }
  const rowOf = (date: string): RevenuePeriodRow | null => (date < from || date > to ? null : (rows.get(revenueBucketKey(date, groupBy)) ?? null));

  return {
    addInvoices(invoices: readonly DatedInvoice[]): void {
      for (const invoice of invoices) {
        const row = rowOf(invoice.date);
        if (!row) continue;
        const r = recognizeInvoice(invoice);
        row.recognized += r.due;
        row.discount += r.discount;
        for (const group of REVENUE_GROUPS) row.byGroup[group] += r.byGroup[group];
      }
    },
    addPayments(payments: readonly DatedPaymentTotal[]): void {
      for (const p of payments) {
        const row = rowOf(p.date);
        if (!row) continue;
        if (p.type === 'PAYMENT') row.collected += p.amount;
        else row.refunded += p.amount;
        row.net = row.collected - row.refunded;
      }
    },
    finish(): { rows: RevenuePeriodRow[]; totals: RevenuePeriodTotals } {
      const list = [...rows.values()];
      const totals: RevenuePeriodTotals = { byGroup: emptyGroups(), recognized: 0, discount: 0, collected: 0, refunded: 0, net: 0 };
      list.forEach((row, i) => {
        const prev = i > 0 ? list[i - 1]! : null;
        row.netDeltaPercent = prev === null || prev.net === 0 ? null : Math.round(((row.net - prev.net) / Math.abs(prev.net)) * 1000) / 10;
        totals.recognized += row.recognized;
        totals.discount += row.discount;
        totals.collected += row.collected;
        totals.refunded += row.refunded;
        totals.net += row.net;
        for (const group of REVENUE_GROUPS) totals.byGroup[group] += row.byGroup[group];
      });
      return { rows: list, totals };
    },
  };
}

// ---- Theo nhóm và dịch vụ ----

export interface ServiceLineInput extends RevenueLineInput {
  code: string;
  name: string;
  quantity: number;
}

export interface ServiceInvoiceInput {
  totalAmount: number;
  discountType: RecognizedInvoiceInput['discountType'];
  discountValue: number | null;
  lines: readonly ServiceLineInput[];
}

export interface ServiceBreakdownRow {
  group: RevenueGroup;
  code: string;
  name: string;
  /** Tổng số lượng đã dùng (cột `quantity` của dòng hoá đơn). */
  quantity: number;
  /** Số phiếu có dịch vụ này. */
  invoiceCount: number;
  /** Doanh thu ghi nhận của dịch vụ (phần của phiếu sau chiết khấu, chia theo tỉ trọng dòng). */
  amount: number;
}

/** Gom dịch vụ theo (nhóm, mã, tên): cộng dồn từng lô phiếu. Phiếu không có dòng thì không tạo dòng dịch vụ nào (tiền vẫn nằm ở tổng của tab Theo kỳ). */
export function createServiceBreakdownAccumulator() {
  const map = new Map<string, ServiceBreakdownRow>();
  return {
    addInvoices(invoices: readonly ServiceInvoiceInput[]): void {
      for (const invoice of invoices) {
        if (invoice.lines.length === 0) continue;
        const due = computeInvoiceDiscount({ totalAmount: invoice.totalAmount, discountType: invoice.discountType, discountValue: invoice.discountValue, lines: invoice.lines }).dueAmount;
        const parts = allocateAmountByWeights(due, invoice.lines.map(lineNetWeight));
        invoice.lines.forEach((line, i) => {
          const group = classifyInvoiceLine(line);
          const key = `${group}|${line.code}|${line.name}`;
          const row = map.get(key) ?? { group, code: line.code, name: line.name, quantity: 0, invoiceCount: 0, amount: 0 };
          row.quantity += line.quantity;
          row.invoiceCount += 1;
          row.amount += parts[i] ?? 0;
          map.set(key, row);
        });
      }
    },
    finish(): { rows: ServiceBreakdownRow[]; byGroup: Record<RevenueGroup, { quantity: number; amount: number }> } {
      const rows = [...map.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'vi'));
      const byGroup = { EXAM: { quantity: 0, amount: 0 }, PARACLINICAL: { quantity: 0, amount: 0 }, DRUG: { quantity: 0, amount: 0 }, PACKAGE: { quantity: 0, amount: 0 } };
      for (const r of rows) {
        byGroup[r.group].quantity += r.quantity;
        byGroup[r.group].amount += r.amount;
      }
      return { rows, byGroup };
    },
  };
}

/** Tỉ trọng phần trăm (1 chữ số thập phân) của `part` trên `whole`; `null` khi `whole` ≤ 0. */
export function sharePercent(part: number, whole: number): number | null {
  return whole <= 0 ? null : Math.round((part / whole) * 1000) / 10;
}

/** Chia `from..to` thành các đoạn không quá một tháng lịch (đoạn đầu/cuối có thể ngắn hơn) — máy chủ nạp phiếu từng đoạn để không giữ cả năm trong bộ nhớ. */
export function splitIntoMonthChunks(from: string, to: string): Array<{ from: string; to: string }> {
  return revenueBucketKeys(from, to, 'month').map((key) => {
    const [y, m] = key.split('-').map(Number) as [number, number];
    const lastDay = fromUtcMs(Date.UTC(y, m, 1) - DAY_MS);
    return { from: key < from ? from : key, to: lastDay > to ? to : lastDay };
  });
}
