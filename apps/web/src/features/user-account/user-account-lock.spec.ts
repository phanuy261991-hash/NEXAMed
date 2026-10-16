import { describe, expect, it } from 'vitest';
import { getLockBadge } from './user-account-lock';

const NOW = new Date('2026-10-16T10:00:00.000Z');
const inMs = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('getLockBadge', () => {
  it('không khoá → không có nhãn', () => {
    expect(getLockBadge({ lockStatus: 'NONE', lockedUntil: null }, NOW)).toBeNull();
  });

  it('khoá vĩnh viễn → nhãn đỏ "Khoá vĩnh viễn"', () => {
    expect(getLockBadge({ lockStatus: 'PERMANENT', lockedUntil: null }, NOW)).toEqual({ tone: 'danger', text: 'Khoá vĩnh viễn' });
  });

  it('khoá tạm → nhãn cam với số phút còn lại làm tròn LÊN', () => {
    expect(getLockBadge({ lockStatus: 'TEMPORARY', lockedUntil: inMs(12 * 60_000) }, NOW)).toEqual({ tone: 'warning', text: 'Khoá 12 phút' });
    expect(getLockBadge({ lockStatus: 'TEMPORARY', lockedUntil: inMs(11 * 60_000 + 1) }, NOW)?.text).toBe('Khoá 12 phút');
    expect(getLockBadge({ lockStatus: 'TEMPORARY', lockedUntil: inMs(10_000) }, NOW)?.text).toBe('Khoá 1 phút');
  });

  it('khoá tạm đã quá hạn (danh sách nạp từ lâu) → không còn nhãn', () => {
    expect(getLockBadge({ lockStatus: 'TEMPORARY', lockedUntil: inMs(-1) }, NOW)).toBeNull();
    expect(getLockBadge({ lockStatus: 'TEMPORARY', lockedUntil: inMs(0) }, NOW)).toBeNull();
  });
});
