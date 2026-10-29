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

// ---- Bản sao client khớp bản gốc ở shared (docs/DECISIONS.md #267)
import {
  formatDoseDecimalPreview,
  formatPrescriptionDosePreview,
  quartersPerBaseUnitPreview,
} from './prescription-dose-preview';

describe('bản sao client của kiểu kê "Khi cần"/ml (#267)', () => {
  it('quy đổi dung tích và số lượng', () => {
    expect(quartersPerBaseUnitPreview()).toBe(4);
    expect(quartersPerBaseUnitPreview(60)).toBe(240);
    expect(computePrescriptionQuantityPreview({ doseMorning: 5, doseNoon: 0, doseAfternoon: 0, doseEvening: 5 }, 5, 60)).toBe(1);
    expect(computePrescriptionQuantityPreview({ doseMorning: 10, doseNoon: 0, doseAfternoon: 0, doseEvening: 10 }, 7, 60)).toBe(3);
    expect(computePrescriptionQuantityPreview({ doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 1 }, 3)).toBe(6);
  });

  it('định dạng liều: thập phân kiểu Việt cho ml, ký hiệu ½ cho viên; "Khi cần"', () => {
    expect(formatDoseDecimalPreview(2.5)).toBe('2,5');
    expect(formatPrescriptionDosePreview({ doseMorning: 5, doseNoon: 0, doseAfternoon: 0, doseEvening: 5, doseUnitName: 'ml' })).toBe('Sáng 5 ml - Tối 5 ml');
    expect(formatPrescriptionDosePreview({ doseMorning: 0.5, doseNoon: 0, doseAfternoon: 0, doseEvening: 1.5 })).toBe('Sáng ½ - Tối 1½');
    const none = { doseMorning: 0, doseNoon: 0, doseAfternoon: 0, doseEvening: 0 };
    expect(formatPrescriptionDosePreview({ ...none, doseMode: 'AS_NEEDED', singleDose: 1.5 })).toBe('Mỗi lần 1,5, khi cần');
    expect(formatPrescriptionDosePreview({ ...none, doseMode: 'AS_NEEDED', singleDose: 1.5, unitName: 'Gói' })).toBe('Mỗi lần 1,5 gói, khi cần');
    expect(formatPrescriptionDosePreview({ ...none, doseMode: 'AS_NEEDED', singleDose: 2.5, doseUnitName: 'ml' })).toBe('Mỗi lần 2,5 ml, khi cần');
    expect(formatPrescriptionDosePreview({ ...none, doseMode: 'AS_NEEDED', singleDose: null })).toBe('Khi cần');
  });
});
