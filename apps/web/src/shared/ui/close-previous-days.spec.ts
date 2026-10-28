import { describe, expect, it } from 'vitest';
import type { PendingClosureDayDto } from '@nexamed/shared';
import { defaultCloseReason, formatShiftRanges, sumUnprocessed } from './ClosePreviousDaysDialog';

const day = (date: string, unprocessedCount = 0): PendingClosureDayDto => ({ date, calledCount: 1, completedCount: 1, unprocessedCount, shifts: [] });

describe('defaultCloseReason — lý do điền sẵn', () => {
  it('một ngày', () => {
    expect(defaultCloseReason([day('2026-10-27')], false)).toBe('Quên đóng ca ngày 27/10');
  });

  it('nhiều ngày liệt kê và nối bằng "và"', () => {
    expect(defaultCloseReason([day('2026-10-23'), day('2026-10-26'), day('2026-10-27')], false)).toBe('Quên đóng ca các ngày 23/10, 26/10 và 27/10');
  });

  it('lễ tân đóng hộ', () => {
    expect(defaultCloseReason([day('2026-10-27')], true)).toBe('Đóng ca hộ ngày 27/10');
  });
});

describe('sumUnprocessed', () => {
  it('cộng lượt khám dở của mọi ngày', () => {
    expect(sumUnprocessed([day('2026-10-26', 0), day('2026-10-27', 2), day('2026-10-23', 1)])).toBe(3);
    expect(sumUnprocessed([])).toBe(0);
  });
});

describe('formatShiftRanges', () => {
  it('nối các ca đã xếp của một ngày bằng "và"', () => {
    expect(formatShiftRanges([{ startTime: '07:30', endTime: '11:30' }, { startTime: '13:30', endTime: '17:30' }])).toBe('07:30–11:30 và 13:30–17:30');
    expect(formatShiftRanges([])).toBe('');
  });
});
