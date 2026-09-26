/**
 * "Công nợ nhà cung cấp" Phần E "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md #182 câu 3,
 * kế hoạch mục 4.3/8) — hàm thuần tính chênh lệch giữa "số hệ thống" (tính tại `asOfDate`, xem
 * `SupplierDebtEntryRepository.sumAmountChangeAsOf()`) và "số NCC xác nhận" (nhập tay), rồi suy ra
 * loại/độ lớn Phiếu điều chỉnh cần tự sinh (nếu có).
 *
 * Quy ước dấu: `differenceAmount = confirmedBalance - systemBalance`. Dương (NCC xác nhận nợ NHIỀU
 * hơn hệ thống ghi) → cần `INCREASE` để hệ thống khớp với NCC; âm → cần `DECREASE`.
 */
export interface SupplierDebtReconciliationOutcome {
  differenceAmount: number;
  adjustmentKind: 'INCREASE' | 'DECREASE' | null;
  /** Luôn dương (giá trị tuyệt đối) — khớp `amount` của `supplier_debt_adjustment`, `null` khi
   * `differenceAmount === 0`. */
  adjustmentAmount: number | null;
}

export function computeSupplierDebtReconciliationOutcome(systemBalance: number, confirmedBalance: number): SupplierDebtReconciliationOutcome {
  const differenceAmount = confirmedBalance - systemBalance;
  if (differenceAmount === 0) {
    return { differenceAmount, adjustmentKind: null, adjustmentAmount: null };
  }
  return {
    differenceAmount,
    adjustmentKind: differenceAmount > 0 ? 'INCREASE' : 'DECREASE',
    adjustmentAmount: Math.abs(differenceAmount),
  };
}
