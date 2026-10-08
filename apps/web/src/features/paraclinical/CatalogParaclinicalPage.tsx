import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';
import { LabIndicatorPane } from './LabIndicatorPane';
import { ResultTemplatePane } from './ResultTemplatePane';
import { TechnicalServicePane } from './TechnicalServicePane';

/**
 * "Danh mục cận lâm sàng" (`/admin/catalog-paraclinical`, thay `ComingSoonPage`) — Cận lâm sàng GĐ1 (docs/DECISIONS.md
 * #212). `ConfigScreenShell` chế độ pill phẳng (không `items`), đúng khuôn `CatalogClinicalPage.tsx`. Pill "Gói dịch vụ"
 * (mockup màn 4) CHƯA có vì thuộc GĐ2 — không dựng pill "Sắp có" cho tính năng chưa xây (ui-guidelines mục 10).
 */
const PILLS: ConfigScreenPill[] = [
  { key: 'service', label: 'Dịch vụ kỹ thuật' },
  { key: 'indicator', label: 'Chỉ số xét nghiệm' },
  { key: 'category', label: 'Nhóm dịch vụ' },
  { key: 'specimen', label: 'Mẫu bệnh phẩm' },
  { key: 'template', label: 'Mẫu kết quả' },
];
const FIRST_PILL = PILLS[0]!;

export function CatalogParaclinicalPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const activePill = PILLS.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Danh mục cận lâm sàng', to: '/admin/catalog-paraclinical' }, { label: activePill.label }]);

  return (
    <ConfigScreenShell pageLabel="Danh mục cận lâm sàng" pills={PILLS} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'service' && <TechnicalServicePane />}
      {activePillKey === 'indicator' && <LabIndicatorPane />}
      {activePillKey === 'category' && <ReferenceCatalogPane category="TECH_SERVICE_CATEGORY" categoryLabel="Nhóm dịch vụ" />}
      {activePillKey === 'specimen' && <ReferenceCatalogPane category="SPECIMEN_TYPE" categoryLabel="Mẫu bệnh phẩm" />}
      {activePillKey === 'template' && <ResultTemplatePane />}
    </ConfigScreenShell>
  );
}
