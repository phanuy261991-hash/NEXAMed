import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';
import { DrugCatalogPane } from './DrugCatalogPane';
import { WarehousePane } from './WarehousePane';

const PILLS: ConfigScreenPill[] = [
  { key: 'drug', label: 'Thuốc & Vật tư' },
  { key: 'warehouse', label: 'Kho' },
  // Chuyển từ "Danh mục dùng chung" sang đây theo yêu cầu chủ dự án — cùng nhóm nội dung Kho
  // Thuốc & Vật tư y tế, tái dùng nguyên `ReferenceCatalogPane.tsx` (docs/DECISIONS.md #146/#148).
  { key: 'active-ingredient', label: 'Hoạt chất' },
  { key: 'drug-group', label: 'Nhóm thuốc' },
  { key: 'drug-route', label: 'Đường dùng' },
  // Mở rộng #151 — 5 category mới, có "thêm nhanh" ngay tại ô chọn trong form Thêm/Sửa thuốc
  // (Combobox allowCreate), NHƯNG vẫn cần trang quản lý riêng để đổi tên/gộp/ẩn (đặc biệt
  // "Hãng sản xuất" backfill từ dữ liệu text cũ có thể trùng gần đúng do khác hoa/thường).
  { key: 'dosage-form', label: 'Dạng bào chế' },
  { key: 'storage-condition', label: 'Điều kiện bảo quản' },
  { key: 'manufacturer', label: 'Hãng sản xuất' },
  { key: 'country-of-origin', label: 'Nước sản xuất' },
  { key: 'storage-location', label: 'Vị trí lưu kho' },
];
const FIRST_PILL = PILLS[0]!;

/**
 * Trang "Danh mục Thuốc và Vật Tư" (`/admin/catalog-pharmacy`) — Giai đoạn 1 của Kho Thuốc & Vật tư
 * y tế (docs/DECISIONS.md #146, mockup Artifact duyệt qua nhiều vòng). Đổi tên từ "Danh mục thuốc"
 * (Sprint 4, S4-03) — v1 mở rộng quản lý cả Vật tư y tế + Kho (chưa có tồn kho/nhập-xuất, GĐ2-3
 * chưa xây). `ConfigScreenShell` chế độ pill phẳng, đúng khuôn `CatalogAdminPage.tsx`.
 *
 * Chuyển từ nhóm "Quản trị" sang nhóm sidebar riêng "Quản lý kho" theo yêu cầu chủ dự án — route
 * GIỮ NGUYÊN `/admin/catalog-pharmacy`, chỉ đổi vị trí hiển thị (xem `Sidebar.tsx`). "Nhà cung cấp"
 * tách khỏi trang này thành trang/nhóm menu riêng "Quản lý nhà cung cấp" (`SupplierManagementPage`),
 * không còn là pill ở đây.
 */
export function PharmacyCatalogPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const activePill = PILLS.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Danh mục Thuốc và Vật Tư', to: '/admin/catalog-pharmacy' }, { label: activePill.label }]);

  return (
    <ConfigScreenShell pageLabel="Danh mục Thuốc và Vật Tư" pills={PILLS} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'drug' && <DrugCatalogPane />}
      {activePillKey === 'warehouse' && <WarehousePane />}
      {activePillKey === 'active-ingredient' && <ReferenceCatalogPane category="ACTIVE_INGREDIENT" categoryLabel="Hoạt chất" />}
      {activePillKey === 'drug-group' && <ReferenceCatalogPane category="DRUG_GROUP" categoryLabel="Nhóm thuốc" />}
      {activePillKey === 'drug-route' && <ReferenceCatalogPane category="DRUG_ROUTE" categoryLabel="Đường dùng" />}
      {activePillKey === 'dosage-form' && <ReferenceCatalogPane category="DOSAGE_FORM" categoryLabel="Dạng bào chế" />}
      {activePillKey === 'storage-condition' && <ReferenceCatalogPane category="STORAGE_CONDITION" categoryLabel="Điều kiện bảo quản" />}
      {activePillKey === 'manufacturer' && <ReferenceCatalogPane category="MANUFACTURER" categoryLabel="Hãng sản xuất" />}
      {activePillKey === 'country-of-origin' && <ReferenceCatalogPane category="COUNTRY_OF_ORIGIN" categoryLabel="Nước sản xuất" />}
      {activePillKey === 'storage-location' && <ReferenceCatalogPane category="STORAGE_LOCATION" categoryLabel="Vị trí lưu kho" />}
    </ConfigScreenShell>
  );
}
