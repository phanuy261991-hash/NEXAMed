/** 1 dòng `payment` đã query sẵn (repository JOIN `reference_catalog` lấy `countsAsCash`/tên hiển thị). */
export interface CashierShiftPaymentInput {
  methodCode: string;
  methodLabel: string;
  isCash: boolean;
  type: 'PAYMENT' | 'REFUND';
  amount: number;
}

export interface CashierShiftNonCashBreakdown {
  method: string;
  methodLabel: string;
  count: number;
  amount: number;
}

export interface CashierShiftTotals {
  cashInAmount: number;
  cashInCount: number;
  cashOutAmount: number;
  cashOutCount: number;
  nonCashBreakdown: CashierShiftNonCashBreakdown[];
  expectedCashAmount: number;
}

/**
 * "Tổng kết hệ thống" (bước 1 wizard Chốt ca, cũng dùng cho "Tính toán lại" sau khi chốt) — hàm
 * thuần nhận mảng `payment` đã query sẵn (không tự query DB, cùng phong cách
 * `computeDailyBillingTotals()` ở `billing/invoice-lifecycle.ts`), dễ unit test.
 *
 * Tiền mặt (`isCash=true`) gộp thành 2 số `cashInAmount`/`cashOutAmount` để tính
 * `expectedCashAmount` — đây là số duy nhất thu ngân phải đối chiếu bằng cách đếm tay. Phi tiền
 * mặt (chuyển khoản/thẻ...) chỉ cần tổng hợp hiển thị THEO TỪNG HÌNH THỨC (đối chiếu qua sao kê,
 * không đếm), REFUND trừ ngược vào đúng hình thức gốc.
 */
export function computeCashierShiftTotals(openingFloatActual: number, payments: readonly CashierShiftPaymentInput[]): CashierShiftTotals {
  let cashInAmount = 0;
  let cashInCount = 0;
  let cashOutAmount = 0;
  let cashOutCount = 0;
  const nonCashMap = new Map<string, CashierShiftNonCashBreakdown>();

  for (const payment of payments) {
    if (payment.isCash) {
      if (payment.type === 'PAYMENT') {
        cashInAmount += payment.amount;
        cashInCount += 1;
      } else {
        cashOutAmount += payment.amount;
        cashOutCount += 1;
      }
      continue;
    }
    const existing = nonCashMap.get(payment.methodCode) ?? {
      method: payment.methodCode,
      methodLabel: payment.methodLabel,
      count: 0,
      amount: 0,
    };
    existing.count += 1;
    existing.amount += payment.type === 'PAYMENT' ? payment.amount : -payment.amount;
    nonCashMap.set(payment.methodCode, existing);
  }

  return {
    cashInAmount,
    cashInCount,
    cashOutAmount,
    cashOutCount,
    nonCashBreakdown: Array.from(nonCashMap.values()),
    expectedCashAmount: openingFloatActual + cashInAmount - cashOutAmount,
  };
}
