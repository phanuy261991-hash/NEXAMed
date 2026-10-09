import { describe, expect, it } from 'vitest';
import { describeLeaveToday, formatLeaveWindow, hhmmToMinute, isWholeDayWindow, minuteToHhmm, windowsOverlap } from './leave-window';

/** Chạy lại đúng các ca của `packages/core/src/leave/leave-window.spec.ts` để bắt lệch bản phản chiếu. */
describe('leave-window (bản phản chiếu web)', () => {
  const morning = { startMinute: hhmmToMinute('07:30'), endMinute: hhmmToMinute('11:30') };
  const wholeDay = { startMinute: 0, endMinute: 1440 };

  it('đổi giờ ↔ phút', () => {
    expect(hhmmToMinute('07:30')).toBe(450);
    expect(minuteToHhmm(450)).toBe('07:30');
    expect(minuteToHhmm(1440)).toBe('24:00');
  });

  it('cả ngày phủ 0–1440', () => {
    expect(isWholeDayWindow(wholeDay)).toBe(true);
    expect(isWholeDayWindow(morning)).toBe(false);
  });

  it('chồng lấn là khoảng nửa mở', () => {
    expect(windowsOverlap(morning, { startMinute: hhmmToMinute('11:30'), endMinute: hhmmToMinute('17:00') })).toBe(false);
    expect(windowsOverlap(morning, { startMinute: hhmmToMinute('11:00'), endMinute: hhmmToMinute('17:00') })).toBe(true);
    expect(windowsOverlap(morning, wholeDay)).toBe(true);
  });

  it('nhãn Tiếp nhận theo buổi + định dạng khung', () => {
    expect(describeLeaveToday(wholeDay)).toBe('Nghỉ hôm nay');
    expect(describeLeaveToday(morning)).toBe('Nghỉ sáng nay');
    expect(describeLeaveToday({ startMinute: hhmmToMinute('13:30'), endMinute: hhmmToMinute('17:00') })).toBe('Nghỉ chiều nay');
    expect(formatLeaveWindow(morning)).toBe('07:30 – 11:30');
    expect(formatLeaveWindow(wholeDay)).toBe('Cả ngày');
  });
});
