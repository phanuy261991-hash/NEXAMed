import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CODE_TOKEN,
  computeBusinessCodePeriodKey,
  DEFAULT_BUSINESS_CODE_COUNTER_DIGITS,
  DEFAULT_BUSINESS_CODE_TEMPLATE,
  formatBusinessCode,
  parseBusinessCodeTemplate,
} from './business-code';

describe('parseBusinessCodeTemplate', () => {
  it('khuôn hợp lệ đủ token → ok, nhận đúng cờ hasYear/hasMonth/hasDay', () => {
    const result = parseBusinessCodeTemplate(`BN${BUSINESS_CODE_TOKEN.YEAR_2}${BUSINESS_CODE_TOKEN.MONTH}${BUSINESS_CODE_TOKEN.COUNTER}`);
    expect(result).toEqual({ ok: true, parsed: { hasYear: true, hasMonth: true, hasDay: false } });
  });

  it('không có token nào ngoài [Số đếm] → ok, không reset theo chu kỳ nào', () => {
    const result = parseBusinessCodeTemplate(`BN${BUSINESS_CODE_TOKEN.COUNTER}`);
    expect(result).toEqual({ ok: true, parsed: { hasYear: false, hasMonth: false, hasDay: false } });
  });

  it('thiếu [Số đếm] → lỗi', () => {
    const result = parseBusinessCodeTemplate(`BN${BUSINESS_CODE_TOKEN.YEAR_2}`);
    expect(result.ok).toBe(false);
  });

  it('token lạ → lỗi', () => {
    const result = parseBusinessCodeTemplate(`BN[Không tồn tại]${BUSINESS_CODE_TOKEN.COUNTER}`);
    expect(result.ok).toBe(false);
  });

  it('token trùng lặp (2 lần [Số đếm]) → lỗi', () => {
    const result = parseBusinessCodeTemplate(`${BUSINESS_CODE_TOKEN.COUNTER}${BUSINESS_CODE_TOKEN.COUNTER}`);
    expect(result.ok).toBe(false);
  });
});

describe('computeBusinessCodePeriodKey', () => {
  const date = { year: 2026, month: 9, day: 3 };

  it('có [Ngày] → reset theo ngày (yyyymmdd)', () => {
    expect(computeBusinessCodePeriodKey({ hasYear: true, hasMonth: true, hasDay: true }, date)).toBe('20260903');
  });

  it('có [Tháng], không [Ngày] → reset theo tháng (yyyymm)', () => {
    expect(computeBusinessCodePeriodKey({ hasYear: true, hasMonth: true, hasDay: false }, date)).toBe('202609');
  });

  it('chỉ có năm → reset theo năm (yyyy)', () => {
    expect(computeBusinessCodePeriodKey({ hasYear: true, hasMonth: false, hasDay: false }, date)).toBe('2026');
  });

  it('không token thời gian nào → chuỗi rỗng, chạy liên tục không reset', () => {
    expect(computeBusinessCodePeriodKey({ hasYear: false, hasMonth: false, hasDay: false }, date)).toBe('');
  });
});

describe('formatBusinessCode', () => {
  it('khuôn mặc định của mọi loại mã phải khớp ĐÚNG formatDisplayCode hiện tại (tương thích ngược)', () => {
    // formatDisplayCode('BN', 2026-08-15, 123n) === 'BN2608000123' (packages/core spec đã có)
    expect(formatBusinessCode(DEFAULT_BUSINESS_CODE_TEMPLATE.PATIENT, DEFAULT_BUSINESS_CODE_COUNTER_DIGITS, { year: 2026, month: 8, day: 15 }, 123)).toBe(
      'BN2608000123',
    );
  });

  it('đệm đủ số chữ số, không cắt bớt khi seq vượt quá', () => {
    expect(formatBusinessCode(`X${BUSINESS_CODE_TOKEN.COUNTER}`, 4, { year: 2026, month: 1, day: 1 }, 5)).toBe('X0005');
    expect(formatBusinessCode(`X${BUSINESS_CODE_TOKEN.COUNTER}`, 4, { year: 2026, month: 1, day: 1 }, 123456)).toBe('X123456');
  });

  it('ghép đủ cả 4 token ngày/tháng/năm (2 số + 4 số)', () => {
    const template = `${BUSINESS_CODE_TOKEN.YEAR_4}-${BUSINESS_CODE_TOKEN.YEAR_2}-${BUSINESS_CODE_TOKEN.MONTH}-${BUSINESS_CODE_TOKEN.DAY}-${BUSINESS_CODE_TOKEN.COUNTER}`;
    expect(formatBusinessCode(template, 3, { year: 2026, month: 9, day: 3 }, 7)).toBe('2026-26-09-03-007');
  });
});
