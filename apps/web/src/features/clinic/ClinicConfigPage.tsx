import { lazy, Suspense, useMemo, useState } from 'react';
import { Buildings, CalendarBlank, CalendarCheck, Clock, CreditCard, Database as DatabaseIcon, MapPinLine, SlidersHorizontal, Vault } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { useHasPermission } from '../auth/usePermission';
import { CashAccountPane } from '../cash-book/CashAccountPane';
import { AppointmentConfigPane } from './AppointmentConfigPane';
import { BackupConfigPane } from './BackupConfigPane';
import { useBackupConfigQuery } from './clinic.queries';
import { ClinicHoursPane } from './ClinicHoursPane';
import { ClinicInfoPane } from './ClinicInfoPane';
import { ExamConfigPane } from './ExamConfigPane';
import { GeneralConfigPane } from './GeneralConfigPane';
import { PaymentConfigPane } from './PaymentConfigPane';
import { RoomPane } from './RoomPane';
import { WorkShiftPane } from './WorkShiftPane';

/** Lazy — riêng pill này có thêm form phân tích cú pháp khuôn mẫu (`@nexamed/shared`), tránh đẩy
 * thêm code vào chunk khởi động cho một màn hình hiếm khi mở (`.claude/docs/coding-standards.md`
 * mục "Hiệu suất"). */
const BusinessCodeTemplatePane = lazy(() =>
  import('./BusinessCodeTemplatePane').then((m) => ({ default: m.BusinessCodeTemplatePane })),
);

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
 * "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, 2026-09-03, chủ dự án yêu cầu trực tiếp) —
 * pill phẳng mới, danh sách 7 loại mã nghiệp vụ + khuôn mẫu tự cấu hình được, lazy (form phân tích
 * cú pháp khuôn mẫu hiếm khi dùng tới, không đẩy vào chunk khởi động).
 */
const BASE_PILLS: ConfigScreenPill[] = [
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
  {
    key: 'payment',
    label: 'Cấu hình thanh toán',
    items: [
      { key: 'config', label: 'Cấu hình', icon: CreditCard },
      { key: 'cash-accounts', label: 'Quỹ', icon: Vault },
    ],
  },
  { key: 'exam', label: 'Cấu hình khám' },
  { key: 'code-templates', label: 'Cấu hình mẫu mã phát sinh' },
];
const FIRST_PILL = BASE_PILLS[0]!;

/** Pill "Sao lưu dữ liệu" (docs/DECISIONS.md #217) — dựng động: chỉ thêm vào khi actor có quyền xem VÀ máy có container sao lưu. */
const BACKUP_PILL: ConfigScreenPill = { key: 'backup', label: 'Sao lưu dữ liệu' };

/**
 * Trang "Cấu hình hệ thống" (`/admin/system-config`) — mục sidebar riêng trong nhóm "Quản trị",
 * tách khỏi trang "Danh mục" theo yêu cầu chủ dự án (docs/DECISIONS.md #040). Dùng chung khung
 * `ConfigScreenShell` với `CatalogAdminPage` — cùng 1 kiểu hiển thị cho mọi trang cấu hình
 * (pill bar + danh sách trái + nội dung phải), dù hiện chỉ có 1 pill/1 mục — không tự ẩn chrome
 * khi ít lựa chọn (đã hỏi và chốt, tránh 2 trang cấu hình trông khác nhau).
 */
export function ClinicConfigPage() {
  // Vai trò chỉ có quyền sao lưu (`system_admin`) không có `clinic_config.update` → chỉ thấy pill "Sao lưu dữ liệu", các pill cấu hình phòng khám bị ẩn.
  const canConfigureClinic = useHasPermission('clinic_config', 'update');
  const [activePillKey, setActivePillKey] = useState(canConfigureClinic ? FIRST_PILL.key : BACKUP_PILL.key);
  const [activeItemKey, setActiveItemKey] = useState(canConfigureClinic ? FIRST_PILL.items![0]!.key : '');

  // Máy dev/cloud không có container sao lưu (`available=false`) → ẩn hẳn pill, không gọi API khi thiếu quyền (tránh 403).
  const canReadBackup = useHasPermission('system_backup', 'read');
  const backupConfigQuery = useBackupConfigQuery(canReadBackup);
  const showBackupPill = canReadBackup && backupConfigQuery.data?.available === true;
  const PILLS = useMemo(
    () => [...(canConfigureClinic ? BASE_PILLS : []), ...(showBackupPill ? [BACKUP_PILL] : [])],
    [canConfigureClinic, showBackupPill],
  );

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

  // Chưa có pill nào để hiện (chỉ xảy ra với vai trò không có `clinic_config.update`): đang tải thì khung xương, tải xong mà máy không có dịch vụ sao lưu thì báo rõ.
  if (PILLS.length === 0) {
    if (backupConfigQuery.isPending) return <Skeleton className="m-6 h-40" />;
    if (backupConfigQuery.isError) return <ErrorBanner message="Không tải được cấu hình sao lưu." onRetry={() => void backupConfigQuery.refetch()} />;
    return (
      <div className="p-6">
        <h1 className="sr-only">Cấu hình hệ thống</h1>
        <EmptyState icon={DatabaseIcon} title="Chưa có cấu hình nào để hiển thị" description="Máy chủ này không chạy dịch vụ sao lưu tự động (bản cài tại chỗ mới có), và tài khoản của bạn không có quyền cấu hình phòng khám." />
      </div>
    );
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
      {activePillKey === 'payment' && activeItemKey === 'config' && <PaymentConfigPane />}
      {activePillKey === 'payment' && activeItemKey === 'cash-accounts' && <CashAccountPane />}
      {activePillKey === 'exam' && <ExamConfigPane />}
      {activePillKey === 'backup' && showBackupPill && <BackupConfigPane />}
      {activePillKey === 'code-templates' && (
        <Suspense fallback={null}>
          <BusinessCodeTemplatePane />
        </Suspense>
      )}
    </ConfigScreenShell>
  );
}
