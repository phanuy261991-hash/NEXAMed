import { useState } from 'react';
import { ClipboardText, Globe, MapPinLine, MapTrifold, Users, UsersThree } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';
import { GeoPane } from '../geo/GeoPane';

/**
 * 1 nhóm THẬT đã có backend — không dựng pill/mục "Sắp có" cho tính năng chưa xây
 * (.claude/docs/ui-guidelines.md mục 10). Thêm nhóm mới ở đây khi có module thật đứng sau, không
 * phải khi có ý tưởng. "Danh mục dùng chung" gộp cả `reference_catalog` (Dân tộc/Quốc tịch/Nguồn
 * khách hàng/Loại khám, quản lý được) lẫn `geo` (Tỉnh/Thành, Phường/Xã, chỉ đọc — #038) chung 1
 * pill — cùng bản chất "danh mục tra cứu". "Nguồn khách hàng"/"Loại khám" phục vụ trang "Tiếp
 * nhận bệnh nhân" (Sprint 3). Cấu hình phòng khám đã tách sang trang riêng "Cấu hình hệ thống"
 * (`ClinicConfigPage`, docs/DECISIONS.md #040), không còn ở đây.
 */
const PILLS: ConfigScreenPill[] = [
  {
    key: 'catalog',
    label: 'Danh mục dùng chung',
    items: [
      { key: 'ethnicity', label: 'Dân tộc', icon: Users },
      { key: 'ward', label: 'Phường/Xã', icon: MapPinLine },
      { key: 'province', label: 'Tỉnh/Thành', icon: MapTrifold },
      { key: 'nationality', label: 'Quốc tịch', icon: Globe },
      { key: 'patient-source', label: 'Nguồn khách hàng', icon: UsersThree },
      { key: 'exam-type', label: 'Loại khám', icon: ClipboardText },
    ],
  },
];
const FIRST_PILL = PILLS[0]!;

/**
 * Trang "Danh mục" (`/admin/catalog`) — gộp `reference_catalog` (Dân tộc/Quốc tịch) và `geo`
 * (Tỉnh/Thành, Phường/Xã — chỉ đọc, docs/DECISIONS.md #038) chung 1 pill "Danh mục dùng chung",
 * dùng khung dùng chung `ConfigScreenShell` (.claude/docs/ui-guidelines.md mục 10,
 * docs/DECISIONS.md #039/#040) — cùng khuôn với `ClinicConfigPage`, đảm bảo 2 trang cấu hình
 * trông thống nhất. Đây KHÔNG phải khuôn mặc định cho mọi trang Quản trị — chỉ áp dụng cho trang
 * này theo yêu cầu cụ thể, việc tạo menu mới sau này do chủ dự án quyết định.
 */
export function CatalogAdminPage() {
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Danh mục' }]);

  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const [activeItemKey, setActiveItemKey] = useState(FIRST_PILL.items[0]!.key);

  function selectPill(pillKey: string) {
    const pill = PILLS.find((p) => p.key === pillKey);
    if (!pill) return;
    setActivePillKey(pillKey);
    setActiveItemKey(pill.items[0]!.key);
  }

  return (
    <ConfigScreenShell
      pageLabel="Danh mục"
      pills={PILLS}
      activePillKey={activePillKey}
      activeItemKey={activeItemKey}
      onSelectPill={selectPill}
      onSelectItem={setActiveItemKey}
    >
      {activeItemKey === 'ethnicity' && <ReferenceCatalogPane category="ETHNICITY" categoryLabel="Dân tộc" />}
      {activeItemKey === 'nationality' && <ReferenceCatalogPane category="NATIONALITY" categoryLabel="Quốc tịch" />}
      {activeItemKey === 'patient-source' && <ReferenceCatalogPane category="PATIENT_SOURCE" categoryLabel="Nguồn khách hàng" />}
      {activeItemKey === 'exam-type' && <ReferenceCatalogPane category="EXAM_TYPE" categoryLabel="Loại khám" />}
      {activeItemKey === 'province' && <GeoPane mode="province" />}
      {activeItemKey === 'ward' && <GeoPane mode="ward" />}
    </ConfigScreenShell>
  );
}
