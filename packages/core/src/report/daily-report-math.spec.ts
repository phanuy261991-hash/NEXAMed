import { describe, expect, it } from 'vitest';
import {
  combineDailyBranches,
  computeShiftDiscrepancy,
  summarizeDailyCollection,
  summarizeDailyVisits,
  summarizeRecognizedRevenue,
  type DailyBranchReport,
  type DailyShift,
} from './daily-report-math';

const NAMES = new Map([
  ['CASH', 'Tiền mặt'],
  ['TRANSFER', 'Chuyển khoản'],
]);

const NO_SOURCE = { sourceServiceItemId: null, sourceStockIssueLineId: null, sourceOrderItemId: null, sourceOrderPackageId: null };

describe('summarizeDailyVisits', () => {
  it('Tiếp nhận = chờ + đang khám + hoàn tất; huỷ và không đến không tính vào tiếp nhận', () => {
    const v = summarizeDailyVisits(
      new Map([
        ['CHECKED_IN', 3],
        ['IN_CONSULTATION', 2],
        ['COMPLETED', 79],
        ['CANCELLED', 1],
        ['NO_SHOW', 1],
        ['SCHEDULED', 9],
      ]),
      31,
      55,
    );
    expect(v).toEqual({ received: 84, newCount: 31, returnCount: 55, completed: 79, stillOpen: 5, cancelled: 1, noShow: 1 });
  });

  it('ngày không có lượt nào thì mọi số bằng 0', () => {
    expect(summarizeDailyVisits(new Map(), 0, 0)).toEqual({ received: 0, newCount: 0, returnCount: 0, completed: 0, stillOpen: 0, cancelled: 0, noShow: 0 });
  });
});

describe('summarizeDailyCollection', () => {
  it('đếm lượt thu và lượt hoàn riêng, thực thu = thu trừ hoàn', () => {
    const c = summarizeDailyCollection(
      [
        { methodCode: 'CASH', type: 'PAYMENT', hour: 8, paymentCount: 40, amount: 28_000_000 },
        { methodCode: 'CASH', type: 'PAYMENT', hour: 14, paymentCount: 1, amount: 450_000 },
        { methodCode: 'TRANSFER', type: 'PAYMENT', hour: 9, paymentCount: 33, amount: 22_180_000 },
        { methodCode: 'CASH', type: 'REFUND', hour: 10, paymentCount: 1, amount: 850_000 },
      ],
      NAMES,
    );
    expect(c.collectedCount).toBe(74);
    expect(c.collectedAmount).toBe(50_630_000);
    expect(c.refundedCount).toBe(1);
    expect(c.refundedAmount).toBe(850_000);
    expect(c.netAmount).toBe(49_780_000);
    expect(c.byMethod.map((m) => [m.methodCode, m.paymentCount, m.amount])).toEqual([
      ['TRANSFER', 33, 22_180_000],
      ['CASH', 41, 28_450_000],
    ].sort((a, b) => (b[2] as number) - (a[2] as number)));
  });

  it('chỉ có hoàn tiền thì thực thu âm và không có dòng phương thức', () => {
    const c = summarizeDailyCollection([{ methodCode: 'CASH', type: 'REFUND', hour: 9, paymentCount: 2, amount: 300_000 }], NAMES);
    expect(c.byMethod).toEqual([]);
    expect(c.netAmount).toBe(-300_000);
    expect(c.refundedCount).toBe(2);
  });
});

describe('summarizeRecognizedRevenue', () => {
  it('dùng dueAmount sau chiết khấu toàn phiếu, KHÔNG phải totalAmount; tổng nhóm = tổng', () => {
    const r = summarizeRecognizedRevenue([
      {
        totalAmount: 1_000_000,
        discountType: 'PERCENT',
        discountValue: 10,
        lines: [
          { ...NO_SOURCE, sourceServiceItemId: 's1', lineTotal: 400_000, discountType: null, discountValue: null },
          { ...NO_SOURCE, sourceStockIssueLineId: 'd1', lineTotal: 600_000, discountType: null, discountValue: null },
        ],
      },
    ]);
    expect(r.total).toBe(900_000);
    expect(r.byGroup).toEqual({ EXAM: 360_000, PARACLINICAL: 0, DRUG: 540_000, PACKAGE: 0 });
    expect(Object.values(r.byGroup).reduce((s, x) => s + x, 0)).toBe(r.total);
  });

  it('chiết khấu theo từng dòng: tính từ tổng các dòng đã giảm', () => {
    const r = summarizeRecognizedRevenue([
      {
        totalAmount: 500_000,
        discountType: null,
        discountValue: null,
        lines: [
          { ...NO_SOURCE, sourceServiceItemId: 's1', lineTotal: 300_000, discountType: 'AMOUNT', discountValue: 50_000 },
          { ...NO_SOURCE, sourceOrderItemId: 'o1', lineTotal: 200_000, discountType: null, discountValue: null },
        ],
      },
    ]);
    expect(r.total).toBe(450_000);
    expect(r.byGroup.EXAM + r.byGroup.PARACLINICAL).toBe(450_000);
  });

  it('không có phiếu nào thì bằng 0', () => {
    expect(summarizeRecognizedRevenue([])).toEqual({ total: 0, byGroup: { EXAM: 0, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 } });
  });
});

describe('computeShiftDiscrepancy', () => {
  it('âm khi kiểm đếm thiếu, null khi ca chưa chốt hoặc chưa kiểm đếm', () => {
    expect(computeShiftDiscrepancy(14_000_000, 13_980_000)).toBe(-20_000);
    expect(computeShiftDiscrepancy(13_250_000, 13_250_000)).toBe(0);
    expect(computeShiftDiscrepancy(null, null)).toBeNull();
    expect(computeShiftDiscrepancy(1_000, null)).toBeNull();
  });
});

function shift(discrepancy: number | null): DailyShift {
  return { shiftNo: 'PCC1', label: 'Ca sáng', cashierName: 'Thu ngân', openedAt: '2026-11-04T00:30:00.000Z', closedAt: null, status: 'CLOSED', expectedCash: 0, countedCash: 0, discrepancy };
}

function branch(id: string, name: string, over: Partial<DailyBranchReport> = {}): DailyBranchReport {
  return {
    branchId: id,
    branchName: name,
    visits: summarizeDailyVisits(new Map([['COMPLETED', 10]]), 4, 6),
    collection: summarizeDailyCollection([{ methodCode: 'CASH', type: 'PAYMENT', hour: 9, paymentCount: 5, amount: 1_000_000 }], NAMES),
    recognized: { total: 1_200_000, byGroup: { EXAM: 700_000, PARACLINICAL: 200_000, DRUG: 300_000, PACKAGE: 0 } },
    unpaid: { invoiceCount: 2, amount: 200_000 },
    shifts: [shift(-20_000), shift(null)],
    counterVouchers: { incomeAmount: 0, expenseAmount: 1_200_000 },
    ...over,
  };
}

describe('combineDailyBranches', () => {
  it('cộng đúng từng chỉ số, gộp phương thức theo mã, cộng chênh lệch các ca đã kiểm đếm', () => {
    const a = branch('a', 'Quận 1');
    const b = branch('b', 'Quận 7', {
      collection: summarizeDailyCollection(
        [
          { methodCode: 'TRANSFER', type: 'PAYMENT', hour: 9, paymentCount: 3, amount: 2_000_000 },
          { methodCode: 'CASH', type: 'PAYMENT', hour: 9, paymentCount: 1, amount: 500_000 },
          { methodCode: 'CASH', type: 'REFUND', hour: 9, paymentCount: 1, amount: 100_000 },
        ],
        NAMES,
      ),
    });
    const t = combineDailyBranches([a, b]);
    expect(t.visits.received).toBe(20);
    expect(t.visits.newCount).toBe(8);
    expect(t.collection.collectedAmount).toBe(3_500_000);
    expect(t.collection.refundedAmount).toBe(100_000);
    expect(t.collection.netAmount).toBe(3_400_000);
    expect(t.collection.collectedCount).toBe(9);
    expect(t.collection.byMethod.map((m) => [m.methodCode, m.amount, m.paymentCount])).toEqual([
      ['TRANSFER', 2_000_000, 3],
      ['CASH', 1_500_000, 6],
    ]);
    expect(t.recognized.total).toBe(2_400_000);
    expect(t.recognized.byGroup.EXAM).toBe(1_400_000);
    expect(t.unpaid).toEqual({ invoiceCount: 4, amount: 400_000 });
    expect(t.counterVouchers.expenseAmount).toBe(2_400_000);
    expect(t.shiftDiscrepancy).toBe(-40_000);
  });

  it('không làm đổi dữ liệu đầu vào (gộp phương thức không sửa chi nhánh gốc)', () => {
    const a = branch('a', 'Quận 1');
    const before = JSON.stringify(a);
    combineDailyBranches([a, branch('b', 'Quận 7')]);
    expect(JSON.stringify(a)).toBe(before);
  });

  it('danh sách rỗng cho tổng bằng 0', () => {
    const t = combineDailyBranches([]);
    expect(t.visits.received).toBe(0);
    expect(t.collection.byMethod).toEqual([]);
    expect(t.recognized.total).toBe(0);
    expect(t.shiftDiscrepancy).toBe(0);
  });
});
