import type { ReferenceCatalogCategory } from '@nexamed/shared';
import type { ComboboxOption } from '../../shared/ui/Combobox';
import { useCreateReferenceCatalogItemMutation, useReferenceCatalogQuery } from './reference-catalog.queries';

/**
 * Gộp query + "thêm nhanh" cho MỘT category `reference_catalog` dùng trong Combobox `allowCreate` (mở rộng #151, chủ dự án yêu cầu trực tiếp) — dùng chung cho form Danh mục Thuốc & Vật tư
 * và hộp "Thêm mặt hàng mới" ở Đơn đặt hàng NCC/Phiếu nhập kho (#298 bổ sung 2), tách ra khi cần ở nơi thứ hai.
 */
export function useCatalogCombobox(category: ReferenceCatalogCategory) {
  const query = useReferenceCatalogQuery(category);
  const createMutation = useCreateReferenceCatalogItemMutation(category);
  const options: ComboboxOption[] = (query.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
  const nameByCode = new Map(options.map((o) => [o.value, o.label]));
  async function onCreateOption(name: string): Promise<ComboboxOption> {
    const created = await createMutation.mutateAsync({ category, name, sortOrder: 0 });
    return { value: created.code, label: created.name };
  }
  return { options, nameByCode, onCreateOption };
}
export type CatalogCombobox = ReturnType<typeof useCatalogCombobox>;
