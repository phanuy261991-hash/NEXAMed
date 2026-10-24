import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { AdviceTemplatePane } from '../advice-template/AdviceTemplatePane';
import { AllergenPane } from '../allergen/AllergenPane';
import { useFilterByPermission } from '../auth/usePermission';
import { PermissionDeniedPage } from '../../shared/ui/PermissionDeniedPage';
import { Icd10Pane } from './Icd10Pane';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';

/**
 * "Danh mục Chuyên môn" (`/admin/catalog-clinical`, thay `ComingSoonPage`) — S3-01, mở khoá một
 * phần. Pill "ICD-10"/"Dị nguyên" (docs/DECISIONS.md #069) — chừa chỗ mở rộng danh mục chuyên môn
 * khác sau (không dựng pill "Sắp có" cho tính năng chưa xây, đúng .claude/docs/ui-guidelines.md
 * mục 10). Pill "Dịch vụ khám" (category `EXAM_TYPE`) chuyển từ "Danh mục hành chính" sang đây,
 * đổi nhãn từ "Loại khám" — thuộc chuyên môn (giá dịch vụ khám), không phải hành chính. Pill "Từ viết
 * tắt chẩn đoán" (category `ICD10_ABBREVIATION`, docs/DECISIONS.md #206) — từ điển viết tắt cho "Gợi ý mã
 * ICD-10", đặt cạnh ICD-10 (cùng chủ đề lâm sàng). Dùng `ConfigScreenShell` chế độ pill phẳng (không
 * `items`), đúng khuôn `CatalogAdminPage.tsx`. Pill "Mẫu lời dặn" (docs/DECISIONS.md #222) — mẫu lời dặn bác sĩ dùng ở màn khám, chỉ hiện với người có `advice_template.read`.
 */
// `permission` = quyền của API mỗi pill gọi (phải khớp `CLINICAL_CATALOG_PILL_PERMISSIONS` ở `auth/admin-permissions.ts`, dùng chung cho route/menu): chỉ hiện pill dùng được.
const PILLS: ConfigScreenPill[] = [
  { key: 'icd10', label: 'ICD-10', permission: ['patient', 'read'] },
  { key: 'icd10-abbreviation', label: 'Từ viết tắt chẩn đoán', permission: ['reference_catalog', 'read'] },
  { key: 'allergen', label: 'Dị nguyên', permission: ['allergen_catalog', 'read'] },
  { key: 'exam-type', label: 'Dịch vụ khám', permission: ['reference_catalog', 'read'] },
  { key: 'advice-template', label: 'Mẫu lời dặn', permission: ['advice_template', 'read'] },
];

export function CatalogClinicalPage() {
  const pills = useFilterByPermission(PILLS);
  const [selectedPillKey, setActivePillKey] = useState<string | null>(null);
  const activePill = pills.find((p) => p.key === selectedPillKey) ?? pills[0];
  const activePillKey = activePill?.key ?? '';

  useBreadcrumb([
    { label: 'Quản trị' },
    { label: 'Danh mục Chuyên môn', to: '/admin/catalog-clinical' },
    { label: activePill?.label ?? 'Không có quyền truy cập' },
  ]);

  if (!activePill) return <PermissionDeniedPage />;

  return (
    <ConfigScreenShell pageLabel="Danh mục Chuyên môn" pills={pills} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'icd10' && <Icd10Pane />}
      {activePillKey === 'icd10-abbreviation' && <ReferenceCatalogPane category="ICD10_ABBREVIATION" categoryLabel="Từ viết tắt chẩn đoán" />}
      {activePillKey === 'allergen' && <AllergenPane />}
      {activePillKey === 'exam-type' && <ReferenceCatalogPane category="EXAM_TYPE" categoryLabel="Dịch vụ khám" />}
      {activePillKey === 'advice-template' && <AdviceTemplatePane />}
    </ConfigScreenShell>
  );
}