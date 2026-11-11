/**
 * Luật kiểm Ngày sản xuất của lô (docs/DECISIONS.md #297, giai đoạn 2) — bản web của `checkManufactureDate` ở
 * `packages/core` (apps/web không import @nexamed/core, #073). Hai bản PHẢI cho kết quả giống hệt: cả hai spec cùng đọc
 * `packages/shared/test-vectors/manufacture-date-rules.json`. Máy chủ vẫn kiểm lại, đây chỉ để báo lỗi ngay tại ô.
 */
export type ManufactureDateIssue = 'AFTER_TODAY' | 'NOT_BEFORE_EXPIRY';

export const MANUFACTURE_DATE_ISSUE_MESSAGES: Record<ManufactureDateIssue, string> = {
  AFTER_TODAY: 'Không được sau hôm nay',
  NOT_BEFORE_EXPIRY: 'Phải trước hạn dùng',
};

/** Cả hai ngày dạng `yyyy-mm-dd` (hoặc rỗng); `todayVn` là hôm nay theo giờ Việt Nam. */
export function checkManufactureDate(manufactureDate: string | null | undefined, expiryDate: string | null | undefined, todayVn: string): ManufactureDateIssue | null {
  if (!manufactureDate) return null;
  if (manufactureDate > todayVn) return 'AFTER_TODAY';
  if (expiryDate && manufactureDate >= expiryDate) return 'NOT_BEFORE_EXPIRY';
  return null;
}
