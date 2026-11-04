import { describe, expect, it } from 'vitest';
import { summarizeInvoiceLineNames, summarizePayments, type PaymentGroupInput } from './cashier-dashboard-math';

const NAMES = new Map([
  ['CASH', 'Tiền mặt'],
  ['TRANSFER', 'Chuyển khoản'],
  ['WALLET', 'Trừ ví tạm ứng'],
]);

describe('summarizePayments', () => {
  it('cộng thu theo phương thức, trừ hoàn ở thực thu, tổng phương thức khớp ô Đã thu', () => {
    const groups: PaymentGroupInput[] = [
      { methodCode: 'CASH', type: 'PAYMENT', hour: 8, paymentCount: 2, amount: 500_000 },
      { methodCode: 'CASH', type: 'PAYMENT', hour: 10, paymentCount: 1, amount: 300_000 },
      { methodCode: 'TRANSFER', type: 'PAYMENT', hour: 10, paymentCount: 1, amount: 900_000 },
      { methodCode: 'CASH', type: 'REFUND', hour: 11, paymentCount: 1, amount: 200_000 },
    ];
    const r = summarizePayments(groups, NAMES);
    expect(r.collectedAmount).toBe(1_700_000);
    expect(r.refundedAmount).toBe(200_000);
    expect(r.netAmount).toBe(1_500_000);
    expect(r.byMethod.map((m) => [m.methodCode, m.amount, m.paymentCount])).toEqual([
      ['TRANSFER', 900_000, 1],
      ['CASH', 800_000, 3],
    ]);
    expect(r.byMethod.reduce((s, m) => s + m.amount, 0)).toBe(r.collectedAmount);
  });

  it('dải theo giờ là thực thu ròng, đủ 24 giờ, giờ có hoàn nhiều hơn thu thì âm', () => {
    const r = summarizePayments(
      [
        { methodCode: 'CASH', type: 'PAYMENT', hour: 9, paymentCount: 1, amount: 400_000 },
        { methodCode: 'CASH', type: 'REFUND', hour: 9, paymentCount: 1, amount: 150_000 },
        { methodCode: 'CASH', type: 'REFUND', hour: 15, paymentCount: 1, amount: 100_000 },
      ],
      NAMES,
    );
    expect(r.hourly).toHaveLength(24);
    expect(r.hourly[9]!.amount).toBe(250_000);
    expect(r.hourly[15]!.amount).toBe(-100_000);
    expect(r.hourly[0]!.amount).toBe(0);
    expect(r.hourly.reduce((s, h) => s + h.amount, 0)).toBe(r.netAmount);
  });

  it('phương thức lạ lấy mã làm tên; ngày trống cho toàn số 0', () => {
    const r = summarizePayments([{ methodCode: 'MOMO', type: 'PAYMENT', hour: 7, paymentCount: 1, amount: 50_000 }], NAMES);
    expect(r.byMethod[0]!.methodName).toBe('MOMO');
    const empty = summarizePayments([], NAMES);
    expect(empty).toMatchObject({ collectedAmount: 0, refundedAmount: 0, netAmount: 0, byMethod: [] });
  });

  it('bằng tiền thì xếp theo tên tiếng Việt', () => {
    const r = summarizePayments(
      [
        { methodCode: 'WALLET', type: 'PAYMENT', hour: 8, paymentCount: 1, amount: 100_000 },
        { methodCode: 'CASH', type: 'PAYMENT', hour: 8, paymentCount: 1, amount: 100_000 },
      ],
      NAMES,
    );
    expect(r.byMethod.map((m) => m.methodCode)).toEqual(['CASH', 'WALLET']);
  });
});

describe('summarizeInvoiceLineNames', () => {
  it('liệt kê tối đa 2 tên rồi +N, bỏ tên trùng và rỗng, giữ thứ tự', () => {
    expect(summarizeInvoiceLineNames(['Khám nội', 'Công thức máu', 'Khám nội', ' ', 'Siêu âm'])).toBe('Khám nội, Công thức máu +1');
    expect(summarizeInvoiceLineNames(['Khám nội'])).toBe('Khám nội');
    expect(summarizeInvoiceLineNames(['A', 'B'])).toBe('A, B');
    expect(summarizeInvoiceLineNames([])).toBe('');
  });
});
