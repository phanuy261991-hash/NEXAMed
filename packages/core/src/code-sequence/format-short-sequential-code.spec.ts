import { describe, expect, it } from 'vitest';
import { formatShortSequentialCode } from './format-short-sequential-code';

describe('formatShortSequentialCode', () => {
  it('ghép đúng <prefix><seq5>', () => {
    expect(formatShortSequentialCode('HV', 1)).toBe('HV00001');
    expect(formatShortSequentialCode('HV', 123)).toBe('HV00123');
  });

  it('seq đệm đủ 5 chữ số, nhận cả number lẫn bigint', () => {
    expect(formatShortSequentialCode('CA', 1n)).toBe('CA00001');
    expect(formatShortSequentialCode('CA', 99999)).toBe('CA99999');
  });

  it('không cắt bớt khi seq vượt 5 chữ số — vẫn ra mã đúng, chỉ không còn đệm 0', () => {
    expect(formatShortSequentialCode('DV', 123456)).toBe('DV123456');
  });
});
