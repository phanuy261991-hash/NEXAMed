import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CODE_TOKEN_PREVIEW as T,
  PRESCRIPTION_STANDARD_COUNTER_DIGITS_PREVIEW,
  PRESCRIPTION_STANDARD_TEMPLATE_PREVIEW,
  formatBusinessCodePreview,
  parseBusinessCodeTemplatePreview,
} from './business-code-preview';

// Bản sao phía web của `packages/shared/src/business-code.ts` (xem comment đầu file nguồn) — test giữ hai bản không lệch nhau ở phần mã đơn thuốc chuẩn Bộ Y tế (#242).
describe('business-code-preview — mã đơn thuốc chuẩn Bộ Y tế', () => {
  it('khuôn chuẩn hợp lệ cho PRESCRIPTION và ghép ra mã 14 ký tự xxxxxyyyyyyy-z', () => {
    expect(parseBusinessCodeTemplatePreview(PRESCRIPTION_STANDARD_TEMPLATE_PREVIEW, 'PRESCRIPTION').ok).toBe(true);
    const code = formatBusinessCodePreview(PRESCRIPTION_STANDARD_TEMPLATE_PREVIEW, PRESCRIPTION_STANDARD_COUNTER_DIGITS_PREVIEW, { year: 2026, month: 10, day: 20 }, 43, {
      facilityCode: '79001',
      prescriptionKind: 'N',
    });
    expect(code).toBe('790010000043-N');
    expect(code).toHaveLength(14);
  });

  it('token [Mã cơ sở KCB]/[Loại đơn] bị từ chối ở loại mã khác, chỉ dùng tối đa 1 lần', () => {
    const template = `BN${T.FACILITY_CODE}${T.COUNTER}`;
    expect(parseBusinessCodeTemplatePreview(template, 'PATIENT').ok).toBe(false);
    expect(parseBusinessCodeTemplatePreview(template, 'PRESCRIPTION').ok).toBe(true);
    expect(parseBusinessCodeTemplatePreview(`${T.PRESCRIPTION_KIND}${T.PRESCRIPTION_KIND}${T.COUNTER}`, 'PRESCRIPTION').ok).toBe(false);
  });

  it('khuôn cũ không đổi hành vi (tương thích ngược)', () => {
    const template = `DT${T.YEAR_2}${T.MONTH}${T.COUNTER}`;
    expect(parseBusinessCodeTemplatePreview(template)).toEqual({ ok: true, parsed: { hasYear: true, hasMonth: true, hasDay: false } });
    expect(formatBusinessCodePreview(template, 6, { year: 2026, month: 10, day: 20 }, 1)).toBe('DT2610000001');
  });
});
