import type { ClinicalServiceKind } from '@nexamed/shared';

/**
 * Phần THUẦN của trang báo cáo "Chuyên môn" (docs/DECISIONS.md #287): nhãn, định dạng thời gian, danh sách tab. Không gọi API, không biết gì về giao diện — để test được và dùng chung cho màn hình
 * và bản in. Web không import giá trị từ `@nexamed/shared`/`core` nên các nhãn khai báo cục bộ.
 */

export const CLINICAL_KIND_LABEL: Record<ClinicalServiceKind, string> = {
  LAB: 'Xét nghiệm',
  IMAGING: 'Chẩn đoán hình ảnh',
  FUNCTIONAL: 'Thăm dò chức năng',
  OTHER: 'Chỉ định ngoài (tên tự do)',
};

/** Nhóm lạ (máy chủ thêm nhóm mới mà web chưa biết) hiện nguyên mã, không bịa nhãn. */
export function kindLabel(kind: string): string {
  return (CLINICAL_KIND_LABEL as Record<string, string>)[kind] ?? kind;
}

/** "45 phút" / "2 giờ 05 phút" / "—" (chưa đo được). */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} giờ` : `${h} giờ ${String(m).padStart(2, '0')} phút`;
}

/** "3 ngày 4 giờ" cho thời gian chờ dài (≥ 24 giờ); ngắn hơn dùng `formatDuration`. */
export function formatWait(minutes: number): string {
  if (minutes < 24 * 60) return formatDuration(minutes);
  const d = Math.floor(minutes / (24 * 60));
  const h = Math.floor((minutes % (24 * 60)) / 60);
  return h === 0 ? `${d} ngày` : `${d} ngày ${h} giờ`;
}

/**
 * Ba tab của trang. `link` = tab dẫn sang báo cáo đã có (không làm trùng): bấm là chuyển sang trang đó, chỉ hiện khi người xem có quyền của trang đích (cùng quyền route).
 */
export const CLINICAL_TABS = [
  { id: 'diagnoses', label: 'Cơ cấu chẩn đoán ICD-10' },
  { id: 'services', label: 'Dịch vụ đã dùng', to: '/reports/revenue?tab=by-service', permission: ['revenue_report', 'read'] as const },
  { id: 'paraclinical', label: 'Cận lâm sàng' },
] as const;

export type ClinicalTabId = (typeof CLINICAL_TABS)[number]['id'];

export const CLINICAL_DEFAULT_TAB: ClinicalTabId = 'diagnoses';

/** Chỉ hai tab có nội dung riêng mới đọc được từ `?tab=`; tab dẫn sang trang khác hay mã lạ rơi về tab đầu. */
export function parseClinicalTab(raw: string | null): Exclude<ClinicalTabId, 'services'> {
  return raw === 'paraclinical' ? 'paraclinical' : 'diagnoses';
}
