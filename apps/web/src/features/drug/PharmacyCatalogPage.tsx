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
    </ConfigScreenShell>
  );
}
