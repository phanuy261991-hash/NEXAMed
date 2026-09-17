import { useMemo } from 'react';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';

/**
 * Map mã đơn vị (`reference_catalog` category UNIT, ví dụ "DV00005") -> tên hiển thị ("Viên") —
 * dùng chung cho mọi nơi hiện đơn vị của thuốc/vật tư (Danh mục Thuốc, Phiếu nhập kho, Tồn kho...).
 * Tránh lặp lại việc dựng Map này ở từng màn hình (đã lặp ở DrugCatalogPane trước khi tách ra đây).
 */
export function useUnitNameByCode(): Map<string, string> {
  const unitQuery = useReferenceCatalogQuery('UNIT');
  return useMemo(() => new Map((unitQuery.data?.items ?? []).map((i) => [i.code, i.name])), [unitQuery.data]);
}

/** Tra tên hiển thị cho 1 mã đơn vị — rơi về chính mã đó nếu chưa tải xong/không tìm thấy (an toàn
 * hơn hiện rỗng, và khớp hành vi cũ trước khi có danh mục UNIT). */
export function unitLabel(unitNameByCode: Map<string, string>, code: string): string {
  return unitNameByCode.get(code) ?? code;
}
