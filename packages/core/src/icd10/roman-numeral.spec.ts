import { describe, expect, it } from 'vitest';
import { romanToInt } from './roman-numeral';

describe('romanToInt', () => {
  it('chuyển đúng các số La Mã Chương ICD-10 (I..XXII)', () => {
    expect(romanToInt('I')).toBe(1);
    expect(romanToInt('IV')).toBe(4);
    expect(romanToInt('V')).toBe(5);
    expect(romanToInt('IX')).toBe(9);
    expect(romanToInt('X')).toBe(10);
    expect(romanToInt('XIV')).toBe(14);
    expect(romanToInt('XIX')).toBe(19);
    expect(romanToInt('XX')).toBe(20);
    expect(romanToInt('XXII')).toBe(22);
  });

  it('sắp xếp đúng thứ tự Chương thật, khác thứ tự chuỗi alphabet (IX phải sau V, không phải trước)', () => {
    const codes = ['I', 'X', 'IX', 'V', 'IV', 'XIX', 'XV'];
    const sorted = [...codes].sort((a, b) => romanToInt(a) - romanToInt(b));
    expect(sorted).toEqual(['I', 'IV', 'V', 'IX', 'X', 'XV', 'XIX']);
  });

  it('ký tự không hợp lệ ném lỗi', () => {
    expect(() => romanToInt('ZZ')).toThrow();
  });
});