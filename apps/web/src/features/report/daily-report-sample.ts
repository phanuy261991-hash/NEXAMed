import type { DailyReport } from '@nexamed/shared';

/** Báo cáo ngày MẪU để xem trước bản in ở "Quản lý mẫu in" (không phải dữ liệu thật). Một chi nhánh nên xem trước ra đúng một trang. */
export const SAMPLE_DAILY_REPORT: DailyReport = (() => {
  const branch = {
    branchId: '00000000-0000-4000-8000-000000000001',
    branchName: 'Chi nhánh mẫu',
    visits: { received: 86, newCount: 31, returnCount: 55, completed: 79, stillOpen: 5, cancelled: 1, noShow: 1 },
    collection: {
      byMethod: [
        { methodCode: 'CASH', methodName: 'Tiền mặt', paymentCount: 41, amount: 28_450_000 },
        { methodCode: 'TRANSFER', methodName: 'Chuyển khoản', paymentCount: 33, amount: 22_180_000 },
        { methodCode: 'CARD', methodName: 'Thẻ', paymentCount: 9, amount: 6_900_000 },
      ],
      collectedCount: 83,
      collectedAmount: 57_530_000,
      refundedCount: 1,
      refundedAmount: 850_000,
      netAmount: 56_680_000,
    },
    recognized: { total: 61_530_000, byGroup: { EXAM: 24_700_000, PARACLINICAL: 19_900_000, DRUG: 13_530_000, PACKAGE: 3_400_000 } },
    unpaid: { invoiceCount: 6, amount: 4_850_000 },
    shifts: [
      { shiftNo: 'PCC2611000001', label: 'Ca sáng', cashierName: 'Nguyễn Thị Hoa', openedAt: '2026-11-04T00:30:00.000Z', closedAt: '2026-11-04T05:05:00.000Z', status: 'CLOSED' as const, expectedCash: 13_250_000, countedCash: 13_250_000, discrepancy: 0 },
      { shiftNo: 'PCC2611000002', label: 'Ca chiều', cashierName: 'Trần Văn Nam', openedAt: '2026-11-04T05:55:00.000Z', closedAt: '2026-11-04T10:40:00.000Z', status: 'CLOSED' as const, expectedCash: 14_000_000, countedCash: 13_980_000, discrepancy: -20_000 },
    ],
    counterVouchers: { incomeAmount: 0, expenseAmount: 1_200_000 },
  };
  return { generatedAt: '2026-11-05T01:05:00.000Z', date: '2026-11-04', branches: [branch], totals: { visits: branch.visits, collection: branch.collection, recognized: branch.recognized, unpaid: branch.unpaid, counterVouchers: branch.counterVouchers, shiftDiscrepancy: -20_000 } };
})();
