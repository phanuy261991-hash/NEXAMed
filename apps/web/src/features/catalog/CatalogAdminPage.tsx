import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';
import { GeoPane } from '../geo/GeoPane';

/**
 * Mỗi danh mục là một pill riêng (chế độ "pill phẳng" của `ConfigScreenShell`, không có `items` —
 * xem `docs/DECISIONS.md` #045, thay thế bản gộp chung 1 pill "Danh mục dùng chung" của #039/#040).
 * Không dựng pill "Sắp có" cho tính năng chưa xây (.claude/docs/ui-guidelines.md mục 10) — thêm
 * pill mới ở đây khi có module thật đứng sau. Cấu hình phòng khám ở trang riêng "Cấu hình hệ
 * thống" (`ClinicConfigPage`, docs/DECISIONS.md #040), không thuộc trang này.
 */
const PILLS: ConfigScreenPill[] = [
  { key: 'ethnicity', label: 'Dân tộc' },
  { key: 'ward', label: 'Phường/Xã' },
  { key: 'province', label: 'Tỉnh/Thành' },
  { key: 'nationality', label: 'Quốc tịch' },
  { key: 'patient-source', label: 'Nguồn khách hàng' },
  { key: 'exam-type', label: 'Loại khám' },
  // Thiết kế lại "Tiếp nhận bệnh nhân" (mockup đã duyệt) — tái dùng reference_catalog, cùng lý do PATIENT_SOURCE/EXAM_TYPE ở trên.
  { key: 'reception-type', label: 'Loại tiếp nhận' },
  { key: 'exam-form', label: 'Hình thức khám' },
  { key: 'priority-reason', label: 'Lý do ưu tiên' },
  { key: 'price-type', label: 'Loại giá dịch vụ' },
];
const FIRST_PILL = PILLS[0]!;

/**
 * Trang "Danh mục hành chính" (`/admin/catalog`, đổi tên từ "Danh mục" — `docs/DECISIONS.md`
 * #045) — mỗi danh mục (`reference_catalog`: Dân tộc/Quốc tịch/Nguồn khách hàng/Loại khám; `geo`:
 * Tỉnh/Thành, Phường/Xã — chỉ đọc, #038) là một pill riêng, không còn gộp chung "Danh mục dùng
 * chung". Dùng `ConfigScreenShell` ở chế độ pill phẳng (không cột trái) — nội dung cột phải sát
 * ngay thanh pill, không còn khoảng cột trái như `ClinicConfigPage` (vẫn dùng chế độ có `items`).
 */
export function CatalogAdminPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const activePill = PILLS.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  // Đoạn cuối breadcrumb phải đổi theo pill đang chọn — nếu không, đứng ở "Nguồn khách hàng" vẫn
  // hiện breadcrumb "Danh mục hành chính" như đứng yên, sai vị trí thực tế đang xem.
  useBreadcrumb([
    { label: 'Quản trị' },
    { label: 'Danh mục hành chính', to: '/admin/catalog' },
    { label: activePill.label },
  ]);

  return (
    <ConfigScreenShell
      pageLabel="Danh mục hành chính"
      pills={PILLS}
      activePillKey={activePillKey}
      onSelectPill={setActivePillKey}
    >
      {activePillKey === 'ethnicity' && <ReferenceCatalogPane category="ETHNICITY" categoryLabel="Dân tộc" />}
      {activePillKey === 'nationality' && <ReferenceCatalogPane category="NATIONALITY" categoryLabel="Quốc tịch" />}
      {activePillKey === 'patient-source' && <ReferenceCatalogPane category="PATIENT_SOURCE" categoryLabel="Nguồn khách hàng" />}
      {activePillKey === 'exam-type' && <ReferenceCatalogPane category="EXAM_TYPE" categoryLabel="Loại khám" />}
      {activePillKey === 'reception-type' && <ReferenceCatalogPane category="RECEPTION_TYPE" categoryLabel="Loại tiếp nhận" />}
      {activePillKey === 'exam-form' && <ReferenceCatalogPane category="EXAM_FORM" categoryLabel="Hình thức khám" />}
      {activePillKey === 'priority-reason' && <ReferenceCatalogPane category="PRIORITY_REASON" categoryLabel="Lý do ưu tiên" />}
      {activePillKey === 'price-type' && <ReferenceCatalogPane category="PRICE_TYPE" categoryLabel="Loại giá dịch vụ" />}
      {activePillKey === 'province' && <GeoPane mode="province" />}
      {activePillKey === 'ward' && <GeoPane mode="ward" />}
    </ConfigScreenShell>
  );
}
