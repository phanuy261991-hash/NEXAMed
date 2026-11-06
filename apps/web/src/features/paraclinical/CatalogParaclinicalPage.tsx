import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { useLabPartnerEnabledQuery } from '../clinic/clinic.queries';
import { SupplierPane } from '../drug/SupplierPane';
import { ServicePackagePane } from '../pricing/ServicePackagePane';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';
import { LabIndicatorPane } from './LabIndicatorPane';
import { ResultTemplatePane } from './ResultTemplatePane';
import { TechnicalServicePane } from './TechnicalServicePane';

/**
 * "Danh mục Cận lâm sàng" (`/admin/catalog-paraclinical`, thay `ComingSoonPage`) — Cận lâm sàng GĐ1 (docs/DECISIONS.md
 * #212). `ConfigScreenShell` chế độ pill phẳng (không `items`), đúng khuôn `CatalogClinicalPage.tsx`. Pill "Gói dịch vụ"
 * (mockup màn 4) thêm ở GĐ2 cùng "Bảng giá có thời hạn" (trang riêng `/admin/price-lists`).
 */
const PILLS: ConfigScreenPill[] = [
  { key: 'service', label: 'Dịch vụ kỹ thuật' },
  { key: 'indicator', label: 'Chỉ số xét nghiệm' },
  { key: 'package', label: 'Gói dịch vụ' },
  { key: 'category', label: 'Nhóm dịch vụ' },
  { key: 'specimen', label: 'Mẫu bệnh phẩm' },
  { key: 'unit', label: 'Đơn vị kết quả' },
  { key: 'template', label: 'Mẫu kết quả' },
];
/** "Đối tác xét nghiệm" (#291) — chỉ hiện khi công tắc "Dùng đối tác xét nghiệm" bật. Danh mục là nhà cung cấp có cờ đối tác nên gác bằng quyền nhà cung cấp (`supplier`), không còn gắn với kho thuốc. */
const PARTNER_PILL: ConfigScreenPill = { key: 'partner', label: 'Đối tác xét nghiệm', permission: ['supplier', 'read'] };
const FIRST_PILL = PILLS[0]!;

export function CatalogParaclinicalPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const partnerEnabled = useLabPartnerEnabledQuery().data?.enabled === true;
  const pills = partnerEnabled ? [...PILLS, PARTNER_PILL] : PILLS;
  const activePill = pills.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Danh mục Cận lâm sàng', to: '/admin/catalog-paraclinical' }, { label: activePill.label }]);

  return (
    <ConfigScreenShell pageLabel="Danh mục Cận lâm sàng" pills={pills} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'service' && <TechnicalServicePane />}
      {activePillKey === 'indicator' && <LabIndicatorPane />}
      {activePillKey === 'package' && <ServicePackagePane />}
      {activePillKey === 'category' && <ReferenceCatalogPane category="TECH_SERVICE_CATEGORY" categoryLabel="Nhóm dịch vụ" />}
      {activePillKey === 'specimen' && <ReferenceCatalogPane category="SPECIMEN_TYPE" categoryLabel="Mẫu bệnh phẩm" />}
      {activePillKey === 'unit' && <ReferenceCatalogPane category="LAB_RESULT_UNIT" categoryLabel="Đơn vị kết quả" />}
      {activePillKey === 'template' && <ResultTemplatePane />}
      {activePillKey === 'partner' && partnerEnabled && <SupplierPane variant="labPartner" />}
    </ConfigScreenShell>
  );
}
