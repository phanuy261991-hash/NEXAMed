import { describe, expect, it } from 'vitest';
import { addMonthsToMonthString, formatMinutesAsHours, formatMonthLabel, formatWeekdayDate, isMonthOpenForSelfRegistration } from './schedule-month';

/** Chạy lại đúng các ca của `packages/core/src/work-shift-assignment/self-registration.spec.ts`. */
describe('schedule-month (bản phản chiếu web)', () => {
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

  it('định dạng nhãn', () => {
    expect(formatMonthLabel('2026-11')).toBe('Tháng 11/2026');
    expect(formatMinutesAsHours(7140)).toBe('119');
    expect(formatMinutesAsHours(450)).toBe('7.5');
    expect(formatWeekdayDate('2026-11-17')).toBe('Thứ Ba 17/11');
  });
});
