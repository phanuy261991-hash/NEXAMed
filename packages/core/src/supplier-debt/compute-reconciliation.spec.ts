import { describe, expect, it } from 'vitest';
import { computeSupplierDebtReconciliationOutcome } from './compute-reconciliation';

describe('computeSupplierDebtReconciliationOutcome', () => {
  it('khớp tuyệt đối → không sinh điều chỉnh', () => {
    expect(computeSupplierDebtReconciliationOutcome(500_000, 500_000)).toEqual({
      differenceAmount: 0,
      adjustmentKind: null,
      adjustmentAmount: null,
    });
  });

  it('NCC xác nhận nợ NHIỀU hơn hệ thống → INCREASE', () => {
    expect(computeSupplierDebtReconciliationOutcome(500_000, 700_000)).toEqual({
      differenceAmount: 200_000,
      adjustmentKind: 'INCREASE',
      adjustmentAmount: 200_000,
    });
  });

  it('NCC xác nhận nợ ÍT hơn hệ thống → DECREASE', () => {
    expect(computeSupplierDebtReconciliationOutcome(500_000, 300_000)).toEqual({
      differenceAmount: -200_000,
      adjustmentKind: 'DECREASE',
      adjustmentAmount: 200_000,
    });
  });

  it('hệ thống 0, NCC xác nhận 0 → khớp', () => {
    expect(computeSupplierDebtReconciliationOutcome(0, 0).adjustmentKind).toBeNull();
  });

  it('hệ thống âm (NCC đang nợ lại), NCC xác nhận đúng số âm → khớp', () => {
    expect(computeSupplierDebtReconciliationOutcome(-100_000, -100_000).adjustmentKind).toBeNull();
  });
});
