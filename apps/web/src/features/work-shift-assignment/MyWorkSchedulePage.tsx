import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowsLeftRight, CalendarX, CaretLeft, CaretRight, CheckCircle, CheckSquare, Clock, Lock, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import type { BusinessHours, LeaveRequestItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { useDataScope, useHasPermission } from '../auth/usePermission';
import { LeaveRequestDialog } from '../leave-request/LeaveRequestDialog';
import { useLeaveRequestsQuery, useWithdrawLeaveRequestMutation } from '../leave-request/leave-request.queries';
import { IncomingShiftSwapDialog } from '../shift-swap/IncomingShiftSwapDialog';
import { ShiftSwapDialog, type SwapSourceAssignment } from '../shift-swap/ShiftSwapDialog';
import { useCancelShiftSwapMutation, useShiftSwapIncomingCountQuery, useShiftSwapsQuery } from '../shift-swap/shift-swap.queries';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ProgressRing } from '../../shared/ui/ProgressRing';
import { Skeleton } from '../../shared/ui/Skeleton';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useAllowStaffSelfScheduleEnabledQuery, useWorkShiftsQuery } from '../clinic/clinic.queries';
import { WORK_SHIFT_COLOR_HEX } from '../clinic/WorkShiftFormModal';
import { WorkShiftPickerModal } from './WorkShiftPickerModal';
import { SCHEDULE_CHIP_TONE } from './ScheduleMonthGrid';
import { formatMinutesAsHours, isMonthOpenForSelfRegistration, resolveMonthBanner } from './schedule-month';
import { useScheduleSubmissionsQuery, useSubmitScheduleSubmissionMutation } from './schedule-submission.queries';
import {
  useBulkCreateWorkShiftAssignmentsMutation,
  useCopyWorkShiftAssignmentsMutation,
  useCreateWorkShiftAssignmentMutation,
  useDeleteWorkShiftAssignmentMutation,
  useWorkShiftAssignmentBusinessHoursQuery,
  useWorkShiftAssignmentMonthLockStatusQuery,
  useWorkShiftAssignmentsQuery,
} from './work-shift-assignment.queries';

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
/** `days[i]` (Thứ 2 → CN) khớp đúng thứ tự khoá của `BusinessHours` (`clinic.ts`). */
const WEEKDAY_KEYS: (keyof BusinessHours)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Số giờ giữa 2 mốc "HH:mm" — chỉ phục vụ hiển thị (làm tròn 1 chữ số thập phân, bỏ ".0" nếu tròn giờ). */
function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const minutes = (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0));
  return Math.round((minutes / 60) * 10) / 10;
}
function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function toDateOnlyUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
function fromDateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(dateStr: string, days: number): string {
  const d = toDateOnlyUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDateOnlyUtc(d);
}
/** "Hôm nay" theo giờ Việt Nam — cùng kỹ thuật `getVietnamTodayDateString()` (schedule-grid.utils.ts). */
function getTodayDateString(): string {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60_000);
  return fromDateOnlyUtc(vn);
}
function getWeekStart(dateStr: string): string {
  const weekday = toDateOnlyUtc(dateStr).getUTCDay(); // 0=CN, 1=T2, ...
  const offsetFromMonday = weekday === 0 ? 6 : weekday - 1;
  return addDays(dateStr, -offsetFromMonday);
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
/** `[đầu tháng, cuối tháng]` — dùng làm khoảng ngày truy vấn cho chế độ Tháng. */
function getMonthRange(monthStr: string): [string, string] {
  const [year, month] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
  return [`${monthStr}-01`, `${monthStr}-${String(daysInMonth).padStart(2, '0')}`];
}
/** Lưới tháng dạng lịch (bắt đầu Thứ 2), gồm cả ngày đệm mờ của tháng trước/sau cho đủ hàng. */
function getMonthGridDays(monthStr: string): { date: string; inMonth: boolean }[] {
  const firstOfMonth = `${monthStr}-01`;
  const firstWeekday = toDateOnlyUtc(firstOfMonth).getUTCDay();
  const leading = firstWeekday === 0 ? 6 : firstWeekday - 1;
  const gridStart = addDays(firstOfMonth, -leading);
  const [year, month] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
  return Array.from({ length: totalCells }, (_, i) => {
    const date = addDays(gridStart, i);
    return { date, inMonth: date.slice(0, 7) === monthStr };
  });
}

/**
 * "Lịch làm việc của tôi" (Giai đoạn 2 của #101) — MỌI nhân viên tự đăng ký ca cho chính mình
 * theo tuần. Chip đã đăng ký HÔM NAY (`canEdit=true`) có nút xoá; chip từ hôm trước trở về trước
 * khoá (icon 🔒), chỉ quản lý sửa được qua "Lịch làm việc nhân viên".
 */
export function MyWorkSchedulePage() {
  useBreadcrumb([{ label: 'Lịch làm việc' }, { label: 'Lịch làm việc của tôi' }]);

  const today = getTodayDateString();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const [view, setView] = useState<'week' | 'month'>('week');
  const [monthAnchor, setMonthAnchor] = useState(() => today.slice(0, 7));
  const monthGridDays = getMonthGridDays(monthAnchor);
  const [monthFrom, monthTo] = getMonthRange(monthAnchor);

  const [bulkMode, setBulkMode] = useState(false);
  const [pickerFor, setPickerFor] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // "Đơn xin nghỉ" (#224): hộp xin nghỉ đang mở (ngày + ca vừa bấm) và ô đang mở menu.
  const [leaveDialog, setLeaveDialog] = useState<{ date: string; shiftId: string } | null>(null);
  const [menuCell, setMenuCell] = useState<string | null>(null);
  // "Đổi ca" (#225): ca đang mở hộp đổi ca, hộp "Yêu cầu đổi ca" của người nhận.
  const [swapSource, setSwapSource] = useState<SwapSourceAssignment | null>(null);
  const [showIncoming, setShowIncoming] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const selection = useRowSelection(days);

  const ownUserId = useAuthStore((s) => s.user?.id);

  // "Cấu hình chung" — mặc định `true` trong lúc tải (đúng mặc định backend), tránh nút tự đăng
  // ký nháy ẩn/hiện lúc mới vào trang trước khi query trả về.
  const selfScheduleQuery = useAllowStaffSelfScheduleEnabledQuery();
  const selfScheduleEnabled = selfScheduleQuery.data?.enabled ?? true;

  // "Khoá bảng ca" theo tháng (2026-09-03) — Tuần có thể trải 2 tháng liền kề, nên luôn gọi đúng 2
  // hook cố định (React Query tự dedupe cache key trùng nhau khi cả 2 cùng 1 tháng, đúng lúc ở
  // Tháng hoặc Tuần nằm gọn trong 1 tháng). Chỉ dùng để ẨN/HIỆN nút trước — enforcement thật vẫn ở
  // server (`canEdit` từng dòng + lỗi 409 khi bấm thử, phòng trường hợp biên qua nửa đêm).
  const monthsInView: [string, string] = view === 'week' ? [days[0]!.slice(0, 7), days[6]!.slice(0, 7)] : [monthAnchor, monthAnchor];
  const lockStatusAQuery = useWorkShiftAssignmentMonthLockStatusQuery(monthsInView[0]);
  const lockStatusBQuery = useWorkShiftAssignmentMonthLockStatusQuery(monthsInView[1]);
  const canBypassLock = lockStatusAQuery.data?.canBypass ?? lockStatusBQuery.data?.canBypass ?? false;
  const lockedMonths = new Set<string>();
  if (lockStatusAQuery.data?.locked) lockedMonths.add(monthsInView[0]);
  if (lockStatusBQuery.data?.locked) lockedMonths.add(monthsInView[1]);
  // Có quyền `unlock` KHÔNG tự động mở khoá giao diện — phải bấm "Sửa" mới lộ nút thao tác (chốt
  // qua phản hồi trực tiếp chủ dự án, 2026-09-03). Reset về đóng khi đổi tháng/tuần/chế độ xem.
  const [unlockedForEditing, setUnlockedForEditing] = useState(false);
  useEffect(() => setUnlockedForEditing(false), [view, monthAnchor, weekStart]);
  const monthAnchorLockedAbsolute = lockedMonths.has(monthAnchor);
  const monthAnchorLocked = monthAnchorLockedAbsolute && !unlockedForEditing;
  // Ẩn toolbar "Chọn nhiều ngày"/"Sao chép..." khi TOÀN BỘ tháng đang xem đã khoá (Tháng: đúng 1
  // tháng; Tuần trải 2 tháng: chỉ ẩn khi CẢ HAI đều khoá — còn ngày nào mở thì vẫn hữu ích).
  const toolbarLocked = !unlockedForEditing && monthsInView.every((m) => lockedMonths.has(m));
  const [lockErrorToast, setLockErrorToast] = useState<string | null>(null);
  function showLockErrorIfApplicable(err: unknown) {
    if (err instanceof ApiError && err.code === 'WORK_SHIFT_ASSIGNMENT_MONTH_LOCKED') {
      setLockErrorToast(err.message);
      setTimeout(() => setLockErrorToast(null), 5000);
    }
  }

  const shiftsQuery = useWorkShiftsQuery();
  // `userId` bắt buộc truyền tường minh: với actor có data_scope `global` (vd. clinic_admin),
  // bỏ trống sẽ khiến backend không lọc gì và trả về ca của TOÀN BỘ nhân viên thay vì "của tôi".
  const listQuery = useWorkShiftAssignmentsQuery(view === 'week' ? days[0]! : monthFrom, view === 'week' ? days[6]! : monthTo, ownUserId);
  const businessHoursQuery = useWorkShiftAssignmentBusinessHoursQuery();
  const canReadLeave = useHasPermission('leave_request', 'read');
  const canCreateLeave = useHasPermission('leave_request', 'create');
  // Cùng lý do `userId` ở `listQuery`: scope global (clinic_admin) bỏ trống sẽ lấy đơn của cả phòng khám.
  const leaveQuery = useLeaveRequestsQuery(
    { from: view === 'week' ? days[0]! : monthFrom, to: view === 'week' ? days[6]! : monthTo, userId: ownUserId },
    canReadLeave && !!ownUserId,
  );
  const withdrawMutation = useWithdrawLeaveRequestMutation();

  // "Duyệt đăng ký ca theo tháng" (#225) — nhân viên (scope personal) tự đăng ký CHỈ tháng sau, khi bảng tháng còn
  // Nháp; Gửi duyệt cả tháng → Chờ duyệt → Đã duyệt (khoá, chỉ xin nghỉ/đổi ca). Scope global (quản lý) không bị ràng buộc.
  const isStaffScope = useDataScope('work_shift_assignment', 'create') === 'personal';
  const submissionsQuery = useScheduleSubmissionsQuery({ userId: ownUserId }, !!ownUserId && selfScheduleEnabled && isStaffScope);
  const submissionByMonth = new Map((submissionsQuery.data?.items ?? []).map((r) => [r.month, r]));
  const submitMutation = useSubmitScheduleSubmissionMutation();
  function monthStatus(month: string): 'DRAFT' | 'SUBMITTED' | 'APPROVED' {
    return submissionByMonth.get(month)?.status ?? 'DRAFT';
  }
  /** Tháng này nhân viên còn tự thêm/xoá ca được không (quản lý luôn `true`, việc còn lại server kiểm). */
  function monthEditable(month: string): boolean {
    if (!isStaffScope) return true;
    return selfScheduleEnabled && isMonthOpenForSelfRegistration(month, today) && monthStatus(month) === 'DRAFT';
  }
  const statusMonth = view === 'month' ? monthAnchor : days[3]!.slice(0, 7);
  const statusRow = submissionByMonth.get(statusMonth);
  const showStatusBanner = isStaffScope && selfScheduleEnabled && (isMonthOpenForSelfRegistration(statusMonth, today) || statusRow !== undefined);
  const monthBanner = resolveMonthBanner(monthStatus(statusMonth), statusRow?.returnReason, isMonthOpenForSelfRegistration(statusMonth, today));
  const MONTH_BADGE_BG = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-600', slate: 'bg-slate-500' } as const;

  // "Đổi ca" (#225): yêu cầu đang chờ (của mình gửi hoặc gửi cho mình) + số yêu cầu chờ MÌNH xác nhận.
  const canCreateSwap = useHasPermission('shift_swap', 'create');
  const swapsQuery = useShiftSwapsQuery({ status: 'PENDING' }, canCreateSwap);
  const pendingSwapByAssignment = new Map(
    (swapsQuery.data?.items ?? []).filter((sw) => sw.requesterId === ownUserId).map((sw) => [sw.requesterAssignment.assignmentId, sw]),
  );
  const incomingSwapCountQuery = useShiftSwapIncomingCountQuery(canCreateSwap);
  const incomingSwapCount = incomingSwapCountQuery.data?.count ?? 0;
  // Toast khi có yêu cầu đổi ca MỚI gửi tới lúc đang mở trang (nhịp 30 giây của query) — lần nạp đầu chỉ ghi nhận mốc,
  // không báo (banner "Có N yêu cầu..." bên dưới đã đủ cho yêu cầu có từ trước).
  const seenIncomingCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (incomingSwapCountQuery.data === undefined) return;
    const count = incomingSwapCountQuery.data.count;
    if (seenIncomingCountRef.current !== null && count > seenIncomingCountRef.current) {
      setToast('Bạn có yêu cầu đổi ca mới đang chờ xác nhận.');
      setTimeout(() => setToast(null), 6000);
    }
    seenIncomingCountRef.current = count;
  }, [incomingSwapCountQuery.data]);
  const cancelSwapMutation = useCancelShiftSwapMutation();
  const createMutation = useCreateWorkShiftAssignmentMutation();
  const bulkMutation = useBulkCreateWorkShiftAssignmentsMutation();
  const copyMutation = useCopyWorkShiftAssignmentsMutation();
  const deleteMutation = useDeleteWorkShiftAssignmentMutation();

  const workShifts = [...(shiftsQuery.data?.items ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const items = listQuery.data?.items ?? [];
  const itemsByDay = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByDay.get(item.workDate) ?? [];
    list.push(item);
    itemsByDay.set(item.workDate, list);
  }

  /** Đơn nghỉ áp lên ô (ngày × ca): đã duyệt > chờ duyệt > từ chối gần nhất. Nghỉ cả ngày (`workShiftId=null`) phủ mọi ca. */
  function leaveForCell(day: string, shiftId: string): LeaveRequestItem | undefined {
    const candidates = (leaveQuery.data?.items ?? []).filter((l) => l.leaveDate === day && (l.workShiftId === shiftId || l.workShiftId === null));
    return (
      candidates.find((l) => l.status === 'APPROVED') ??
      candidates.find((l) => l.status === 'PENDING') ??
      candidates.find((l) => l.status === 'REJECTED')
    );
  }

  const loading = shiftsQuery.isPending || listQuery.isPending;
  const error = shiftsQuery.error ?? listQuery.error;

  /** `null` = chưa cấu hình Giờ làm việc — coi như MỌI ngày đều mở (không suy diễn "Nghỉ" khi
   * không có dữ liệu thật, giữ đúng hành vi hiện có: mọi ngày đều cho đăng ký). */
  const businessHours = businessHoursQuery.data?.businessHours ?? null;
  function isWeekdayClosed(dayIndex: number): boolean {
    if (!businessHours) return false;
    return businessHours[WEEKDAY_KEYS[dayIndex]!] === null;
  }

  // "Đã đăng ký N/M ca" (chỉ ở chế độ Tuần) — M = tổng số Ô CA KHẢ DỤNG trong tuần (số loại ca ×
  // số ngày phòng khám MỞ CỬA), không phải chỉ tiêu cấu hình riêng (chưa có khái niệm này ở v1).
  const openDayCount = days.filter((_, i) => !isWeekdayClosed(i)).length;
  const availableSlotCount = workShifts.length * openDayCount;
  const registeredCount = items.length;
  const registeredHours = items.reduce((sum, item) => sum + hoursBetween(item.startTime, item.endTime), 0);
  const registeredPercent = availableSlotCount > 0 ? (registeredCount / availableSlotCount) * 100 : 0;

  async function handlePickerSave(shiftIds: string[]) {
    if (!pickerFor) return;
    try {
      if (pickerFor.length === 1) {
        for (const workShiftId of shiftIds) {
          await createMutation.mutateAsync({ workShiftId, workDate: pickerFor[0]! });
        }
      } else {
        for (const workShiftId of shiftIds) {
          await bulkMutation.mutateAsync({ workShiftId, workDates: pickerFor });
        }
      }
    } catch (err) {
      showLockErrorIfApplicable(err);
      return;
    }
    setPickerFor(null);
    selection.clear();
  }

  /** Đăng ký NHANH đúng 1 ô (ca × ngày) ở lưới tuần — không cần mở `WorkShiftPickerModal` vì hàng
   * đã CHÍNH LÀ loại ca, khác đăng ký từ cột ngày (chưa biết chọn ca nào) ở chế độ Tháng/bulk. */
  async function handleQuickRegister(workShiftId: string, workDate: string) {
    try {
      await createMutation.mutateAsync({ workShiftId, workDate });
    } catch (err) {
      showLockErrorIfApplicable(err);
    }
  }

  async function handleSubmitMonth(month: string) {
    setSubmitError(null);
    try {
      await submitMutation.mutateAsync({ month });
      setToast(`Đã gửi duyệt ${formatMonthLabel(month).toLowerCase()}.`);
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Gửi duyệt thất bại, vui lòng thử lại.');
    }
  }

  function showCopyToast(result: { createdCount: number; skippedCount: number }) {
    setToast(`Đã sao chép ${result.createdCount} ca, bỏ qua ${result.skippedCount} ca đã có sẵn.`);
    setTimeout(() => setToast(null), 4000);
  }
  async function handleCopyWeek() {
    try {
      showCopyToast(await copyMutation.mutateAsync({ mode: 'week', fromWeekStart: addDays(weekStart, -7), toWeekStart: weekStart }));
    } catch (err) {
      showLockErrorIfApplicable(err);
    }
  }
  /** `targetMonth` — tháng ĐÍCH nhận ca sao chép (nguồn luôn là tháng liền trước). */
  async function handleCopyMonth(targetMonth: string) {
    try {
      showCopyToast(await copyMutation.mutateAsync({ mode: 'month', fromMonth: addMonths(targetMonth, -1), toMonth: targetMonth }));
    } catch (err) {
      showLockErrorIfApplicable(err);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">Lịch làm việc của tôi</h1>

      {/* "Đã đăng ký N/M ca" — chỉ ở chế độ Tuần (khớp đúng phạm vi lưới tuần bên dưới). */}
      {view === 'week' && !loading && !error && (
        <div className="flex flex-shrink-0 justify-end px-1">
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Đã đăng ký</div>
              <div className="mt-0.5 text-lg font-bold text-slate-900">
                {registeredCount}/{availableSlotCount} ca <span className="text-sm font-semibold text-slate-400">({formatHours(registeredHours)} giờ)</span>
              </div>
            </div>
            <ProgressRing percent={registeredPercent} />
          </div>
        </div>
      )}

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2.5 px-1">
        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-md border border-slate-300 shadow-sm">
            <button
              type="button"
              aria-pressed={view === 'week'}
              onClick={() => setView('week')}
              className={`px-3.5 py-1.5 text-[13px] font-semibold ${view === 'week' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Tuần
            </button>
            <button
              type="button"
              aria-pressed={view === 'month'}
              onClick={() => setView('month')}
              className={`border-l border-slate-300 px-3.5 py-1.5 text-[13px] font-semibold ${view === 'month' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Tháng
            </button>
          </div>

          {view === 'week' ? (
            <>
              <button
                type="button"
                onClick={() => setWeekStart((w) => addDays(w, -7))}
                aria-label="Tuần trước"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              >
                <CaretLeft size={15} weight="bold" />
              </button>
              <span className="min-w-[168px] rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900 shadow-sm">
                {formatDDMM(days[0]!)} – {formatDDMM(days[6]!)}
              </span>
              <button
                type="button"
                onClick={() => setWeekStart((w) => addDays(w, 7))}
                aria-label="Tuần sau"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              >
                <CaretRight size={15} weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(getWeekStart(today))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              >
                Tuần này
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
                aria-label="Tháng trước"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              >
                <CaretLeft size={15} weight="bold" />
              </button>
              <span className="min-w-[128px] rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900 shadow-sm">
                {formatMonthLabel(monthAnchor)}
              </span>
              <button
                type="button"
                onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
                aria-label="Tháng sau"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              >
                <CaretRight size={15} weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => setMonthAnchor(today.slice(0, 7))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              >
                Tháng này
              </button>
            </>
          )}
        </div>

        {selfScheduleEnabled && !toolbarLocked && monthsInView.some((m) => monthEditable(m)) && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={bulkMode ? 'primary' : 'secondary'}
              className="px-3 py-1.5 text-xs"
              onClick={() => {
                setBulkMode((b) => !b);
                selection.clear();
              }}
            >
              <CheckSquare size={14} weight="bold" aria-hidden="true" />
              {bulkMode ? 'Thoát chọn nhiều ngày' : 'Chọn nhiều ngày'}
            </Button>
            {view === 'week' ? (
              <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void handleCopyWeek()}>
                Sao chép tuần trước
              </Button>
            ) : (
              <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void handleCopyMonth(monthAnchor)}>
                Sao chép tháng trước
              </Button>
            )}
          </div>
        )}
      </div>

      {/* "Chọn nhiều ngày" (chế độ Tuần) — đặt ở ĐÂY (ngay dưới toolbar), KHÔNG đặt cuối khung lưới:
          `SelectionToolbar` nổi cố định đáy màn hình sẽ đè lên nếu đặt checkbox ở cuối trang (bug
          thật phát hiện lúc verify Playwright — chụp ảnh thấy toolbar che mất 4/7 checkbox). */}
      {view === 'week' && bulkMode && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <span className="text-xs font-semibold text-slate-500">Chọn ngày để áp dụng ca:</span>
          {days.map((day, index) => {
            const dayLocked = lockedMonths.has(day.slice(0, 7)) && !unlockedForEditing;
            if (dayLocked || day < today || !monthEditable(day.slice(0, 7))) return null;
            return (
              <label key={day} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <input type="checkbox" checked={selection.isSelected(day)} onChange={() => selection.toggle(day)} className="h-3.5 w-3.5" />
                {WEEKDAY_LABELS[index]} {formatDDMM(day)}
              </label>
            );
          })}
        </div>
      )}

      {/* "Đổi ca" (#225): có yêu cầu đang chờ MÌNH xác nhận. */}
      {incomingSwapCount > 0 && (
        <div className="flex flex-shrink-0 items-center gap-2.5 rounded-md bg-amber-500 px-3.5 py-2.5 text-white shadow-sm">
          <span className="flex-1 text-[13px] font-semibold">Có {incomingSwapCount} yêu cầu đổi ca đang chờ bạn xác nhận.</span>
          <Button type="button" variant="secondary" className="px-3.5 py-1.5 text-xs font-bold" onClick={() => setShowIncoming(true)}>
            Xem yêu cầu
          </Button>
        </div>
      )}

      {/* "Duyệt đăng ký ca theo tháng" (#225) — trạng thái bảng tháng + Gửi duyệt cả tháng. */}
      {showStatusBanner && (
        <div className="flex flex-shrink-0 flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[13px] font-semibold text-slate-700">{formatMonthLabel(statusMonth)}</span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white ${MONTH_BADGE_BG[monthBanner.tone]}`}>{monthBanner.label}</span>
          </div>
          {monthBanner.banner === 'RETURNED' && statusRow?.returnReason && (
            <div className="flex items-center gap-2.5 rounded-md bg-rose-600 px-3.5 py-2.5 text-white shadow-sm">
              <span className="flex-1 text-[13px] font-semibold">
                {formatMonthLabel(statusMonth)} bị trả lại: &quot;{statusRow.returnReason}&quot; Bạn sửa lại rồi gửi duyệt lần nữa.
              </span>
              <Button
                type="button"
                variant="secondary"
                className="px-3.5 py-1.5 text-xs font-bold"
                loading={submitMutation.isPending}
                onClick={() => void handleSubmitMonth(statusMonth)}
              >
                Gửi duyệt cả tháng
              </Button>
            </div>
          )}
          {monthBanner.banner === 'DRAFT_OPEN' && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900">
              <span className="min-w-0 flex-1">
                <span className="font-bold">Đăng ký {formatMonthLabel(statusMonth).toLowerCase()}.</span> Bạn chỉ đăng ký được cho tháng chưa tới. Đăng ký xong bấm <strong>Gửi duyệt cả tháng</strong>; sau khi gửi bạn không tự sửa hoặc xoá ca được nữa.
              </span>
              <Button type="button" className="px-3.5 py-1.5 text-xs font-bold" loading={submitMutation.isPending} onClick={() => void handleSubmitMonth(statusMonth)}>
                Gửi duyệt cả tháng
              </Button>
            </div>
          )}
          {monthBanner.banner === 'SUBMITTED' && statusRow && (
            <div className="flex items-center gap-2.5 rounded-md bg-amber-500 px-3.5 py-2.5 text-white shadow-sm">
              <span className="flex-1 text-[13px] font-semibold">
                Đã gửi duyệt — {statusRow.shiftCount} ca, {formatMinutesAsHours(statusRow.totalMinutes)} giờ. Đang chờ Quản lý phòng khám duyệt, trong lúc này không sửa hoặc xoá ca được.
              </span>
            </div>
          )}
          {monthBanner.banner === 'APPROVED' && (
            <p className="px-1 text-xs text-slate-500">Lịch đã duyệt không sửa hoặc xoá trực tiếp. Chỉ xin nghỉ hoặc đổi ca.</p>
          )}
          {submitError && <p className="px-1 text-xs font-medium text-rose-600">{submitError}</p>}
        </div>
      )}

      {/* Trạng thái cấu hình, không phải lỗi/cảnh báo khẩn — chú thích gọn màu trung tính, không
          bọc khung banner đầy màu (chốt 2026-09-03, phản hồi trực tiếp chủ dự án). */}
      {!selfScheduleEnabled && (
        <p className="flex flex-shrink-0 items-center gap-1.5 px-1 text-xs text-slate-400">
          <Lock size={12} weight="bold" aria-hidden="true" />
          Đăng ký lịch cá nhân đang tắt — lịch làm việc được lấy từ lịch nhân viên do quản lý phân công.
        </p>
      )}

      {/* "Khoá bảng ca" theo tháng — chỉ hiện ở chế độ Tháng (đúng scenario chủ dự án nêu: xem lại
          tháng trước). Nền ĐẶC (không nhạt, đúng #106) để gây chú ý. 3 biến thể như
          `StaffWorkSchedulePage.tsx`: (1) khoá, không có quyền mở → chỉ báo; (2) khoá, có quyền
          nhưng CHƯA bấm "Sửa" → cùng cảnh báo + nút "Sửa"; (3) đã bấm "Sửa" → dải nhắc đang sửa tạm
          + nút "Khoá lại". Mặc định LUÔN khoá giao diện dù có quyền hay không. */}
      {view === 'month' && monthAnchorLocked && (
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
      {view === 'month' && monthAnchorLockedAbsolute && !monthAnchorLocked && (
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

      {toast && (
        <div className="flex flex-shrink-0 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          {toast}
        </div>
      )}

      {/* Phòng trường hợp biên (khoá xảy ra đúng lúc đang mở trang, hoặc nút chưa kịp ẩn) — banner
          đã che phần lớn trường hợp, đây chỉ là lưới an toàn thứ hai khi thao tác thật sự bị 409. */}
      {lockErrorToast && (
        <div className="flex flex-shrink-0 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {lockErrorToast}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-7 gap-2.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <ErrorBanner
          message={error instanceof ApiError ? error.message : 'Không tải được lịch làm việc.'}
          onRetry={() => {
            void shiftsQuery.refetch();
            void listQuery.refetch();
          }}
        />
      )}

      {/* Lưới "Ca × Ngày" theo tuần (chốt qua ảnh tham khảo chủ dự án gửi) — hàng = loại ca (mẫu ca
          `work_shift`), cột = 7 ngày. Màu ô theo TRẠNG THÁI đăng ký (xanh lá = đã đăng ký), khác
          chấm màu theo ca ở lưới Tháng bên dưới (giữ nguyên, không đổi). "+ Đăng ký" ở đây gọi
          thẳng `handleQuickRegister` (biết chính xác ca của hàng đang bấm) — không mở
          `WorkShiftPickerModal` nữa (khác trước đây phải mở modal để CHỌN ca vì theo cột-ngày
          không biết trước ca nào). */}
      {!loading && !error && view === 'week' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="scroll-hover min-h-0 flex-1 overflow-auto">
            <div className="grid" style={{ gridTemplateColumns: `168px repeat(7, minmax(128px, 1fr))`, minWidth: 168 + 128 * 7 }}>
              <div className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Ca / Thời gian
              </div>
              {days.map((day, index) => {
                const isToday = day === today;
                return (
                  <div
                    key={day}
                    className={`sticky top-0 z-10 border-b border-r border-slate-200 px-2 py-2 text-center last:border-r-0 ${isToday ? 'bg-blue-600' : 'bg-slate-50'}`}
                  >
                    {isToday && (
                      <span className="mb-0.5 inline-block rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Hôm nay
                      </span>
                    )}
                    {!isToday && <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{WEEKDAY_LABELS[index]}</div>}
                    <div className={`text-[15px] font-extrabold ${isToday ? 'text-white' : 'text-slate-900'}`}>{formatDDMM(day)}</div>
                  </div>
                );
              })}

              {workShifts.length === 0 && (
                <div className="col-span-8 px-3 py-6 text-center text-sm text-slate-400">Chưa có mẫu ca nào — liên hệ quản lý để tạo Ca làm việc.</div>
              )}

              {workShifts.map((shift) => (
                <Fragment key={shift.id}>
                  <div className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-[13px] font-bold text-slate-800">{shift.name}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-400">
                      <Clock size={11} weight="bold" aria-hidden="true" />
                      {shift.startTime} - {shift.endTime}
                    </div>
                  </div>
                  {days.map((day, index) => {
                    const item = (itemsByDay.get(day) ?? []).find((it) => it.workShiftId === shift.id);
                    const dayLocked = lockedMonths.has(day.slice(0, 7)) && !unlockedForEditing;
                    const cellKey = `${shift.id}-${day}`;

                    if (isWeekdayClosed(index)) {
                      return (
                        <div key={cellKey} className="border-b border-r border-slate-100 bg-slate-50/70 p-1.5 text-center last:border-r-0">
                          <span className="text-xs font-medium text-slate-300">Nghỉ</span>
                        </div>
                      );
                    }

                    if (item) {
                      const locked = !item.canEdit || dayLocked;
                      const leave = leaveForCell(day, shift.id);
                      const canDelete = item.canEdit && selfScheduleEnabled && !dayLocked;
                      const pendingSwap = pendingSwapByAssignment.get(item.id);
                      const canSwap = canCreateSwap && day >= today && !item.canEdit && !pendingSwap;

                      // Nghỉ ĐÃ DUYỆT — gạch chéo đỏ, ca đăng ký vẫn giữ nguyên bên dưới.
                      if (leave?.status === 'APPROVED') {
                        return (
                          <div key={cellKey} className="border-b border-r border-slate-100 p-1.5 last:border-r-0">
                            <div
                              className="flex h-full flex-col justify-center gap-1 rounded-md border border-rose-300 px-2 py-2"
                              style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(225,29,72,.10) 0 6px, transparent 6px 12px)' }}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <span className="text-xs font-bold text-rose-700">Nghỉ</span>
                                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">Đã duyệt</span>
                              </div>
                              <span className="truncate text-[11px] text-slate-600" title={leave.reason}>
                                {leave.reason}
                              </span>
                            </div>
                          </div>
                        );
                      }
                      // Chờ duyệt — nhãn hổ phách + "Rút đơn".
                      if (leave?.status === 'PENDING') {
                        return (
                          <div key={cellKey} className="border-b border-r border-slate-100 p-1.5 last:border-r-0">
                            <div className="flex h-full flex-col justify-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <span className="text-xs font-bold text-amber-800">{shift.name}</span>
                                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">Chờ duyệt nghỉ</span>
                              </div>
                              {leave.canWithdraw && (
                                <button
                                  type="button"
                                  onClick={() => withdrawMutation.mutate({ id: leave.id, version: leave.version })}
                                  className="self-start text-[11px] font-semibold text-blue-600 hover:underline"
                                >
                                  Rút đơn
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      }
                      // Chờ NGƯỜI NHẬN xác nhận đổi ca ("Đổi ca", #225) — nhãn hổ phách + "Huỷ yêu cầu".
                      if (pendingSwap) {
                        return (
                          <div key={cellKey} className="border-b border-r border-slate-100 p-1.5 last:border-r-0">
                            <div className="flex h-full flex-col justify-center gap-0.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-2">
                              <span className="text-xs font-bold text-amber-800">Chờ xác nhận đổi ca</span>
                              <span className="truncate text-[11px] text-slate-600">với {pendingSwap.counterpartName}</span>
                              <button
                                type="button"
                                onClick={() => cancelSwapMutation.mutate({ id: pendingSwap.id, version: pendingSwap.version })}
                                className="self-start text-[11px] font-semibold text-blue-600 hover:underline"
                              >
                                Huỷ yêu cầu
                              </button>
                            </div>
                          </div>
                        );
                      }
                      // Từ chối — xám kèm lý do; vẫn xin lại được qua menu như ô thường.
                      const rejectedNote = leave?.status === 'REJECTED' ? leave : undefined;
                      const canRequestLeave = canCreateLeave && day >= today;
                      const menuOpen = menuCell === cellKey;

                      return (
                        <div key={cellKey} className="border-b border-r border-slate-100 p-1.5 last:border-r-0">
                          <div
                            className={`relative flex h-full flex-col items-center justify-center gap-0.5 rounded-md px-2 py-2 text-center ring-1 ring-inset ${
                              rejectedNote ? 'bg-slate-50 ring-slate-300' : 'bg-emerald-50 ring-emerald-200'
                            }`}
                          >
                            {locked && <Lock size={10} weight="bold" className="absolute right-1.5 top-1.5 text-emerald-400" aria-hidden="true" />}
                            {rejectedNote ? (
                              <>
                                <span className="flex flex-wrap items-center justify-center gap-1.5 text-[12.5px] font-bold text-slate-700">
                                  {shift.name}
                                  <span className="rounded-full bg-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Từ chối nghỉ</span>
                                </span>
                                <span className="max-w-full truncate text-[11px] text-slate-500" title={rejectedNote.decisionReason ?? undefined}>
                                  &quot;{rejectedNote.decisionReason}&quot;
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="flex items-center gap-1 text-[12.5px] font-bold text-emerald-700">
                                  <CheckCircle size={13} weight="fill" aria-hidden="true" />
                                  Đã đăng ký
                                </span>
                                <span className="text-[11px] font-semibold text-emerald-600">{formatHours(hoursBetween(item.startTime, item.endTime))} giờ</span>
                              </>
                            )}

                            {(canRequestLeave || canDelete || canSwap) && (
                              <button
                                type="button"
                                aria-label="Tuỳ chọn ca"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                onClick={() => setMenuCell(menuOpen ? null : cellKey)}
                                className="absolute inset-0 rounded-md focus-visible:outline-2 focus-visible:outline-blue-600"
                              />
                            )}
                            {menuOpen && (
                              <>
                                <button type="button" aria-label="Đóng menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setMenuCell(null)} />
                                <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 text-left text-sm font-medium text-slate-800 shadow-lg">
                                  {canRequestLeave && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
                                      onClick={() => {
                                        setMenuCell(null);
                                        setLeaveDialog({ date: day, shiftId: shift.id });
                                      }}
                                    >
                                      <CalendarX size={14} weight="bold" className="text-rose-600" aria-hidden="true" />
                                      Xin nghỉ ca này
                                    </button>
                                  )}
                                  {canSwap && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
                                      onClick={() => {
                                        setMenuCell(null);
                                        setSwapSource({
                                          assignmentId: item.id,
                                          workDate: day,
                                          workShiftName: shift.name,
                                          startTime: shift.startTime,
                                          endTime: shift.endTime,
                                        });
                                      }}
                                    >
                                      <ArrowsLeftRight size={14} weight="bold" className="text-blue-600" aria-hidden="true" />
                                      Đổi ca
                                    </button>
                                  )}
                                  {canDelete ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
                                      onClick={() => {
                                        setMenuCell(null);
                                        deleteMutation.mutate({ id: item.id, version: item.version }, { onError: showLockErrorIfApplicable });
                                      }}
                                    >
                                      <Trash size={14} weight="bold" className="text-slate-500" aria-hidden="true" />
                                      Xoá ca
                                    </button>
                                  ) : (
                                    <span className="flex items-center gap-2 px-3 py-1.5 text-slate-400">
                                      <Lock size={14} weight="bold" aria-hidden="true" />
                                      Xoá ca (đã khoá)
                                    </span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Ngày đã qua không đăng ký được (chốt 2026-10-09, #224) — server cũng chặn, ẩn nút cho đỡ nhầm.
                    const canAdd = !bulkMode && selfScheduleEnabled && !dayLocked && day >= today && monthEditable(day.slice(0, 7));
                    return (
                      <div key={cellKey} className="border-b border-r border-slate-100 p-1.5 last:border-r-0">
                        {canAdd ? (
                          <button
                            type="button"
                            onClick={() => void handleQuickRegister(shift.id, day)}
                            className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-slate-300 py-2 text-slate-400 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <Plus size={13} weight="bold" aria-hidden="true" />
                            <span className="text-[11.5px] font-semibold">Đăng ký</span>
                          </button>
                        ) : (
                          <div className="h-full rounded-md border border-dashed border-slate-100" />
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>

        </div>
      )}

      {!loading && !error && view === 'month' && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm scroll-hover">
          <div className="grid grid-cols-7 gap-2 pb-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={label} className={i >= 5 ? 'text-slate-300' : undefined}>
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {monthGridDays.map(({ date, inMonth }) => {
              const dayItems = itemsByDay.get(date) ?? [];
              const isToday = date === today;
              const selected = bulkMode && selection.isSelected(date);
              return (
                <button
                  type="button"
                  key={date}
                  disabled={bulkMode && (!inMonth || monthAnchorLocked || date < today || !monthEditable(date.slice(0, 7)))}
                  onClick={() => {
                    if (bulkMode) {
                      selection.toggle(date);
                      return;
                    }
                    setWeekStart(getWeekStart(date));
                    setView('week');
                  }}
                  className={`relative flex min-h-16 flex-col items-start rounded-lg border p-2 text-left text-[13px] font-bold transition-shadow ${
                    !inMonth
                      ? 'border-slate-100 bg-slate-50 text-slate-300'
                      : selected
                        ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-100'
                        : isToday
                          ? 'border-blue-500 bg-blue-600 text-white shadow-[0_0_0_3px_rgba(37,99,235,0.12)]'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  {bulkMode && inMonth && (
                    <input
                      type="checkbox"
                      checked={selected}
                      readOnly
                      className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
                      aria-label={`Chọn ngày ${date}`}
                    />
                  )}
                  <span>{Number(date.slice(8, 10))}</span>
                  {dayItems.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {dayItems.map((item) =>
                        isStaffScope ? (
                          // #225: chip tên ca tô theo trạng thái bảng tháng (Nháp xanh dương / Chờ duyệt hổ phách / Đã duyệt xanh lá).
                          <span
                            key={item.id}
                            title={item.workShiftName}
                            className={`max-w-full truncate rounded bg-white px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${SCHEDULE_CHIP_TONE[monthStatus(item.workDate.slice(0, 7))]}`}
                          >
                            {item.workShiftName}
                          </span>
                        ) : (
                          <span
                            key={item.id}
                            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${isToday ? 'ring-1 ring-white/60' : ''}`}
                            style={{ background: WORK_SHIFT_COLOR_HEX[item.workShiftColor] }}
                          />
                        ),
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] text-slate-400">
            {bulkMode
              ? 'Đang ở chế độ chọn nhiều ngày — bấm vào các ngày cần đăng ký, rồi bấm "Áp dụng ca cho các ngày này" ở thanh dưới.'
              : selfScheduleEnabled
                ? 'Chấm màu chỉ có/không có ca, không hiện chi tiết giờ. Bấm 1 ngày để xem chi tiết Tuần chứa ngày đó, hoặc bật "Chọn nhiều ngày" để đăng ký ca ngay tại đây.'
                : 'Chấm màu chỉ có/không có ca, không hiện chi tiết giờ. Bấm 1 ngày để xem chi tiết Tuần chứa ngày đó.'}
          </p>
        </div>
      )}

      <SelectionToolbar count={selection.selectedCount} onClear={selection.clear}>
        <Button type="button" className="px-3 py-1 text-xs" onClick={() => setPickerFor([...selection.selectedIds])}>
          Áp dụng ca cho các ngày này
        </Button>
      </SelectionToolbar>

      {swapSource && (
        <ShiftSwapDialog
          source={swapSource}
          onClose={() => setSwapSource(null)}
          onDone={() => {
            setSwapSource(null);
            setToast('Đã gửi yêu cầu đổi ca, đang chờ đồng nghiệp xác nhận.');
            setTimeout(() => setToast(null), 4000);
          }}
        />
      )}
      {showIncoming && <IncomingShiftSwapDialog onClose={() => setShowIncoming(false)} />}

      {leaveDialog && (
        <LeaveRequestDialog
          date={leaveDialog.date}
          initialShiftId={leaveDialog.shiftId}
          onClose={() => setLeaveDialog(null)}
          onDone={() => {
            setLeaveDialog(null);
            setToast('Đã gửi đơn xin nghỉ, đang chờ duyệt.');
            setTimeout(() => setToast(null), 4000);
          }}
        />
      )}

      {pickerFor && (
        <WorkShiftPickerModal
          subtitle={pickerFor.length === 1 ? `Ngày ${formatDDMM(pickerFor[0]!)}` : `Áp dụng cho ${pickerFor.length} ngày đã chọn`}
          workShifts={workShifts}
          saving={createMutation.isPending || bulkMutation.isPending}
          showLockNotice
          onClose={() => setPickerFor(null)}
          onSave={(ids) => void handlePickerSave(ids)}
        />
      )}
    </div>
  );
}
