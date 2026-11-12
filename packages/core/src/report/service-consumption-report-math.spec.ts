import { describe, expect, it } from 'vitest';
import { averageCostPerVisit, topConsumedItemNames } from './service-consumption-report-math';

describe('averageCostPerVisit', () => {
  it('chia và làm tròn nửa lên về 1 đồng', () => {
    expect(averageCostPerVisit(4_289_000, 368)).toBe(11_655);
    expect(averageCostPerVisit(10, 4)).toBe(3); // 2,5 → 3
    expect(averageCostPerVisit(9, 4)).toBe(2); // 2,25 → 2
    expect(averageCostPerVisit(0, 5)).toBe(0);
  });
  it('chưa có lượt nào thì null; chi phí âm không xảy ra nhưng không làm hỏng', () => {
    expect(averageCostPerVisit(1000, 0)).toBeNull();
    expect(averageCostPerVisit(-5, 2)).toBe(0);
  });
});

describe('topConsumedItemNames', () => {
  const items = [
    { name: 'Bông cồn', cost: 400, quantity: 4 },
    { name: 'Ống EDTA', cost: 2000, quantity: 1 },
    { name: 'Kim 21G', cost: 2000, quantity: 3 },
    { name: 'Găng', cost: 0, quantity: 9 },
  ];
  it('xếp theo chi phí, bằng nhau thì theo số lượng, rồi theo tên', () => {
    expect(topConsumedItemNames(items, 2)).toEqual(['Kim 21G', 'Ống EDTA']);
    expect(topConsumedItemNames(items, 3)).toEqual(['Kim 21G', 'Ống EDTA', 'Bông cồn']);
  });
  it('bỏ mặt hàng chi phí 0 khi còn mặt hàng có chi phí; toàn chi phí 0 thì vẫn liệt kê', () => {
    expect(topConsumedItemNames(items, 10)).not.toContain('Găng');
    expect(topConsumedItemNames([{ name: 'A', cost: 0, quantity: 2 }, { name: 'B', cost: 0, quantity: 5 }], 5)).toEqual(['B', 'A']);
  });
  it('limit 0 hoặc âm, danh sách rỗng → rỗng', () => {
    expect(topConsumedItemNames(items, 0)).toEqual([]);
    expect(topConsumedItemNames(items, -1)).toEqual([]);
    expect(topConsumedItemNames([], 3)).toEqual([]);
  });
});
