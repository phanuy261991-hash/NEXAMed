/**
 * Bản sao THUẦN CLIENT của `parseBusinessCodeTemplate`/`computeBusinessCodePeriodKey`/
 * `formatBusinessCode` (`packages/shared/src/business-code.ts`) — CHỈ dùng để xem trước trực tiếp
 * lúc gõ trong `BusinessCodeTemplateFormModal.tsx`, không phải nguồn sự thật (mã thật luôn do
 * backend cấp atomic qua `BusinessCodeService`).
 *
 * Khai lại tại đây thay vì import từ `@nexamed/shared` — Rollup không dò được các export này của
 * `business-code.ts` qua `__exportStar` lúc `vite build` (dù `tsc`/Node thấy đúng), cùng lỗi
 * bundler đã gặp nhiều lần trong dự án (docs/DECISIONS.md #032/#091). Nếu sửa cú pháp token/luật
 * validate ở bản gốc thì PHẢI sửa lại y hệt ở đây.
 */
const TOKEN_YEAR_2 = '[Năm 2 số]';
const TOKEN_YEAR_4 = '[Năm 4 số]';
const TOKEN_MONTH = '[Tháng]';
const TOKEN_DAY = '[Ngày]';
const TOKEN_COUNTER = '[Số đếm]';
const KNOWN_TOKENS = [TOKEN_YEAR_2, TOKEN_YEAR_4, TOKEN_MONTH, TOKEN_DAY, TOKEN_COUNTER];
const BRACKET_TOKEN_PATTERN = /\[[^\]]*\]/g;

export interface ParsedBusinessCodeTemplatePreview {
  hasYear: boolean;
  hasMonth: boolean;
  hasDay: boolean;
}

export type ParseBusinessCodeTemplatePreviewResult = { ok: true; parsed: ParsedBusinessCodeTemplatePreview } | { ok: false; error: string };

export function parseBusinessCodeTemplatePreview(template: string): ParseBusinessCodeTemplatePreviewResult {
  const brackets = template.match(BRACKET_TOKEN_PATTERN) ?? [];
  const unknown = brackets.filter((b) => !KNOWN_TOKENS.includes(b));
  if (unknown.length > 0) {
    return { ok: false, error: `Token không hợp lệ: ${unknown.join(', ')}` };
  }

  const countOf = (token: string) => brackets.filter((b) => b === token).length;
  const counterCount = countOf(TOKEN_COUNTER);
  if (counterCount === 0) {
    return { ok: false, error: `Khuôn mẫu phải có đúng 1 token ${TOKEN_COUNTER}` };
  }
  if (counterCount > 1) {
    return { ok: false, error: `Token ${TOKEN_COUNTER} chỉ được dùng 1 lần` };
  }
  for (const token of [TOKEN_YEAR_2, TOKEN_YEAR_4, TOKEN_MONTH, TOKEN_DAY]) {
    if (countOf(token) > 1) {
      return { ok: false, error: `Token ${token} chỉ được dùng tối đa 1 lần` };
    }
  }

  return {
    ok: true,
    parsed: { hasYear: countOf(TOKEN_YEAR_2) > 0 || countOf(TOKEN_YEAR_4) > 0, hasMonth: countOf(TOKEN_MONTH) > 0, hasDay: countOf(TOKEN_DAY) > 0 },
  };
}

export function formatBusinessCodePreview(
  template: string,
  counterDigits: number,
  date: { year: number; month: number; day: number },
  seq: number,
): string {
  const yy = String(date.year % 100).padStart(2, '0');
  const yyyy = String(date.year).padStart(4, '0');
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  const seqStr = seq.toString().padStart(counterDigits, '0');

  return template
    .split(TOKEN_YEAR_2)
    .join(yy)
    .split(TOKEN_YEAR_4)
    .join(yyyy)
    .split(TOKEN_MONTH)
    .join(mm)
    .split(TOKEN_DAY)
    .join(dd)
    .split(TOKEN_COUNTER)
    .join(seqStr);
}

export const BUSINESS_CODE_TOKEN_PREVIEW = {
  YEAR_2: TOKEN_YEAR_2,
  YEAR_4: TOKEN_YEAR_4,
  MONTH: TOKEN_MONTH,
  DAY: TOKEN_DAY,
  COUNTER: TOKEN_COUNTER,
};
