import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CODE_TOKEN,
  computeBusinessCodePeriodKey,
  DEFAULT_BUSINESS_CODE_COUNTER_DIGITS,
  DEFAULT_BUSINESS_CODE_TEMPLATE,
  formatBusinessCode,
  formatPrescriptionNationalCode,
  isValidFacilityCode,
  parseBusinessCodeTemplate,
  PRESCRIPTION_STANDARD_TEMPLATE,
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

describe('mã đơn thuốc chuẩn Bộ Y tế (#242)', () => {
  it('khuôn chuẩn hợp lệ cho PRESCRIPTION, đúng 1 [Số đếm], không có token thời gian (không đánh số lại)', () => {
    expect(parseBusinessCodeTemplate(PRESCRIPTION_STANDARD_TEMPLATE, 'PRESCRIPTION')).toEqual({ ok: true, parsed: { hasYear: false, hasMonth: false, hasDay: false } });
  });

  it('token [Mã cơ sở KCB]/[Loại đơn] bị từ chối ở loại mã khác ngoài PRESCRIPTION, nhưng hợp lệ khi không nêu loại mã', () => {
    const template = `BN${BUSINESS_CODE_TOKEN.FACILITY_CODE}${BUSINESS_CODE_TOKEN.COUNTER}`;
    expect(parseBusinessCodeTemplate(template, 'PATIENT').ok).toBe(false);
    expect(parseBusinessCodeTemplate(`BN${BUSINESS_CODE_TOKEN.PRESCRIPTION_KIND}${BUSINESS_CODE_TOKEN.COUNTER}`, 'ENCOUNTER').ok).toBe(false);
    expect(parseBusinessCodeTemplate(template, 'PRESCRIPTION').ok).toBe(true);
    expect(parseBusinessCodeTemplate(template).ok).toBe(true);
  });

  it('mỗi token mã đơn thuốc chỉ dùng tối đa 1 lần', () => {
    const twice = `${BUSINESS_CODE_TOKEN.FACILITY_CODE}${BUSINESS_CODE_TOKEN.FACILITY_CODE}${BUSINESS_CODE_TOKEN.COUNTER}`;
    expect(parseBusinessCodeTemplate(twice, 'PRESCRIPTION').ok).toBe(false);
  });

  it('formatPrescriptionNationalCode: 14 ký tự xxxxxyyyyyyy-z, đệm số 0 bên trái, đủ 4 loại đơn', () => {
    expect(formatPrescriptionNationalCode('79001', 43n, 'C')).toBe('790010000043-C');
    expect(formatPrescriptionNationalCode('00123', 1, 'N')).toBe('001230000001-N');
    expect(formatPrescriptionNationalCode('79001', 9_999_999n, 'H')).toBe('790019999999-H');
    expect(formatPrescriptionNationalCode('79001', 12, 'Y')).toBe('790010000012-Y');
    for (const kind of ['C', 'N', 'H', 'Y'] as const) expect(formatPrescriptionNationalCode('79001', 5, kind)).toHaveLength(14);
  });

  it('formatBusinessCode với khuôn tuỳ chỉnh dùng token mã đơn thuốc', () => {
    const template = `DT${BUSINESS_CODE_TOKEN.FACILITY_CODE}-${BUSINESS_CODE_TOKEN.COUNTER}-${BUSINESS_CODE_TOKEN.PRESCRIPTION_KIND}`;
    expect(formatBusinessCode(template, 4, { year: 2026, month: 10, day: 20 }, 7, { facilityCode: '79001', prescriptionKind: 'N' })).toBe('DT79001-0007-N');
  });

  it('isValidFacilityCode: đúng 5 chữ số', () => {
    expect(isValidFacilityCode('79001')).toBe(true);
    for (const bad of ['7900', '790011', 'abcde', '79 01', '', null, undefined]) expect(isValidFacilityCode(bad)).toBe(false);
  });
});
