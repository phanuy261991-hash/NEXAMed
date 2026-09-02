import { useState } from 'react';
import { Buildings, CalendarBlank, CalendarCheck, Clock, MapPinLine, SlidersHorizontal } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { AppointmentConfigPane } from './AppointmentConfigPane';
import { ClinicHoursPane } from './ClinicHoursPane';
import { ClinicInfoPane } from './ClinicInfoPane';
import { ExamConfigPane } from './ExamConfigPane';
import { GeneralConfigPane } from './GeneralConfigPane';
import { PaymentConfigPane } from './PaymentConfigPane';
import { RoomPane } from './RoomPane';
import { WorkShiftPane } from './WorkShiftPane';

/**
 * Pill "Cấu hình phòng khám" (4 mục con) — "Thông tin phòng khám" (2026-08-13, mặc định mở đầu
 * tiên) đặt TRƯỚC "Giờ làm việc" theo yêu cầu chủ dự án. "Phòng khám" (docs/DECISIONS.md
 * #054) — CRUD `room` chưa từng có UI web trước đây (chỉ backend từ S2-07), thêm ở đây để bật được
 * luồng "phòng làm việc hôm nay". "Lịch hẹn" (S5-07, APP-05, 2026-08-29, chủ dự án yêu cầu trực
 * tiếp) — bật/tắt tự động đánh dấu "Không đến" + ngưỡng thời gian. Pill "Cấu hình thanh toán" (Thu
 * ngân cơ bản, Sprint 5/6, chủ dự án yêu cầu trực tiếp) và "Cấu hình khám" (ngưỡng cảnh báo "chờ
 * lâu" ở Hàng đợi khám, 2026-08-28, chủ dự án yêu cầu trực tiếp) — cả hai KHÔNG khai `items` (chế
 * độ "pill phẳng", mục 10 điểm 8 — bản thân pill đã là 1 màn hình lá, chỉ có đúng 1 cấu hình).
 * Không dựng thêm pill/mục "Sắp có" (.claude/docs/ui-guidelines.md mục 10), thêm khi có module
 * thật đứng sau.
 * "Ca làm việc" (docs/DECISIONS.md #101, chủ dự án yêu cầu trực tiếp) — danh mục mẫu ca RIÊNG theo
 * tenant (bảng `work_shift`, KHÔNG dùng chung `reference_catalog`), thêm/sửa/xoá qua UI.
 * "Cấu hình chung" (02/09/2026, tiếp sau #104) — bật/tắt cho phép nhân viên tự đăng ký ca, đặt
 * dưới "Ca làm việc".
 */
const PILLS: ConfigScreenPill[] = [
  {
    key: 'clinic',
    label: 'Cấu hình phòng khám',
    items: [
      { key: 'info', label: 'Thông tin phòng khám', icon: Buildings },
      { key: 'hours', label: 'Giờ làm việc', icon: Clock },
      { key: 'rooms', label: 'Tầng phòng', icon: MapPinLine },
      { key: 'appointments', label: 'Lịch hẹn', icon: CalendarBlank },
      { key: 'shifts', label: 'Ca làm việc', icon: CalendarCheck },
      { key: 'general', label: 'Cấu hình chung', icon: SlidersHorizontal },
    ],
  },
  { key: 'payment', label: 'Cấu hình thanh toán' },
  { key: 'exam', label: 'Cấu hình khám' },
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

  const activePill = PILLS.find((p) => p.key === activePillKey);
  // Pill phẳng (không `items`, ví dụ "Cấu hình thanh toán") thì đoạn cuối lấy đúng nhãn của pill.
  const activeItemLabel = activePill?.items
    ? (activePill.items.find((i) => i.key === activeItemKey)?.label ?? activePill.label)
    : (activePill?.label ?? 'Cấu hình hệ thống');

  // Đoạn cuối breadcrumb phải đổi theo mục đang chọn ở cột trái — cùng lỗi đã sửa ở
  // `CatalogAdminPage` (docs/DECISIONS.md #045): breadcrumb tĩnh không phản ánh đúng vị trí thật
  // đang xem khi đổi mục (ví dụ đứng ở "Giờ làm việc" vẫn hiện "Cấu hình hệ thống").
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Cấu hình hệ thống', to: '/admin/system-config' }, { label: activeItemLabel }]);

  function selectPill(pillKey: string) {
    const pill = PILLS.find((p) => p.key === pillKey);
    if (!pill) return;
    setActivePillKey(pillKey);
    setActiveItemKey(pill.items?.[0]?.key ?? '');
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
      {activePillKey === 'clinic' && activeItemKey === 'info' && <ClinicInfoPane />}
      {activePillKey === 'clinic' && activeItemKey === 'hours' && <ClinicHoursPane />}
      {activePillKey === 'clinic' && activeItemKey === 'rooms' && <RoomPane />}
      {activePillKey === 'clinic' && activeItemKey === 'appointments' && <AppointmentConfigPane />}
      {activePillKey === 'clinic' && activeItemKey === 'shifts' && <WorkShiftPane />}
      {activePillKey === 'clinic' && activeItemKey === 'general' && <GeneralConfigPane />}
      {activePillKey === 'payment' && <PaymentConfigPane />}
      {activePillKey === 'exam' && <ExamConfigPane />}
    </ConfigScreenShell>
  );
}
