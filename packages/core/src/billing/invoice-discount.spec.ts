import { describe, expect, it } from 'vitest';
import { computeDiscountAmount, computeInvoiceDiscount } from './invoice-discount';

describe('computeDiscountAmount', () => {
  it('PERCENT làm tròn round-half-up', () => {
    expect(computeDiscountAmount(155_000, 'PERCENT', 10)).toBe(15_500);
    // 33% của 100.005 = 33.001,65 -> làm tròn 33.002
    expect(computeDiscountAmount(100_005, 'PERCENT', 33)).toBe(33_002);
  });

  it('AMOUNT lấy đúng giá trị nhập, clamp không vượt quá base', () => {
    expect(computeDiscountAmount(100_000, 'AMOUNT', 20_000)).toBe(20_000);
    expect(computeDiscountAmount(100_000, 'AMOUNT', 500_000)).toBe(100_000);
  });

  it('không âm dù discountValue âm hoặc 0', () => {
    expect(computeDiscountAmount(100_000, 'AMOUNT', 0)).toBe(0);
    expect(computeDiscountAmount(100_000, 'AMOUNT', -5_000)).toBe(0);
  });

  it('discountType null hoặc discountValue null -> 0', () => {
    expect(computeDiscountAmount(100_000, null, null)).toBe(0);
    expect(computeDiscountAmount(100_000, 'PERCENT', null)).toBe(0);
  });
});

describe('computeInvoiceDiscount', () => {
  it('không có chiết khấu nào -> NONE, dueAmount = totalAmount', () => {
    const result = computeInvoiceDiscount({ totalAmount: 300_000, discountType: null, discountValue: null, lines: [] });
    expect(result).toEqual({ mode: 'NONE', discountAmount: 0, dueAmount: 300_000 });
  });

  it('TOTAL — 10% trên tổng hoá đơn', () => {
    const result = computeInvoiceDiscount({ totalAmount: 450_000, discountType: 'PERCENT', discountValue: 10, lines: [] });
    expect(result).toEqual({ mode: 'TOTAL', discountAmount: 45_000, dueAmount: 405_000 });
  });

  it('TOTAL — chiết khấu tiền trực tiếp', () => {
    const result = computeInvoiceDiscount({ totalAmount: 450_000, discountType: 'AMOUNT', discountValue: 50_000, lines: [] });
    expect(result).toEqual({ mode: 'TOTAL', discountAmount: 50_000, dueAmount: 400_000 });
  });

  it('PER_LINE — tổng đúng nhiều dòng, xen kẽ dòng không chiết khấu', () => {
    const result = computeInvoiceDiscount({
      totalAmount: 450_000,
      discountType: null,
      discountValue: null,
      lines: [
        { lineTotal: 200_000, discountType: 'PERCENT', discountValue: 10 }, // -20.000
        { lineTotal: 150_000, discountType: null, discountValue: null }, // không chiết khấu
        { lineTotal: 100_000, discountType: 'AMOUNT', discountValue: 30_000 }, // -30.000
      ],
    });
    expect(result).toEqual({ mode: 'PER_LINE', discountAmount: 50_000, dueAmount: 400_000 });
  });

  it('PER_LINE ưu tiên hơn TOTAL khi (không nên xảy ra trong thực tế) cả hai cấp cùng có dữ liệu', () => {
    const result = computeInvoiceDiscount({
      totalAmount: 450_000,
      discountType: 'PERCENT',
      discountValue: 10,
      lines: [{ lineTotal: 100_000, discountType: 'AMOUNT', discountValue: 20_000 }],
    });
    expect(result).toEqual({ mode: 'PER_LINE', discountAmount: 20_000, dueAmount: 430_000 });
  });

  it('chiết khấu 100% -> dueAmount = 0, không âm', () => {
    const result = computeInvoiceDiscount({ totalAmount: 450_000, discountType: 'PERCENT', discountValue: 100, lines: [] });
    expect(result).toEqual({ mode: 'TOTAL', discountAmount: 450_000, dueAmount: 0 });
  });
});
