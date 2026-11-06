import { describe, expect, it } from 'vitest';
import { buildSystemAlerts, collectedByGroup, kpiWithPrevious, lastMonths, mergeBranchRankings, monthRange, previousComparablePeriod, previousMonth, type CollectedRowInput } from './system-report-math';

describe('tháng', () => {
  it('monthRange: ngày đầu và ngày cuối, kể cả tháng 2 năm nhuận; sai định dạng → null', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('2026-1')).toBeNull();
  });

  it('previousMonth qua ranh giới năm; lastMonths cũ nhất trước', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(lastMonths('2026-10', 1)).toEqual(['2026-10']);
    expect(lastMonths('2026-10', 6)).toHaveLength(6);
  });
});

describe('previousComparablePeriod', () => {
  it('một tháng tròn so với tháng liền trước (tháng 31 ngày so với tháng 30 ngày)', () => {
    expect(previousComparablePeriod('2026-10-01', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousComparablePeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousComparablePeriod('2026-01-01', '2026-01-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('quý và năm tròn so với đúng số tháng liền trước', () => {
    expect(previousComparablePeriod('2026-10-01', '2026-12-31')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(previousComparablePeriod('2026-01-01', '2026-03-31')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(previousComparablePeriod('2025-01-01', '2025-12-31')).toEqual({ from: '2024-01-01', to: '2024-12-31' });
  });

  it('khoảng không tròn tháng (hôm nay, 7 ngày, đầu tháng đến nay) so với khoảng cùng độ dài liền trước', () => {
    expect(previousComparablePeriod('2026-11-05', '2026-11-05')).toEqual({ from: '2026-11-04', to: '2026-11-04' });
    expect(previousComparablePeriod('2026-10-30', '2026-11-05')).toEqual({ from: '2026-10-23', to: '2026-10-29' });
    expect(previousComparablePeriod('2026-11-01', '2026-11-05')).toEqual({ from: '2026-10-27', to: '2026-10-31' });
  });

  it('khoảng ngày sai → lỗi', () => {
    expect(() => previousComparablePeriod('2026-11-05', '2026-11-01')).toThrow();
    expect(() => previousComparablePeriod('2026-02-31', '2026-03-01')).toThrow();
  });
});

describe('kpiWithPrevious', () => {
  it('% thay đổi một chữ số thập phân, hướng, và null khi kỳ trước bằng 0', () => {
    expect(kpiWithPrevious(842_600_000, 777_300_000)).toMatchObject({ value: 842_600_000, previous: 777_300_000, percent: 8.4, direction: 'up' });
    expect(kpiWithPrevious(312, 319)).toMatchObject({ percent: -2.2, direction: 'down' });
    expect(kpiWithPrevious(5, 0)).toMatchObject({ percent: null, direction: 'up' });
    expect(kpiWithPrevious(7, 7)).toMatchObject({ percent: 0, direction: 'flat' });
  });
});

describe('collectedByGroup', () => {
  const none = { sourceServiceItemId: null, sourceStockIssueLineId: null, sourceOrderItemId: null, sourceOrderPackageId: null };
  const row = (invoiceId: string, net: number, lineTotal: number | null, source: Partial<CollectedRowInput> = {}): CollectedRowInput => ({ invoiceId, net, lineTotal, discountType: null, discountValue: null, ...none, ...source });

  it('chia thực thu của phiếu vào các nhóm theo tỉ trọng dòng; tổng nhóm đúng bằng tổng thực thu', () => {
    const totals = collectedByGroup([row('a', 100_000, 300_000, { sourceServiceItemId: 'x' }), row('a', 100_000, 100_000, { sourceStockIssueLineId: 'y' })]);
    expect(totals).toEqual({ EXAM: 75_000, PARACLINICAL: 0, DRUG: 25_000, PACKAGE: 0 });
    expect(Object.values(totals).reduce((s, v) => s + v, 0)).toBe(100_000);
  });

  it('nhiều phiếu cộng dồn; phiếu không còn dòng nào dồn vào Khám bệnh; hoàn tiền (âm) trừ ra', () => {
    const totals = collectedByGroup([row('a', 50_000, 50_000, { sourceOrderItemId: 'c' }), row('b', 30_000, null), row('c', -10_000, 40_000, { sourceStockIssueLineId: 'd' })]);
    expect(totals).toEqual({ EXAM: 30_000, PARACLINICAL: 50_000, DRUG: -10_000, PACKAGE: 0 });
  });
});

describe('buildSystemAlerts', () => {
  const b = (name: string, over: Partial<Parameters<typeof buildSystemAlerts>[0][number]> = {}) => ({ branchId: name, branchName: name, staleOpenShifts: 0, overdueUnpaid: 0, expiringBatches: 0, averageWaitMinutes: null, ...over });

  it('chi nhánh êm → không cảnh báo', () => {
    expect(buildSystemAlerts([b('Quận 1', { averageWaitMinutes: 10 }), b('Quận 7', { averageWaitMinutes: 12 })])).toEqual([]);
  });

  it('từng loại vấn đề một dòng, sắp theo loại rồi theo số lượng giảm dần', () => {
    const alerts = buildSystemAlerts([
      b('Thủ Đức', { staleOpenShifts: 2, averageWaitMinutes: 22 }),
      b('Quận 7', { overdueUnpaid: 14, averageWaitMinutes: 19 }),
      b('Quận 1', { expiringBatches: 6, overdueUnpaid: 3, averageWaitMinutes: 14 }),
    ]);
    expect(alerts.map((a) => `${a.kind}:${a.branchName}`)).toEqual(['OPEN_SHIFTS:Thủ Đức', 'OVERDUE_UNPAID:Quận 7', 'OVERDUE_UNPAID:Quận 1', 'EXPIRING_BATCHES:Quận 1', 'LONG_WAIT:Thủ Đức']);
    expect(alerts[0]!.text).toBe('2 ca thu ngân chưa chốt từ hôm qua');
    expect(alerts[1]!.text).toBe('14 phiếu chưa thu quá 3 ngày');
    expect(alerts[3]!.text).toBe('6 lô thuốc hết hạn trong 30 ngày');
    expect(alerts[4]!.text).toBe('Thời gian chờ trung bình 22 phút, cao nhất hệ thống');
  });

  it('chờ lâu chỉ nêu khi có từ hai chi nhánh và chi nhánh chậm nhất từ 20 phút; chưa đo được thì bỏ qua', () => {
    expect(buildSystemAlerts([b('Quận 1', { averageWaitMinutes: 40 })])).toEqual([]);
    expect(buildSystemAlerts([b('A', { averageWaitMinutes: 19.4 }), b('B', { averageWaitMinutes: 18 })])).toEqual([]);
    expect(buildSystemAlerts([b('A', { averageWaitMinutes: null }), b('B', { averageWaitMinutes: 30 })]).map((a) => a.branchName)).toEqual(['B']);
  });
});

describe('mergeBranchRankings', () => {
  const item = (key: string, name: string, amount: number, quantity = 1) => ({ key, name, subtitle: 'Khám bệnh', quantity, amount });

  it('cộng theo khoá, kèm giá trị từng chi nhánh đúng thứ tự, xếp giảm dần theo tổng', () => {
    const rows = mergeBranchRankings(
      [
        [item('kham', 'Khám nội', 300), item('sa', 'Siêu âm', 100)],
        [item('kham', 'Khám nội', 200, 2), item('xn', 'Xét nghiệm máu', 450)],
      ],
      10,
    );
    expect(rows.map((r) => r.key)).toEqual(['kham', 'xn', 'sa']);
    expect(rows[0]).toMatchObject({ total: 500, quantity: 3, byBranch: [300, 200] });
    expect(rows[1]).toMatchObject({ total: 450, byBranch: [0, 450] });
  });

  it('cắt theo giới hạn, bằng nhau thì theo tên, giá trị âm đứng cuối', () => {
    const rows = mergeBranchRankings([[item('b', 'B', 100), item('a', 'A', 100), item('c', 'C', -5), item('d', 'D', 50)]], 3);
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'd']);
    expect(mergeBranchRankings([[item('c', 'C', -5), item('d', 'D', 50)]], 10).map((r) => r.key)).toEqual(['d', 'c']);
  });

  it('không có dữ liệu → rỗng', () => {
    expect(mergeBranchRankings([[], []], 10)).toEqual([]);
  });
});
