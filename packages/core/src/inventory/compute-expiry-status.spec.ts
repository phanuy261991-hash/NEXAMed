import { describe, expect, it } from 'vitest';
import { computeExpiryStatus } from './compute-expiry-status';

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY_UTC_MS = Date.UTC(2026, 8, 17); // 17/09/2026

describe('computeExpiryStatus', () => {
  it('còn hạn ngoài ngưỡng cảnh báo → null (không cần hiện gì)', () => {
    const expiryDate = new Date(TODAY_UTC_MS + 31 * DAY_MS);
    expect(computeExpiryStatus(expiryDate, TODAY_UTC_MS, 30)).toBeNull();
  });

  it('còn hạn ĐÚNG ngưỡng cảnh báo (30 ngày) → EXPIRING_SOON', () => {
    const expiryDate = new Date(TODAY_UTC_MS + 30 * DAY_MS);
    expect(computeExpiryStatus(expiryDate, TODAY_UTC_MS, 30)).toEqual({ status: 'EXPIRING_SOON', daysUntilExpiry: 30 });
  });

  it('hết hạn hôm nay → EXPIRING_SOON, 0 ngày', () => {
    expect(computeExpiryStatus(new Date(TODAY_UTC_MS), TODAY_UTC_MS, 30)).toEqual({ status: 'EXPIRING_SOON', daysUntilExpiry: 0 });
  });

  it('đã hết hạn → EXPIRED, số ngày âm', () => {
    const expiryDate = new Date(TODAY_UTC_MS - 5 * DAY_MS);
    expect(computeExpiryStatus(expiryDate, TODAY_UTC_MS, 30)).toEqual({ status: 'EXPIRED', daysUntilExpiry: -5 });
  });
});
