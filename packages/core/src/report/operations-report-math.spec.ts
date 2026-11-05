import { describe, expect, it } from 'vitest';
import { buildPeakHours, occurringIsoWeekdays, roundPercent, summarizeWaitGroup, summarizeWaiting, waitBucketIndex } from './operations-report-math';

describe('occurringIsoWeekdays', () => {
  it('kỳ 3 ngày chỉ có 3 thứ', () => {
    // 05/11/2026 là Thứ Năm.
    expect([...occurringIsoWeekdays('2026-11-05', '2026-11-07')].sort()).toEqual([4, 5, 6]);
  });
  it('kỳ từ 7 ngày trở lên đủ 7 thứ', () => {
    expect(occurringIsoWeekdays('2026-11-01', '2026-11-07').size).toBe(7);
  });
  it('ngày sai định dạng thì rỗng', () => {
    expect(occurringIsoWeekdays('abc', '2026-11-07').size).toBe(0);
  });
});

describe('buildPeakHours', () => {
  it('mặc định cột 7–19h, đủ 7 thứ, tìm ô đông nhất và thứ ít khách nhất', () => {
    const r = buildPeakHours(
      [
        { isoDow: 1, hour: 9, count: 36 },
        { isoDow: 1, hour: 8, count: 25 },
        { isoDow: 2, hour: 9, count: 33 },
        { isoDow: 7, hour: 9, count: 3 },
      ],
      '2026-10-01',
      '2026-10-31',
    );
    expect(r.hours).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(r.days).toHaveLength(7);
    expect(r.days[0]!.total).toBe(61);
    expect(r.peak).toEqual({ isoDow: 1, hour: 9, count: 36 });
    // Thứ Ba..Thứ Bảy có thứ 0 lượt nhưng vẫn là "ít khách nhất" — chỉ khi kỳ có thứ đó; ở đây tất cả 7 thứ có mặt nên thứ có 0 lượt thắng.
    expect(r.quietestDay?.total).toBe(0);
    expect(r.totalVisits).toBe(97);
  });

  it('mở rộng cột giờ khi có lượt ngoài 7–19h', () => {
    const r = buildPeakHours([{ isoDow: 3, hour: 5, count: 2 }, { isoDow: 3, hour: 21, count: 1 }], '2026-10-01', '2026-10-31');
    expect(r.hours[0]).toBe(5);
    expect(r.hours[r.hours.length - 1]).toBe(21);
    expect(r.days[2]!.counts[0]).toBe(2);
  });

  it('hoà ô đông nhất: lấy thứ sớm hơn rồi giờ sớm hơn', () => {
    const r = buildPeakHours([{ isoDow: 2, hour: 8, count: 5 }, { isoDow: 1, hour: 10, count: 5 }, { isoDow: 1, hour: 9, count: 5 }], '2026-10-01', '2026-10-31');
    expect(r.peak).toEqual({ isoDow: 1, hour: 9, count: 5 });
  });

  it('thứ không xuất hiện trong kỳ không được chọn làm ít khách nhất', () => {
    // Kỳ Thứ Năm–Thứ Bảy: Chủ nhật không có trong kỳ.
    const r = buildPeakHours([{ isoDow: 4, hour: 9, count: 4 }, { isoDow: 5, hour: 9, count: 2 }, { isoDow: 6, hour: 9, count: 3 }], '2026-11-05', '2026-11-07');
    expect(r.quietestDay).toEqual({ isoDow: 5, total: 2 });
  });

  it('không có dữ liệu thì không có giờ cao điểm', () => {
    const r = buildPeakHours([], '2026-10-01', '2026-10-31');
    expect(r.peak).toBeNull();
    expect(r.quietestDay).toBeNull();
    expect(r.totalVisits).toBe(0);
  });
});

describe('waitBucketIndex', () => {
  it('chia mốc nửa mở', () => {
    expect([0, 9.9, 10, 19, 20, 29.9, 30, 44, 45, 120].map(waitBucketIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('summarizeWaiting', () => {
  it('trung bình, tỉ lệ chờ quá 30 phút, khung 2 giờ và phân bố', () => {
    const r = summarizeWaiting([
      { hour: 7, bucket: 0, count: 2, sumMinutes: 10 },
      { hour: 8, bucket: 3, count: 1, sumMinutes: 40 },
      { hour: 9, bucket: 1, count: 3, sumMinutes: 45 },
      { hour: 10, bucket: 4, count: 2, sumMinutes: 120 },
    ]);
    expect(r.measuredCount).toBe(8);
    expect(r.averageMinutes).toBe(27); // 215/8 = 26,875
    expect(r.over30Count).toBe(3);
    expect(r.over30Percent).toBe(37.5);
    expect(r.slots.map((s) => s.label)).toEqual(['07–09h', '09–11h', '11–13h', '13–15h', '15–17h', '17–19h']);
    expect(r.slots[0]).toMatchObject({ visits: 3, averageMinutes: 17, over30Percent: 33.3 });
    expect(r.slots[1]).toMatchObject({ visits: 5, averageMinutes: 33, over30Percent: 40 });
    expect(r.slots[2]).toMatchObject({ visits: 0, averageMinutes: null, over30Percent: null });
    expect(r.distribution.map((d) => d.count)).toEqual([2, 3, 0, 1, 2]);
    expect(r.distribution[0]!.percent).toBe(25);
  });

  it('thêm khung ở hai đầu khi có lượt trước 7h hoặc từ 19h', () => {
    const r = summarizeWaiting([{ hour: 6, bucket: 0, count: 1, sumMinutes: 5 }, { hour: 19, bucket: 0, count: 1, sumMinutes: 5 }]);
    expect(r.slots[0]!.label).toBe('05–07h');
    expect(r.slots[r.slots.length - 1]!.label).toBe('19–21h');
  });

  it('không đo được lượt nào thì rỗng, không chia cho 0', () => {
    const r = summarizeWaiting([]);
    expect(r).toMatchObject({ measuredCount: 0, averageMinutes: null, over30Percent: null, slots: [] });
    expect(r.distribution.every((d) => d.count === 0 && d.percent === 0)).toBe(true);
  });
});

describe('summarizeWaitGroup / roundPercent', () => {
  it('tính trung bình và tỉ lệ từng nhóm', () => {
    expect(summarizeWaitGroup({ count: 4, sumMinutes: 90, over30Count: 1 })).toEqual({ visits: 4, averageMinutes: 23, over30Count: 1, over30Percent: 25 });
  });
  it('làm tròn một chữ số thập phân và an toàn khi mẫu bằng 0', () => {
    expect(roundPercent(182, 1284)).toBe(14.2);
    expect(roundPercent(0, 0)).toBeNull();
  });
});
