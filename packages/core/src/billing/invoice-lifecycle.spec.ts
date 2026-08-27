import { describe, expect, it } from 'vitest';
import {
  canRefundInvoice,
  computeDailyBillingTotals,
  isInvoiceClosed,
  needsRefund,
  resolveInvoiceStatusOnEncounterCancel,
  type InvoiceLifecycleStatus,
} from './invoice-lifecycle';

describe('resolveInvoiceStatusOnEncounterCancel', () => {
  it('phiếu CHƯA thu → CANCELLED (rớt khỏi "Chờ thu" và tổng kết cuối ngày)', () => {
    expect(resolveInvoiceStatusOnEncounterCancel('UNPAID')).toBe('CANCELLED');
  });

  it('phiếu ĐÃ thu → giữ nguyên PAID, KHÔNG tự nhảy REFUNDED (hoàn tiền là thao tác riêng có quyền riêng)', () => {
    expect(resolveInvoiceStatusOnEncounterCancel('PAID')).toBeNull();
  });

  it('phiếu đã đóng sổ → không đổi gì (huỷ lại lượt khám đã huỷ không làm hỏng dữ liệu)', () => {
    expect(resolveInvoiceStatusOnEncounterCancel('CANCELLED')).toBeNull();
    expect(resolveInvoiceStatusOnEncounterCancel('REFUNDED')).toBeNull();
  });
});

describe('isInvoiceClosed', () => {
  it('chỉ CANCELLED/REFUNDED là đóng sổ', () => {
    expect(isInvoiceClosed('CANCELLED')).toBe(true);
    expect(isInvoiceClosed('REFUNDED')).toBe(true);
    expect(isInvoiceClosed('UNPAID')).toBe(false);
    expect(isInvoiceClosed('PAID')).toBe(false);
  });
});

describe('canRefundInvoice', () => {
  it('chỉ hoàn được khi phiếu PAID VÀ lượt khám đã huỷ', () => {
    expect(canRefundInvoice({ invoiceStatus: 'PAID', encounterCancelled: true })).toBe(true);
  });

  it('lượt khám chưa huỷ thì không hoàn (chặn hoàn nhầm ca đang khám bình thường)', () => {
    expect(canRefundInvoice({ invoiceStatus: 'PAID', encounterCancelled: false })).toBe(false);
  });

  it('phiếu chưa thu/đã hoàn rồi thì không hoàn (được) nữa', () => {
    for (const status of ['UNPAID', 'CANCELLED', 'REFUNDED'] as const) {
      expect(canRefundInvoice({ invoiceStatus: status, encounterCancelled: true })).toBe(false);
    }
  });

  it('needsRefund là cùng điều kiện — cảnh báo "Cần hoàn tiền" ở màn Thu ngân', () => {
    expect(needsRefund({ invoiceStatus: 'PAID', encounterCancelled: true })).toBe(true);
    expect(needsRefund({ invoiceStatus: 'REFUNDED', encounterCancelled: true })).toBe(false);
  });
});

describe('computeDailyBillingTotals', () => {
  const make = (status: InvoiceLifecycleStatus, totalAmount: number) => ({ status, totalAmount });

  it('danh sách rỗng → mọi số 0', () => {
    expect(computeDailyBillingTotals([])).toEqual({
      paidCount: 0,
      paidTotalAmount: 0,
      unpaidCount: 0,
      unpaidTotalAmount: 0,
      refundedCount: 0,
      refundedTotalAmount: 0,
      netTotalAmount: 0,
    });
  });

  it('REFUNDED vẫn tính vào "Đã thu" rồi trừ ra ở "Thực thu" — đối soát két cuối ngày mới khớp', () => {
    const totals = computeDailyBillingTotals([make('PAID', 200_000), make('REFUNDED', 150_000)]);
    expect(totals.paidCount).toBe(2);
    expect(totals.paidTotalAmount).toBe(350_000);
    expect(totals.refundedCount).toBe(1);
    expect(totals.refundedTotalAmount).toBe(150_000);
    expect(totals.netTotalAmount).toBe(200_000);
  });

  it('CANCELLED không tính vào bất kỳ cột tiền nào — chưa đồng nào đổi chủ', () => {
    const totals = computeDailyBillingTotals([make('CANCELLED', 500_000), make('UNPAID', 100_000)]);
    expect(totals.unpaidCount).toBe(1);
    expect(totals.unpaidTotalAmount).toBe(100_000);
    expect(totals.paidTotalAmount).toBe(0);
    expect(totals.refundedTotalAmount).toBe(0);
    expect(totals.netTotalAmount).toBe(0);
  });

  it('hoàn hết mọi phiếu đã thu → thực thu về 0 (không âm)', () => {
    const totals = computeDailyBillingTotals([make('REFUNDED', 200_000), make('REFUNDED', 300_000)]);
    expect(totals.paidTotalAmount).toBe(500_000);
    expect(totals.refundedTotalAmount).toBe(500_000);
    expect(totals.netTotalAmount).toBe(0);
  });

  it('trộn đủ 4 trạng thái', () => {
    const totals = computeDailyBillingTotals([
      make('PAID', 200_000),
      make('UNPAID', 120_000),
      make('CANCELLED', 90_000),
      make('REFUNDED', 80_000),
    ]);
    expect(totals).toEqual({
      paidCount: 2,
      paidTotalAmount: 280_000,
      unpaidCount: 1,
      unpaidTotalAmount: 120_000,
      refundedCount: 1,
      refundedTotalAmount: 80_000,
      netTotalAmount: 200_000,
    });
  });
});