import { describe, expect, it } from 'vitest';
import { computeUnitConversion, convertToBaseUnitQuantity } from './compute-unit-conversion';

describe('computeUnitConversion', () => {
  it('trả đúng bậc gốc khi không có bậc quy đổi nào (mặt hàng chỉ dùng 1 đơn vị)', () => {
    expect(computeUnitConversion('Viên', [])).toEqual([{ unitCode: 'Viên', factorToBaseUnit: 1 }]);
  });

  it('tích luỹ đúng chuỗi 3 bậc: 1 Hộp = 10 Vỉ = 100 Viên', () => {
    const levels = computeUnitConversion('Viên', [
      { unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 10 },
      { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 10 },
    ]);
    expect(levels).toEqual([
      { unitCode: 'Viên', factorToBaseUnit: 1 },
      { unitCode: 'Vỉ', factorToBaseUnit: 10 },
      { unitCode: 'Hộp', factorToBaseUnit: 100 },
    ]);
  });

  it('tự sắp lại theo sortOrder dù truyền vào không đúng thứ tự', () => {
    const levels = computeUnitConversion('Viên', [
      { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 3 },
      { unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 14 },
    ]);
    expect(levels.map((l) => l.unitCode)).toEqual(['Viên', 'Vỉ', 'Hộp']);
    expect(levels[2]).toEqual({ unitCode: 'Hộp', factorToBaseUnit: 42 });
  });

  it('quy đổi khác nhau ở mỗi bậc không nhân đồng loạt — 2 bậc hệ số lệch nhau', () => {
    const levels = computeUnitConversion('Cái', [
      { unitCode: 'Đôi', sortOrder: 0, factorToUnitBelow: 2 },
      { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 25 },
    ]);
    expect(levels).toEqual([
      { unitCode: 'Cái', factorToBaseUnit: 1 },
      { unitCode: 'Đôi', factorToBaseUnit: 2 },
      { unitCode: 'Hộp', factorToBaseUnit: 50 },
    ]);
  });
});

describe('computeUnitConversion — ca biên', () => {
  it('hệ số 1 ở mọi bậc: các bậc cùng quy về 1 đơn vị nhỏ nhất', () => {
    const levels = computeUnitConversion('Cái', [
      { unitCode: 'Gói', sortOrder: 0, factorToUnitBelow: 1 },
      { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 1 },
    ]);
    expect(levels.map((l) => l.factorToBaseUnit)).toEqual([1, 1, 1]);
  });

  it('không làm thay đổi mảng đầu vào', () => {
    const links = [
      { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 3 },
      { unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 14 },
    ];
    computeUnitConversion('Viên', links);
    expect(links.map((l) => l.unitCode)).toEqual(['Hộp', 'Vỉ']);
  });

  it('chuỗi 4 bậc với hệ số lệch nhau tích luỹ đúng (Thùng→Hộp→Vỉ→Viên)', () => {
    const levels = computeUnitConversion('Viên', [
      { unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 10 },
      { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 3 },
      { unitCode: 'Thùng', sortOrder: 2, factorToUnitBelow: 24 },
    ]);
    expect(levels.map((l) => l.factorToBaseUnit)).toEqual([1, 10, 30, 720]);
  });

  it('sortOrder có khoảng trống vẫn tích luỹ theo thứ tự tăng dần', () => {
    const levels = computeUnitConversion('Viên', [
      { unitCode: 'Hộp', sortOrder: 5, factorToUnitBelow: 4 },
      { unitCode: 'Vỉ', sortOrder: 2, factorToUnitBelow: 10 },
    ]);
    expect(levels).toEqual([
      { unitCode: 'Viên', factorToBaseUnit: 1 },
      { unitCode: 'Vỉ', factorToBaseUnit: 10 },
      { unitCode: 'Hộp', factorToBaseUnit: 40 },
    ]);
  });
});

describe('convertToBaseUnitQuantity', () => {
  const links = [
    { unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 10 },
    { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 10 },
  ];

  it('quy đổi đúng số lượng từ bậc cao xuống đơn vị nhỏ nhất', () => {
    expect(convertToBaseUnitQuantity('Viên', links, 'Hộp', 3)).toBe(300);
    expect(convertToBaseUnitQuantity('Viên', links, 'Vỉ', 5)).toBe(50);
    expect(convertToBaseUnitQuantity('Viên', links, 'Viên', 7)).toBe(7);
  });

  it('trả null khi đơn vị không có trong chuỗi quy đổi', () => {
    expect(convertToBaseUnitQuantity('Viên', links, 'Thùng', 1)).toBeNull();
  });
});
