import { describe, expect, it } from 'vitest';
import { addMonthsToMonthString, formatMinutesAsHours, formatMonthLabel, formatWeekdayDate, isMonthOpenForSelfRegistration, resolveMonthBanner } from './schedule-month';

describe('resolveMonthBanner — banner trạng thái tháng', () => {
  it('Đã duyệt / Chờ duyệt luôn có banner của trạng thái, bất kể tháng còn mở hay không', () => {
    expect(resolveMonthBanner('APPROVED', null, false)).toEqual({ label: 'Đã duyệt', tone: 'emerald', banner: 'APPROVED' });
    expect(resolveMonthBanner('SUBMITTED', null, true)).toEqual({ label: 'Chờ duyệt', tone: 'amber', banner: 'SUBMITTED' });
  });

  it('Nháp còn lý do trả lại → nhãn "Bị trả lại"; banner chỉ hiện khi tháng còn mở', () => {
    expect(resolveMonthBanner('DRAFT', 'Thiếu ca chiều', true)).toEqual({ label: 'Bị trả lại', tone: 'rose', banner: 'RETURNED' });
    expect(resolveMonthBanner('DRAFT', 'Thiếu ca chiều', false)).toEqual({ label: 'Bị trả lại', tone: 'rose', banner: null });
  });

  it('Nháp thường → banner hướng dẫn gửi duyệt chỉ khi tháng còn mở', () => {
    expect(resolveMonthBanner('DRAFT', null, true)).toEqual({ label: 'Nháp', tone: 'slate', banner: 'DRAFT_OPEN' });
    expect(resolveMonthBanner('DRAFT', undefined, false)).toEqual({ label: 'Nháp', tone: 'slate', banner: null });
  });
});

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
