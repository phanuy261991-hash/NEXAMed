import { describe, expect, it } from 'vitest';
import { summarizeEncounterInvoices } from './encounter-billing-summary';

describe('summarizeEncounterInvoices', () => {
  it('không có hoá đơn, hoặc chỉ hoá đơn đã huỷ → null', () => {
    expect(summarizeEncounterInvoices([])).toBeNull();
    expect(summarizeEncounterInvoices([{ status: 'CANCELLED', dueAmount: 500_000, refundedAmount: 0 }])).toBeNull();
  });

  it('mọi hoá đơn đã thu → PAID, cộng dồn tiền phải thu của nhiều hoá đơn (khám + thuốc + cận lâm sàng)', () => {
    expect(
      summarizeEncounterInvoices([
        { status: 'PAID', dueAmount: 150_000, refundedAmount: 0 },
        { status: 'PAID', dueAmount: 420_000, refundedAmount: 0 },
        { status: 'PAID', dueAmount: 715_000, refundedAmount: 0 },
      ]),
    ).toEqual({ netAmount: 1_285_000, paymentState: 'PAID' });
  });

  it('còn một hoá đơn chưa thu → UNPAID dù hoá đơn khác đã thu', () => {
    expect(
      summarizeEncounterInvoices([
        { status: 'PAID', dueAmount: 150_000, refundedAmount: 0 },
        { status: 'UNPAID', dueAmount: 300_000, refundedAmount: 0 },
      ]),
    ).toEqual({ netAmount: 450_000, paymentState: 'UNPAID' });
  });

  it('có hoàn tiền một phần → REFUNDED, trừ phần đã hoàn khỏi tổng', () => {
    expect(summarizeEncounterInvoices([{ status: 'PAID', dueAmount: 400_000, refundedAmount: 80_000 }])).toEqual({ netAmount: 320_000, paymentState: 'REFUNDED' });
  });

  it('hoàn toàn phần → tổng 0, vẫn REFUNDED; hoá đơn đã huỷ không tính', () => {
    expect(
      summarizeEncounterInvoices([
        { status: 'REFUNDED', dueAmount: 250_000, refundedAmount: 250_000 },
        { status: 'CANCELLED', dueAmount: 99_000, refundedAmount: 0 },
      ]),
    ).toEqual({ netAmount: 0, paymentState: 'REFUNDED' });
  });

  it('không bao giờ âm khi dữ liệu hoàn lớn hơn phải thu', () => {
    expect(summarizeEncounterInvoices([{ status: 'PAID', dueAmount: 100_000, refundedAmount: 120_000 }])?.netAmount).toBe(0);
  });
});
