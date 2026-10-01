import { describe, expect, it } from 'vitest';
import {
  normalizeImportName,
  parseImportControlType,
  parseImportInteger,
  parseImportItemType,
  parseImportStrength,
  parseImportYesNo,
} from './parse-cells';

describe('normalizeImportName', () => {
  it('bỏ dấu, viết thường, gộp khoảng trắng', () => {
    expect(normalizeImportName('  Hộp   Lớn ')).toBe('hop lon');
    expect(normalizeImportName('ĐỨC')).toBe('duc');
  });
});

describe('parseImportItemType / ControlType / YesNo', () => {
  it('nhận nhãn tiếng Việt có/không dấu, không phân biệt hoa thường; trống → null; lạ → lỗi', () => {
    expect(parseImportItemType('Thuốc')).toEqual({ ok: true, value: 'MEDICINE' });
    expect(parseImportItemType(' vật tư ')).toEqual({ ok: true, value: 'SUPPLY' });
    expect(parseImportItemType('')).toEqual({ ok: true, value: null });
    expect(parseImportItemType('Hoá chất')).toEqual({ ok: false });
    expect(parseImportControlType('Gây nghiện')).toEqual({ ok: true, value: 'NARCOTIC' });
    expect(parseImportControlType('thuong')).toEqual({ ok: true, value: 'NORMAL' });
    expect(parseImportControlType('Cực độc')).toEqual({ ok: false });
    expect(parseImportYesNo('Có')).toEqual({ ok: true, value: true });
    expect(parseImportYesNo('không')).toEqual({ ok: true, value: false });
    expect(parseImportYesNo(true)).toEqual({ ok: true, value: true });
    expect(parseImportYesNo(undefined)).toEqual({ ok: true, value: null });
    expect(parseImportYesNo('có lẽ')).toEqual({ ok: false });
  });
});

describe('parseImportInteger', () => {
  it('nhận số nguyên, chuỗi số, chuỗi có dấu ngăn nghìn; từ chối số lẻ/âm/chữ', () => {
    expect(parseImportInteger(1500)).toEqual({ ok: true, value: 1500 });
    expect(parseImportInteger('1500')).toEqual({ ok: true, value: 1500 });
    expect(parseImportInteger('1.500')).toEqual({ ok: true, value: 1500 });
    expect(parseImportInteger('1,250,000')).toEqual({ ok: true, value: 1250000 });
    expect(parseImportInteger(0)).toEqual({ ok: true, value: 0 });
    expect(parseImportInteger(null)).toEqual({ ok: true, value: null });
    expect(parseImportInteger(1500.5)).toEqual({ ok: false });
    expect(parseImportInteger('1500.5')).toEqual({ ok: false });
    expect(parseImportInteger(-1)).toEqual({ ok: false });
    expect(parseImportInteger('abc')).toEqual({ ok: false });
    // Số kiểu SỐ lẻ 1.234 KHÔNG bị hiểu nhầm là "1.234" = 1234.
    expect(parseImportInteger(1.234)).toEqual({ ok: false });
  });
});

describe('parseImportStrength', () => {
  it('quy ra số nguyên ×1000, dấu phẩy hoặc chấm làm thập phân, tối đa 3 chữ số lẻ', () => {
    expect(parseImportStrength(500)).toEqual({ ok: true, value: 500000 });
    expect(parseImportStrength('500')).toEqual({ ok: true, value: 500000 });
    expect(parseImportStrength('0,5')).toEqual({ ok: true, value: 500 });
    expect(parseImportStrength('62.5')).toEqual({ ok: true, value: 62500 });
    expect(parseImportStrength(0.25)).toEqual({ ok: true, value: 250 });
    expect(parseImportStrength('0.001')).toEqual({ ok: true, value: 1 });
    expect(parseImportStrength('')).toEqual({ ok: true, value: null });
    expect(parseImportStrength('0.0001')).toEqual({ ok: false });
    expect(parseImportStrength('1.000,5')).toEqual({ ok: false });
    expect(parseImportStrength(-5)).toEqual({ ok: false });
    expect(parseImportStrength('abc')).toEqual({ ok: false });
  });
});
