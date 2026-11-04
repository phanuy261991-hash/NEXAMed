/**
 * Phép tính thuần cho Trang Tổng quan của THU NGÂN (docs/DECISIONS.md #283) — không biết gì về DB hay HTTP.
 */

export type PaymentKind = 'PAYMENT' | 'REFUND';

/** Một nhóm dòng `payment` đã gộp theo (phương thức, loại, giờ thu VN). */
export interface PaymentGroupInput {
  methodCode: string;
  type: PaymentKind;
  hour: number;
  paymentCount: number;
  amount: number;
}

export interface MethodTotal {
  methodCode: string;
  methodName: string;
  amount: number;
  paymentCount: number;
}

export interface CashierPaymentTotals {
  collectedAmount: number;
  refundedAmount: number;
  netAmount: number;
  byMethod: MethodTotal[];
  /** Đủ 24 giờ, thực thu ròng (thu trừ hoàn) từng giờ. */
  hourly: Array<{ hour: number; amount: number }>;
}

/**
 * Gộp các nhóm thanh toán thành số liệu của Trang Tổng quan thu ngân. "Đã thu theo phương thức" chỉ cộng tiền THU (chưa trừ hoàn) để tổng các phương thức khớp ô "Đã thu";
 * hoàn tiền hiện ở ô riêng và được trừ vào dải theo giờ. Phương thức không có trong danh mục lấy chính mã làm tên. Sắp theo số tiền giảm dần, bằng nhau thì theo tên.
 */
export function summarizePayments(groups: readonly PaymentGroupInput[], methodNames: ReadonlyMap<string, string>): CashierPaymentTotals {
  let collectedAmount = 0;
  let refundedAmount = 0;
  const methods = new Map<string, MethodTotal>();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0 }));

  for (const g of groups) {
    const signed = g.type === 'PAYMENT' ? g.amount : -g.amount;
    const slot = hourly[g.hour];
    if (slot) slot.amount += signed;
    if (g.type === 'REFUND') {
      refundedAmount += g.amount;
      continue;
    }
    collectedAmount += g.amount;
    const entry = methods.get(g.methodCode) ?? { methodCode: g.methodCode, methodName: methodNames.get(g.methodCode) ?? g.methodCode, amount: 0, paymentCount: 0 };
    entry.amount += g.amount;
    entry.paymentCount += g.paymentCount;
    methods.set(g.methodCode, entry);
  }

  const byMethod = [...methods.values()].sort((a, b) => b.amount - a.amount || a.methodName.localeCompare(b.methodName, 'vi'));
  return { collectedAmount, refundedAmount, netAmount: collectedAmount - refundedAmount, byMethod, hourly };
}

/**
 * Tóm tắt dịch vụ trên một phiếu cho cột "Bệnh nhân" ("Khám nội, Công thức máu +1"): tên không lặp, giữ thứ tự xuất hiện, tối đa `max` tên rồi "+N". Phiếu không có dòng → chuỗi rỗng.
 */
export function summarizeInvoiceLineNames(names: readonly string[], max = 2): string {
  const unique: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name !== '' && !unique.includes(name)) unique.push(name);
  }
  if (unique.length <= max) return unique.join(', ');
  return `${unique.slice(0, max).join(', ')} +${unique.length - max}`;
}
