import { describe, expect, it } from 'vitest';
import { computeCombinedInvoiceTotals } from './combined-invoice-totals';

describe('computeCombinedInvoiceTotals', () => {
  it('khám đã thu + thuốc đã thu + thuốc chưa thu (khớp mockup)', () => {
    const totals = computeCombinedInvoiceTotals([
      { status: 'PAID', totalAmount: 350_000, discountAmount: 0, dueAmount: 350_000 },
      { status: 'PAID', totalAmount: 66_900, discountAmount: 0, dueAmount: 66_900 },
      { status: 'UNPAID', totalAmount: 42_000, discountAmount: 0, dueAmount: 42_000 },
    ]);
    expect(totals).toEqual({
      invoiceCount: 3,
      grossAmount: 458_900,
      discountAmount: 0,
      paidAmount: 416_900,
      refundedAmount: 0,
      unpaidAmount: 42_000,
    });
  });

  it('có chiết khấu: tổng gross tách khỏi số tiền thật đã thu', () => {
    const totals = computeCombinedInvoiceTotals([
      { status: 'PAID', totalAmount: 350_000, discountAmount: 35_000, dueAmount: 315_000 },
      { status: 'PAID', totalAmount: 186_000, discountAmount: 0, dueAmount: 186_000 },
    ]);
    expect(totals.grossAmount).toBe(536_000);
    expect(totals.discountAmount).toBe(35_000);
    expect(totals.paidAmount).toBe(501_000);
    expect(totals.unpaidAmount).toBe(0);
  });

  it('phiếu REFUNDED vẫn nằm trong đã thu rồi hiện riêng ở đã hoàn', () => {
    const totals = computeCombinedInvoiceTotals([
      { status: 'PAID', totalAmount: 100_000, discountAmount: 0, dueAmount: 100_000 },
      { status: 'REFUNDED', totalAmount: 40_000, discountAmount: 0, dueAmount: 40_000 },
    ]);
    expect(totals.paidAmount).toBe(140_000);
    expect(totals.refundedAmount).toBe(40_000);
  });

  it('phiếu CANCELLED bị bỏ qua hoàn toàn (kể cả gross/số phiếu)', () => {
    const totals = computeCombinedInvoiceTotals([
      { status: 'PAID', totalAmount: 100_000, discountAmount: 0, dueAmount: 100_000 },
      { status: 'CANCELLED', totalAmount: 999_000, discountAmount: 0, dueAmount: 999_000 },
    ]);
    expect(totals.invoiceCount).toBe(1);
    expect(totals.grossAmount).toBe(100_000);
    expect(totals.paidAmount).toBe(100_000);
  });

  it('danh sách rỗng: mọi tổng bằng 0', () => {
    expect(computeCombinedInvoiceTotals([])).toEqual({
      invoiceCount: 0,
      grossAmount: 0,
      discountAmount: 0,
      paidAmount: 0,
      refundedAmount: 0,
      unpaidAmount: 0,
    });
  });
});
