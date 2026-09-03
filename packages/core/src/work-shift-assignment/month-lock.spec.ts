import { describe, expect, it } from 'vitest';
import { getMonthUnlockDeadline, isMonthLocked } from './month-lock';

describe('getMonthUnlockDeadline', () => {
  it('graceDays=0 — mốc khoá là ngày 1 tháng kế tiếp', () => {
    expect(getMonthUnlockDeadline('2026-09', 0)).toBe('2026-10-01');
  });

  it('graceDays=5 — cộng thêm 5 ngày vào ngày 1 tháng kế tiếp', () => {
    expect(getMonthUnlockDeadline('2026-09', 5)).toBe('2026-10-06');
  });

  it('graceDays=27 (biên trên) — vẫn cộng đúng, không tràn quá xa', () => {
    expect(getMonthUnlockDeadline('2026-09', 27)).toBe('2026-10-28');
  });

  it('tháng 12 qua năm mới tính đúng', () => {
    expect(getMonthUnlockDeadline('2026-12', 0)).toBe('2027-01-01');
  });

  it('tháng 2 (28 ngày, không nhuận) không ảnh hưởng cách tính — vẫn dựa vào tháng KẾ TIẾP', () => {
    expect(getMonthUnlockDeadline('2026-02', 0)).toBe('2026-03-01');
  });

  it('tháng 1 (31 ngày) — mốc khoá đúng ngày 1/2', () => {
    expect(getMonthUnlockDeadline('2026-01', 0)).toBe('2026-02-01');
  });
});

describe('isMonthLocked', () => {
  it('graceDays=0 — hôm nay là ngày 1 tháng kế tiếp thì ĐÃ khoá (biên bao gồm)', () => {
    expect(isMonthLocked('2026-09', '2026-10-01', 0)).toBe(true);
  });

  it('graceDays=0 — hôm nay vẫn còn trong tháng đang xét thì CHƯA khoá', () => {
    expect(isMonthLocked('2026-09', '2026-09-30', 0)).toBe(false);
  });

  it('graceDays=5 — hôm nay 05/10 (còn trong hạn ân) thì CHƯA khoá', () => {
    expect(isMonthLocked('2026-09', '2026-10-05', 5)).toBe(false);
  });

  it('graceDays=5 — hôm nay đúng 06/10 (hết hạn ân) thì ĐÃ khoá', () => {
    expect(isMonthLocked('2026-09', '2026-10-06', 5)).toBe(true);
  });

  it('tháng tương lai (chưa tới) luôn CHƯA khoá', () => {
    expect(isMonthLocked('2027-01', '2026-09-03', 0)).toBe(false);
  });
});
