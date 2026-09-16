import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { DrugCatalogPane } from './DrugCatalogPane';

/**
 * Trang "Thuốc & Vật tư" (`/admin/catalog-pharmacy`, đổi tên từ "Danh mục Thuốc và Vật Tư") — chủ
 * dự án yêu cầu trực tiếp (16/09/2026, docs/DECISIONS.md #157) đổi từ trang nhiều pill (Thuốc & Vật
 * tư/Kho/Hoạt chất/...) sang page ĐƠN, chỉ còn đúng nội dung CRUD thuốc (`DrugCatalogPane.tsx`) —
 * không chia pill nữa. 10 pill còn lại (Kho + 9 danh mục phân loại) tách sang trang mới "Danh mục
 * kho" (`WarehouseCatalogPage.tsx`, route `/admin/catalog-warehouse`). Cùng khuôn
 * `SupplierManagementPage.tsx` (page đơn, không pill — `useBreadcrumb` + `<h1 className="sr-only">`
 * cho a11y).
 */
export function PharmacyCatalogPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Thuốc & Vật tư' }]);

  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="sr-only">Thuốc &amp; Vật tư</h1>
      <DrugCatalogPane />
    </div>
  );
}
