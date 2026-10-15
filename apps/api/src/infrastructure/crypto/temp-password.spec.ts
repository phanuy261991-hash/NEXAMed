import { describe, expect, it } from 'vitest';
import { generateTempPassword } from './temp-password';

describe('generateTempPassword', () => {
  it('đúng định dạng 3 nhóm 4 ký tự, không có ký tự dễ nhầm', () => {
    for (let i = 0; i < 200; i += 1) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
    }
  });

  it('mỗi lần một giá trị khác nhau', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateTempPassword()));
    expect(set.size).toBe(200);
  });
});
