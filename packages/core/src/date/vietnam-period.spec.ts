import { describe, expect, it } from 'vitest';
import { addDaysToDateString, diffDateStrings } from '../encounter/follow-up-date';
import { vietnamDateOf } from '../prescription-interop/submission';
import {
  isValidDateString,
  listDateStrings,
  previousPeriod,
  resolveReportPeriod,
  sameSpanPreviousMonth,
  vietnamDateRangeHalfOpenUtc,
  vietnamDateRangeUtc,
  vietnamDayEndUtc,
  vietnamDayStartUtc,
} from './vietnam-period';

describe('mốc ngày giờ Việt Nam', () => {
  it('đầu ngày VN = 17:00 UTC hôm trước, cuối ngày VN = 16:59:59.999 UTC', () => {
    expect(vietnamDayStartUtc('2026-11-03').toISOString()).toBe('2026-11-02T17:00:00.000Z');
    expect(vietnamDayEndUtc('2026-11-03').toISOString()).toBe('2026-11-03T16:59:59.999Z');
  });

  it('khoản thu 23:30 giờ VN thuộc đúng ngày VN, 00:10 giờ VN thuộc ngày kế tiếp (không theo ngày UTC)', () => {
    const paid2330 = new Date('2026-11-03T16:30:00.000Z');
    const paid0010 = new Date('2026-11-03T17:10:00.000Z');
    expect(vietnamDateOf(paid2330)).toBe('2026-11-03');
    expect(vietnamDateOf(paid0010)).toBe('2026-11-04');
    const { from, to } = vietnamDateRangeUtc('2026-11-03', '2026-11-03');
    expect(paid2330 >= from && paid2330 <= to).toBe(true);
    expect(paid0010 >= from && paid0010 <= to).toBe(false);
  });

  it('khoảng nửa mở [start, end) phủ trọn các ngày, không hở không chồng', () => {
    const { startUtc, endUtc } = vietnamDateRangeHalfOpenUtc('2026-11-01', '2026-11-30');
    expect(startUtc.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(vietnamDateRangeHalfOpenUtc('2026-12-01', '2026-12-01').startUtc.getTime()).toBe(endUtc.getTime());
  });

  it('ngày sai định dạng hoặc không có trong lịch bị từ chối', () => {
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2026-1-5')).toBe(false);
    expect(() => vietnamDayStartUtc('2026-13-01')).toThrow();
    expect(addDaysToDateString('abc', 1)).toBeNull();
  });
});

describe('cộng trừ ngày và liệt kê', () => {
  it('qua cuối tháng, cuối năm, năm nhuận', () => {
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateString('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToDateString('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDateStrings('2026-10-31', '2026-11-03')).toBe(3);
    expect(diffDateStrings('2026-11-03', '2026-10-31')).toBe(-3);
  });

  it('listDateStrings liệt kê đủ cả hai đầu; ngược hoặc quá dài thì ném lỗi', () => {
    expect(listDateStrings('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(() => listDateStrings('2026-03-02', '2026-02-27')).toThrow();
    expect(() => listDateStrings('2020-01-01', '2026-01-01', 366)).toThrow();
  });
});

describe('resolveReportPeriod', () => {
  it('tuần chạy từ thứ Hai đến Chủ nhật (kể cả khi neo là Chủ nhật)', () => {
    expect(resolveReportPeriod('week', '2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-08' }); // thứ Tư
    expect(resolveReportPeriod('week', '2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' }); // Chủ nhật
    expect(resolveReportPeriod('week', '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-08' }); // thứ Hai
  });

  it('tháng, quý, năm — tháng 2 nhuận và quý IV', () => {
    expect(resolveReportPeriod('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(resolveReportPeriod('month', '2026-11-03')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(resolveReportPeriod('quarter', '2026-11-03')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(resolveReportPeriod('quarter', '2026-03-31')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(resolveReportPeriod('year', '2026-11-03')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(resolveReportPeriod('day', '2026-11-03')).toEqual({ from: '2026-11-03', to: '2026-11-03' });
  });
});

describe('previousPeriod / sameSpanPreviousMonth', () => {
  it('cả tháng lịch → lùi đúng một tháng (tháng 3 → tháng 2 đủ ngày); cả quý/năm tương tự', () => {
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod('2026-01-01', '2026-01-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(previousPeriod('2026-10-01', '2026-12-31')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(previousPeriod('2026-01-01', '2026-12-31')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('khoảng tuỳ ý → lùi đúng số ngày của kỳ', () => {
    expect(previousPeriod('2026-11-02', '2026-11-08')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(previousPeriod('2026-11-03', '2026-11-03')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
  });

  it('cùng kỳ tháng trước: cắt về ngày cuối tháng nếu tháng trước ngắn hơn', () => {
    expect(sameSpanPreviousMonth('2026-11-01', '2026-11-03')).toEqual({ from: '2026-10-01', to: '2026-10-03' });
    expect(sameSpanPreviousMonth('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(sameSpanPreviousMonth('2026-01-05', '2026-01-20')).toEqual({ from: '2025-12-05', to: '2025-12-20' });
  });
});
