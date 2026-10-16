import { describe, expect, it } from 'vitest';
import { getVietnamGreeting } from './greeting';

// Giờ VN = UTC + 7: 'T00:00:00Z' = 07:00 VN.
const at = (utcIso: string) => getVietnamGreeting(new Date(utcIso));

describe('getVietnamGreeting', () => {
  it.each([
    ['2026-10-16T22:00:00Z', 'Xin chào, Buổi sáng !!!'], // 05:00 VN
    ['2026-10-16T03:59:00Z', 'Xin chào, Buổi sáng !!!'], // 10:59 VN
    ['2026-10-16T04:00:00Z', 'Xin chào, Buổi trưa !!!'], // 11:00 VN
    ['2026-10-16T05:59:00Z', 'Xin chào, Buổi trưa !!!'], // 12:59 VN
    ['2026-10-16T06:00:00Z', 'Xin chào, Buổi chiều !!!'], // 13:00 VN
    ['2026-10-16T10:59:00Z', 'Xin chào, Buổi chiều !!!'], // 17:59 VN
    ['2026-10-16T11:00:00Z', 'Xin chào, Buổi tối !!!'], // 18:00 VN
    ['2026-10-16T17:00:00Z', 'Xin chào, Buổi tối !!!'], // 00:00 VN
    ['2026-10-16T21:59:00Z', 'Xin chào, Buổi tối !!!'], // 04:59 VN
  ])('%s → %s', (iso, expected) => {
    expect(at(iso)).toBe(expected);
  });
});
