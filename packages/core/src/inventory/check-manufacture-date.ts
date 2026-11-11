/**
 * Luật kiểm Ngày sản xuất của lô (docs/DECISIONS.md #297, giai đoạn 2) — hàm THUẦN, dùng ở máy chủ khi lập/duyệt phiếu nhập và
 * kiểm kê. Ngày dạng `yyyy-mm-dd` (so sánh chuỗi đúng thứ tự thời gian). `todayVn` là hôm nay theo giờ Việt Nam
 * (`getVietnamDateString()`), KHÔNG lấy giờ máy trong hàm để test được.
 *
 * Bản web (`apps/web/src/features/inventory/manufacture-date.ts`) PHẢI cho kết quả giống hệt — cả hai spec cùng đọc
 * `packages/shared/test-vectors/manufacture-date-rules.json`.
 */
export type ManufactureDateIssue = 'AFTER_TODAY' | 'NOT_BEFORE_EXPIRY';

export const MANUFACTURE_DATE_ISSUE_MESSAGES: Record<ManufactureDateIssue, string> = {
  AFTER_TODAY: 'Ngày sản xuất không được sau hôm nay.',
  NOT_BEFORE_EXPIRY: 'Ngày sản xuất phải trước hạn dùng.',
};

export function checkManufactureDate(manufactureDate: string | null | undefined, expiryDate: string | null | undefined, todayVn: string): ManufactureDateIssue | null {
  if (!manufactureDate) return null;
  if (manufactureDate > todayVn) return 'AFTER_TODAY';
  if (expiryDate && manufactureDate >= expiryDate) return 'NOT_BEFORE_EXPIRY';
  return null;
}
