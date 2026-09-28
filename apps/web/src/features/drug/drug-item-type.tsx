import type { DrugItemType } from '@nexamed/shared';

/**
 * Nhãn hiển thị cho `drug.itemType` — nguồn DUY NHẤT, dùng chung cho mọi nơi hiện danh mục Thuốc &
 * Vật tư (trước đây `DrugCatalogPane.tsx`/`StockBalancePage.tsx` mỗi nơi tự khai một bản khác nhau
 * — "Vật tư y tế" so với "Vật tư" — chủ dự án phát hiện lệch nhau lúc dùng thử, trích xuất ra đây
 * đúng quy tắc "trùng lặp lần 2 mới trích xuất" của CLAUDE.md).
 */
export const ITEM_TYPE_LABEL: Record<DrugItemType, string> = { MEDICINE: 'Thuốc', SUPPLY: 'Vật tư y tế' };

const ITEM_TYPE_BADGE_CLASS: Record<DrugItemType, string> = {
  MEDICINE: 'bg-slate-100 text-slate-700',
  SUPPLY: 'bg-sky-100 text-sky-700',
};

/** Badge nền đặc cho cột "Loại" — cùng khuôn `ControlTypeBadge`/`StatusBadge` (pill `rounded-full`,
 * không phải chữ trần không nền như bản cũ ở `DrugCatalogPane.tsx`). */
export function DrugItemTypeBadge({ itemType }: { itemType: DrugItemType }) {
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${ITEM_TYPE_BADGE_CLASS[itemType]}`}>{ITEM_TYPE_LABEL[itemType]}</span>;
}
