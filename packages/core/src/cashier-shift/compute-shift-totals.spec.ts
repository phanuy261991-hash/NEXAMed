import { describe, expect, it } from 'vitest';
import { computeCashierShiftTotals, type CashierShiftPaymentInput } from './compute-shift-totals';

describe('computeCashierShiftTotals', () => {
  it('không có phiếu thu nào — dự kiến = đúng vốn đầu ca', () => {
    const totals = computeCashierShiftTotals(500_000, []);
    expect(totals).toEqual({
      cashInAmount: 0,
      cashInCount: 0,
      cashOutAmount: 0,
      cashOutCount: 0,
      nonCashBreakdown: [],
      expectedCashAmount: 500_000,
      otherCashInAmount: 0,
      otherCashInCount: 0,
      otherCashOutAmount: 0,
      otherCashOutCount: 0,
    });
  });

  it('gộp đúng thu/hoàn tiền mặt vào dự kiến, bỏ qua phi tiền mặt', () => {
    const payments: CashierShiftPaymentInput[] = [
      { methodCode: 'CASH', methodLabel: 'Tiền mặt', isCash: true, type: 'PAYMENT', amount: 6_850_000 },
      { methodCode: 'CASH', methodLabel: 'Tiền mặt', isCash: true, type: 'REFUND', amount: 450_000 },
      { methodCode: 'BANK_TRANSFER', methodLabel: 'Chuyển khoản', isCash: false, type: 'PAYMENT', amount: 3_200_000 },
    ];
    const totals = computeCashierShiftTotals(500_000, payments);
    expect(totals.cashInAmount).toBe(6_850_000);
    expect(totals.cashInCount).toBe(1);
    expect(totals.cashOutAmount).toBe(450_000);
    expect(totals.cashOutCount).toBe(1);
    expect(totals.expectedCashAmount).toBe(500_000 + 6_850_000 - 450_000);
  });

  it('gộp phi tiền mặt theo từng hình thức, REFUND trừ ngược đúng hình thức gốc', () => {
    const payments: CashierShiftPaymentInput[] = [
      { methodCode: 'BANK_TRANSFER', methodLabel: 'Chuyển khoản', isCash: false, type: 'PAYMENT', amount: 2_000_000 },
      { methodCode: 'BANK_TRANSFER', methodLabel: 'Chuyển khoản', isCash: false, type: 'PAYMENT', amount: 1_200_000 },
      { methodCode: 'CARD', methodLabel: 'Quẹt thẻ', isCash: false, type: 'PAYMENT', amount: 1_100_000 },
      { methodCode: 'BANK_TRANSFER', methodLabel: 'Chuyển khoản', isCash: false, type: 'REFUND', amount: 200_000 },
    ];
    const totals = computeCashierShiftTotals(0, payments);
    expect(totals.nonCashBreakdown).toEqual([
      { method: 'BANK_TRANSFER', methodLabel: 'Chuyển khoản', count: 3, amount: 3_000_000 },
      { method: 'CARD', methodLabel: 'Quẹt thẻ', count: 1, amount: 1_100_000 },
    ]);
  });

  it('"Thu chi tại quầy" — dòng source=VOUCHER vẫn cộng vào tổng gộp (không đổi expectedCashAmount) nhưng tách riêng được ở other*', () => {
    const payments: CashierShiftPaymentInput[] = [
      { methodCode: 'CASH', methodLabel: 'Tiền mặt', isCash: true, type: 'PAYMENT', amount: 8_500_000 }, // thu khám
      { methodCode: 'CASH', methodLabel: 'Tiền mặt', isCash: true, type: 'PAYMENT', amount: 150_000, source: 'VOUCHER' }, // bán phế liệu
      { methodCode: 'CASH', methodLabel: 'Tiền mặt', isCash: true, type: 'REFUND', amount: 1_200_000, source: 'VOUCHER' }, // chi tiền điện
    ];
    const totals = computeCashierShiftTotals(2_000_000, payments);
    expect(totals.cashInAmount).toBe(8_650_000);
    expect(totals.cashOutAmount).toBe(1_200_000);
    expect(totals.expectedCashAmount).toBe(2_000_000 + 8_650_000 - 1_200_000);
    expect(totals.otherCashInAmount).toBe(150_000);
    expect(totals.otherCashInCount).toBe(1);
    expect(totals.otherCashOutAmount).toBe(1_200_000);
    expect(totals.otherCashOutCount).toBe(1);
  });

  it('không truyền source (payment cũ trước GĐ1) → other* luôn 0', () => {
    const payments: CashierShiftPaymentInput[] = [{ methodCode: 'CASH', methodLabel: 'Tiền mặt', isCash: true, type: 'PAYMENT', amount: 300_000 }];
    const totals = computeCashierShiftTotals(0, payments);
    expect(totals.otherCashInAmount).toBe(0);
    expect(totals.otherCashOutAmount).toBe(0);
  });
});
