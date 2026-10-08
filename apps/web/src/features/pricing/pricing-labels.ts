import type { PriceListItemKind, PriceListStatus, ServicePackagePricingMode } from '@nexamed/shared';
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge';

/**
 * Nhãn/tông màu cho Gói dịch vụ + Bảng giá (Cận lâm sàng GĐ2, docs/DECISIONS.md #212). `apps/web` KHÔNG import được GIÁ TRỊ từ
 * `@nexamed/shared` (chỉ `import type`) nên các bảng nhãn đặt cục bộ — `satisfies Record<..>` để typecheck bắt lệch khoá.
 */
export const PRICE_LIST_ITEM_KIND_LABELS = {
  EXAM_TYPE: 'Dịch vụ khám',
  TECHNICAL_SERVICE: 'Dịch vụ kỹ thuật',
  PACKAGE: 'Gói dịch vụ',
  DRUG: 'Thuốc',
  MEDICAL_SUPPLY: 'Vật tư y tế',
} as const satisfies Record<PriceListItemKind, string>;

/** Thứ tự tab lọc theo loại mặt hàng (đúng mockup màn 11). */
export const PRICE_LIST_ITEM_KINDS: readonly PriceListItemKind[] = ['EXAM_TYPE', 'TECHNICAL_SERVICE', 'PACKAGE', 'DRUG', 'MEDICAL_SUPPLY'];

export const PRICE_LIST_STATUS_META = {
  ACTIVE: { label: 'Đang áp dụng', tone: 'success' },
  UPCOMING: { label: 'Sắp áp dụng', tone: 'warning' },
  EXPIRED: { label: 'Đã hết hạn', tone: 'neutral' },
  STOPPED: { label: 'Đã ngừng', tone: 'danger' },
} as const satisfies Record<PriceListStatus, { label: string; tone: StatusBadgeTone }>;

export const SERVICE_PACKAGE_PRICING_MODE_LABELS = {
  FIXED: 'Giá cố định cho cả gói',
  SUM_MINUS_DISCOUNT: 'Tổng dịch vụ con trừ chiết khấu',
} as const satisfies Record<ServicePackagePricingMode, string>;

/** "dd/mm/yyyy" từ "yyyy-mm-dd" (ngày lịch, không qua timezone). */
export function formatDateVn(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}/${m}/${y}` : isoDate;
}

/** "Giảm 20%" hoặc "Giá mới 350.000 đ" — mô tả ngắn quy tắc của một dòng bảng giá. */
export function describePriceRule(mode: 'PERCENT_OFF' | 'NEW_PRICE', value: number): string {
  return mode === 'PERCENT_OFF' ? `Giảm ${value}%` : `Giá mới ${value.toLocaleString('vi-VN')} đ`;
}
