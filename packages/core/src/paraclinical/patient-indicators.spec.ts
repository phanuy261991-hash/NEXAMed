import { describe, expect, it } from 'vitest';
import { countTrackableIndicators, groupIndicatorMeasures, indicatorKey, normalizeIndicatorUnit, type IndicatorMeasure } from './patient-indicators';

const m = (over: Partial<IndicatorMeasure>): IndicatorMeasure => ({ code: 'GLU', unit: 'mmol/L', name: 'Glucose', groupName: 'SINH HOÁ', signedAtMs: 1, value: 5, ...over });

describe('patient-indicators', () => {
  it('chuẩn hoá đơn vị: rỗng/khoảng trắng = không đơn vị; cắt khoảng trắng hai đầu', () => {
    expect(normalizeIndicatorUnit('  mmol/L ')).toBe('mmol/L');
    expect(normalizeIndicatorUnit('   ')).toBeNull();
    expect(normalizeIndicatorUnit(null)).toBeNull();
    expect(indicatorKey('GLU', ' ')).toBe(indicatorKey('GLU', null));
    expect(indicatorKey('GLU', 'mmol/L')).not.toBe(indicatorKey('GLU', 'mg/dL'));
  });

  it('gộp theo mã + đơn vị, sắp cũ → mới; đổi đơn vị thì tách thành hai nhóm riêng', () => {
    const groups = groupIndicatorMeasures([
      m({ signedAtMs: 30, value: 7 }),
      m({ signedAtMs: 10, value: 5 }),
      m({ signedAtMs: 20, value: 6 }),
      m({ signedAtMs: 40, unit: 'mg/dL', value: 120 }),
    ]);
    expect(groups).toHaveLength(2);
    const mmol = groups.find((g) => g.unit === 'mmol/L')!;
    expect(mmol.measures.map((x) => x.value)).toEqual([5, 6, 7]);
    expect(groups.find((g) => g.unit === 'mg/dL')!.measures).toHaveLength(1);
  });

  it('tên nhóm lấy theo lần đo mới nhất; nhóm sắp theo nhóm dịch vụ rồi tên, nhóm chưa phân loại xuống cuối', () => {
    const groups = groupIndicatorMeasures([
      m({ code: 'B', name: 'Bạch cầu', groupName: 'HUYẾT HỌC', signedAtMs: 1 }),
      m({ code: 'A', name: 'Albumin cũ', groupName: 'SINH HOÁ', signedAtMs: 1 }),
      m({ code: 'A', name: 'Albumin', groupName: 'SINH HOÁ', signedAtMs: 2 }),
      m({ code: 'Z', name: 'Chỉ số lạ', groupName: null, signedAtMs: 1 }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Bạch cầu', 'Albumin', 'Chỉ số lạ']);
  });

  it('đếm chỉ số theo dõi được: từ 3 lần đo trở lên', () => {
    const groups = groupIndicatorMeasures([
      m({ code: 'A', signedAtMs: 1 }),
      m({ code: 'A', signedAtMs: 2 }),
      m({ code: 'A', signedAtMs: 3 }),
      m({ code: 'B', signedAtMs: 1 }),
      m({ code: 'B', signedAtMs: 2 }),
    ]);
    expect(countTrackableIndicators(groups)).toBe(1);
  });
});
