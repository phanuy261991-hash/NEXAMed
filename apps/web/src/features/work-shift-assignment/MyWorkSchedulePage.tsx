import { useState } from 'react';
import { CaretLeft, CaretRight, Lock, X as XIcon } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ActionMenu } from '../../shared/ui/ActionMenu';
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
function previousMonthOf(dateStr: string): string {
  const [year, month] = dateStr.slice(0, 7).split('-').map(Number);
  const d = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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

  const [pickerFor, setPickerFor] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const selection = useRowSelection(days);

  const shiftsQuery = useWorkShiftsQuery();
  const listQuery = useWorkShiftAssignmentsQuery(days[0]!, days[6]!);
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

  async function handleCopy(mode: 'week' | 'month') {
    const result =
      mode === 'week'
        ? await copyMutation.mutateAsync({ mode: 'week', fromWeekStart: addDays(weekStart, -7), toWeekStart: weekStart })
        : await copyMutation.mutateAsync({ mode: 'month', fromMonth: previousMonthOf(weekStart), toMonth: weekStart.slice(0, 7) });
    setToast(`Đã sao chép ${result.createdCount} ca, bỏ qua ${result.skippedCount} ca đã có sẵn.`);
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">Lịch làm việc của tôi</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2.5 px-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Tuần trước"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <span className="min-w-[168px] rounded-md border border-slate-300 px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900">
            {formatDDMM(days[0]!)} – {formatDDMM(days[6]!)}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Tuần sau"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretRight size={15} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(getWeekStart(today))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Tuần này
          </button>
        </div>

        <ActionMenu
          label="Sao chép..."
          items={[
            { key: 'week', label: 'Sao chép tuần trước', onClick: () => void handleCopy('week') },
            { key: 'month', label: 'Sao chép tháng trước', onClick: () => void handleCopy('month') },
          ]}
        />
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

      {!loading && !error && (
        <div className="grid flex-1 grid-cols-7 gap-2.5 overflow-y-auto scroll-hover">
          {days.map((day, index) => {
            const dayItems = itemsByDay.get(day) ?? [];
            const isToday = day === today;
            return (
              <div
                key={day}
                className={`flex flex-col rounded-lg border bg-white ${isToday ? 'border-blue-400 ring-1 ring-blue-400' : 'border-slate-200'}`}
              >
                <div className="border-b border-slate-100 px-2.5 py-2 text-center">
                  <div className={`text-[10.5px] font-bold uppercase tracking-wide ${isToday ? 'text-blue-600' : 'text-slate-400'}`}>
                    {isToday ? 'Hôm nay' : WEEKDAY_LABELS[index]}
                  </div>
                  <div className={`text-[15px] font-bold ${isToday ? 'text-blue-600' : 'text-slate-900'}`}>{formatDDMM(day)}</div>
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-2">
                  <label className="flex items-center justify-center gap-1.5 pb-0.5 text-[11px] text-slate-400">
                    <input type="checkbox" checked={selection.isSelected(day)} onChange={() => selection.toggle(day)} className="h-3.5 w-3.5" />
                    Chọn ngày
                  </label>
                  {dayItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-1.5 rounded-md border-l-[3px] px-2 py-1.5 text-[11.5px] font-bold text-slate-900"
                      style={{ borderLeftColor: WORK_SHIFT_COLOR_HEX[item.workShiftColor], background: `color-mix(in srgb, ${WORK_SHIFT_COLOR_HEX[item.workShiftColor]} 12%, white)` }}
                    >
                      {!item.canEdit && <Lock size={10} weight="bold" className="flex-shrink-0 opacity-60" aria-hidden="true" />}
                      <span className="min-w-0 flex-1 truncate">
                        {item.workShiftName}
                        <span className="block text-[10px] font-medium text-slate-500">
                          {item.startTime}–{item.endTime}
                        </span>
                      </span>
                      {item.canEdit && (
                        <button
                          type="button"
                          aria-label="Xoá ca"
                          onClick={() => deleteMutation.mutate({ id: item.id, version: item.version })}
                          className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <XIcon size={11} weight="bold" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPickerFor([day])}
                    className="mt-auto rounded-md border border-dashed border-blue-400 bg-blue-50 px-2 py-1.5 text-[11px] font-bold text-blue-600 hover:bg-blue-100"
                  >
                    + Đăng ký ca
                  </button>
                </div>
              </div>
            );
          })}
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
