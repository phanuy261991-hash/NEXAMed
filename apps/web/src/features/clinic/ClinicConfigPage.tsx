import { useState } from 'react';
import { Buildings, Clock } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { ClinicHoursPane } from './ClinicHoursPane';
import { ClinicInfoPane } from './ClinicInfoPane';

/**
 * 1 pill, 2 mục — "Thông tin phòng khám" (2026-08-13, mặc định mở đầu tiên) đặt TRƯỚC "Giờ làm
 * việc & Slot" theo yêu cầu chủ dự án. Không dựng thêm pill/mục "Sắp có"
 * (.claude/docs/ui-guidelines.md mục 10), thêm khi có module thật đứng sau.
 */
const PILLS: ConfigScreenPill[] = [
  {
    key: 'clinic',
    label: 'Cấu hình phòng khám',
    items: [
      { key: 'info', label: 'Thông tin phòng khám', icon: Buildings },
      { key: 'hours', label: 'Giờ làm việc & Slot', icon: Clock },
    ],
  },
];
const FIRST_PILL = PILLS[0]!;

/**
 * Trang "Cấu hình hệ thống" (`/admin/system-config`) — mục sidebar riêng trong nhóm "Quản trị",
 * tách khỏi trang "Danh mục" theo yêu cầu chủ dự án (docs/DECISIONS.md #040). Dùng chung khung
 * `ConfigScreenShell` với `CatalogAdminPage` — cùng 1 kiểu hiển thị cho mọi trang cấu hình
 * (pill bar + danh sách trái + nội dung phải), dù hiện chỉ có 1 pill/1 mục — không tự ẩn chrome
 * khi ít lựa chọn (đã hỏi và chốt, tránh 2 trang cấu hình trông khác nhau).
 */
export function ClinicConfigPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const [activeItemKey, setActiveItemKey] = useState(FIRST_PILL.items![0]!.key);

  const activeItemLabel =
    PILLS.find((p) => p.key === activePillKey)?.items?.find((i) => i.key === activeItemKey)?.label ??
    'Cấu hình hệ thống';

  // Đoạn cuối breadcrumb phải đổi theo mục đang chọn ở cột trái — cùng lỗi đã sửa ở
  // `CatalogAdminPage` (docs/DECISIONS.md #045): breadcrumb tĩnh không phản ánh đúng vị trí thật
  // đang xem khi đổi mục (ví dụ đứng ở "Giờ làm việc & Slot" vẫn hiện "Cấu hình hệ thống").
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Cấu hình hệ thống', to: '/admin/system-config' }, { label: activeItemLabel }]);

  function selectPill(pillKey: string) {
    const pill = PILLS.find((p) => p.key === pillKey);
    if (!pill) return;
    setActivePillKey(pillKey);
    setActiveItemKey(pill.items![0]!.key);
  }

  return (
    <ConfigScreenShell
      pageLabel="Cấu hình hệ thống"
      pills={PILLS}
      activePillKey={activePillKey}
      activeItemKey={activeItemKey}
      onSelectPill={selectPill}
      onSelectItem={setActiveItemKey}
    >
      {activeItemKey === 'info' && <ClinicInfoPane />}
      {activeItemKey === 'hours' && <ClinicHoursPane />}
    </ConfigScreenShell>
  );
}
