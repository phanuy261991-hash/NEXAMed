import { describe, expect, it } from 'vitest';
import { evaluateVitalSignWarnings, resolveVitalSignAgeBand } from './vital-sign-thresholds';

describe('resolveVitalSignAgeBand', () => {
  it('biên đúng 1 tuổi và 13 tuổi', () => {
    expect(resolveVitalSignAgeBand(0)).toBe('infant');
    expect(resolveVitalSignAgeBand(0.9)).toBe('infant');
    expect(resolveVitalSignAgeBand(1)).toBe('child');
    expect(resolveVitalSignAgeBand(12.9)).toBe('child');
    expect(resolveVitalSignAgeBand(13)).toBe('adolescent_adult');
    expect(resolveVitalSignAgeBand(40)).toBe('adolescent_adult');
  });
});

describe('evaluateVitalSignWarnings', () => {
  it('không có chỉ số nào → mảng rỗng (đo từng phần hợp lệ)', () => {
    expect(evaluateVitalSignWarnings({}, 30)).toEqual([]);
  });

  it('mạch trong ngưỡng người lớn (60-100) → không cảnh báo; ngoài ngưỡng → cảnh báo out_of_range', () => {
    expect(evaluateVitalSignWarnings({ pulse: 60 }, 30)).toEqual([]);
    expect(evaluateVitalSignWarnings({ pulse: 100 }, 30)).toEqual([]);
    expect(evaluateVitalSignWarnings({ pulse: 59 }, 30)).toHaveLength(1);
    expect(evaluateVitalSignWarnings({ pulse: 101 }, 30)[0]).toMatchObject({ field: 'pulse', kind: 'out_of_range' });
  });

  it('cùng giá trị mạch, trẻ sơ sinh (infant) và người lớn cho kết quả khác nhau — đúng ý nghĩa "theo tuổi"', () => {
    // 120 lần/phút: bình thường cho trẻ sơ sinh (100-160), bất thường cho người lớn (60-100).
    expect(evaluateVitalSignWarnings({ pulse: 120 }, 0.5)).toEqual([]);
    expect(evaluateVitalSignWarnings({ pulse: 120 }, 30)).toHaveLength(1);
  });

  it('nhịp thở theo nhóm tuổi (child 18-30)', () => {
    expect(evaluateVitalSignWarnings({ respiratoryRate: 18 }, 5)).toEqual([]);
    expect(evaluateVitalSignWarnings({ respiratoryRate: 30 }, 5)).toEqual([]);
    expect(evaluateVitalSignWarnings({ respiratoryRate: 31 }, 5)[0]).toMatchObject({ field: 'respiratoryRate', kind: 'out_of_range' });
  });

  it('nhiệt độ dùng chung 1 ngưỡng mọi tuổi (36.0-39.0°C)', () => {
    expect(evaluateVitalSignWarnings({ temperatureC: 39.0 }, 5)).toEqual([]);
    expect(evaluateVitalSignWarnings({ temperatureC: 39.5 }, 30)[0]).toMatchObject({ field: 'temperatureC', kind: 'out_of_range' });
    expect(evaluateVitalSignWarnings({ temperatureC: 35.5 }, 30)[0]).toMatchObject({ field: 'temperatureC', kind: 'out_of_range' });
  });

  it('SpO2 chỉ cảnh báo khi dưới 95%', () => {
    expect(evaluateVitalSignWarnings({ spo2: 95 }, 30)).toEqual([]);
    expect(evaluateVitalSignWarnings({ spo2: 100 }, 30)).toEqual([]);
    expect(evaluateVitalSignWarnings({ spo2: 94 }, 30)[0]).toMatchObject({ field: 'spo2', kind: 'out_of_range' });
  });

  it('huyết áp: biên đúng 13 tuổi tách 2 nhóm ngưỡng khác nhau', () => {
    // 120/80 hợp lệ cho >=13 tuổi nhưng ngoài ngưỡng cho <13 tuổi (70-110/40-70).
    expect(evaluateVitalSignWarnings({ bpSystolic: 120, bpDiastolic: 80 }, 13)).toEqual([]);
    const warningsUnder13 = evaluateVitalSignWarnings({ bpSystolic: 120, bpDiastolic: 80 }, 12);
    expect(warningsUnder13).toHaveLength(2);
    expect(warningsUnder13.map((w) => w.field).sort()).toEqual(['bpDiastolic', 'bpSystolic']);
  });

  it('cân nặng/chiều cao phi lý → kind implausible, không phải out_of_range', () => {
    expect(evaluateVitalSignWarnings({ weightGram: 200 }, 30)[0]).toMatchObject({ field: 'weightGram', kind: 'implausible' });
    expect(evaluateVitalSignWarnings({ heightMm: 100 }, 30)[0]).toMatchObject({ field: 'heightMm', kind: 'implausible' });
    // Giá trị hợp lý (60kg, 1m70) → không cảnh báo.
    expect(evaluateVitalSignWarnings({ weightGram: 60_000, heightMm: 1_700 }, 30)).toEqual([]);
  });

  it('nhiều chỉ số ngoài ngưỡng cùng lúc → trả đủ từng cảnh báo, không dừng ở cái đầu tiên', () => {
    const warnings = evaluateVitalSignWarnings({ pulse: 200, spo2: 80, temperatureC: 41 }, 30);
    expect(warnings).toHaveLength(3);
  });
});
