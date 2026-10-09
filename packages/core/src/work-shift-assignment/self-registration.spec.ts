import { describe, expect, it } from 'vitest';
import { addMonthsToMonthString, isMonthOpenForSelfRegistration, shiftDurationMinutes, findWeeksBelowMinDaysOff } from './self-registration';

describe('self-registration', () => {
  it('chỉ tháng SAU tháng hiện tại mới mở cho nhân viên tự đăng ký', () => {
    expect(isMonthOpenForSelfRegistration('2026-11', '2026-10-09')).toBe(true);
    expect(isMonthOpenForSelfRegistration('2026-10', '2026-10-09')).toBe(false);
    expect(isMonthOpenForSelfRegistration('2026-09', '2026-10-09')).toBe(false);
    expect(isMonthOpenForSelfRegistration('2027-01', '2026-12-31')).toBe(true);
  });

  it('cộng tháng qua ranh giới năm', () => {
    expect(addMonthsToMonthString('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToMonthString('2026-01', -1)).toBe('2025-12');
  });

  it('số phút của ca', () => {
    expect(shiftDurationMinutes('07:30', '11:30')).toBe(240);
    expect(shiftDurationMinutes('13:30', '17:00')).toBe(210);
  });
});

describe('findWeeksBelowMinDaysOff — quota nghỉ tối thiểu mỗi tuần', () => {
  const days = (...d: number[]) => d.map((n) => `2026-11-${String(n).padStart(2, '0')}`);
  it('minDaysOff = 0 → không kiểm gì', () => {
    expect(findWeeksBelowMinDaysOff('2026-11', days(2, 3, 4, 5, 6, 7, 8), 0)).toEqual([]);
  });
  it('tuần làm đủ 7 ngày bị báo; tuần nghỉ đủ N ngày thì không', () => {
    // 2/11 là Thứ Hai: tuần 2–8 làm cả 7 ngày; tuần 9–15 chỉ làm 6 ngày (nghỉ ngày 15).
    const worked = [...days(2, 3, 4, 5, 6, 7, 8), ...days(9, 10, 11, 12, 13, 14)];
    const r = findWeeksBelowMinDaysOff('2026-11', worked, 1);
    // các tuần 16–22 và 23–29 không làm gì → nghỉ 7 ngày, đạt
    expect(r).toEqual([{ weekStart: '2026-11-02', weekEnd: '2026-11-08', daysOff: 0 }]);
  });
  it('tuần bị cắt ở đầu/cuối tháng bị bỏ qua', () => {
    // 1/11 là Chủ nhật, 30/11 là Thứ Hai → hai tuần lẻ không kiểm dù làm kín.
    const all = days(...Array.from({ length: 30 }, (_, i) => i + 1));
    const r = findWeeksBelowMinDaysOff('2026-11', all, 1);
    expect(r.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  });
  it('tính đúng khi tháng bắt đầu giữa tuần và ngày trùng không tính 2 lần', () => {
    // 2026-12: 1/12 là Thứ Ba → tuần đầu trọn trong tháng là 7–13/12.
    const dec = (n: number) => `2026-12-${String(n).padStart(2, '0')}`;
    const worked = [7, 7, 8, 9, 10, 11, 12].map(dec);
    const r = findWeeksBelowMinDaysOff('2026-12', worked, 2);
    expect(r.find((w) => w.weekStart === '2026-12-07')).toEqual({ weekStart: '2026-12-07', weekEnd: '2026-12-13', daysOff: 1 });
  });
});
