import type { PharmacyControlledReport, PharmacyDispensedReport, PharmacyMarginReport } from '@nexamed/shared';

/**
 * Phần THUẦN của trang báo cáo "Thuốc và vật tư" (docs/DECISIONS.md #287): nhãn, bộ lọc, thứ tự tab, hàm dựng liên kết. Không gọi API, không biết gì về giao diện — để test được và dùng chung
 * cho màn hình, bản in và Excel. Web không import giá trị từ `@nexamed/shared`/`core` nên các nhãn khai báo cục bộ (kiểu thì import được).
 */
export type PharmacyItemFilter = PharmacyDispensedReport['itemType'];
export type ControlledTypeFilter = PharmacyControlledReport['controlType'];
export type PharmacyItemType = PharmacyMarginReport['rows'][number]['itemType'];
export type ControlledType = PharmacyControlledReport['rows'][number]['controlType'];

/** Bộ lọc Loại của hai tab Đã phát và Lãi gộp (đúng mockup: Tất cả / Thuốc / Vật tư y tế). */
export const PHARMACY_ITEM_FILTER_ITEMS: ReadonlyArray<{ id: PharmacyItemFilter; label: string }> = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'MEDICINE', label: 'Thuốc' },
  { id: 'SUPPLY', label: 'Vật tư y tế' },
];

export const PHARMACY_ITEM_FILTER_LABEL: Record<PharmacyItemFilter, string> = { ALL: 'Tất cả', MEDICINE: 'Thuốc', SUPPLY: 'Vật tư y tế' };

/** Nhãn cột "Loại" của bảng mặt hàng (đúng mockup: "Thuốc" / "Vật tư"). */
export const PHARMACY_ITEM_TYPE_LABEL: Record<PharmacyItemType, string> = { MEDICINE: 'Thuốc', SUPPLY: 'Vật tư' };

export const CONTROLLED_FILTER_ITEMS: ReadonlyArray<{ id: ControlledTypeFilter; label: string }> = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'NARCOTIC', label: 'Gây nghiện' },
  { id: 'PSYCHOTROPIC', label: 'Hướng thần' },
  { id: 'PRECURSOR', label: 'Tiền chất' },
  { id: 'TOXIC', label: 'Độc' },
];

export const CONTROLLED_TYPE_LABEL: Record<ControlledType, string> = { NARCOTIC: 'Gây nghiện', PSYCHOTROPIC: 'Hướng thần', PRECURSOR: 'Tiền chất', TOXIC: 'Độc' };

/** Màu chữ của phân loại: gây nghiện và hướng thần bị kiểm soát chặt hơn nên đỏ; độc và tiền chất hổ phách (cùng cách Danh mục thuốc). */
export const CONTROLLED_TYPE_TONE: Record<ControlledType, string> = {
  NARCOTIC: 'text-rose-700',
  PSYCHOTROPIC: 'text-rose-700',
  PRECURSOR: 'text-amber-700',
  TOXIC: 'text-amber-700',
};

/** Ba tab của trang này (nhớ trong `?tab=`); tab mặc định là `margin` theo mockup. */
export const PHARMACY_OWN_TABS = [
  { id: 'dispensed', label: 'Đã phát' },
  { id: 'margin', label: 'Lãi gộp' },
  { id: 'controlled', label: 'Kiểm soát đặc biệt' },
] as const;

export type PharmacyOwnTabId = (typeof PHARMACY_OWN_TABS)[number]['id'];

export const PHARMACY_DEFAULT_TAB: PharmacyOwnTabId = 'dispensed';

/**
 * Bốn tab là báo cáo kho đã có: bấm tab là chuyển sang trang cũ (giữ đúng đường dẫn và quyền cũ, chủ dự án chọn 05/11/2026). `permission` giống hệt quyền của route tương ứng.
 */
export const PHARMACY_LINK_TABS = [
  { id: 'stock-ledger', label: 'Nhập-Xuất-Tồn', to: '/inventory/reports/stock-ledger', permission: ['stock_receipt', 'report'] },
  { id: 'stock-balance', label: 'Tồn kho và hạn dùng', to: '/inventory/balances', permission: ['stock_receipt', 'read'] },
  { id: 'transfer-shrinkage', label: 'Hao hụt điều chuyển', to: '/inventory/reports/stock-ledger?tab=shrinkage', permission: ['stock_receipt', 'report'] },
  { id: 'supplier-debt', label: 'Công nợ nhà cung cấp', to: '/suppliers/debts', permission: ['supplier_debt', 'read'] },
] as const;

export function parsePharmacyTab(raw: string | null): PharmacyOwnTabId {
  return PHARMACY_OWN_TABS.find((t) => t.id === raw)?.id ?? PHARMACY_DEFAULT_TAB;
}

/** Tiêu đề khung bảng ghi kỳ đang xem, ví dụ "Mặt hàng, xếp theo lãi gộp, Tháng 10/2026". */
export function pharmacyCardTitle(base: string, caption: string): string {
  return `${base}, ${caption}`;
}

/** "56,0%" kiểu Việt với MỘT chữ số thập phân (đúng mockup); `null` → "—". */
export function formatMarginPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1).replace('.', ',')}%`;
}

/** Số lượng có dấu chấm phân cách hàng nghìn. */
export function formatQuantity(value: number): string {
  return value.toLocaleString('vi-VN');
}

/** Độ rộng thanh biên lãi gộp (0–100): mặt hàng có biên cao nhất đầy thanh, các mặt hàng khác theo tỉ lệ; biên âm hoặc không xác định → 0. */
export function marginBarPercent(percent: number | null, maxPercent: number): number {
  if (percent === null || percent <= 0 || maxPercent <= 0) return 0;
  return Math.round(Math.min(1, percent / maxPercent) * 100);
}

/** Số ngày giữa hai ngày `YYYY-MM-DD` không cần đến ở đây; hàm này chỉ ghép dòng cắt bớt ("8 mặt hàng đầu · còn 142 mặt hàng khác") khi danh sách bị cắt. */
export function truncatedNote(shown: number, total: number, noun: string): string {
  return total > shown ? `${formatQuantity(shown)} ${noun} đầu · còn ${formatQuantity(total - shown)} ${noun} khác` : `${formatQuantity(total)} ${noun}`;
}
