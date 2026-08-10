import { describe, expect, it } from 'vitest';
import { computeExpiresAt, isSessionActive } from './break-glass';

describe('break-glass', () => {
  it('computeExpiresAt cộng đúng số phút cấu hình', () => {
    const occurredAt = new Date('2026-08-10T10:00:00.000Z');
    expect(computeExpiresAt(occurredAt, 120).toISOString()).toBe('2026-08-10T12:00:00.000Z');
    expect(computeExpiresAt(occurredAt, 30).toISOString()).toBe('2026-08-10T10:30:00.000Z');
  });

  it('isSessionActive: true khi còn trước mốc hết hạn', () => {
    const expiresAt = new Date('2026-08-10T12:00:00.000Z');
    expect(isSessionActive({ expiresAt }, new Date('2026-08-10T11:59:59.999Z'))).toBe(true);
  });

  it('isSessionActive: false đúng tại/qua mốc hết hạn', () => {
    const expiresAt = new Date('2026-08-10T12:00:00.000Z');
    expect(isSessionActive({ expiresAt }, expiresAt)).toBe(false);
    expect(isSessionActive({ expiresAt }, new Date('2026-08-10T12:00:00.001Z'))).toBe(false);
  });
});
