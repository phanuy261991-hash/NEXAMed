import { describe, expect, it } from 'vitest';
import { listVisitServiceNames, sumVisitAmount, type VisitBookInvoice } from './visit-book-math';

const line = (name: string, lineTotal: number, extra: Partial<VisitBookInvoice['lines'][number]> = {}) => ({ name, isDrug: false, lineTotal, discountType: null, discountValue: null, ...extra });

describe('sumVisitAmount', () => {
  it('không có phiếu thì bằng 0', () => {
    expect(sumVisitAmount([])).toBe(0);
  });

  it('cộng dueAmount của nhiều phiếu, không dùng tổng gốc khi có chiết khấu toàn phiếu', () => {
    const invoices: VisitBookInvoice[] = [
      { totalAmount: 200000, discountType: 'PERCENT', discountValue: 10, lines: [line('Khám nội', 200000)] },
      { totalAmount: 185000, discountType: null, discountValue: null, lines: [line('Xét nghiệm máu', 185000)] },
    ];
    expect(sumVisitAmount(invoices)).toBe(180000 + 185000);
  });

  it('chiết khấu từng dòng được trừ đúng', () => {
    const invoices: VisitBookInvoice[] = [
      { totalAmount: 300000, discountType: null, discountValue: null, lines: [line('Khám nội', 200000, { discountType: 'AMOUNT', discountValue: 50000 }), line('Điện tim', 100000)] },
    ];
    expect(sumVisitAmount(invoices)).toBe(250000);
  });
});

describe('listVisitServiceNames', () => {
  it('giữ thứ tự, bỏ thuốc, bỏ tên rỗng và tên lặp không phân biệt hoa thường', () => {
    const invoices: VisitBookInvoice[] = [
      { totalAmount: 0, discountType: null, discountValue: null, lines: [line('Khám nội', 1), line('Paracetamol 500mg', 1, { isDrug: true }), line('  ', 1)] },
      { totalAmount: 0, discountType: null, discountValue: null, lines: [line('khám NỘI', 1), line('Xét nghiệm máu', 1)] },
    ];
    expect(listVisitServiceNames(invoices)).toEqual(['Khám nội', 'Xét nghiệm máu']);
  });

  it('không có dịch vụ thì mảng rỗng', () => {
    expect(listVisitServiceNames([])).toEqual([]);
  });
});
