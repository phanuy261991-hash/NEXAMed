import { describe, expect, it } from 'vitest';
import { factorToBaseUnit, parsePositiveQuantity } from './base-quantity';

const chain = [
  { unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 10 },
  { unitCode: 'HOP', sortOrder: 1, factorToUnitBelow: 10 },
];

describe('factorToBaseUnit', () => {
  it('đơn vị nhỏ nhất = 1; bậc trên tích luỹ hệ số từ bậc 0', () => {
    expect(factorToBaseUnit('VIEN', chain, 'VIEN')).toBe(1);
    expect(factorToBaseUnit('VIEN', chain, 'VI')).toBe(10);
    expect(factorToBaseUnit('VIEN', chain, 'HOP')).toBe(100);
  });

  it('không phụ thuộc thứ tự mảng; đơn vị ngoài chuỗi → null', () => {
    expect(factorToBaseUnit('VIEN', [...chain].reverse(), 'HOP')).toBe(100);
    expect(factorToBaseUnit('VIEN', chain, 'THUNG')).toBeNull();
  });

  it('thiếu đơn vị nhỏ nhất (dữ liệu cũ) coi như hệ số 1', () => {
    expect(factorToBaseUnit(null, [], 'HOP')).toBe(1);
  });
});

describe('parsePositiveQuantity', () => {
  it('chỉ nhận số nguyên dương', () => {
    expect(parsePositiveQuantity('5')).toBe(5);
    expect(parsePositiveQuantity(7)).toBe(7);
    expect(parsePositiveQuantity('')).toBeNull();
    expect(parsePositiveQuantity('0')).toBeNull();
    expect(parsePositiveQuantity('2.5')).toBeNull();
    expect(parsePositiveQuantity('-3')).toBeNull();
  });
});
