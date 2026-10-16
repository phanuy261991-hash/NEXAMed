import { describe, expect, it } from 'vitest';
import {
  computePrescriptionExactQuartersPreview,
  computePrescriptionQuantityPreview,
  formatDoseAmountPreview,
  formatQuarterTotalVi,
  hasFractionalDosePreview,
  parseDoseInput,
} from './prescription-dose-preview';

describe('parseDoseInput (#241)', () => {
  it.each([
    ['0,5', 0.5],
    ['0.5', 0.5],
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    ['½', 0.5],
    ['1½', 1.5],
    ['¼', 0.25],
    ['3/4', 0.75],
    ['2', 2],
    ['  1 ', 1],
  ])('đọc "%s" = %s', (text, expected) => {
    expect(parseDoseInput(text)).toBe(expected);
  });

  it('để trống → chuỗi rỗng (xoá ô)', () => {
    expect(parseDoseInput('')).toBe('');
    expect(parseDoseInput('   ')).toBe('');
  });

  it.each(['0,3', '1/3', 'abc', '1/0', '-1', '100', '1.1'])('"%s" không hợp lệ → null (quay về giá trị cũ)', (text) => {
    expect(parseDoseInput(text)).toBeNull();
  });
});

describe('tổng số / hiển thị liều lẻ (khớp bản gốc ở packages/shared)', () => {
  const P = (m: number, n: number, a: number, e: number) => ({ doseMorning: m, doseNoon: n, doseAfternoon: a, doseEvening: e });

  it('làm tròn lên khi tổng lẻ, ghi rõ số lẻ gốc', () => {
    expect(computePrescriptionQuantityPreview(P(0.5, 0, 0, 0), 7)).toBe(4);
    expect(formatQuarterTotalVi(computePrescriptionExactQuartersPreview(P(0.5, 0, 0, 0), 7))).toBe('3,5');
  });

  it('tổng nguyên thì không lẻ', () => {
    expect(computePrescriptionQuantityPreview(P(0.5, 0, 0, 0.5), 5)).toBe(5);
    expect(computePrescriptionExactQuartersPreview(P(0.5, 0, 0, 0.5), 5) % 4).toBe(0);
  });

  it('hiển thị phân số và nhận diện liều lẻ', () => {
    expect([0.5, 1.5, 2, 0.25, 0].map(formatDoseAmountPreview)).toEqual(['½', '1½', '2', '¼', '0']);
    expect(hasFractionalDosePreview(P(1, 0, 0, 0.5))).toBe(true);
    expect(hasFractionalDosePreview(P(1, 1, 0, 1))).toBe(false);
  });
});
