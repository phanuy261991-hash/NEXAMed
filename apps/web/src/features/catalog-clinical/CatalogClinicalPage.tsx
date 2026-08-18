import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { Icd10Pane } from './Icd10Pane';

/**
 * "Danh mục Chuyên môn" (`/admin/catalog-clinical`, thay `ComingSoonPage`) — S3-01, mở khoá một
 * phần. Chỉ 1 pill "ICD-10" hiện tại — chừa chỗ mở rộng danh mục chuyên môn khác sau (không dựng
 * pill "Sắp có" cho tính năng chưa xây, đúng .claude/docs/ui-guidelines.md mục 10). Dùng
 * `ConfigScreenShell` chế độ pill phẳng (không `items`), đúng khuôn `CatalogAdminPage.tsx`.
 */
const PILLS: ConfigScreenPill[] = [{ key: 'icd10', label: 'ICD-10' }];
const FIRST_PILL = PILLS[0]!;

export function CatalogClinicalPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const activePill = PILLS.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  useBreadcrumb([
    { label: 'Quản trị' },
    { label: 'Danh mục Chuyên môn', to: '/admin/catalog-clinical' },
    { label: activePill.label },
  ]);

  return (
    <ConfigScreenShell pageLabel="Danh mục Chuyên môn" pills={PILLS} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'icd10' && <Icd10Pane />}
    </ConfigScreenShell>
  );
}