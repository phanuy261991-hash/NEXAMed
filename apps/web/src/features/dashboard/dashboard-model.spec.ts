import { describe, expect, it } from 'vitest';
import type { OwnerDashboard } from '@nexamed/shared';
import { averageMillions, buildAttentionItems, compareLabel, describeDelta, formatDayMonth, formatHourRange, formatWait, formatWeekdayDate, periodTitle, visibleHours } from './dashboard-model';

describe('describeDelta', () => {
  it('đếm: nêu hiệu số, tăng là tốt', () => {
    expect(describeDelta({ diff: 6, diffPercent: 14.3, direction: 'up' }, 'today', 'count')).toEqual({ direction: 'up', text: 'tăng 6 so với hôm qua', tone: 'good' });
  });
  it('tiền: nêu phần trăm; giảm là xấu', () => {
    expect(describeDelta({ diff: -2_000_000, diffPercent: -11.5, direction: 'down' }, 'week', 'money')).toEqual({ direction: 'down', text: 'giảm 11,5% so với 7 ngày trước', tone: 'bad' });
  });
  it('tiền, kỳ trước bằng 0 (không có phần trăm): nêu số tiền', () => {
    expect(describeDelta({ diff: 150_000, diffPercent: null, direction: 'up' }, 'month', 'money').text).toBe('tăng 150.000 đ so với cùng kỳ tháng trước');
  });
  it('không đổi → "bằng ...", trung tính', () => {
    expect(describeDelta({ diff: 0, diffPercent: 0, direction: 'flat' }, 'today', 'count')).toEqual({ direction: 'flat', text: 'bằng hôm qua', tone: 'neutral' });
  });
});

describe('kỳ', () => {
  it('tiêu đề và nhãn so sánh theo kỳ', () => {
    expect(periodTitle('today')).toBe('Tổng quan hôm nay');
    expect(compareLabel('week')).toBe('7 ngày trước');
  });
});

describe('visibleHours', () => {
  const full = (counts: Record<number, number>) => Array.from({ length: 24 }, (_, hour) => ({ hour, count: counts[hour] ?? 0 }));
  it('mặc định 07–18', () => {
    const hours = visibleHours(full({ 10: 12 }));
    expect(hours[0]!.hour).toBe(7);
    expect(hours.at(-1)!.hour).toBe(18);
  });
  it('mở rộng khi có lượt ngoài khung (sớm 6 giờ, muộn 20 giờ)', () => {
    const hours = visibleHours(full({ 6: 1, 20: 2 }));
    expect(hours[0]!.hour).toBe(6);
    expect(hours.at(-1)!.hour).toBe(20);
  });
  it('luôn đủ 12 giờ hiển thị khi không có dữ liệu', () => {
    expect(visibleHours(full({}))).toHaveLength(12);
  });
});

describe('định dạng', () => {
  it('khoảng giờ, thời gian chờ, ngày thứ, ngày tháng, trung bình', () => {
    expect(formatHourRange(10)).toBe('10:00 – 11:00');
    expect(formatHourRange(23)).toBe('23:00 – 00:00');
    expect(formatWait(28)).toBe('28 phút');
    expect(formatWait(65)).toBe('1 giờ 5 phút');
    expect(formatWait(120)).toBe('2 giờ');
    expect(formatWeekdayDate('2026-11-02')).toBe('Thứ Hai, 02/11/2026');
    expect(formatDayMonth('2026-10-27')).toBe('27/10');
    expect(averageMillions([14_200_000, 16_800_000, 15_100_000, 19_400_000, 17_200_000, 12_600_000, 18_100_000])).toBe('16,2');
  });
});

describe('buildAttentionItems', () => {
  const attention = (over: Partial<OwnerDashboard['needsAttention']> = {}): OwnerDashboard['needsAttention'] => ({
    unpaidInvoices: { count: 0, amount: 0 },
    openShifts: [],
    expiringBatches: { count: 0, withinDays: 30 },
    belowMinStockItems: { count: 0 },
    ...over,
  });

  it('không có việc nào → danh sách rỗng', () => {
    expect(buildAttentionItems(attention())).toEqual([]);
  });

  it('đúng thứ tự mockup và chỉ những việc có số', () => {
    const items = buildAttentionItems(
      attention({
        unpaidInvoices: { count: 5, amount: 2_100_000 },
        openShifts: [{ label: 'Ca sáng', openedAt: '2026-11-02T00:05:00.000Z' }],
        expiringBatches: { count: 8, withinDays: 30 },
        belowMinStockItems: { count: 12 },
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['unpaid', 'shift', 'expiry', 'stock']);
    expect(items[0]).toMatchObject({ text: '5 phiếu thu chưa thanh toán', trailing: '2.100.000 đ', tone: 'amber' });
    expect(items[1]).toMatchObject({ text: 'Ca sáng chưa chốt', trailing: 'từ 07:05' });
    expect(items[2]).toMatchObject({ text: '8 lô thuốc sắp hết hạn', trailing: 'trong 30 ngày', tone: 'rose' });
    expect(items[3]).toMatchObject({ text: '12 mặt hàng tồn dưới ngưỡng', trailing: 'cần đặt' });
  });
});
