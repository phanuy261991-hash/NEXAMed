import { describe, expect, it } from 'vitest';
import { buildDosePresets, formatDoseNumber, isPresetRowEmpty, parseDosePerBaseUnit, presetRowsFromItem, summarizePreset, validateDoseConfig, type DosePresetRow } from './drug-dose-config';

const row = (over: Partial<DosePresetRow> = {}): DosePresetRow => ({ name: 'Người lớn', doseMorning: '10', doseNoon: '', doseAfternoon: '', doseEvening: '10', ...over });

describe('parseDosePerBaseUnit', () => {
  it('nhận số dương bội của ¼, dấu phẩy hoặc chấm', () => {
    expect(parseDosePerBaseUnit('60')).toBe(60);
    expect(parseDosePerBaseUnit('2,5')).toBe(2.5);
    expect(parseDosePerBaseUnit('0.25')).toBe(0.25);
    expect(parseDosePerBaseUnit(' 100 ')).toBe(100);
  });
  it('từ chối rỗng, 0, âm, chữ, không phải bội ¼, quá lớn', () => {
    for (const bad of ['', '0', '-5', 'abc', '60.1', '0.1', '100001', '1e3']) expect(parseDosePerBaseUnit(bad), bad).toBeNull();
  });
});

describe('validateDoseConfig', () => {
  const ok = { doseUnitCode: 'ml', dosePerBaseUnit: '60', rows: [row(), row({ name: 'Trẻ 2 - 6 tuổi', doseMorning: '5', doseEvening: '5' })] };
  it('hợp lệ → không có lỗi', () => {
    expect(validateDoseConfig(ok)).toEqual([]);
  });
  it('không đơn vị liều, không dung tích, không liều mẫu → hợp lệ (thuốc thường)', () => {
    expect(validateDoseConfig({ doseUnitCode: '', dosePerBaseUnit: '', rows: [] })).toEqual([]);
  });
  it('đơn vị liều thiếu dung tích / dung tích thiếu đơn vị liều / dung tích sai', () => {
    expect(validateDoseConfig({ ...ok, dosePerBaseUnit: '' })[0]).toMatchObject({ row: null });
    expect(validateDoseConfig({ ...ok, dosePerBaseUnit: '60.1' })[0]).toMatchObject({ row: null });
    expect(validateDoseConfig({ ...ok, doseUnitCode: '' })[0]).toMatchObject({ row: null });
  });
  it('dòng trống hoàn toàn bị bỏ qua, không báo lỗi', () => {
    expect(validateDoseConfig({ ...ok, rows: [...ok.rows, row({ name: '', doseMorning: '', doseEvening: '' })] })).toEqual([]);
  });
  it('thiếu tên / liều sai / toàn 0 / tên trùng (không phân biệt hoa-thường) → báo đúng dòng', () => {
    expect(validateDoseConfig({ ...ok, rows: [row({ name: '' })] })).toEqual([expect.objectContaining({ row: 0 })]);
    expect(validateDoseConfig({ ...ok, rows: [row({ doseMorning: '1,1' })] })).toEqual([expect.objectContaining({ row: 0 })]);
    expect(validateDoseConfig({ ...ok, rows: [row({ doseMorning: '', doseEvening: '0' })] })).toEqual([expect.objectContaining({ row: 0 })]);
    const dup = validateDoseConfig({ ...ok, rows: [row(), row({ name: ' người LỚN ' })] });
    expect(dup).toEqual([expect.objectContaining({ row: 1 })]);
  });
  it('liều lẻ ½ gõ kiểu "1/2" và 2,5 đều hợp lệ', () => {
    expect(validateDoseConfig({ ...ok, rows: [row({ doseMorning: '1/2', doseEvening: '2,5' })] })).toEqual([]);
  });
});

describe('buildDosePresets / presetRowsFromItem / summarizePreset', () => {
  it('bỏ dòng trống, ô trống = 0, giữ thứ tự và liều lẻ', () => {
    const built = buildDosePresets([row(), row({ name: '', doseMorning: '', doseEvening: '' }), row({ name: 'Trẻ dưới 2 tuổi', doseMorning: '2,5', doseEvening: '2,5' })]);
    expect(built).toEqual([
      { name: 'Người lớn', doseMorning: 10, doseNoon: 0, doseAfternoon: 0, doseEvening: 10 },
      { name: 'Trẻ dưới 2 tuổi', doseMorning: 2.5, doseNoon: 0, doseAfternoon: 0, doseEvening: 2.5 },
    ]);
  });
  it('đọc lại từ thuốc đã lưu: liều 0 thành ô trống, liều lẻ dạng "2,5"', () => {
    const rows = presetRowsFromItem({ dosePresets: [{ id: 'x', name: 'Trẻ', sortOrder: 0, doseMorning: 2.5, doseNoon: 0, doseAfternoon: 0, doseEvening: 2.5 }] });
    expect(rows).toEqual([{ name: 'Trẻ', doseMorning: '2,5', doseNoon: '', doseAfternoon: '', doseEvening: '2,5' }]);
    expect(presetRowsFromItem(undefined)).toEqual([]);
  });
  it('tóm tắt: bỏ buổi bằng 0, kèm đơn vị', () => {
    expect(summarizePreset({ doseMorning: 10, doseNoon: 0, doseAfternoon: 0, doseEvening: 10 }, 'ml')).toBe('Sáng 10 - Tối 10 ml');
    expect(summarizePreset({ doseMorning: 1, doseNoon: 1, doseAfternoon: 1, doseEvening: 0 }, '')).toBe('Sáng 1 - Trưa 1 - Chiều 1');
  });
  it('isPresetRowEmpty và formatDoseNumber', () => {
    expect(isPresetRowEmpty(row({ name: '', doseMorning: '', doseEvening: '' }))).toBe(true);
    expect(isPresetRowEmpty(row())).toBe(false);
    expect(formatDoseNumber(2.5)).toBe('2,5');
    expect(formatDoseNumber(10)).toBe('10');
  });
});
