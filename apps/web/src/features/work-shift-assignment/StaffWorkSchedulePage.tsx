import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, CheckSquare, DownloadSimple, Lock, MagnifyingGlass, Plus, UploadSimple, WarningCircle, X as XIcon } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useUserAccountsQuery } from '../user-account/user-account.queries';
import { useDepartmentsQuery } from '../department/department.queries';
import { useWorkShiftsQuery } from '../clinic/clinic.queries';
import { WORK_SHIFT_COLOR_HEX } from '../clinic/WorkShiftFormModal';
import { ImportExcelDialog } from './ImportExcelDialog';
import { WorkShiftPickerModal } from './WorkShiftPickerModal';
import { exportWorkShiftAssignments } from './work-shift-assignment.api';
import {
  useBulkCreateWorkShiftAssignmentsMutation,
  useCreateWorkShiftAssignmentMutation,
  useDeleteWorkShiftAssignmentMutation,
  useWorkShiftAssignmentMonthLockStatusQuery,
  useWorkShiftAssignmentsQuery,
} from './work-shift-assignment.queries';

function toDateOnlyUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
function fromDateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function getTodayDateString(): string {
  const now = new Date();
  return fromDateOnlyUtc(new Date(now.getTime() + 7 * 60 * 60_000));
}
function formatDDMM(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}
function addMonths(monthStr: string, delta: number): string {
  const [year, month] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  return `Tháng ${Number(month)}/${year}`;
}
/** Số ngày của tháng — mẹo "ngày 0 của tháng kế tiếp", cùng kỹ thuật `MyWorkSchedulePage.tsx`. */
function getDaysInMonth(monthStr: string): string[] {
  const [year, month] = monthStr.split('-').map(Number);
  const count = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${monthStr}-${String(i + 1).padStart(2, '0')}`);
}
const WEEKDAY_FULL_LABELS = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'];
/** 0=CN..6=T7 (UTC) → chỉ số trong `WEEKDAY_FULL_LABELS` (0=Thứ hai). */
function weekdayLabelIndex(dateStr: string): number {
  const utcDay = toDateOnlyUtc(dateStr).getUTCDay();
  return utcDay === 0 ? 6 : utcDay - 1;
}

const NAME_COL_WIDTH = 192;
const VISIBLE_DAY_COLUMNS = 7;
const MIN_DAY_COL_WIDTH = 132;

/**
 * "Lịch làm việc nhân viên" (Giai đoạn 2 của #101) — chỉ clinic_admin (scope global) truy cập,
 * xem/tạo/xoá TOÀN BỘ nhân viên, không giới hạn thời gian (khác "Lịch làm việc của tôi"). Mọi ô
 * (kể cả đã có ca) sửa/xoá được ngay — không khoá.
 *
 * Lưới hiện NGUYÊN 1 THÁNG liên mạch (cột tên nhân viên cố định bên trái qua `position: sticky`,
 * mỗi lần chỉ thấy đúng 7 cột ngày — cùng mật độ/kích thước thẻ ca như trước) — cuộn ngang để xem
 * các tuần tiếp theo, khớp SNAP đúng ranh giới tuần (`scroll-snap-type`, không dừng giữa chừng).
 * Độ rộng mỗi cột ngày đo bằng `ResizeObserver` để luôn vừa đúng 7 cột trong khung nhìn hiện có,
 * responsive theo màn hình thay vì hardcode 1 con số.
 */
export function StaffWorkSchedulePage() {
  useBreadcrumb([{ label: 'Lịch làm việc' }, { label: 'Lịch làm việc nhân viên' }]);

  const today = getTodayDateString();
  const [monthAnchor, setMonthAnchor] = useState(() => today.slice(0, 7));
  const days = getDaysInMonth(monthAnchor);

  /** `dates.length === 1` → tạo đơn (`createMutation`); nhiều ngày → bulk-apply (`bulkMutation`). */
  const [picker, setPicker] = useState<{ userId: string; dates: string[] } | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** "Chọn nhiều ngày" theo TỪNG DÒNG nhân viên — chỉ 1 dòng active cùng lúc, tránh áp nhầm ca cho
   * người khác (chốt qua AskUserQuestion 2026-09-03). Đổi dòng active thì tự xoá lựa chọn cũ. */
  const [bulkUserId, setBulkUserId] = useState<string | null>(null);
  const selection = useRowSelection(days);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [dayColWidth, setDayColWidth] = useState(MIN_DAY_COL_WIDTH);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const width = Math.floor((el.clientWidth - NAME_COL_WIDTH) / VISIBLE_DAY_COLUMNS);
      setDayColWidth(Math.max(MIN_DAY_COL_WIDTH, width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // "Khoá bảng ca" theo tháng (2026-09-03) — trang này chỉ có 1 view Tháng, gọi đúng 1 tháng.
  // `monthLockedAbsolute` là trạng thái THẬT của tháng (không tính quyền); `unlockedForEditing` là
  // lựa chọn CHỦ ĐỘNG của người xem (chỉ có tác dụng nếu họ có quyền `canBypassLock`) — mặc định
  // LUÔN hiện giao diện khoá (ẩn nút) dù có quyền mở khoá hay không, phải bấm "Sửa" mới lộ nút thao
  // tác (chốt qua phản hồi trực tiếp chủ dự án, 2026-09-03: không tự động mở khoá chỉ vì có quyền).
  const lockStatusQuery = useWorkShiftAssignmentMonthLockStatusQuery(monthAnchor);
  const canBypassLock = lockStatusQuery.data?.canBypass ?? false;
  const monthLockedAbsolute = lockStatusQuery.data?.locked ?? false;
  const [unlockedForEditing, setUnlockedForEditing] = useState(false);
  useEffect(() => setUnlockedForEditing(false), [monthAnchor]);
  const monthLocked = monthLockedAbsolute && !unlockedForEditing;
  const [lockErrorToast, setLockErrorToast] = useState<string | null>(null);
  function showLockErrorIfApplicable(err: unknown) {
    if (err instanceof ApiError && err.code === 'WORK_SHIFT_ASSIGNMENT_MONTH_LOCKED') {
      setLockErrorToast(err.message);
      setTimeout(() => setLockErrorToast(null), 5000);
    }
  }

  const usersQuery = useUserAccountsQuery();
  // Trang này quản lý lịch làm việc của TOÀN BỘ nhân viên (mọi bộ phận, không riêng Khoa chuyên
  // môn) — dùng GET /departments (đầy đủ, yêu cầu user_account.read) thay vì GET /departments/
  // options (chỉ Khoa participatesInQueue=true, phục vụ điều phối hàng đợi khám #064/#105) để
  // không ẩn mất các bộ phận hành chính (ví dụ "Bộ phận Lễ Tân") khỏi bộ lọc. An toàn vì trang này
  // đã giới hạn chỉ clinic_admin (Sidebar.tsx STAFF_SCHEDULE_ROLES), vốn luôn có user_account.read.
  const departmentsQuery = useDepartmentsQuery();
  const shiftsQuery = useWorkShiftsQuery();
  const listQuery = useWorkShiftAssignmentsQuery(days[0]!, days[days.length - 1]!);
  const createMutation = useCreateWorkShiftAssignmentMutation();
  const bulkMutation = useBulkCreateWorkShiftAssignmentsMutation();
  const deleteMutation = useDeleteWorkShiftAssignmentMutation();

  const departments = (departmentsQuery.data?.items ?? []).filter((d) => d.isActive);
  const trimmedSearch = search.trim().toLowerCase();
  const staff = (usersQuery.data?.items ?? [])
    .filter((u) => !u.roleNames.includes('system_admin'))
    .filter((u) => !departmentFilter || u.departmentId === departmentFilter)
    .filter((u) => !trimmedSearch || (u.displayName ?? u.fullName).toLowerCase().includes(trimmedSearch))
    // Chỉ hiện nhân viên đã TỒN TẠI tại tháng đang xem (2026-09-03, chủ dự án phát hiện lúc dùng
    // thử) — tránh 2 lỗi ngược chiều nhau: (1) hiện tên nhân viên mới tạo ở tháng TRƯỚC ngày họ
    // được tạo; (2) MẤT hẳn nhân viên đã nghỉ việc khỏi tháng họ CÒN làm (lọc cứng `isActive` trước
    // đây xoá luôn lịch sử). Nhân viên đang hoạt động: hiện từ `createdAt` trở đi. Nhân viên đã
    // nghỉ (`isActive=false`): CHỈ hiện tới hết tháng nghỉ (xấp xỉ bằng `updatedAt` — lần sửa gần
    // nhất, đủ dùng cho mục đích hiển thị lịch), tháng sau đó ẩn hẳn. So sánh chuỗi YYYY-MM là đủ.
    .filter((u) => {
      const monthCreated = u.createdAt.slice(0, 7);
      if (monthCreated > monthAnchor) return false;
      if (!u.isActive && u.updatedAt.slice(0, 7) < monthAnchor) return false;
      return true;
    });
  const workShifts = shiftsQuery.data?.items ?? [];
  const items = listQuery.data?.items ?? [];
  const itemsByUserDay = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${item.userId}|${item.workDate}`;
    const list = itemsByUserDay.get(key) ?? [];
    list.push(item);
    itemsByUserDay.set(key, list);
  }

  const loading = usersQuery.isPending || shiftsQuery.isPending || listQuery.isPending;
  const error = usersQuery.error ?? shiftsQuery.error ?? listQuery.error;

  async function handlePickerSave(shiftIds: string[]) {
    if (!picker) return;
    try {
      if (picker.dates.length === 1) {
        for (const workShiftId of shiftIds) {
          await createMutation.mutateAsync({ workShiftId, workDate: picker.dates[0]!, userId: picker.userId });
        }
      } else {
        for (const workShiftId of shiftIds) {
          await bulkMutation.mutateAsync({ workShiftId, workDates: picker.dates, userId: picker.userId });
        }
      }
    } catch (err) {
      showLockErrorIfApplicable(err);
      return;
    }
    setPicker(null);
    selection.clear();
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportWorkShiftAssignments(monthAnchor);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">Lịch làm việc nhân viên</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-700"
        >
          <option value="">Tất cả Khoa</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="relative">
          <MagnifyingGlass size={14} weight="bold" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm nhân viên..."
            className="min-w-[200px] rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-[13px] font-medium text-slate-900 placeholder:text-slate-400"
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
            aria-label="Tháng trước"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <span className="min-w-[128px] rounded-md border border-slate-300 px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900">
            {formatMonthLabel(monthAnchor)}
          </span>
          <button
            type="button"
            onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
            aria-label="Tháng sau"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretRight size={15} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => setMonthAnchor(today.slice(0, 7))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Tháng này
          </button>
          <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden="true" />
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void handleExport()} loading={exporting}>
            <DownloadSimple size={14} weight="bold" aria-hidden="true" />
            Xuất Excel
          </Button>
          {/* Nhập Excel là thao tác GHI theo tháng — ẩn khi tháng đang xem đã khoá (Xuất Excel/Tải
              mẫu chỉ đọc, không bị ảnh hưởng). */}
          {!monthLocked && (
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setImportOpen(true)}>
              <UploadSimple size={14} weight="bold" aria-hidden="true" />
              Nhập Excel
            </Button>
          )}
        </div>
      </div>

      {/* "Khoá bảng ca" theo tháng — nền ĐẶC (không nhạt, đúng #106) để gây chú ý. 3 biến thể: (1)
          khoá + KHÔNG có quyền mở → chỉ báo, không có nút; (2) khoá + có quyền nhưng CHƯA bấm "Sửa"
          → cùng cảnh báo, thêm nút "Sửa"; (3) đã bấm "Sửa" (unlockedForEditing) → dải nhắc đang ở
          chế độ sửa tạm thời + nút "Khoá lại". Mặc định LUÔN ở trạng thái (1)/(2) — có quyền không
          tự động mở khoá (chốt qua phản hồi trực tiếp chủ dự án). */}
      {monthLocked && (
        <div className="flex flex-shrink-0 items-center gap-2.5 rounded-md bg-amber-500 px-3.5 py-2.5 text-white shadow-sm">
          <WarningCircle size={18} weight="fill" className="flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 text-[13px] font-semibold">
            Lịch làm việc {formatMonthLabel(monthAnchor)} đã khoá (đã qua ngày chốt bảng ca)
            {!canBypassLock && ' — liên hệ người có quyền "Sửa lịch đã khoá" để mở khoá.'}
          </span>
          {canBypassLock && (
            <Button
              type="button"
              variant="secondary"
              className="px-3.5 py-1.5 text-xs font-bold transition-colors active:bg-amber-100 active:text-amber-800"
              onClick={() => setUnlockedForEditing(true)}
            >
              Sửa
            </Button>
          )}
        </div>
      )}
      {monthLockedAbsolute && !monthLocked && (
        <div className="flex flex-shrink-0 items-center gap-2.5 rounded-md bg-slate-700 px-3.5 py-2.5 text-white shadow-sm">
          <Lock size={16} weight="bold" className="flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 text-[13px] font-semibold">
            Đang chỉnh sửa lịch {formatMonthLabel(monthAnchor)} dù đã khoá — mọi thay đổi vẫn được ghi nhận.
          </span>
          <Button
            type="button"
            variant="secondary"
            className="px-3.5 py-1.5 text-xs font-bold transition-colors active:bg-slate-200 active:text-slate-900"
            onClick={() => setUnlockedForEditing(false)}
          >
            Khoá lại
          </Button>
        </div>
      )}
      {lockErrorToast && (
        <div className="flex flex-shrink-0 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {lockErrorToast}
        </div>
      )}

      {!loading && !error && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-1">
          {workShifts.length > 0 && (
            <>
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Chú thích ca:</span>
              {workShifts.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold text-white shadow-sm"
                  style={{ background: WORK_SHIFT_COLOR_HEX[s.color] }}
                >
                  {s.name}
                  <span className="font-semibold opacity-85">
                    {s.startTime}–{s.endTime}
                  </span>
                </span>
              ))}
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-400">Cuộn tuần</span>
            <button
              type="button"
              aria-label="Cuộn 1 tuần trước"
              onClick={() => scrollRef.current?.scrollBy({ left: -dayColWidth * VISIBLE_DAY_COLUMNS, behavior: 'smooth' })}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <CaretLeft size={15} weight="bold" />
            </button>
            <button
              type="button"
              aria-label="Cuộn 1 tuần sau"
              onClick={() => scrollRef.current?.scrollBy({ left: dayColWidth * VISIBLE_DAY_COLUMNS, behavior: 'smooth' })}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <CaretRight size={15} weight="bold" />
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <ErrorBanner
          message={error instanceof ApiError ? error.message : 'Không tải được lịch làm việc nhân viên.'}
          onRetry={() => {
            void usersQuery.refetch();
            void shiftsQuery.refetch();
            void listQuery.refetch();
          }}
        />
      )}

      {!loading && !error && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div ref={scrollRef} className="scroll-hover h-full overflow-auto">
            <table className="border-separate border-spacing-0 text-sm" style={{ width: NAME_COL_WIDTH + dayColWidth * days.length }}>
              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-100">
                  <th
                    className="sticky left-0 z-30 border-b-2 border-r border-blue-600 bg-slate-100 px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-slate-800"
                    style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
                  >
                    Nhân viên
                  </th>
                  {days.map((day) => {
                    const isToday = day === today;
                    return (
                      <th
                        key={day}
                        className="border-b-2 border-r border-slate-300 bg-slate-100 px-2 py-2.5 text-center border-b-blue-600"
                        style={{ width: dayColWidth, minWidth: dayColWidth }}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-[12.5px] font-semibold ${isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                            {WEEKDAY_FULL_LABELS[weekdayLabelIndex(day)]}
                          </span>
                          <span
                            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                              isToday ? 'bg-blue-600 text-white' : 'text-slate-700'
                            }`}
                          >
                            {Number(day.slice(8, 10))}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {staff.map((person) => {
                  const rowBulkActive = bulkUserId === person.id;
                  return (
                    <tr key={person.id}>
                      <td
                        className="sticky left-0 z-10 border-b border-r border-slate-300 bg-white px-4 py-2.5"
                        style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
                      >
                        <div className="flex flex-col gap-1">
                          <span className="truncate font-semibold text-slate-900">{person.displayName ?? person.fullName}</span>
                          {person.employeeCode && <span className="text-[11px] font-medium text-slate-400">{person.employeeCode}</span>}
                          {!monthLocked && (
                            <div className="flex flex-wrap items-center gap-1">
                              <Button
                                type="button"
                                variant={rowBulkActive ? 'primary' : 'secondary'}
                                className="gap-1 px-1.5 py-1 text-[10.5px]"
                                onClick={() => {
                                  setBulkUserId(rowBulkActive ? null : person.id);
                                  selection.clear();
                                }}
                              >
                                <CheckSquare size={11} weight="bold" aria-hidden="true" />
                                {rowBulkActive ? 'Đang chọn' : 'Chọn nhiều ngày'}
                              </Button>
                              {rowBulkActive && (
                                <Button type="button" variant="secondary" className="px-1.5 py-1 text-[10.5px]" onClick={() => selection.toggleAll()}>
                                  {selection.allLoadedSelected ? 'Bỏ chọn cả tháng' : 'Chọn cả tháng'}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      {days.map((day) => {
                        const dayItems = itemsByUserDay.get(`${person.id}|${day}`) ?? [];
                        return (
                          <td
                            key={day}
                            className="border-b border-r border-slate-300 px-1.5 py-2 align-top"
                            style={{ width: dayColWidth, minWidth: dayColWidth }}
                          >
                            <div className="flex flex-col gap-1.5">
                              {rowBulkActive && (
                                <label className="flex items-center justify-center gap-1.5 pb-0.5 text-[10.5px] text-slate-400">
                                  <input type="checkbox" checked={selection.isSelected(day)} onChange={() => selection.toggle(day)} className="h-3.5 w-3.5" />
                                  Chọn
                                </label>
                              )}
                              {dayItems.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center gap-1 rounded-md px-2 py-2 text-[11px] font-bold text-white shadow-sm"
                                  style={{ background: WORK_SHIFT_COLOR_HEX[item.workShiftColor] }}
                                >
                                  {(!item.canEdit || monthLocked) && (
                                    <Lock size={9} weight="bold" className="flex-shrink-0 text-white/80" aria-hidden="true" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">{item.workShiftName}</span>
                                  {item.canEdit && !monthLocked && (
                                    <button
                                      type="button"
                                      aria-label="Xoá ca"
                                      onClick={() =>
                                        deleteMutation.mutate({ id: item.id, version: item.version }, { onError: showLockErrorIfApplicable })
                                      }
                                      className="flex-shrink-0 rounded p-0.5 text-white/75 hover:bg-white/20 hover:text-white"
                                    >
                                      <XIcon size={10} weight="bold" />
                                    </button>
                                  )}
                                </div>
                              ))}
                              {!rowBulkActive && !monthLocked && (
                                <Button
                                  type="button"
                                  variant="add"
                                  className="w-full justify-center gap-1 px-1.5 py-1.5 text-[11px]"
                                  onClick={() => setPicker({ userId: person.id, dates: [day] })}
                                >
                                  <Plus size={11} weight="bold" aria-hidden="true" />
                                  Thêm ca
                                </Button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SelectionToolbar count={selection.selectedCount} onClear={selection.clear}>
        <Button
          type="button"
          className="px-3 py-1 text-xs"
          onClick={() => bulkUserId && setPicker({ userId: bulkUserId, dates: [...selection.selectedIds] })}
        >
          Áp dụng ca cho {selection.selectedCount} ngày đã chọn
        </Button>
      </SelectionToolbar>

      {picker && (
        <WorkShiftPickerModal
          subtitle={
            picker.dates.length === 1
              ? `Ngày ${formatDDMM(picker.dates[0]!)} — ${staff.find((p) => p.id === picker.userId)?.displayName ?? ''}`
              : `Áp dụng cho ${picker.dates.length} ngày đã chọn — ${staff.find((p) => p.id === picker.userId)?.displayName ?? ''}`
          }
          workShifts={workShifts}
          saving={createMutation.isPending || bulkMutation.isPending}
          showLockNotice={false}
          onClose={() => setPicker(null)}
          onSave={(ids) => void handlePickerSave(ids)}
        />
      )}

      {importOpen && (
        <ImportExcelDialog
          defaultMonth={monthAnchor}
          onClose={() => setImportOpen(false)}
          onImported={() => void listQuery.refetch()}
        />
      )}
    </div>
  );
}
