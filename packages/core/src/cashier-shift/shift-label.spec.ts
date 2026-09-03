import { describe, expect, it } from 'vitest';
import { deriveShiftLabel } from './shift-label';

describe('deriveShiftLabel', () => {
  it('08:03 giờ VN (01:03 UTC) → Ca sáng', () => {
    expect(deriveShiftLabel(new Date('2026-09-03T01:03:00.000Z'))).toBe('Ca sáng');
  });

  it('13:50 giờ VN (06:50 UTC) → Ca chiều', () => {
    expect(deriveShiftLabel(new Date('2026-09-03T06:50:00.000Z'))).toBe('Ca chiều');
  });

  it('18:15 giờ VN (11:15 UTC) → Ca tối', () => {
    expect(deriveShiftLabel(new Date('2026-09-03T11:15:00.000Z'))).toBe('Ca tối');
  });

  it('01:00 giờ VN (18:00 UTC hôm trước, qua đêm) → Ca tối', () => {
    expect(deriveShiftLabel(new Date('2026-09-02T18:00:00.000Z'))).toBe('Ca tối');
  });

  it('biên đúng 05:00 giờ VN → Ca sáng, 04:59 → Ca tối', () => {
    expect(deriveShiftLabel(new Date('2026-09-02T22:00:00.000Z'))).toBe('Ca sáng'); // 05:00 VN
    expect(deriveShiftLabel(new Date('2026-09-02T21:59:00.000Z'))).toBe('Ca tối'); // 04:59 VN
  });
});
