import { describe, expect, it } from 'vitest';
import { classifyStockCountDifference } from './classify-stock-count-difference';

describe('classifyStockCountDifference', () => {
  it('đếm nhiều hơn tồn kho sống → SURPLUS, difference dương', () => {
    expect(classifyStockCountDifference(56, 50)).toEqual({ difference: 6, kind: 'SURPLUS' });
  });

  it('đếm ít hơn tồn kho sống → SHORTAGE, difference âm', () => {
    expect(classifyStockCountDifference(195, 200)).toEqual({ difference: -5, kind: 'SHORTAGE' });
  });

  it('đếm khớp đúng tồn kho sống → MATCH, difference 0', () => {
    expect(classifyStockCountDifference(90, 90)).toEqual({ difference: 0, kind: 'MATCH' });
  });

  it('lô mới hoàn toàn (tồn sống = 0) → SURPLUS đúng bằng số đếm', () => {
    expect(classifyStockCountDifference(12, 0)).toEqual({ difference: 12, kind: 'SURPLUS' });
  });

  it('đếm = 0 và tồn sống = 0 → MATCH (không sinh dòng thừa)', () => {
    expect(classifyStockCountDifference(0, 0)).toEqual({ difference: 0, kind: 'MATCH' });
  });
});
