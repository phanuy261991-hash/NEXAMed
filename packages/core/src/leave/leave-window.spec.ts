import { describe, expect, it } from 'vitest';
import {
  appointmentOverlapsLeaveWindow,
  describeLeaveToday,
  hhmmToMinute,
  isWholeDayLeaveWindow,
  leaveWindowFromShift,
  vietnamMinuteOfDay,
  wholeDayLeaveWindow,
  windowsOverlap,
} from './leave-window';

describe('leave-window', () => {
  it('đổi HH:mm sang phút và dựng khung từ ca', () => {
    expect(hhmmToMinute('07:30')).toBe(450);
    expect(leaveWindowFromShift('07:30', '11:30')).toEqual({ startMinute: 450, endMinute: 690 });
  });

  it('cả ngày phủ 0–1440', () => {
    const w = wholeDayLeaveWindow();
    expect(w).toEqual({ startMinute: 0, endMinute: 1440 });
    expect(isWholeDayLeaveWindow(w)).toBe(true);
    expect(isWholeDayLeaveWindow(leaveWindowFromShift('07:30', '11:30'))).toBe(false);
  });

  it('chồng lấn là khoảng nửa mở: chạm đầu mút không tính', () => {
    const morning = leaveWindowFromShift('07:30', '11:30');
    expect(windowsOverlap(morning, leaveWindowFromShift('11:30', '17:00'))).toBe(false);
    expect(windowsOverlap(morning, leaveWindowFromShift('11:00', '17:00'))).toBe(true);
    expect(windowsOverlap(morning, wholeDayLeaveWindow())).toBe(true);
  });

  it('đổi UTC sang phút trong ngày giờ VN, kể cả qua nửa đêm UTC', () => {
    // 01:00Z = 08:00 VN; 18:00Z = 01:00 VN ngày hôm sau
    expect(vietnamMinuteOfDay(new Date('2026-10-14T01:00:00Z'))).toBe(8 * 60);
    expect(vietnamMinuteOfDay(new Date('2026-10-13T18:00:00Z'))).toBe(60);
  });

  it('lịch hẹn nằm trong/ngoài/chạm khung nghỉ', () => {
    const morning = leaveWindowFromShift('07:30', '11:30');
    // 08:00 VN (01:00Z), 15 phút → trong khung
    expect(appointmentOverlapsLeaveWindow(new Date('2026-10-14T01:00:00Z'), 15, morning)).toBe(true);
    // 11:30 VN (04:30Z) → đúng giờ kết thúc, không chồng
    expect(appointmentOverlapsLeaveWindow(new Date('2026-10-14T04:30:00Z'), 15, morning)).toBe(false);
    // 11:20 VN, 15 phút → lấn qua 11:30 nên chồng
    expect(appointmentOverlapsLeaveWindow(new Date('2026-10-14T04:20:00Z'), 15, morning)).toBe(true);
  });

  it('nhãn Tiếp nhận theo buổi', () => {
    expect(describeLeaveToday(wholeDayLeaveWindow())).toBe('Nghỉ hôm nay');
    expect(describeLeaveToday(leaveWindowFromShift('07:30', '11:30'))).toBe('Nghỉ sáng nay');
    expect(describeLeaveToday(leaveWindowFromShift('13:30', '17:00'))).toBe('Nghỉ chiều nay');
  });
});
