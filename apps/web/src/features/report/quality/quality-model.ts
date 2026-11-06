/**
 * Phần THUẦN của trang báo cáo "Chất lượng và tuân thủ" (docs/DECISIONS.md #290): nhãn trạng thái, định dạng, danh sách tab. Không gọi API, không biết gì về giao diện — để test được và dùng
 * chung cho màn hình và bản in. Web không import giá trị từ `@nexamed/shared`/`core` nên các nhãn khai báo cục bộ.
 */

/** Trạng thái lượt khám còn treo → nhãn; mã lạ hiện nguyên mã (không bịa nhãn). */
const ENCOUNTER_STATUS_LABEL: Record<string, string> = { CHECKED_IN: 'Chờ khám', IN_CONSULTATION: 'Đang khám' };

export function encounterStatusLabel(status: string): string {
  return ENCOUNTER_STATUS_LABEL[status] ?? status;
}

/** Trạng thái đơn thuốc ở hàng chờ liên thông → nhãn. */
const INTEROP_STATUS_LABEL: Record<string, string> = { PENDING: 'Chờ gửi', FAILED: 'Cổng từ chối', SENT: 'Đã gửi', AMENDED: 'Đã gửi bản sửa' };

export function interopStatusLabel(status: string): string {
  return INTEROP_STATUS_LABEL[status] ?? status;
}

/** Màu chữ của trạng thái đơn tồn: cổng từ chối đỏ, chờ gửi hổ phách, còn lại thường. */
export function interopStatusToneClass(status: string): string {
  if (status === 'FAILED') return 'font-semibold text-rose-700';
  if (status === 'PENDING') return 'font-semibold text-amber-700';
  return 'text-slate-800';
}

/** "3 ngày" / "Hôm nay" (0 ngày) cho cột "Đã treo". */
export function formatDaysOpen(days: number): string {
  return days <= 0 ? 'Hôm nay' : `${days.toLocaleString('vi-VN')} ngày`;
}

/** Số lần thử gọn: "3 lần"; chưa thử lần nào → "—". */
export function formatAttempts(attempts: number): string {
  return attempts <= 0 ? '—' : `${attempts} lần`;
}

/** Nguyên văn lỗi nhiều dòng gộp một ô; không có lỗi → "—". */
export function joinErrors(errors: readonly string[]): string {
  return errors.length === 0 ? '—' : errors.join('; ');
}

/**
 * Ba tab của trang. `link` = tab dẫn sang trang đã có (không làm trùng): bấm là chuyển sang trang đó, chỉ hiện khi người xem có quyền của trang đích (cùng quyền route).
 */
export const QUALITY_TABS = [
  { id: 'incomplete', label: 'Lượt khám chưa hoàn tất' },
  { id: 'interop', label: 'Liên thông đơn thuốc' },
  { id: 'audit', label: 'Nhật ký kiểm toán', to: '/admin/activity-log', permission: ['audit_log', 'read'] as const },
] as const;

export type QualityTabId = (typeof QUALITY_TABS)[number]['id'];

export const QUALITY_DEFAULT_TAB: QualityTabId = 'incomplete';

/** Chỉ hai tab có nội dung riêng mới đọc được từ `?tab=`; tab dẫn sang trang khác hay mã lạ rơi về tab đầu. */
export function parseQualityTab(raw: string | null): Exclude<QualityTabId, 'audit'> {
  return raw === 'interop' ? 'interop' : 'incomplete';
}

/** Đường dẫn sang báo cáo Doanh thu → Phiếu chưa thu (chi tiết các phiếu chưa thu). */
export const UNPAID_REPORT_LINK = '/reports/revenue?tab=unpaid';
