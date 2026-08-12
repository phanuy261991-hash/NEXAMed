import { describe, expect, it } from 'vitest';
import { PROVINCE_ITEMS, WARD_ITEMS } from './data';

describe('geo seed data (province/ward)', () => {
  it('có đúng 34 tỉnh/thành, không trùng code, Hà Nội đứng đầu', () => {
    expect(PROVINCE_ITEMS).toHaveLength(34);
    expect(new Set(PROVINCE_ITEMS.map((p) => p.code)).size).toBe(34);
    expect(PROVINCE_ITEMS[0]).toMatchObject({ code: '1', name: 'Thành phố Hà Nội' });
  });

  it('có đúng 3321 phường/xã, code duy nhất toàn quốc (không chỉ trong 1 tỉnh)', () => {
    expect(WARD_ITEMS).toHaveLength(3321);
    expect(new Set(WARD_ITEMS.map((w) => w.code)).size).toBe(3321);
  });

  it('mọi ward.provinceCode đều trỏ tới 1 province có thật trong PROVINCE_ITEMS', () => {
    const provinceCodes = new Set(PROVINCE_ITEMS.map((p) => p.code));
    for (const ward of WARD_ITEMS) {
      expect(provinceCodes.has(ward.provinceCode)).toBe(true);
    }
  });

  it('Hà Nội (code 1) có đúng 126 phường/xã', () => {
    expect(WARD_ITEMS.filter((w) => w.provinceCode === '1')).toHaveLength(126);
  });
});
