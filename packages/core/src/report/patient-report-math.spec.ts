import { describe, expect, it } from 'vitest';
import { AGE_BANDS, ageBandKey, listMonthKeys, overdueDays, returnGapIndex, summarizeDemographics, summarizeNewReturning } from './patient-report-math';

describe('returnGapIndex', () => {
  it('chia khoảng đúng ở các mốc 30/90/180/365 ngày', () => {
    expect([0, 30, 31, 90, 91, 180, 181, 365, 366, 2000].map(returnGapIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('số âm coi như 0', () => {
    expect(returnGapIndex(-5)).toBe(0);
  });
});

describe('summarizeNewReturning', () => {
  const rows = [
    { isNew: true, visits: 1, gapIndex: null, patients: 6, totalVisits: 6 },
    { isNew: true, visits: 2, gapIndex: null, patients: 2, totalVisits: 4 },
    { isNew: false, visits: 1, gapIndex: 0, patients: 3, totalVisits: 3 },
    { isNew: false, visits: 4, gapIndex: 4, patients: 1, totalVisits: 9 },
  ];
  it('đếm bệnh nhân mới/cũ, lượt khám và tỉ lệ', () => {
    const r = summarizeNewReturning(rows);
    expect(r.summary).toEqual({ patients: 12, newPatients: 8, returningPatients: 4, visits: 22, visitsPerPatient: 1.8, returningPercent: 33.3 });
  });
  it('phân bố số lượt gộp từ 4 lượt, khoảng cách chỉ tính bệnh nhân cũ', () => {
    const r = summarizeNewReturning(rows);
    expect(r.frequency.map((f) => f.patients)).toEqual([9, 2, 0, 1]);
    expect(r.gap.map((g) => g.patients)).toEqual([3, 0, 0, 0, 1]);
  });
  it('không có bệnh nhân thì tỉ lệ là null', () => {
    const r = summarizeNewReturning([]);
    expect(r.summary.visitsPerPatient).toBeNull();
    expect(r.summary.returningPercent).toBeNull();
    expect(r.frequency.every((f) => f.patients === 0)).toBe(true);
  });
});

describe('listMonthKeys', () => {
  it('liệt kê tháng qua năm', () => {
    expect(listMonthKeys('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
  it('một tháng khi cùng tháng', () => {
    expect(listMonthKeys('2026-10-01', '2026-10-31')).toEqual(['2026-10']);
  });
  it('ngày sai định dạng thì rỗng', () => {
    expect(listMonthKeys('x', '2026-10-31')).toEqual([]);
  });
});

describe('ageBandKey', () => {
  it('đúng khoảng ở các mốc biên', () => {
    expect([0, 1, 5, 6, 15, 16, 30, 31, 45, 46, 60, 61, 120].map(ageBandKey)).toEqual(['under1', '1-5', '1-5', '6-15', '6-15', '16-30', '16-30', '31-45', '31-45', '46-60', '46-60', 'over60', 'over60']);
  });
  it('tuổi âm hoặc vô lý là null', () => {
    expect(ageBandKey(-1)).toBeNull();
    expect(ageBandKey(200)).toBeNull();
  });
  it('các khoảng nối liền nhau, không hở', () => {
    for (let age = 0; age <= 120; age += 1) expect(ageBandKey(age)).not.toBeNull();
    expect(AGE_BANDS).toHaveLength(7);
  });
});

describe('summarizeDemographics', () => {
  it('xếp tuổi × giới, giới lạ vào "khác", thiếu tuổi vào unknownAge', () => {
    const r = summarizeDemographics([
      { age: 3, gender: 'male', patients: 4 },
      { age: 3, gender: 'female', patients: 2 },
      { age: 40, gender: 'female', patients: 5 },
      { age: 40, gender: 'unknown', patients: 1 },
      { age: null, gender: 'male', patients: 2 },
    ]);
    expect(r.patients).toBe(14);
    expect(r.genders).toEqual({ male: 6, female: 7, other: 1 });
    expect(r.unknownAge).toBe(2);
    expect(r.ageBands.find((b) => b.key === '1-5')).toMatchObject({ male: 4, female: 2, total: 6 });
    expect(r.ageBands.find((b) => b.key === '31-45')).toMatchObject({ female: 5, other: 1, total: 6 });
  });
});

describe('overdueDays', () => {
  it('đếm số ngày quá hẹn', () => {
    expect(overdueDays('2026-11-01', '2026-11-06')).toBe(5);
  });
  it('chưa quá hẹn hoặc sai định dạng thì 0', () => {
    expect(overdueDays('2026-11-10', '2026-11-06')).toBe(0);
    expect(overdueDays('x', '2026-11-06')).toBe(0);
  });
});
