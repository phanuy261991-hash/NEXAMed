import { useState } from 'react';
import { CaretLeft, CaretRight, CheckSquare, Lock, X as XIcon } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useWorkShiftsQuery } from '../clinic/clinic.queries';
import { WORK_SHIFT_COLOR_HEX } from '../clinic/WorkShiftFormModal';
import { WorkShiftPickerModal } from './WorkShiftPickerModal';
import {
  useBulkCreateWorkShiftAssignmentsMutation,
  useCopyWorkShiftAssignmentsMutation,
  useCreateWorkShiftAssignmentMutation,
  useDeleteWorkShiftAssignmentMutation,
  useWorkShiftAssignmentsQuery,
} from './work-shift-assignment.queries';

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

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
  const selection = useRowSelection(days);

  const ownUserId = useAuthStore((s) => s.user?.id);

  const shiftsQuery = useWorkShiftsQuery();
  // `userId` bắt buộc truyền tường minh: với actor có data_scope `global` (vd. clinic_admin),
  // bỏ trống sẽ khiến backend không lọc gì và trả về ca của TOÀN BỘ nhân viên thay vì "của tôi".
  const listQuery = useWorkShiftAssignmentsQuery(view === 'week' ? days[0]! : monthFrom, view === 'week' ? days[6]! : monthTo, ownUserId);
  const createMutation = useCreateWorkShiftAssignmentMutation();
  const bulkMutation = useBulkCreateWorkShiftAssignmentsMutation();
  const copyMutation = useCopyWorkShiftAssignmentsMutation();
  const deleteMutation = useDeleteWorkShiftAssignmentMutation();

  const workShifts = shiftsQuery.data?.items ?? [];
  const items = listQuery.data?.items ?? [];
  const itemsByDay = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByDay.get(item.workDate) ?? [];
    list.push(item);
    itemsByDay.set(item.workDate, list);
  }

  const loading = shiftsQuery.isPending || listQuery.isPending;
  const error = shiftsQuery.error ?? listQuery.error;

  async function handlePickerSave(shiftIds: string[]) {
    if (!pickerFor) return;
    if (pickerFor.length === 1) {
      for (const workShiftId of shiftIds) {
        await createMutation.mutateAsync({ workShiftId, workDate: pickerFor[0]! });
      }
    } else {
      for (const workShiftId of shiftIds) {
        await bulkMutation.mutateAsync({ workShiftId, workDates: pickerFor });
      }
    }
    setPickerFor(null);
    selection.clear();
  }

  function showCopyToast(result: { createdCount: number; skippedCount: number }) {
    setToast(`Đã sao chép ${result.createdCount} ca, bỏ qua ${result.skippedCount} ca đã có sẵn.`);
    setTimeout(() => setToast(null), 4000);
  }
  async function handleCopyWeek() {
    showCopyToast(await copyMutation.mutateAsync({ mode: 'week', fromWeekStart: addDays(weekStart, -7), toWeekStart: weekStart }));
  }
  /** `targetMonth` — tháng ĐÍCH nhận ca sao chép (nguồn luôn là tháng liền trước). */
  async function handleCopyMonth(targetMonth: string) {
    showCopyToast(await copyMutation.mutateAsync({ mode: 'month', fromMonth: addMonths(targetMonth, -1), toMonth: targetMonth }));
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">Lịch làm việc của tôi</h1>

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
      </div>

      {toast && (
        <div className="flex flex-shrink-0 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          {toast}
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

      {!loading && !error && view === 'week' && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm scroll-hover">
          <div className="grid grid-cols-7 items-start gap-3">
            {days.map((day, index) => {
              const dayItems = itemsByDay.get(day) ?? [];
              const isToday = day === today;
              const isWeekend = index >= 5;
              return (
                <div
                  key={day}
                  className={`flex flex-col overflow-hidden rounded-lg border transition-shadow hover:shadow-md ${
                    isToday ? 'border-blue-500 shadow-[0_0_0_3px_rgba(37,99,235,0.12)]' : 'border-slate-200'
                  }`}
                >
                  <div className={`px-2.5 py-2.5 text-center ${isToday ? 'bg-blue-600' : isWeekend ? 'bg-slate-100' : 'bg-slate-50'}`}>
                    <div className={`text-[10.5px] font-bold uppercase tracking-wide ${isToday ? 'text-blue-100' : 'text-slate-400'}`}>
                      {isToday ? 'Hôm nay' : WEEKDAY_LABELS[index]}
                    </div>
                    <div className={`text-[16px] font-extrabold ${isToday ? 'text-white' : 'text-slate-900'}`}>{formatDDMM(day)}</div>
                  </div>
                  <div className="flex flex-col gap-1.5 bg-white p-2">
                    {bulkMode && (
                      <label className="flex items-center justify-center gap-1.5 pb-0.5 text-[11px] text-slate-400">
                        <input type="checkbox" checked={selection.isSelected(day)} onChange={() => selection.toggle(day)} className="h-3.5 w-3.5" />
                        Chọn ngày
                      </label>
                    )}
                    {dayItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-1.5 rounded-md px-2 py-2 text-[13px] font-semibold text-white shadow-sm"
                        style={{ background: WORK_SHIFT_COLOR_HEX[item.workShiftColor] }}
                      >
                        {!item.canEdit && <Lock size={10} weight="bold" className="flex-shrink-0 text-white/80" aria-hidden="true" />}
                        <span className="min-w-0 flex-1 truncate">
                          {item.workShiftName}
                          <span className="block text-[11px] font-medium text-white/85">
                            {item.startTime}–{item.endTime}
                          </span>
                        </span>
                        {item.canEdit && (
                          <button
                            type="button"
                            aria-label="Xoá ca"
                            onClick={() => deleteMutation.mutate({ id: item.id, version: item.version })}
                            className="flex-shrink-0 rounded p-0.5 text-white/75 hover:bg-white/20 hover:text-white"
                          >
                            <XIcon size={11} weight="bold" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!bulkMode && (
                      <Button type="button" variant="add" className="w-full py-1.5 text-[11px]" onClick={() => setPickerFor([day])}>
                        {dayItems.length > 0 ? '+ Thêm ca khác' : '+ Đăng ký ca'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
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
                  disabled={bulkMode && !inMonth}
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
                      {dayItems.map((item) => (
                        <span
                          key={item.id}
                          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${isToday ? 'ring-1 ring-white/60' : ''}`}
                          style={{ background: WORK_SHIFT_COLOR_HEX[item.workShiftColor] }}
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] text-slate-400">
            {bulkMode
              ? 'Đang ở chế độ chọn nhiều ngày — bấm vào các ngày cần đăng ký, rồi bấm "Áp dụng ca cho các ngày này" ở thanh dưới.'
              : 'Chấm màu chỉ có/không có ca, không hiện chi tiết giờ. Bấm 1 ngày để xem chi tiết Tuần chứa ngày đó, hoặc bật "Chọn nhiều ngày" để đăng ký ca ngay tại đây.'}
          </p>
        </div>
      )}

      <SelectionToolbar count={selection.selectedCount} onClear={selection.clear}>
        <Button type="button" className="px-3 py-1 text-xs" onClick={() => setPickerFor([...selection.selectedIds])}>
          Áp dụng ca cho các ngày này
        </Button>
      </SelectionToolbar>

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
