import { describe, expect, it } from 'vitest';
import { vietnamDayRange } from './vietnam-day-range';

describe('vietnamDayRange', () => {
  it('00:00 giờ VN của ngày X = 17:00 UTC ngày hôm trước', () => {
    const { startUtc } = vietnamDayRange('2026-08-12');
    expect(startUtc.toISOString()).toBe('2026-08-11T17:00:00.000Z');
  });

  it('kết thúc là 00:00 giờ VN ngày kế tiếp (không bao gồm)', () => {
    const { endUtc } = vietnamDayRange('2026-08-12');
    expect(endUtc.toISOString()).toBe('2026-08-12T17:00:00.000Z');
  });

  it('lịch hẹn 23h30 giờ VN vẫn thuộc đúng ngày (không lệch sang ngày UTC kế tiếp)', () => {
    const { startUtc, endUtc } = vietnamDayRange('2026-08-12');
    const scheduledAt = new Date('2026-08-12T16:30:00.000Z'); // 23:30 giờ VN ngày 12/08
    expect(scheduledAt.getTime() >= startUtc.getTime() && scheduledAt.getTime() < endUtc.getTime()).toBe(true);
  });

  it('lịch hẹn 00:30 giờ VN (khoảng 17:30 UTC hôm trước) không lọt sang ngày trước theo UTC', () => {
    const { startUtc, endUtc } = vietnamDayRange('2026-08-12');
    const scheduledAt = new Date('2026-08-11T17:30:00.000Z'); // 00:30 giờ VN ngày 12/08
    expect(scheduledAt.getTime() >= startUtc.getTime() && scheduledAt.getTime() < endUtc.getTime()).toBe(true);
  });

  it('qua năm mới tính đúng', () => {
    const { startUtc } = vietnamDayRange('2027-01-01');
    expect(startUtc.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});
