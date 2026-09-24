import { describe, expect, it } from 'vitest';
import { resolveRecentDateRange, vietnamDayRange } from './vietnam-day-range';

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

describe('resolveRecentDateRange', () => {
  it('cả `from`/`to` đều được truyền — dùng nguyên giá trị, không suy diễn mặc định', () => {
    const { from, to } = resolveRecentDateRange('2026-09-01', '2026-09-10');
    expect(from.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-10T16:59:59.999Z');
  });

  it('bỏ trống cả hai — `to` = hôm nay, `from` = N ngày trước theo `defaultDaysBack`', () => {
    const { from, to } = resolveRecentDateRange(undefined, undefined, 5);
    expect(to.getTime() - from.getTime()).toBeGreaterThan(4 * 24 * 60 * 60 * 1000);
    expect(to.getTime() - from.getTime()).toBeLessThan(6 * 24 * 60 * 60 * 1000);
  });

  it('chỉ bỏ trống `from` — giữ nguyên `to` đã truyền (không đè bằng hôm nay), `from` tính từ THỜI ĐIỂM GỌI HÀM chứ không phải từ `to``', () => {
    const { from, to } = resolveRecentDateRange(undefined, '2020-01-31', 10);
    expect(to.toISOString()).toBe('2020-01-31T16:59:59.999Z');
    expect(to.getTime()).toBeLessThan(from.getTime()); // `to` lùi xa trong quá khứ hơn `from` (tính từ hôm nay) — xác nhận `from` KHÔNG neo theo `to`
  });
});
