import { describe, expect, it } from 'vitest';
import { branchShiftDiscrepancy, formatReportDate, formatReportDayMonth, formatShiftClock, formatSignedVnd, weekdayLabel } from './daily-report-model';

describe('định dạng ngày của Báo cáo ngày', () => {
  it('đổi YYYY-MM-DD sang dd/MM/yyyy và dd/MM', () => {
    expect(formatReportDate('2026-11-04')).toBe('04/11/2026');
    expect(formatReportDayMonth('2026-11-04')).toBe('04/11');
  });

  it('thứ trong tuần theo lịch, không lệch theo múi giờ máy xem', () => {
    expect(weekdayLabel('2026-11-04')).toBe('Thứ Tư');
    expect(weekdayLabel('2026-11-01')).toBe('Chủ nhật');
    expect(weekdayLabel('2026-11-07')).toBe('Thứ Bảy');
  });

  it('giờ ca theo giờ Việt Nam (UTC+7)', () => {
    expect(formatShiftClock('2026-11-04T00:30:00.000Z')).toBe('07:30');
    expect(formatShiftClock('2026-11-04T17:05:00.000Z')).toBe('00:05');
  });
});

describe('formatSignedVnd', () => {
  it('âm dùng dấu trừ thật, dương có dấu cộng, không thì 0', () => {
    expect(formatSignedVnd(-20_000)).toBe('−20.000');
    expect(formatSignedVnd(5_000)).toBe('+5.000');
    expect(formatSignedVnd(0)).toBe('0');
    expect(formatSignedVnd(-1_234_567)).toBe('−1.234.567');
  });
});

describe('branchShiftDiscrepancy', () => {
  const shift = (discrepancy: number | null) => ({
    shiftNo: 'x',
    label: 'Ca',
    cashierName: 'A',
    openedAt: '2026-11-04T00:00:00.000Z',
    closedAt: null,
    status: 'CLOSED' as const,
    expectedCash: 0,
    countedCash: 0,
    discrepancy,
  });

  it('cộng chênh lệch các ca đã kiểm đếm, bỏ qua ca chưa chốt', () => {
    expect(branchShiftDiscrepancy({ shifts: [shift(-20_000), shift(5_000), shift(null)] })).toBe(-15_000);
  });

  it('không có ca nào thì bằng 0', () => {
    expect(branchShiftDiscrepancy({ shifts: [] })).toBe(0);
  });
});
