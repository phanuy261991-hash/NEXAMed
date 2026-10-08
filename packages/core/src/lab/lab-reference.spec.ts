import { describe, expect, it } from 'vitest';
import {
  evaluateLabValue,
  formatLabReferenceText,
  parseLabNumber,
  selectLabReference,
  type LabReferenceRow,
} from './lab-reference';

function row(partial: Partial<LabReferenceRow>): LabReferenceRow {
  return {
    sex: 'ANY',
    ageFromYears: 0,
    ageToYears: null,
    lowValue: null,
    highValue: null,
    lowInclusive: true,
    highInclusive: true,
    normalText: null,
    displayText: null,
    ...partial,
  };
}

// HGB (g/L) — đúng ví dụ ở mockup: Nam ≥15 / Nữ ≥15 / Chung 1-14 / Chung sơ sinh.
const HGB: LabReferenceRow[] = [
  row({ sex: 'MALE', ageFromYears: 15, lowValue: 130, highValue: 175 }),
  row({ sex: 'FEMALE', ageFromYears: 15, lowValue: 120, highValue: 160 }),
  row({ sex: 'ANY', ageFromYears: 1, ageToYears: 14, lowValue: 110, highValue: 150 }),
  row({ sex: 'ANY', ageFromYears: 0, ageToYears: 0, lowValue: 145, highValue: 225 }),
];

describe('selectLabReference', () => {
  it('chọn đúng dòng theo giới tính + tuổi', () => {
    expect(selectLabReference(HGB, { gender: 'male', ageYears: 40 })?.lowValue).toBe(130);
    expect(selectLabReference(HGB, { gender: 'female', ageYears: 40 })?.lowValue).toBe(120);
    expect(selectLabReference(HGB, { gender: 'female', ageYears: 8 })?.lowValue).toBe(110);
    expect(selectLabReference(HGB, { gender: 'male', ageYears: 0 })?.lowValue).toBe(145);
  });

  it('ranh giới tuổi tính cả hai đầu (14 và 15)', () => {
    expect(selectLabReference(HGB, { gender: 'male', ageYears: 14 })?.highValue).toBe(150);
    expect(selectLabReference(HGB, { gender: 'male', ageYears: 15 })?.highValue).toBe(175);
  });

  it('giới tính "other"/chưa rõ chỉ khớp dòng ANY; tuổi chưa biết chỉ khớp dòng không ràng buộc tuổi', () => {
    expect(selectLabReference(HGB, { gender: 'other', ageYears: 40 })).toBeNull();
    expect(selectLabReference(HGB, { gender: 'male', ageYears: null })).toBeNull();
    const open = [row({ lowValue: 1, highValue: 2 })];
    expect(selectLabReference(open, { gender: null, ageYears: null })?.lowValue).toBe(1);
  });

  it('dòng cụ thể hơn thắng: giới tính cụ thể > ANY, khoảng tuổi hẹp > rộng, bất kể thứ tự', () => {
    const rows = [
      row({ sex: 'ANY', lowValue: 1, highValue: 100 }),
      row({ sex: 'ANY', ageFromYears: 18, ageToYears: 65, lowValue: 2, highValue: 90 }),
      row({ sex: 'FEMALE', lowValue: 3, highValue: 80 }),
    ];
    expect(selectLabReference(rows, { gender: 'female', ageYears: 30 })?.lowValue).toBe(3);
    expect(selectLabReference(rows, { gender: 'male', ageYears: 30 })?.lowValue).toBe(2);
    expect(selectLabReference(rows, { gender: 'male', ageYears: 80 })?.lowValue).toBe(1);
  });

  it('không dòng nào khớp → null', () => {
    expect(selectLabReference([], { gender: 'male', ageYears: 30 })).toBeNull();
  });
});

describe('evaluateLabValue', () => {
  const ref = HGB[0]!;

  it('gắn cờ Thấp / Cao / Bình thường theo ngưỡng', () => {
    expect(evaluateLabValue('NUMBER', 104, ref)).toBe('LOW');
    expect(evaluateLabValue('NUMBER', 180, ref)).toBe('HIGH');
    expect(evaluateLabValue('NUMBER', 150, ref)).toBe('NORMAL');
  });

  it('biên: bằng ngưỡng là bình thường khi bao gồm, bất thường khi loại trừ', () => {
    expect(evaluateLabValue('NUMBER', 130, ref)).toBe('NORMAL');
    expect(evaluateLabValue('NUMBER', 175, ref)).toBe('NORMAL');
    const exclusive = row({ highValue: 0.03, highInclusive: false });
    expect(evaluateLabValue('NUMBER', 0.03, exclusive)).toBe('HIGH');
    expect(evaluateLabValue('NUMBER', 0, exclusive)).toBe('NORMAL');
  });

  it('chấp nhận dấu phẩy thập phân kiểu Việt và chuỗi số', () => {
    expect(evaluateLabValue('NUMBER', '5,3', row({ lowValue: 4, highValue: 6 }))).toBe('NORMAL');
    expect(evaluateLabValue('NUMBER', 'abc', ref)).toBeNull();
    expect(parseLabNumber('  12,5 ')).toBe(12.5);
    expect(parseLabNumber('')).toBeNull();
  });

  it('một đầu ngưỡng: chỉ có ngưỡng cao ("< 0.03")', () => {
    const onlyHigh = row({ highValue: 0.03, highInclusive: false });
    expect(evaluateLabValue('NUMBER', 0.01, onlyHigh)).toBe('NORMAL');
    expect(evaluateLabValue('NUMBER', 0.5, onlyHigh)).toBe('HIGH');
  });

  it('chỉ số chữ: so khớp giá trị bình thường, không phân biệt hoa/thường/dấu', () => {
    const neg = row({ normalText: 'Âm tính' });
    expect(evaluateLabValue('CHOICE', 'am tinh', neg)).toBe('NORMAL');
    expect(evaluateLabValue('CHOICE', 'Dương tính', neg)).toBe('ABNORMAL');
    expect(evaluateLabValue('TEXT', '', neg)).toBeNull();
  });

  it('không có tham chiếu hoặc không có ngưỡng → null (không kết luận)', () => {
    expect(evaluateLabValue('NUMBER', 5, null)).toBeNull();
    expect(evaluateLabValue('NUMBER', 5, row({}))).toBeNull();
    expect(evaluateLabValue('CHOICE', 'x', row({}))).toBeNull();
  });
});

describe('formatLabReferenceText', () => {
  it('ưu tiên displayText người dùng gõ (kể cả nhiều dòng)', () => {
    const t = 'Bình thường: < 5.7\nTiền tiểu đường: 5.7 - 6.4';
    expect(formatLabReferenceText(row({ displayText: t, lowValue: 1, highValue: 2 }))).toBe(t);
  });

  it('tự sinh từ ngưỡng', () => {
    expect(formatLabReferenceText(row({ lowValue: 4, highValue: 10 }))).toBe('4 - 10');
    expect(formatLabReferenceText(row({ highValue: 0.03, highInclusive: false }))).toBe('< 0.03');
    expect(formatLabReferenceText(row({ highValue: 1 }))).toBe('≤ 1');
    expect(formatLabReferenceText(row({ lowValue: 90 }))).toBe('≥ 90');
    expect(formatLabReferenceText(row({ lowValue: 90, lowInclusive: false }))).toBe('> 90');
  });

  it('tôn trọng số lẻ thập phân của chỉ số', () => {
    expect(formatLabReferenceText(row({ lowValue: 4, highValue: 10 }), 2)).toBe('4.00 - 10.00');
  });

  it('chỉ số chữ dùng normalText; không có gì thì rỗng', () => {
    expect(formatLabReferenceText(row({ normalText: 'Âm tính' }))).toBe('Âm tính');
    expect(formatLabReferenceText(row({}))).toBe('');
    expect(formatLabReferenceText(null)).toBe('');
  });
});
