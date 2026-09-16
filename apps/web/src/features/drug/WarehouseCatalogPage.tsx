import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';
import { WarehousePane } from './WarehousePane';

const PILLS: ConfigScreenPill[] = [
  { key: 'warehouse', label: 'Kho' },
  { key: 'active-ingredient', label: 'Hoạt chất' },
  { key: 'drug-group', label: 'Nhóm thuốc' },
  { key: 'drug-route', label: 'Đường dùng' },
  { key: 'dosage-form', label: 'Dạng bào chế' },
  { key: 'storage-condition', label: 'Điều kiện bảo quản' },
  { key: 'manufacturer', label: 'Hãng sản xuất' },
  { key: 'country-of-origin', label: 'Nước sản xuất' },
  { key: 'storage-location', label: 'Vị trí lưu kho' },
  { key: 'usage-timing', label: 'Thời điểm dùng thuốc' },
];
const FIRST_PILL = PILLS[0]!;

/**
 * Trang "Danh mục kho" (`/admin/catalog-warehouse`) — tách ra từ "Danh mục Thuốc và Vật Tư" theo
 * yêu cầu chủ dự án (16/09/2026, docs/DECISIONS.md #157): trang cũ có 11 pill lẫn lộn giữa 1 pill
 * CRUD thuốc thật (đã tách sang `PharmacyCatalogPage.tsx`, không còn chia pill) và 10 pill THUẦN
 * danh mục/phân loại (Kho + 9 category `reference_catalog`) — nay 10 pill đó dồn về đây, đúng bản
 * chất "Danh mục" tách khỏi "CRUD nghiệp vụ". Cùng nhóm sidebar "Quản lý kho", cùng quyền
 * `drug.create`/`drug.update` (không permission mới).
 */
export function WarehouseCatalogPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const activePill = PILLS.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Danh mục kho', to: '/admin/catalog-warehouse' }, { label: activePill.label }]);

  return (
    <ConfigScreenShell pageLabel="Danh mục kho" pills={PILLS} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'warehouse' && <WarehousePane />}
      {activePillKey === 'active-ingredient' && <ReferenceCatalogPane category="ACTIVE_INGREDIENT" categoryLabel="Hoạt chất" />}
      {activePillKey === 'drug-group' && <ReferenceCatalogPane category="DRUG_GROUP" categoryLabel="Nhóm thuốc" />}
      {activePillKey === 'drug-route' && <ReferenceCatalogPane category="DRUG_ROUTE" categoryLabel="Đường dùng" />}
      {activePillKey === 'dosage-form' && <ReferenceCatalogPane category="DOSAGE_FORM" categoryLabel="Dạng bào chế" />}
      {activePillKey === 'storage-condition' && <ReferenceCatalogPane category="STORAGE_CONDITION" categoryLabel="Điều kiện bảo quản" />}
      {activePillKey === 'manufacturer' && <ReferenceCatalogPane category="MANUFACTURER" categoryLabel="Hãng sản xuất" />}
      {activePillKey === 'country-of-origin' && <ReferenceCatalogPane category="COUNTRY_OF_ORIGIN" categoryLabel="Nước sản xuất" />}
      {activePillKey === 'storage-location' && <ReferenceCatalogPane category="STORAGE_LOCATION" categoryLabel="Vị trí lưu kho" />}
      {activePillKey === 'usage-timing' && <ReferenceCatalogPane category="DRUG_USAGE_TIMING" categoryLabel="Thời điểm dùng thuốc" />}
    </ConfigScreenShell>
  );
}
