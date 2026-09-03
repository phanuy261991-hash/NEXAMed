import { describe, expect, it } from 'vitest';
import { formatDisplayCode, toVietnamDateParts } from './format-display-code';

describe('formatDisplayCode', () => {
  it('ghép đúng <prefix><yyMM><seq6>', () => {
    expect(formatDisplayCode('BN', new Date('2026-08-15T10:00:00.000Z'), 123n)).toBe('BN2608000123');
  });

  it('seq đệm đủ 6 chữ số', () => {
    expect(formatDisplayCode('BN', new Date('2026-08-15T10:00:00.000Z'), 1n)).toBe('BN2608000001');
    expect(formatDisplayCode('BN', new Date('2026-08-15T10:00:00.000Z'), 999999n)).toBe('BN2608999999');
  });

  it('quy đổi đúng sang giờ Việt Nam (UTC+7) quanh mốc nửa đêm — không lệch tháng theo UTC', () => {
    // 2026-08-01T00:30 giờ VN = 2026-07-31T17:30 UTC — UTC vẫn là tháng 7, nhưng mã phải ra 08.
    expect(formatDisplayCode('BN', new Date('2026-07-31T17:30:00.000Z'), 1n)).toBe('BN2608000001');
    // 2026-08-31T23:30 giờ VN = 2026-08-31T16:30 UTC — cùng tháng 8 ở cả hai phía, không phải ca khó.
    expect(formatDisplayCode('BN', new Date('2026-08-31T16:30:00.000Z'), 1n)).toBe('BN2608000001');
  });
});

describe('toVietnamDateParts', () => {
  it('quy đổi đúng năm/tháng/ngày theo giờ Việt Nam (UTC+7)', () => {
    expect(toVietnamDateParts(new Date('2026-09-03T10:00:00.000Z'))).toEqual({ year: 2026, month: 9, day: 3 });
  });

  it('quanh mốc nửa đêm — UTC vẫn ngày cũ nhưng giờ VN đã sang ngày mới', () => {
    expect(toVietnamDateParts(new Date('2026-08-31T17:30:00.000Z'))).toEqual({ year: 2026, month: 9, day: 1 });
  });
});
