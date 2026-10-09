import { describe, expect, it } from 'vitest';
import { addMonthsToMonthString, isMonthOpenForSelfRegistration, shiftDurationMinutes } from './self-registration';

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
