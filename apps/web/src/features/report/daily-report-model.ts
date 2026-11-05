import type { DailyBranchReportDto, DailyReport } from '@nexamed/shared';

/**
 * Phần thuần của "Báo cáo ngày" (docs/DECISIONS.md #287): nhãn, định dạng ngày, tổng chênh lệch kiểm đếm. Không tính tiền — máy chủ đã tính mọi số; web chỉ hiển thị.
 */

export type RevenueGroupKey = keyof DailyReport['totals']['recognized']['byGroup'];

export const REVENUE_GROUP_ORDER: readonly RevenueGroupKey[] = ['EXAM', 'PARACLINICAL', 'DRUG', 'PACKAGE'];

export const REVENUE_GROUP_LABEL: Record<RevenueGroupKey, string> = {
  EXAM: 'Khám bệnh',
  PARACLINICAL: 'Cận lâm sàng',
  DRUG: 'Thuốc và vật tư',
  PACKAGE: 'Gói dịch vụ',
};

export const SHIFT_STATUS_LABEL: Record<DailyBranchReportDto['shifts'][number]['status'], string> = {
  OPEN: 'Đang mở',
  CLOSED: 'Đã chốt',
};

const WEEKDAY_LABEL = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** `2026-11-04` → `04/11/2026`. */
export function formatReportDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** `2026-11-04` → `04/11` (nhãn nút chọn ngày). */
export function formatReportDayMonth(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

/** Thứ trong tuần của một ngày lịch (`YYYY-MM-DD`), không phụ thuộc múi giờ máy xem. */
export function weekdayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAY_LABEL[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

/** Tổng chênh lệch kiểm đếm các ca đã chốt của một chi nhánh (âm = thiếu tiền). Ca chưa chốt/chưa kiểm đếm không tính. */
export function branchShiftDiscrepancy(branch: Pick<DailyBranchReportDto, 'shifts'>): number {
  return branch.shifts.reduce((sum, s) => sum + (s.discrepancy ?? 0), 0);
}

/** Số có dấu cho chênh lệch: `−20.000`, `0`, `+5.000` (dấu trừ thật U+2212 để không bị nhầm với gạch nối). */
export function formatSignedVnd(amount: number): string {
  const digits = Math.abs(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (amount === 0) return '0';
  return `${amount < 0 ? '−' : '+'}${digits}`;
}

/** Giờ mở/đóng ca dạng `HH:mm` theo giờ Việt Nam. */
export function formatShiftClock(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}`;
}
