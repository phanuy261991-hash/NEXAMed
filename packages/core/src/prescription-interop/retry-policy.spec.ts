import { describe, expect, it } from 'vitest';
import { decideAfterAttempt, interopRetryDelayMinutes } from './retry-policy';
import { addDaysToIsoDate, suggestInteropDosePeriod } from './dose-period';

const NOW = new Date('2026-10-21T03:00:00.000Z');

describe('interopRetryDelayMinutes', () => {
  it('giãn dần 1/5/15/60 phút rồi giữ 60', () => {
    expect([1, 2, 3, 4, 5, 9].map(interopRetryDelayMinutes)).toEqual([1, 5, 15, 60, 60, 60]);
  });
});

describe('decideAfterAttempt', () => {
  it('gửi được thì SENT', () => {
    expect(decideAfterAttempt('ok', 1, 5, NOW)).toEqual({ next: 'SENT' });
  });

  it('lỗi dữ liệu (cổng từ chối) dừng ngay, không tự thử lại dù còn lần', () => {
    expect(decideAfterAttempt('rejected', 1, 5, NOW)).toEqual({ next: 'FAILED' });
  });

  it('lỗi mạng còn lần thì hẹn thử lại theo khoảng giãn dần', () => {
    expect(decideAfterAttempt('unreachable', 1, 5, NOW)).toEqual({ next: 'RETRY', at: new Date('2026-10-21T03:01:00.000Z') });
    expect(decideAfterAttempt('unreachable', 3, 5, NOW)).toEqual({ next: 'RETRY', at: new Date('2026-10-21T03:15:00.000Z') });
  });

  it('lỗi mạng hết số lần thử thì dừng ở lỗi (thử 5/5)', () => {
    expect(decideAfterAttempt('unreachable', 5, 5, NOW)).toEqual({ next: 'FAILED' });
  });

  it('maxRetries = 0 vẫn thử đúng một lần', () => {
    expect(decideAfterAttempt('unreachable', 1, 0, NOW)).toEqual({ next: 'FAILED' });
  });
});

describe('suggestInteropDosePeriod', () => {
  it('đến ngày = ngày kê + số ngày dài nhất − 1', () => {
    expect(suggestInteropDosePeriod('2026-10-16', 3)).toEqual({ number: 1, from: '2026-10-16', to: '2026-10-18' });
    expect(suggestInteropDosePeriod('2026-10-16', 1)).toEqual({ number: 1, from: '2026-10-16', to: '2026-10-16' });
  });

  it('qua cuối tháng/năm và số ngày không hợp lệ', () => {
    expect(suggestInteropDosePeriod('2026-12-30', 5).to).toBe('2027-01-03');
    expect(suggestInteropDosePeriod('2026-10-16', 0).to).toBe('2026-10-16');
    expect(addDaysToIsoDate('2028-02-28', 1)).toBe('2028-02-29');
  });
});
