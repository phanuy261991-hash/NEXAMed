import { describe, expect, it } from 'vitest';
import { daysInclusive, formatPeriodRange, periodCaption, periodError, periodLabel, resolvePeriod, shiftDate } from './report-period';

const TODAY = '2026-11-05';

describe('resolvePeriod', () => {
  it('hôm nay và 7 ngày gần nhất (gồm hôm nay)', () => {
    expect(resolvePeriod('today', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(resolvePeriod('last7', TODAY)).toEqual({ from: '2026-10-30', to: TODAY });
  });

  it('tháng này, quý, năm tính đến hôm nay; tháng trước là cả tháng', () => {
    expect(resolvePeriod('thisMonth', TODAY)).toEqual({ from: '2026-11-01', to: TODAY });
    expect(resolvePeriod('quarter', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(resolvePeriod('year', TODAY)).toEqual({ from: '2026-01-01', to: TODAY });
    expect(resolvePeriod('lastMonth', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('tháng trước qua năm và tháng 2 nhuận', () => {
    expect(resolvePeriod('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(resolvePeriod('lastMonth', '2028-03-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('quý I, II, III, IV', () => {
    expect(resolvePeriod('quarter', '2026-03-31').from).toBe('2026-01-01');
    expect(resolvePeriod('quarter', '2026-04-01').from).toBe('2026-04-01');
    expect(resolvePeriod('quarter', '2026-09-30').from).toBe('2026-07-01');
    expect(resolvePeriod('quarter', '2026-12-31').from).toBe('2026-10-01');
  });

  it('tuỳ chọn lấy khoảng đã nhập, không có thì là hôm nay', () => {
    expect(resolvePeriod('custom', TODAY, { from: '2026-09-01', to: '2026-09-30' })).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolvePeriod('custom', TODAY)).toEqual({ from: TODAY, to: TODAY });
  });
});

describe('ngày', () => {
  it('shiftDate qua tháng/năm và daysInclusive', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysInclusive('2026-09-01', '2026-09-30')).toBe(30);
    expect(daysInclusive('2026-09-05', '2026-09-05')).toBe(1);
    expect(daysInclusive('2026-09-05', '2026-09-01')).toBeLessThan(0);
  });

  it('nhãn kỳ: năm lấy theo hôm nay', () => {
    expect(periodLabel('year', TODAY)).toBe('Năm 2026');
    expect(periodLabel('lastMonth', TODAY)).toBe('Tháng trước');
  });

  it('định dạng khoảng ngày', () => {
    expect(formatPeriodRange({ from: '2026-10-01', to: '2026-10-31' })).toBe('01/10/2026 – 31/10/2026');
  });
});

describe('periodError', () => {
  it('hợp lệ → null', () => {
    expect(periodError({ from: '2026-09-01', to: '2026-09-30' })).toBeNull();
  });
  it('thiếu ngày, ngược, quá 366 ngày → thông báo tiếng Việt', () => {
    expect(periodError({ from: '', to: '2026-09-30' })).toContain('ngày');
    expect(periodError({ from: '2026-09-30', to: '2026-09-01' })).toContain('trước hoặc bằng');
    expect(periodError({ from: '2025-01-01', to: '2026-09-01' })).toContain('366');
    // Đúng 366 ngày (cả hai đầu) còn hợp lệ, 367 ngày thì không — khớp giới hạn của máy chủ.
    expect(periodError({ from: '2025-09-01', to: '2026-09-01' })).toBeNull();
    expect(periodError({ from: '2025-08-31', to: '2026-09-01' })).toContain('366');
  });
});

describe('periodCaption', () => {
  it('cả tháng → "Tháng MM/YYYY", còn lại → khoảng ngày', () => {
    expect(periodCaption({ from: '2026-10-01', to: '2026-10-31' })).toBe('Tháng 10/2026');
    expect(periodCaption({ from: '2028-02-01', to: '2028-02-29' })).toBe('Tháng 02/2028');
    expect(periodCaption({ from: '2026-10-01', to: '2026-10-15' })).toBe('01/10/2026 – 15/10/2026');
    expect(periodCaption({ from: '2026-10-02', to: '2026-10-31' })).toBe('02/10/2026 – 31/10/2026');
  });
});
