import { describe, expect, it } from 'vitest';
import { computeWeightedAverageCost } from './compute-weighted-average-cost';

describe('computeWeightedAverageCost', () => {
  it('tồn kho rỗng ban đầu → giá vốn = giá nhập mới', () => {
    expect(computeWeightedAverageCost(0, 0n, 100, 5000n)).toBe(5000n);
  });

  it('tính đúng bình quân gia quyền khi chia hết', () => {
    // (100×5000 + 100×7000) / 200 = 6000
    expect(computeWeightedAverageCost(100, 5000n, 100, 7000n)).toBe(6000n);
  });

  it('làm tròn round-half-up khi có phần dư >= một nửa', () => {
    // (10×1000 + 3×1000) / 13 = 1000 đúng (không lẻ) — đổi trường hợp có lẻ:
    // (10×1000 + 1×1005) / 11 = 11005/11 = 1000.4545... → 1000
    expect(computeWeightedAverageCost(10, 1000n, 1, 1005n)).toBe(1000n);
    // (10×1000 + 1×1006) / 11 = 11006/11 = 1000.5454... → 1001
    expect(computeWeightedAverageCost(10, 1000n, 1, 1006n)).toBe(1001n);
  });

  it('nhập thêm số lượng 0 (lý thuyết) không đổi giá vốn', () => {
    expect(computeWeightedAverageCost(50, 8000n, 0, 9999n)).toBe(8000n);
  });
});
