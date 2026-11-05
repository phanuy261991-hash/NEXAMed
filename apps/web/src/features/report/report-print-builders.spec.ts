import { describe, expect, it } from 'vitest';
import {
  buildAuditLogPrintSpec,
  buildCashBookLedgerPrintSpec,
  buildCashFlowPrintSpec,
  buildStockBalancePrintSpec,
  buildStockLedgerPrintSpec,
  buildStockShrinkagePrintSpec,
  buildSupplierDebtPrintSpec,
  buildWalletsPrintSpec,
} from './report-print-builders';

const BRANCH_A = '00000000-0000-4000-8000-000000000001';
const BRANCH_B = '00000000-0000-4000-8000-000000000002';

/** Mọi dòng dữ liệu và dòng cộng phải có ĐÚNG số ô bằng số cột — lệch cột làm bản in sai hàng. */
function expectRectangular(spec: { sections: Array<{ columns: unknown[]; rows: string[][]; totalRows?: string[][] }> }) {
  for (const s of spec.sections) {
    for (const row of [...s.rows, ...(s.totalRows ?? [])]) expect(row).toHaveLength(s.columns.length);
  }
}

describe('buildCashFlowPrintSpec', () => {
  const base = {
    totalIncome: 10_000_000,
    totalExpense: 4_000_000,
    byType: [{ key: 'INVOICE', label: 'Thu tiền khám', totalIncome: 10_000_000, totalExpense: 0 }, { key: 'TC1', label: 'Tiền điện', totalIncome: 0, totalExpense: 4_000_000 }],
    byAccount: [{ key: 'a1', label: 'Quỹ tiền mặt', totalIncome: 10_000_000, totalExpense: 4_000_000, closingBalance: 6_500_000, branchId: BRANCH_A, branchName: 'Quận 1' }],
  };

  it('một chi nhánh: hai bảng, không có cột/bảng chi nhánh, đủ số tiền', () => {
    const spec = buildCashFlowPrintSpec({ ...base, byBranch: [{ branchId: BRANCH_A, branchName: 'Quận 1', totalIncome: 10_000_000, totalExpense: 4_000_000 }] }, { from: '2026-11-01', to: '2026-11-05', scopeLabel: null });
    expect(spec.sections.map((s) => s.title)).toEqual(['Theo Loại thu chi', 'Theo Quỹ']);
    expect(spec.subtitleLines).toEqual(['Từ 01/11/2026 đến 05/11/2026']);
    expect(spec.infoLines![0]).toContain('Chênh lệch: +6.000.000');
    expect(spec.sections[1]!.rows[0]).toEqual(['Quỹ tiền mặt', '10.000.000', '4.000.000', '6.500.000']);
    expectRectangular(spec);
  });

  it('nhiều chi nhánh: thêm bảng Theo chi nhánh có dòng cộng và cột Chi nhánh ở Theo Quỹ', () => {
    const spec = buildCashFlowPrintSpec(
      { ...base, byBranch: [{ branchId: BRANCH_A, branchName: 'Quận 1', totalIncome: 6_000_000, totalExpense: 1_000_000 }, { branchId: BRANCH_B, branchName: 'Quận 7', totalIncome: 4_000_000, totalExpense: 3_000_000 }] },
      { from: '2026-11-01', to: '2026-11-05', scopeLabel: 'Quận 1, Quận 7' },
    );
    expect(spec.sections.map((s) => s.title)).toEqual(['Theo chi nhánh', 'Theo Loại thu chi', 'Theo Quỹ']);
    expect(spec.sections[0]!.totalRows![0]).toEqual(['Cộng 2 chi nhánh', '10.000.000', '4.000.000', '+6.000.000']);
    expect(spec.sections[2]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(spec.subtitleLines).toContain('Phạm vi: Quận 1, Quận 7');
    expectRectangular(spec);
  });
});

describe('buildCashBookLedgerPrintSpec', () => {
  it('giữ thứ tự cũ → mới, số âm có dấu trừ thật, đủ đầu kỳ/cuối kỳ', () => {
    const spec = buildCashBookLedgerPrintSpec(
      {
        cashAccountId: 'x',
        cashAccountName: 'Quỹ tiền mặt',
        branchId: BRANCH_A,
        branchName: 'Quận 1',
        openingBalance: 1_000_000,
        closingBalance: 1_700_000,
        entries: [
          { id: '1', occurredAt: '2026-11-02T03:00:00.000Z', entryType: 'INVOICE_PAYMENT', description: 'Thu tiền khám', referenceNo: 'PT001', amountSigned: 900_000, runningBalance: 1_900_000 },
          { id: '2', occurredAt: '2026-11-03T03:00:00.000Z', entryType: 'VOUCHER_EXPENSE', description: 'Tiền điện', referenceNo: 'PC001', amountSigned: -200_000, runningBalance: 1_700_000 },
        ],
      },
      { from: '2026-11-01', to: '2026-11-05', accountLabel: 'Quỹ tiền mặt' },
    );
    expect(spec.infoLines![0]).toBe('Số dư đầu kỳ: 1.000.000 · Số dư cuối kỳ: 1.700.000');
    expect(spec.sections[0]!.rows.map((r) => r[3])).toEqual(['+900.000', '−200.000']);
    expect(spec.sections[0]!.rows[0]![1]).toBe('Thu tiền khám');
    expect(spec.sections[0]!.rows[0]![0]).toBe('02/11/2026');
    expectRectangular(spec);
  });
});

describe('buildStockLedgerPrintSpec', () => {
  const rows = [{ key: 'k', drugCode: 'T01', drugName: 'Paracetamol', unitCode: 'Viên', branchId: BRANCH_A, branchLabel: 'Quận 1', warehouseLabel: 'Kho chính', openingQuantity: 100, totalIn: 50, totalOut: 30, closingQuantity: 120 }];
  const totals = { totalOpeningQuantity: 100, totalIn: 50, totalOut: 30, totalClosingQuantity: 120 };

  it('một chi nhánh: không có cột Chi nhánh; nhiều chi nhánh: có', () => {
    const one = buildStockLedgerPrintSpec(totals, rows, { from: '2026-11-01', to: '2026-11-05', multiBranch: false, warehouseLabel: null, scopeLabel: null });
    const many = buildStockLedgerPrintSpec(totals, rows, { from: '2026-11-01', to: '2026-11-05', multiBranch: true, warehouseLabel: 'Kho chính · Quận 1', scopeLabel: 'Tất cả' });
    expect(one.sections[0]!.columns.map((c) => c.header)).not.toContain('Chi nhánh');
    expect(many.sections[0]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(one.sections[0]!.rows[0]).toEqual(['T01', 'Paracetamol', 'Viên', 'Kho chính', '100', '+50', '-30', '120']);
    expect(one.sections[0]!.totalRows![0]!.slice(-4)).toEqual(['100', '+50', '-30', '120']);
    expectRectangular(one);
    expectRectangular(many);
  });

  it('dòng không nhập/xuất hiện gạch ngang', () => {
    const spec = buildStockLedgerPrintSpec(totals, [{ ...rows[0]!, totalIn: 0, totalOut: 0 }], { from: '2026-11-01', to: '2026-11-05', multiBranch: false, warehouseLabel: null, scopeLabel: null });
    expect(spec.sections[0]!.rows[0]!.slice(5, 7)).toEqual(['—', '—']);
  });
});

describe('buildStockShrinkagePrintSpec', () => {
  it('có nguyên nhân tiếng Việt, tổng số lượng và giá trị', () => {
    const spec = buildStockShrinkagePrintSpec(
      {
        items: [{ transferId: 'x', transferNo: 'DC001', occurredAt: '2026-11-02T03:00:00.000Z', fromWarehouseName: 'Kho A', toWarehouseName: 'Kho B', drugCode: 'T01', drugName: 'Thuốc', quantity: 3, unitCost: 1000, lineValue: 3000, cause: 'WRITE_OFF' }],
        totalQuantity: 3,
        totalValue: 3000,
        transferCount: 1,
        countByCause: { WRITE_OFF: 1, RETURN_SHORTAGE: 0 },
      },
      { from: '2026-11-01', to: '2026-11-05', warehouseLabel: null, causeLabel: null },
    );
    expect(spec.sections[0]!.rows[0]![7]).toBe('Ghi hao hụt');
    expect(spec.sections[0]!.totalRows![0]).toEqual(['Tổng', '', '', '', '3', '', '3.000', '']);
    expectRectangular(spec);
  });
});

describe('buildStockBalancePrintSpec', () => {
  it('hai bảng: tồn kho và cảnh báo hạn dùng; định mức và hạn dùng đọc được', () => {
    const spec = buildStockBalancePrintSpec(
      [
        { drugId: 'd1', drugCode: 'T01', drugName: 'Paracetamol', itemType: 'MEDICINE', warehouseId: 'w', warehouseName: 'Kho chính', unitCode: 'VIEN', quantityOnHand: 0, minStockAlert: 10, maxStockAlert: null, status: 'OUT' },
        { drugId: 'd2', drugCode: 'V01', drugName: 'Găng tay', itemType: 'SUPPLY', warehouseId: 'w', warehouseName: 'Kho chính', unitCode: null, quantityOnHand: 50, minStockAlert: null, maxStockAlert: null, status: 'NORMAL' },
      ],
      [{ batchId: 'b', batchNo: 'L1', drugId: 'd1', drugName: 'Paracetamol', warehouseId: 'w', warehouseName: 'Kho chính', expiryDate: '2026-11-01', daysUntilExpiry: -4, quantityOnHand: 5, status: 'EXPIRED' }] as never,
      { warehouseLabel: 'Kho chính', belowMinOnly: false, keyword: null, unitName: (c) => (c === 'VIEN' ? 'Viên' : c) },
    );
    expect(spec.sections.map((s) => s.title)).toEqual(['Tồn kho theo mặt hàng', 'Cảnh báo hạn dùng']);
    expect(spec.sections[0]!.rows[0]).toEqual(['T01', 'Paracetamol', 'Thuốc', 'Kho chính', 'Viên', '0', '10 – ∞', 'Hết hàng']);
    expect(spec.sections[0]!.rows[1]![4]).toBe('—');
    expect(spec.sections[1]!.rows[0]![3]).toBe('01/11/2026 · đã quá 4 ngày');
    expectRectangular(spec);
  });
});

describe('buildSupplierDebtPrintSpec', () => {
  it('cộng còn nợ và NCC nợ lại, ghi rõ trạng thái từng dòng', () => {
    const spec = buildSupplierDebtPrintSpec(
      [
        { code: 'NCC1', name: 'Công ty A', totalPurchase: 5_000_000, totalPaid: 2_000_000, balance: 3_000_000, pendingApprovalAmount: 500_000 },
        { code: 'NCC2', name: 'Công ty B', totalPurchase: 1_000_000, totalPaid: 1_200_000, balance: -200_000, pendingApprovalAmount: 0 },
        { code: 'NCC3', name: 'Công ty C', totalPurchase: 0, totalPaid: 0, balance: 0, pendingApprovalAmount: 0 },
        { code: 'NCC4', name: 'Công ty D', totalPurchase: null, totalPaid: null, balance: null, pendingApprovalAmount: 0 },
      ],
      { search: null, showAll: true },
    );
    expect(spec.infoLines![0]).toBe('Tổng còn nợ: 3.000.000 · NCC đang nợ lại: 200.000 · Phiếu chi chờ duyệt: 500.000');
    expect(spec.sections[0]!.rows.map((r) => r[4])).toEqual(['3.000.000', '200.000 (NCC nợ lại)', 'Đã tất toán', '—']);
    expectRectangular(spec);
  });
});

describe('buildWalletsPrintSpec', () => {
  it('có số tóm tắt, ghi chú khi bị cắt dòng', () => {
    const items = [{ walletId: 'w', patientId: 'p', patientCode: 'BN1', fullName: 'Nguyễn Văn A', phone: null, balance: 500_000, totalToppedUp: 1_000_000, totalUsed: 500_000, lastTransactionAt: '2026-11-03T03:00:00.000Z', status: 'ACTIVE' as const }];
    const spec = buildWalletsPrintSpec(items, { statusLabel: 'Đang hoạt động', search: null, totalHeldBalance: 500_000, activeWalletCount: 1, toppedUpToday: 0, deductedToday: 0, capped: true });
    expect(spec.sections[0]!.rows[0]).toEqual(['BN1', 'Nguyễn Văn A', '—', '500.000', '1.000.000', '500.000', '03/11/2026 10:00', 'Đang hoạt động']);
    expect(spec.note).toContain('Xuất Excel');
    expectRectangular(spec);
    expect(buildWalletsPrintSpec(items, { statusLabel: 'Tất cả', search: 'a', totalHeldBalance: 0, activeWalletCount: 0, toppedUpToday: 0, deductedToday: 0, capped: false }).note).toBeUndefined();
  });
});

describe('buildAuditLogPrintSpec', () => {
  it('ghi người thực hiện, đánh dấu truy cập khẩn cấp, người vắng = Hệ thống', () => {
    const base = { id: 'i', actorId: null, entityType: 'patient', entityId: 'e', entityLabel: 'Bệnh nhân A', beforeJson: null, afterJson: null };
    const spec = buildAuditLogPrintSpec(
      [
        { ...base, occurredAt: '2026-11-05T03:00:00.000Z', actorName: 'Quản trị', action: 'patient.updated', actionLabel: 'Sửa hồ sơ bệnh nhân', isBreakGlass: false },
        { ...base, occurredAt: '2026-11-05T04:00:00.000Z', actorName: null, action: 'break_glass.access', actionLabel: 'Xem hồ sơ', isBreakGlass: true },
      ],
      { filterLines: ['Từ 01/11/2026'], capped: false },
    );
    expect(spec.sections[0]!.rows[0]).toEqual(['05/11/2026 10:00', 'Quản trị', 'Sửa hồ sơ bệnh nhân', 'Bệnh nhân A']);
    expect(spec.sections[0]!.rows[1]![1]).toBe('Hệ thống');
    expect(spec.sections[0]!.rows[1]![2]).toContain('truy cập khẩn cấp');
    expectRectangular(spec);
  });
});
