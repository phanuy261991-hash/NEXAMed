import { z } from 'zod';

/**
 * "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, chủ dự án yêu cầu trực tiếp 2026-09-03) —
 * cho phép TỪNG TENANT tự cấu hình khuôn mã nghiệp vụ (Nhóm B, khác Nhóm A "mã danh mục" đã rút
 * gọn cố định ở #113). Đặt ở `packages/shared` (không phải `packages/core`) dù có hàm thuần —
 * `apps/web` bị ESLint chặn import `@nexamed/core` (#073) nhưng CẦN gọi `formatBusinessCode` để
 * xem trước mã kế tiếp ngay lúc gõ, không round-trip API — đúng tiền lệ đã có ở đây
 * (`calculateAgeYears`, `labelForEntityType`).
 *
 * Token cố định trong ngoặc vuông (chuỗi tiếng Việt nguyên văn, KHÔNG parse số/tham số động —
 * web chèn qua nút bấm nên không có input tự do sai chính tả). "Số chữ số đệm" tách thành field
 * riêng (`counterDigits`), không nhét vào token, để tránh phải parse số ra khỏi text.
 */
export const BUSINESS_CODE_TOKEN = {
  YEAR_2: '[Năm 2 số]',
  YEAR_4: '[Năm 4 số]',
  MONTH: '[Tháng]',
  DAY: '[Ngày]',
  COUNTER: '[Số đếm]',
} as const;

const KNOWN_TOKENS = Object.values(BUSINESS_CODE_TOKEN);
/** Khớp bất kỳ chuỗi trong ngoặc vuông — dùng để phát hiện token LẠ (không thuộc 5 token đã biết). */
const BRACKET_TOKEN_PATTERN = /\[[^\]]*\]/g;

export const businessCodeTypeSchema = z.enum([
  'PATIENT',
  'DEPARTMENT',
  'EMPLOYEE',
  'APPOINTMENT_BOOKING',
  'ENCOUNTER',
  'INVOICE',
  'CASHIER_SHIFT',
  'CASH_RECEIPT',
  'CASH_PAYMENT',
]);
export type BusinessCodeType = z.infer<typeof businessCodeTypeSchema>;

/**
 * Nhãn tiếng Việt + tiền tố NỘI BỘ mặc định (khoá đếm `code_sequence.prefix`, KHÔNG đổi theo chữ
 * tự do admin gõ trong khuôn mẫu hiển thị — xem comment `BusinessCodeService`). Khuôn MẶC ĐỊNH
 * (`defaultTemplate`) phải tái tạo ĐÚNG hành vi `formatDisplayCode` đang chạy (`<prefix><yy><mm>
 * <seq6>`) để tenant chưa từng cấu hình không thấy khác biệt gì.
 */
export const BUSINESS_CODE_TYPE_REGISTRY: Record<BusinessCodeType, { label: string; internalPrefix: string }> = {
  PATIENT: { label: 'Mã bệnh nhân', internalPrefix: 'BN' },
  DEPARTMENT: { label: 'Mã Khoa/Phòng', internalPrefix: 'KP' },
  EMPLOYEE: { label: 'Mã nhân viên', internalPrefix: 'NV' },
  APPOINTMENT_BOOKING: { label: 'Mã đặt lịch', internalPrefix: 'LH' },
  ENCOUNTER: { label: 'Mã lượt khám', internalPrefix: 'LK' },
  INVOICE: { label: 'Mã phiếu thu', internalPrefix: 'PT' },
  CASHIER_SHIFT: { label: 'Mã phiếu chốt ca', internalPrefix: 'PCC' },
  // "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — không trùng "PT" (phiếu thu viện phí)/"PCC" (phiếu
  // chốt ca) đã dùng.
  CASH_RECEIPT: { label: 'Mã phiếu thu quỹ', internalPrefix: 'PTQ' },
  CASH_PAYMENT: { label: 'Mã phiếu chi quỹ', internalPrefix: 'PCQ' },
};

export const DEFAULT_BUSINESS_CODE_COUNTER_DIGITS = 6;
export const DEFAULT_BUSINESS_CODE_STARTING_VALUE = 1;

function defaultTemplateFor(codeType: BusinessCodeType): string {
  return `${BUSINESS_CODE_TYPE_REGISTRY[codeType].internalPrefix}${BUSINESS_CODE_TOKEN.YEAR_2}${BUSINESS_CODE_TOKEN.MONTH}${BUSINESS_CODE_TOKEN.COUNTER}`;
}
export const DEFAULT_BUSINESS_CODE_TEMPLATE: Record<BusinessCodeType, string> = Object.fromEntries(
  businessCodeTypeSchema.options.map((t) => [t, defaultTemplateFor(t)]),
) as Record<BusinessCodeType, string>;

export interface ParsedBusinessCodeTemplate {
  hasYear: boolean;
  hasMonth: boolean;
  hasDay: boolean;
}

export type ParseBusinessCodeTemplateResult =
  | { ok: true; parsed: ParsedBusinessCodeTemplate }
  | { ok: false; error: string };

/**
 * Validate khuôn mẫu: đúng 1 lần `[Số đếm]` (bắt buộc — không có thì không đảm bảo mã không
 * trùng), mỗi token khác tối đa 1 lần, không có `[...]` nào lạ ngoài 5 token đã biết.
 */
export function parseBusinessCodeTemplate(template: string): ParseBusinessCodeTemplateResult {
  const brackets = template.match(BRACKET_TOKEN_PATTERN) ?? [];
  const unknown = brackets.filter((b) => !KNOWN_TOKENS.includes(b as (typeof KNOWN_TOKENS)[number]));
  if (unknown.length > 0) {
    return { ok: false, error: `Token không hợp lệ: ${unknown.join(', ')}` };
  }

  const countOf = (token: string) => brackets.filter((b) => b === token).length;
  const counterCount = countOf(BUSINESS_CODE_TOKEN.COUNTER);
  if (counterCount === 0) {
    return { ok: false, error: `Khuôn mẫu phải có đúng 1 token ${BUSINESS_CODE_TOKEN.COUNTER}` };
  }
  if (counterCount > 1) {
    return { ok: false, error: `Token ${BUSINESS_CODE_TOKEN.COUNTER} chỉ được dùng 1 lần` };
  }
  for (const token of [BUSINESS_CODE_TOKEN.YEAR_2, BUSINESS_CODE_TOKEN.YEAR_4, BUSINESS_CODE_TOKEN.MONTH, BUSINESS_CODE_TOKEN.DAY]) {
    if (countOf(token) > 1) {
      return { ok: false, error: `Token ${token} chỉ được dùng tối đa 1 lần` };
    }
  }

  return {
    ok: true,
    parsed: {
      hasYear: countOf(BUSINESS_CODE_TOKEN.YEAR_2) > 0 || countOf(BUSINESS_CODE_TOKEN.YEAR_4) > 0,
      hasMonth: countOf(BUSINESS_CODE_TOKEN.MONTH) > 0,
      hasDay: countOf(BUSINESS_CODE_TOKEN.DAY) > 0,
    },
  };
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Chu kỳ reset bộ đếm = granularity MỊN NHẤT xuất hiện trong khuôn (chốt qua AskUserQuestion,
 * docs/DECISIONS.md #114): có `[Ngày]` → reset theo ngày; có `[Tháng]` (không ngày) → theo tháng;
 * có năm (không tháng/ngày) → theo năm; không token thời gian nào → '' (chạy liên tục, đúng hành
 * vi `code_sequence` hiện tại — KHÔNG bao giờ reset).
 */
export function computeBusinessCodePeriodKey(parsed: ParsedBusinessCodeTemplate, date: DateParts): string {
  const yyyy = String(date.year).padStart(4, '0');
  if (parsed.hasDay) {
    return `${yyyy}${String(date.month).padStart(2, '0')}${String(date.day).padStart(2, '0')}`;
  }
  if (parsed.hasMonth) {
    return `${yyyy}${String(date.month).padStart(2, '0')}`;
  }
  if (parsed.hasYear) {
    return yyyy;
  }
  return '';
}

/** Ghép khuôn mẫu thành mã thật — `seq` do backend cấp atomic; ở web chỉ dùng để XEM TRƯỚC. */
export function formatBusinessCode(template: string, counterDigits: number, date: DateParts, seq: number | bigint): string {
  const yy = String(date.year % 100).padStart(2, '0');
  const yyyy = String(date.year).padStart(4, '0');
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  const seqStr = seq.toString().padStart(counterDigits, '0');

  return template
    .split(BUSINESS_CODE_TOKEN.YEAR_2)
    .join(yy)
    .split(BUSINESS_CODE_TOKEN.YEAR_4)
    .join(yyyy)
    .split(BUSINESS_CODE_TOKEN.MONTH)
    .join(mm)
    .split(BUSINESS_CODE_TOKEN.DAY)
    .join(dd)
    .split(BUSINESS_CODE_TOKEN.COUNTER)
    .join(seqStr);
}

export const businessCodeTemplateItemSchema = z.object({
  codeType: businessCodeTypeSchema,
  label: z.string(),
  prefix: z.string(),
  template: z.string(),
  counterDigits: z.number().int().min(1).max(9),
  startingValue: z.number().int().positive(),
  /** `true` = loại mã này đã phát sinh ít nhất 1 mã — `startingValue` không sửa được nữa. */
  locked: z.boolean(),
  /** Mã kế tiếp minh hoạ (tính từ `currentValue` thật hiện có, KHÔNG cấp số/đụng DB). */
  exampleNextCode: z.string(),
});
export type BusinessCodeTemplateItem = z.infer<typeof businessCodeTemplateItemSchema>;

export const listBusinessCodeTemplatesResponseSchema = z.object({
  items: z.array(businessCodeTemplateItemSchema),
});
export type ListBusinessCodeTemplatesResponse = z.infer<typeof listBusinessCodeTemplatesResponseSchema>;

export const updateBusinessCodeTemplateRequestSchema = z.object({
  template: z.string().min(1),
  counterDigits: z.number().int().min(1).max(9),
  /** Chỉ chấp nhận khi loại mã CHƯA `locked` — server 409 nếu gửi kèm lúc đã khoá. */
  startingValue: z.number().int().positive().optional(),
});
export type UpdateBusinessCodeTemplateRequest = z.infer<typeof updateBusinessCodeTemplateRequestSchema>;
