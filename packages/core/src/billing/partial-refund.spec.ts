import { describe, expect, it } from 'vitest';
import { allocateInvoiceDueToLines, allocateRefundAcrossPayments, computeLineRefundAmount } from './partial-refund';

const noDiscount = { discountType: null, discountValue: null } as const;

describe('allocateInvoiceDueToLines', () => {
  it('không chiết khấu: net từng dòng bằng lineTotal', () => {
    const net = allocateInvoiceDueToLines({
      totalAmount: 100_000,
      ...noDiscount,
      lines: [
        { lineTotal: 60_000, ...noDiscount },
        { lineTotal: 40_000, ...noDiscount },
      ],
    });
    expect(net).toEqual([60_000, 40_000]);
  });

  it('chiết khấu toàn phiếu: tổng net khớp dueAmount từng đồng dù không chia hết', () => {
    // 10% của 100.001 = 10.000 (làm tròn) → due 90.001, chia cho 3 dòng gần bằng nhau.
    const lines = [{ lineTotal: 33_334, ...noDiscount }, { lineTotal: 33_334, ...noDiscount }, { lineTotal: 33_333, ...noDiscount }];
    const net = allocateInvoiceDueToLines({ totalAmount: 100_001, discountType: 'PERCENT', discountValue: 10, lines });
    expect(net.reduce((a, b) => a + b, 0)).toBe(90_001);
    expect(net).toHaveLength(3);
  });

  it('chiết khấu toàn phiếu dạng số tiền cố định: tổng net khớp', () => {
    const net = allocateInvoiceDueToLines({
      totalAmount: 90_000,
      discountType: 'AMOUNT',
      discountValue: 10_000,
      lines: [{ lineTotal: 50_000, ...noDiscount }, { lineTotal: 40_000, ...noDiscount }],
    });
    expect(net.reduce((a, b) => a + b, 0)).toBe(80_000);
  });

  it('chiết khấu từng dòng: net = lineTotal − chiết khấu của chính dòng đó', () => {
    const net = allocateInvoiceDueToLines({
      totalAmount: 100_000,
      ...noDiscount,
      lines: [
        { lineTotal: 60_000, discountType: 'PERCENT', discountValue: 10 },
        { lineTotal: 40_000, ...noDiscount },
      ],
    });
    expect(net).toEqual([54_000, 40_000]);
  });

  it('phần dư lớn nhất được cộng cho dòng có phần dư cao nhất, hoà thì dòng đứng trước', () => {
    // due 10 chia 3 dòng bằng nhau → 3,3,3 dư 1 → dòng đầu nhận thêm 1.
    const net = allocateInvoiceDueToLines({
      totalAmount: 10,
      ...noDiscount,
      lines: [{ lineTotal: 1, ...noDiscount }, { lineTotal: 1, ...noDiscount }, { lineTotal: 1, ...noDiscount }],
    });
    expect(net).toEqual([4, 3, 3]);
  });

  it('tổng lineTotal bằng 0 → mọi dòng 0, không chia cho 0', () => {
    expect(allocateInvoiceDueToLines({ totalAmount: 0, ...noDiscount, lines: [{ lineTotal: 0, ...noDiscount }] })).toEqual([0]);
  });
});

describe('computeLineRefundAmount', () => {
  it('hoàn một phần theo tỷ lệ số lượng', () => {
    expect(computeLineRefundAmount(52_500, 21, 0, 7)).toBe(17_500);
  });

  it('chia thành nhiều lần, TỔNG khi trả hết đúng bằng net dòng (không lệch đồng nào)', () => {
    const net = 10_000;
    const qty = 3;
    const first = computeLineRefundAmount(net, qty, 0, 1);
    const second = computeLineRefundAmount(net, qty, 1, 1);
    const third = computeLineRefundAmount(net, qty, 2, 1);
    expect(first + second + third).toBe(net);
  });

  it('nhiều cách chia khác nhau đều cho tổng bằng net (lẻ đồng cộng dồn)', () => {
    const net = 99_999;
    const qty = 7;
    for (const split of [[1, 6], [2, 5], [3, 4], [1, 1, 1, 1, 1, 1, 1]]) {
      let done = 0;
      let sum = 0;
      for (const q of split) {
        sum += computeLineRefundAmount(net, qty, done, q);
        done += q;
      }
      expect(done).toBe(qty);
      expect(sum).toBe(net);
    }
  });

  it('net rất lớn không mất chính xác (tích vượt 2^53)', () => {
    const net = 9_000_000_000_000; // 9 nghìn tỷ đồng
    expect(computeLineRefundAmount(net, 3, 0, 1) + computeLineRefundAmount(net, 3, 1, 2)).toBe(net);
  });

  it('net = 0 (chiết khấu 100%) → hoàn 0', () => {
    expect(computeLineRefundAmount(0, 5, 0, 5)).toBe(0);
  });

  it('từ chối số lượng không hợp lệ hoặc vượt số đã bán', () => {
    expect(() => computeLineRefundAmount(1000, 5, 0, 0)).toThrow(RangeError);
    expect(() => computeLineRefundAmount(1000, 5, 3, 3)).toThrow(RangeError);
    expect(() => computeLineRefundAmount(1000, 0, 0, 1)).toThrow(RangeError);
  });
});

describe('allocateRefundAcrossPayments', () => {
  it('một phương thức: hoàn đúng phương thức đó', () => {
    expect(allocateRefundAcrossPayments(30_000, [{ method: 'CASH', remaining: 100_000 }])).toEqual({
      allocations: [{ method: 'CASH', amount: 30_000 }],
      shortfall: 0,
    });
  });

  it('trả hỗn hợp: VÍ trước dù đứng sau trong danh sách', () => {
    const result = allocateRefundAcrossPayments(30_000, [
      { method: 'CASH', remaining: 100_000 },
      { method: 'WALLET', remaining: 50_000 },
    ]);
    expect(result.allocations).toEqual([{ method: 'WALLET', amount: 30_000 }]);
  });

  it('vượt phần ví thì phần dư ra phương thức còn lại theo thứ tự', () => {
    const result = allocateRefundAcrossPayments(70_000, [
      { method: 'CASH', remaining: 100_000 },
      { method: 'WALLET', remaining: 50_000 },
    ]);
    expect(result.allocations).toEqual([
      { method: 'WALLET', amount: 50_000 },
      { method: 'CASH', amount: 20_000 },
    ]);
    expect(result.shortfall).toBe(0);
  });

  it('ví đã hoàn hết (remaining 0) thì bỏ qua ví', () => {
    const result = allocateRefundAcrossPayments(10_000, [
      { method: 'WALLET', remaining: 0 },
      { method: 'CASH', remaining: 10_000 },
    ]);
    expect(result.allocations).toEqual([{ method: 'CASH', amount: 10_000 }]);
  });

  it('tổng còn hoàn được không đủ → báo shortfall, không hoàn quá', () => {
    const result = allocateRefundAcrossPayments(90_000, [{ method: 'CASH', remaining: 60_000 }]);
    expect(result.allocations).toEqual([{ method: 'CASH', amount: 60_000 }]);
    expect(result.shortfall).toBe(30_000);
  });
});
