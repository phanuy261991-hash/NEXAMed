import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { AdviceTemplatePane } from '../advice-template/AdviceTemplatePane';
import { AllergenPane } from '../allergen/AllergenPane';
import { useHasPermission } from '../auth/usePermission';
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
const PILLS: ConfigScreenPill[] = [
  { key: 'icd10', label: 'ICD-10' },
  { key: 'icd10-abbreviation', label: 'Từ viết tắt chẩn đoán' },
  { key: 'allergen', label: 'Dị nguyên' },
  { key: 'exam-type', label: 'Dịch vụ khám' },
];
const ADVICE_TEMPLATE_PILL: ConfigScreenPill = { key: 'advice-template', label: 'Mẫu lời dặn' };
const FIRST_PILL = PILLS[0]!;

export function CatalogClinicalPage() {
  const canSeeAdviceTemplates = useHasPermission('advice_template', 'read');
  const pills = canSeeAdviceTemplates ? [...PILLS, ADVICE_TEMPLATE_PILL] : PILLS;
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const activePill = pills.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  useBreadcrumb([
    { label: 'Quản trị' },
    { label: 'Danh mục Chuyên môn', to: '/admin/catalog-clinical' },
    { label: activePill.label },
  ]);

  return (
    <ConfigScreenShell pageLabel="Danh mục Chuyên môn" pills={pills} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'icd10' && <Icd10Pane />}
      {activePillKey === 'icd10-abbreviation' && <ReferenceCatalogPane category="ICD10_ABBREVIATION" categoryLabel="Từ viết tắt chẩn đoán" />}
      {activePillKey === 'allergen' && <AllergenPane />}
      {activePillKey === 'exam-type' && <ReferenceCatalogPane category="EXAM_TYPE" categoryLabel="Dịch vụ khám" />}
      {activePillKey === 'advice-template' && canSeeAdviceTemplates && <AdviceTemplatePane />}
    </ConfigScreenShell>
  );
}