/**
 * Bỏ dấu tiếng Việt + viết thường để lọc/tìm không phân biệt hoa/thường/dấu ("xq nguc" khớp "X-quang ngực thẳng").
 * Bản nhỏ của `stripVietnameseDiacritics` ở `packages/core` (cùng kỹ thuật xử lý riêng "đ"/"Đ" — không phải ký tự tổ hợp Unicode) —
 * KHÔNG import từ `@nexamed/core`: ESLint cấm `apps/web` import package này (docs/DECISIONS.md #073).
 */
export function stripDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
