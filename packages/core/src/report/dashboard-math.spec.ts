import { describe, expect, it } from 'vitest';
import {
  allocateAmountByWeights,
  allocateCollectionToGroups,
  classifyInvoiceLine,
  computeDelta,
  fillDailySeries,
  findPeakHour,
  lineNetWeight,
  percentOf,
  type RevenueLineInput,
} from './dashboard-math';

const none = { sourceServiceItemId: null, sourceStockIssueLineId: null, sourceOrderItemId: null, sourceOrderPackageId: null };
const line = (over: Partial<RevenueLineInput>): RevenueLineInput => ({ ...none, lineTotal: 0, discountType: null, discountValue: null, ...over });

describe('classifyInvoiceLine', () => {
  it('xếp theo nguồn của dòng', () => {
    expect(classifyInvoiceLine({ ...none, sourceServiceItemId: 'a' })).toBe('EXAM');
    expect(classifyInvoiceLine({ ...none, sourceStockIssueLineId: 'a' })).toBe('DRUG');
    expect(classifyInvoiceLine({ ...none, sourceOrderItemId: 'a' })).toBe('PARACLINICAL');
    expect(classifyInvoiceLine({ ...none, sourceOrderPackageId: 'a' })).toBe('PACKAGE');
  });
  it('không nguồn nào → Khám bệnh (không làm mất tiền khỏi tổng)', () => {
    expect(classifyInvoiceLine(none)).toBe('EXAM');
  });
});

describe('allocateAmountByWeights', () => {
  it('tổng các phần luôn đúng bằng số tiền, không lệch 1 đồng do làm tròn', () => {
    const parts = allocateAmountByWeights(100, [1, 1, 1]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(100);
    expect([...parts].sort()).toEqual([33, 33, 34]);
  });

  it('chia theo tỉ lệ trọng số', () => {
    expect(allocateAmountByWeights(1000, [3, 1])).toEqual([750, 250]);
    expect(allocateAmountByWeights(18_100_000, [6_400_000, 5_200_000, 5_100_000, 1_400_000]).reduce((s, x) => s + x, 0)).toBe(18_100_000);
  });

  it('số tiền ÂM (hoàn nhiều hơn thu) vẫn cộng đúng', () => {
    const parts = allocateAmountByWeights(-100, [1, 1, 1]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(-100);
    expect(parts.every((x) => x <= -33 && x >= -34)).toBe(true);
  });

  it('mọi trọng số bằng 0 hoặc rỗng: phần đầu nhận hết; số tiền 0 → toàn 0', () => {
    expect(allocateAmountByWeights(500, [0, 0])).toEqual([500, 0]);
    expect(allocateAmountByWeights(0, [1, 2])).toEqual([0, 0]);
    expect(allocateAmountByWeights(500, [])).toEqual([]);
  });

  it('trọng số âm coi như 0', () => {
    expect(allocateAmountByWeights(100, [-5, 1])).toEqual([0, 100]);
  });
});

describe('allocateCollectionToGroups', () => {
  it('chia tiền một phiếu vào bốn nhóm theo giá trị dòng, tổng đúng bằng số thực thu', () => {
    const lines = [
      line({ sourceServiceItemId: 's', lineTotal: 200_000 }),
      line({ sourceOrderItemId: 'o', lineTotal: 300_000 }),
      line({ sourceStockIssueLineId: 'd', lineTotal: 500_000 }),
    ];
    const result = allocateCollectionToGroups(900_000, lines); // đã chiết khấu 10% toàn phiếu
    expect(result.EXAM + result.PARACLINICAL + result.DRUG + result.PACKAGE).toBe(900_000);
    expect(result).toEqual({ EXAM: 180_000, PARACLINICAL: 270_000, DRUG: 450_000, PACKAGE: 0 });
  });

  it('chiết khấu RIÊNG của dòng làm giảm tỉ trọng của nhóm đó', () => {
    const lines = [line({ sourceServiceItemId: 's', lineTotal: 100_000, discountType: 'PERCENT', discountValue: 50 }), line({ sourceStockIssueLineId: 'd', lineTotal: 50_000 })];
    expect(lineNetWeight(lines[0]!)).toBe(50_000);
    expect(allocateCollectionToGroups(100_000, lines)).toEqual({ EXAM: 50_000, PARACLINICAL: 0, DRUG: 50_000, PACKAGE: 0 });
  });

  it('phiếu không có dòng → dồn vào Khám bệnh', () => {
    expect(allocateCollectionToGroups(70_000, [])).toEqual({ EXAM: 70_000, PARACLINICAL: 0, DRUG: 0, PACKAGE: 0 });
  });

  it('hoàn tiền (số âm) trừ vào đúng nhóm theo cùng tỉ trọng', () => {
    const lines = [line({ sourceServiceItemId: 's', lineTotal: 100_000 }), line({ sourceStockIssueLineId: 'd', lineTotal: 100_000 })];
    expect(allocateCollectionToGroups(-100_000, lines)).toEqual({ EXAM: -50_000, PARACLINICAL: 0, DRUG: -50_000, PACKAGE: 0 });
  });
});

describe('computeDelta / percentOf', () => {
  it('tăng, giảm, bằng', () => {
    expect(computeDelta(48, 42)).toEqual({ diff: 6, percent: 14.3, direction: 'up' });
    expect(computeDelta(30, 40)).toEqual({ diff: -10, percent: -25, direction: 'down' });
    expect(computeDelta(5, 5)).toEqual({ diff: 0, percent: 0, direction: 'flat' });
  });
  it('kỳ trước bằng 0 → không có phần trăm', () => {
    expect(computeDelta(10, 0)).toEqual({ diff: 10, percent: null, direction: 'up' });
    expect(computeDelta(0, 0)).toEqual({ diff: 0, percent: null, direction: 'flat' });
  });
  it('percentOf làm tròn và an toàn khi mẫu số 0', () => {
    expect(percentOf(11, 48)).toBe(23);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe('fillDailySeries / findPeakHour', () => {
  it('ngày thiếu hàng = 0, hàng trùng ngày được cộng dồn', () => {
    expect(fillDailySeries(['2026-11-01', '2026-11-02', '2026-11-03'], [{ date: '2026-11-01', value: 5 }, { date: '2026-11-03', value: 2 }, { date: '2026-11-03', value: 3 }])).toEqual([5, 0, 5]);
  });
  it('giờ đông nhất; hoà lấy giờ sớm; không có lượt → null', () => {
    expect(findPeakHour([{ hour: 8, count: 3 }, { hour: 10, count: 12 }, { hour: 11, count: 12 }])).toEqual({ hour: 10, count: 12 });
    expect(findPeakHour([{ hour: 8, count: 0 }])).toBeNull();
  });
});
