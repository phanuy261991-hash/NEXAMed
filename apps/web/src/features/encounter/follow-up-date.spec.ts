import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_MAX_DAYS,
  addDaysToDateString,
  diffDateStrings,
  formatDateStringVi,
  closedDayName,
  resolveFollowUpFromDate,
  resolveFollowUpFromDays,
  toVietnamDateString,
  vietnameseWeekdayLabel,
} from './follow-up-date';

// Bản phản chiếu của `packages/core/src/encounter/follow-up-date.ts` — chạy lại ĐÚNG các ca của bản core để 2 bản không lệch nhau.
describe('follow-up-date (bản phản chiếu ở web)', () => {
  it('cộng ngày qua ranh giới tháng, năm và năm nhuận', () => {
    expect(addDaysToDateString('2026-10-08', 7)).toBe('2026-10-15');
    expect(addDaysToDateString('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDaysToDateString('2026-12-30', 5)).toBe('2027-01-04');
    expect(addDaysToDateString('2028-02-27', 2)).toBe('2028-02-29');
    expect(addDaysToDateString('2027-02-27', 2)).toBe('2027-03-01');
  });

  it('chuỗi ngày sai định dạng hoặc không tồn tại → null; diff là nghịch đảo của add', () => {
    expect(addDaysToDateString('2026-02-31', 1)).toBeNull();
    expect(addDaysToDateString('08/10/2026', 1)).toBeNull();
    expect(diffDateStrings('2026-10-08', 'abc')).toBeNull();
    for (const n of [1, 7, 30, 365]) expect(diffDateStrings('2026-10-08', addDaysToDateString('2026-10-08', n)!)).toBe(n);
    expect(diffDateStrings('2026-10-08', '2026-10-01')).toBe(-7);
  });

  it('quy đổi số ngày → ngày hẹn; từ chối 0, số âm, thập phân, quá 365', () => {
    expect(resolveFollowUpFromDays('2026-10-08', 3)).toEqual({ ok: true, date: '2026-10-11', days: 3 });
    expect(resolveFollowUpFromDays('2026-10-08', FOLLOW_UP_MAX_DAYS)).toMatchObject({ ok: true, days: 365 });
    for (const bad of [0, -1, 2.5, 366, Number.NaN]) expect(resolveFollowUpFromDays('2026-10-08', bad)).toMatchObject({ ok: false });
  });

  it('quy đổi ngày hẹn → số ngày; phải sau ngày khám, không quá 365 ngày', () => {
    expect(resolveFollowUpFromDate('2026-10-08', '2026-10-15')).toEqual({ ok: true, date: '2026-10-15', days: 7 });
    expect(resolveFollowUpFromDate('2026-10-08', '2026-10-08')).toMatchObject({ ok: false });
    expect(resolveFollowUpFromDate('2026-10-08', '2026-10-01')).toMatchObject({ ok: false });
    expect(resolveFollowUpFromDate('2026-10-08', '2027-10-08')).toMatchObject({ ok: true, days: 365 });
    expect(resolveFollowUpFromDate('2026-10-08', '2027-10-09')).toMatchObject({ ok: false });
    expect(resolveFollowUpFromDate('2026-10-08', '2026-11-31')).toMatchObject({ ok: false });
  });

  it('nhãn thứ, định dạng dd/mm/yyyy và ngày khám theo giờ Việt Nam', () => {
    expect(vietnameseWeekdayLabel('2026-10-15')).toBe('Thứ Năm');
    expect(vietnameseWeekdayLabel('2026-10-11')).toBe('Chủ nhật');
    expect(vietnameseWeekdayLabel('xx')).toBe('');
    expect(formatDateStringVi('2026-10-15')).toBe('15/10/2026');
    // 23:30 UTC ngày 7 = 06:30 ngày 8 giờ Việt Nam
    expect(toVietnamDateString('2026-10-07T23:30:00.000Z')).toBe('2026-10-08');
    expect(toVietnamDateString('2026-10-08T16:59:00.000Z')).toBe('2026-10-08');
    expect(toVietnamDateString('2026-10-08T17:00:00.000Z')).toBe('2026-10-09');
  });

  it('nhắc ngày nghỉ: chỉ khi ngày đó được cấu hình đóng cửa (null); chưa cấu hình hoặc có giờ mở thì không nhắc', () => {
    const hours = { monday: { open: '08:00', close: '17:00' }, saturday: { open: '08:00', close: '12:00' }, sunday: null };
    expect(closedDayName(hours, '2026-10-11')).toBe('Chủ nhật'); // Chủ nhật
    expect(closedDayName(hours, '2026-10-12')).toBeNull(); // Thứ Hai có giờ mở
    expect(closedDayName(hours, '2026-10-17')).toBeNull(); // Thứ Bảy có giờ mở
    expect(closedDayName(hours, '2026-10-13')).toBeNull(); // Thứ Ba không có khoá → coi như chưa cấu hình, không nhắc
    expect(closedDayName(null, '2026-10-11')).toBeNull();
    expect(closedDayName(undefined, '2026-10-11')).toBeNull();
    expect(closedDayName(hours, 'xx')).toBeNull();
  });
});
