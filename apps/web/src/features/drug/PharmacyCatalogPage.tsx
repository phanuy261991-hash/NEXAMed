import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { DrugCatalogPane } from './DrugCatalogPane';
import { SupplierPane } from './SupplierPane';
import { WarehousePane } from './WarehousePane';

const PILLS: ConfigScreenPill[] = [
  { key: 'drug', label: 'Thuốc & Vật tư' },
  { key: 'supplier', label: 'Nhà cung cấp' },
  { key: 'warehouse', label: 'Kho' },
];
const FIRST_PILL = PILLS[0]!;

/**
 * Trang "Danh mục Thuốc & Vật tư" (`/admin/catalog-pharmacy`) — Giai đoạn 1 của Kho Thuốc & Vật tư
 * y tế (docs/DECISIONS.md #146, mockup Artifact duyệt qua nhiều vòng). Đổi tên từ "Danh mục thuốc"
 * (Sprint 4, S4-03) — v1 mở rộng quản lý cả Vật tư y tế + Nhà cung cấp + Kho (chưa có tồn kho/nhập-
 * xuất, GĐ2-3 chưa xây). `ConfigScreenShell` chế độ pill phẳng, đúng khuôn `CatalogAdminPage.tsx`.
 */
export function PharmacyCatalogPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const activePill = PILLS.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Danh mục Thuốc & Vật tư', to: '/admin/catalog-pharmacy' }, { label: activePill.label }]);

  return (
    <ConfigScreenShell pageLabel="Danh mục Thuốc & Vật tư" pills={PILLS} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'drug' && <DrugCatalogPane />}
      {activePillKey === 'supplier' && <SupplierPane />}
      {activePillKey === 'warehouse' && <WarehousePane />}
    </ConfigScreenShell>
  );
}
