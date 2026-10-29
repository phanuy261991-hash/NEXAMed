import { describe, expect, it } from 'vitest';
import { buildAsNeededInstruction, parsePositiveInt } from './as-needed-instruction';

describe('buildAsNeededInstruction', () => {
  it('ghép đủ câu như mockup (Hapacol)', () => {
    expect(
      buildAsNeededInstruction({ amountText: '1,5', unitText: 'gói', when: 'sốt cao > 38,5 độ C kèm đừ, khó chịu', maxPerDay: 5, minGapHours: 4 }),
    ).toBe('Uống 1,5 gói khi sốt cao > 38,5 độ C kèm đừ, khó chịu, uống tối đa 5 lần / 24 tiếng, mỗi lần cách nhau tối thiểu 4 tiếng.');
  });

  it('bỏ phần nào để trống', () => {
    expect(buildAsNeededInstruction({ amountText: '5', unitText: 'ml', when: 'ho nhiều', maxPerDay: null, minGapHours: null })).toBe('Uống 5 ml khi ho nhiều.');
    expect(buildAsNeededInstruction({ amountText: '', unitText: 'gói', when: '', maxPerDay: 3, minGapHours: null })).toBe('Uống, uống tối đa 3 lần / 24 tiếng.');
  });
});

describe('parsePositiveInt', () => {
  it('chỉ nhận số nguyên dương', () => {
    expect(parsePositiveInt('4')).toBe(4);
    expect(parsePositiveInt(' 12 ')).toBe(12);
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-2')).toBeNull();
    expect(parsePositiveInt('1,5')).toBeNull();
  });
});
