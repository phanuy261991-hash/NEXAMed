import { describe, expect, it } from 'vitest';
import type { BusinessHours } from '@nexamed/shared';
import { isAtOrPastTime, resolveReminderTime } from './useClosingTimeReminder';

const hours = (close: string | null) => (close === null ? null : { open: '07:30', close });
const businessHours: BusinessHours = {
  monday: hours('17:30'),
  tuesday: hours('17:30'),
  wednesday: hours('17:30'),
  thursday: hours('17:30'),
  friday: hours('17:30'),
  saturday: hours('12:00'),
  sunday: null,
};

// 28/10/2026 là thứ Tư; 31/10/2026 thứ Bảy; 1/11/2026 Chủ nhật.
const wednesday = new Date(2026, 9, 28, 10, 0);
const saturday = new Date(2026, 9, 31, 10, 0);
const sunday = new Date(2026, 10, 1, 10, 0);

describe('resolveReminderTime — giờ nhắc đóng ca hôm nay', () => {
  it('có ca đã xếp → giờ kết thúc ca cuối, không dùng giờ phòng khám', () => {
    expect(resolveReminderTime({ todayClosingTime: '11:30', todayClosingSource: 'SHIFT' }, businessHours, wednesday)).toBe('11:30');
  });

  it('nghỉ phép cả ngày đã duyệt → không nhắc', () => {
    expect(resolveReminderTime({ todayClosingTime: null, todayClosingSource: 'LEAVE' }, businessHours, wednesday)).toBeNull();
  });

  it('phòng khám tắt "Nhắc và bắt buộc đóng ca" → không nhắc dù có ca hay có giờ phòng khám', () => {
    expect(resolveReminderTime({ todayClosingTime: null, todayClosingSource: 'DISABLED' }, businessHours, wednesday)).toBeNull();
  });

  it('không dùng phân ca (phòng khám 1 bác sĩ) → giờ đóng cửa phòng khám của đúng thứ hôm nay', () => {
    const noShift = { todayClosingTime: null, todayClosingSource: null } as const;
    expect(resolveReminderTime(noShift, businessHours, wednesday)).toBe('17:30');
    expect(resolveReminderTime(noShift, businessHours, saturday)).toBe('12:00');
  });

  it('không có ca và phòng khám nghỉ hôm nay / chưa có giờ làm việc → không nhắc', () => {
    const noShift = { todayClosingTime: null, todayClosingSource: null } as const;
    expect(resolveReminderTime(noShift, businessHours, sunday)).toBeNull();
    expect(resolveReminderTime(noShift, null, wednesday)).toBeNull();
    expect(resolveReminderTime(noShift, undefined, wednesday)).toBeNull();
  });
});

describe('isAtOrPastTime', () => {
  it('đúng giờ hoặc quá giờ thì true, trước giờ thì false', () => {
    expect(isAtOrPastTime(new Date(2026, 9, 28, 17, 29), '17:30')).toBe(false);
    expect(isAtOrPastTime(new Date(2026, 9, 28, 17, 30), '17:30')).toBe(true);
    expect(isAtOrPastTime(new Date(2026, 9, 28, 20, 0), '17:30')).toBe(true);
  });
});
