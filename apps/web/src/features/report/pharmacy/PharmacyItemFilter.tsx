import type { ReactNode } from 'react';
import { SegmentedToggle } from '../../../shared/ui/SegmentedToggle';
import { CONTROLLED_FILTER_ITEMS, PHARMACY_ITEM_FILTER_ITEMS, type ControlledTypeFilter, type PharmacyItemFilter } from './pharmacy-model';

/** Bộ lọc Loại dùng chung của hai tab Đã phát và Lãi gộp: giá trị đang chọn và ô chọn đặt cạnh bộ chọn Kỳ. */
export interface PharmacyFilterState {
  itemType: PharmacyItemFilter;
  control: ReactNode;
}

/** Ô chọn Loại (Tất cả / Thuốc / Vật tư y tế), đúng mockup Lãi gộp. */
export function PharmacyItemTypeControl({ value, onChange }: { value: PharmacyItemFilter; onChange: (next: PharmacyItemFilter) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-slate-800">Loại</span>
      <SegmentedToggle<PharmacyItemFilter> items={PHARMACY_ITEM_FILTER_ITEMS} value={value} onChange={onChange} ariaLabel="Loại mặt hàng" />
    </div>
  );
}

/** Bộ lọc Phân loại của tab Kiểm soát đặc biệt. */
export interface ControlledFilterState {
  controlType: ControlledTypeFilter;
  control: ReactNode;
}

export function ControlledTypeControl({ value, onChange }: { value: ControlledTypeFilter; onChange: (next: ControlledTypeFilter) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-slate-800">Phân loại</span>
      <SegmentedToggle<ControlledTypeFilter> items={CONTROLLED_FILTER_ITEMS} value={value} onChange={onChange} ariaLabel="Phân loại thuốc kiểm soát đặc biệt" />
    </div>
  );
}
