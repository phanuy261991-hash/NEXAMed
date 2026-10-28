import { describe, expect, it } from 'vitest';
import {
  MAX_PENDING_CLOSURE_LOOKBACK_DAYS,
  addDaysToVietnamDate,
  computePendingClosureDates,
  formatVietnamDateDisplay,
  latestShiftEndTime,
  pendingClosureWindow,
} from './pending-closure';

describe('addDaysToVietnamDate', () => {
  it('cộng/trừ ngày qua ranh giới tháng và năm', () => {
    expect(addDaysToVietnamDate('2026-10-28', -1)).toBe('2026-10-27');
    expect(addDaysToVietnamDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysToVietnamDate('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('pendingClosureWindow', () => {
  it('kết thúc ở HÔM QUA, bắt đầu từ mốc áp dụng khi mốc gần hơn giới hạn lùi', () => {
    expect(pendingClosureWindow('2026-10-28', '2026-10-25')).toEqual({ from: '2026-10-25', to: '2026-10-27' });
  });

  it('mốc áp dụng là hôm nay → chưa có ngày nào để xét', () => {
    expect(pendingClosureWindow('2026-10-28', '2026-10-28')).toBeNull();
  });

  it('mốc quá xa bị chặn bởi giới hạn lùi', () => {
    const window = pendingClosureWindow('2026-10-28', '2020-01-01');
    expect(window?.from).toBe(addDaysToVietnamDate('2026-10-28', -MAX_PENDING_CLOSURE_LOOKBACK_DAYS));
  });

  it('chưa có mốc → áp dụng từ đầu giới hạn lùi', () => {
    expect(pendingClosureWindow('2026-10-28', null)?.from).toBe(addDaysToVietnamDate('2026-10-28', -MAX_PENDING_CLOSURE_LOOKBACK_DAYS));
  });
});

describe('computePendingClosureDates', () => {
  const base = { from: '2026-10-20', to: '2026-10-27', workedDates: [], assignedDates: [], wholeDayLeaveDates: [], endedDates: [] };

  it('có nhận lượt khám mà chưa đóng → tính', () => {
    expect(computePendingClosureDates({ ...base, workedDates: ['2026-10-27'] })).toEqual(['2026-10-27']);
  });

  it('có ca đã xếp mà chưa đóng → tính', () => {
    expect(computePendingClosureDates({ ...base, assignedDates: ['2026-10-26'] })).toEqual(['2026-10-26']);
  });

  it('ca đã xếp nhưng nghỉ phép cả ngày được duyệt → không tính', () => {
    expect(computePendingClosureDates({ ...base, assignedDates: ['2026-10-26'], wholeDayLeaveDates: ['2026-10-26'] })).toEqual([]);
  });

  it('nghỉ phép nhưng thực tế vẫn nhận lượt khám → vẫn tính', () => {
    expect(computePendingClosureDates({ ...base, workedDates: ['2026-10-26'], wholeDayLeaveDates: ['2026-10-26'] })).toEqual(['2026-10-26']);
  });

  it('đã có bản ghi Đã đóng ca → không tính', () => {
    expect(computePendingClosureDates({ ...base, workedDates: ['2026-10-26', '2026-10-27'], endedDates: ['2026-10-26'] })).toEqual(['2026-10-27']);
  });

  it('bỏ ngày ngoài khoảng, gộp trùng, sắp tăng dần', () => {
    expect(
      computePendingClosureDates({
        ...base,
        workedDates: ['2026-10-27', '2026-10-21', '2026-10-19', '2026-10-28'],
        assignedDates: ['2026-10-21', '2026-10-23'],
      }),
    ).toEqual(['2026-10-21', '2026-10-23', '2026-10-27']);
  });

  it('không có dấu hiệu làm việc → rỗng', () => {
    expect(computePendingClosureDates(base)).toEqual([]);
  });
});

describe('formatVietnamDateDisplay / latestShiftEndTime', () => {
  it('đổi YYYY-MM-DD sang dd/mm/yyyy', () => {
    expect(formatVietnamDateDisplay('2026-10-27')).toBe('27/10/2026');
  });

  it('giờ kết thúc muộn nhất của các ca', () => {
    expect(latestShiftEndTime([{ endTime: '11:30' }, { endTime: '17:30' }])).toBe('17:30');
    expect(latestShiftEndTime([])).toBeNull();
  });
});
