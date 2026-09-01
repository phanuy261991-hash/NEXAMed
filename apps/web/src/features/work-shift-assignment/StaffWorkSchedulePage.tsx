import { useState } from 'react';
import { CaretLeft, CaretRight, X as XIcon } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useUserAccountsQuery } from '../user-account/user-account.queries';
import { useWorkShiftsQuery } from '../clinic/clinic.queries';
import { WORK_SHIFT_COLOR_HEX } from '../clinic/WorkShiftFormModal';
import { WorkShiftPickerModal } from './WorkShiftPickerModal';
import { useCreateWorkShiftAssignmentMutation, useDeleteWorkShiftAssignmentMutation, useWorkShiftAssignmentsQuery } from './work-shift-assignment.queries';

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
function getTodayDateString(): string {
  const now = new Date();
  return fromDateOnlyUtc(new Date(now.getTime() + 7 * 60 * 60_000));
}
function getWeekStart(dateStr: string): string {
  const weekday = toDateOnlyUtc(dateStr).getUTCDay();
  const offsetFromMonday = weekday === 0 ? 6 : weekday - 1;
  return addDays(dateStr, -offsetFromMonday);
}
function formatDDMM(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}
const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function initials(name: string): string {
  return name
    .split(' ')
    .filter((w) => /^[\p{L}]/u.test(w))
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/**
 * "Lịch làm việc nhân viên" (Giai đoạn 2 của #101) — chỉ clinic_admin (scope global) truy cập,
 * xem/tạo/xoá TOÀN BỘ nhân viên, không giới hạn thời gian (khác "Lịch làm việc của tôi"). Mọi ô
 * (kể cả đã có ca) sửa/xoá được ngay — không khoá.
 */
export function StaffWorkSchedulePage() {
  useBreadcrumb([{ label: 'Lịch làm việc' }, { label: 'Lịch làm việc nhân viên' }]);

  const today = getTodayDateString();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const [pickerTarget, setPickerTarget] = useState<{ userId: string; date: string } | null>(null);

  const usersQuery = useUserAccountsQuery();
  const shiftsQuery = useWorkShiftsQuery();
  const listQuery = useWorkShiftAssignmentsQuery(days[0]!, days[6]!);
  const createMutation = useCreateWorkShiftAssignmentMutation();
  const deleteMutation = useDeleteWorkShiftAssignmentMutation();

  const staff = (usersQuery.data?.items ?? []).filter((u) => u.isActive && !u.roleNames.includes('system_admin'));
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
    if (!pickerTarget) return;
    for (const workShiftId of shiftIds) {
      await createMutation.mutateAsync({ workShiftId, workDate: pickerTarget.date, userId: pickerTarget.userId });
    }
    setPickerTarget(null);
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">Lịch làm việc nhân viên</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 px-1">
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
          <div className="scroll-hover h-full overflow-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="w-48 px-4 py-2.5 text-left">Nhân viên</th>
                  {days.map((day, index) => (
                    <th key={day} className="px-2 py-2.5 text-center">
                      {WEEKDAY_LABELS[index]} <span className="font-medium normal-case text-slate-500">{formatDDMM(day)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map((person) => (
                  <tr key={person.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-bold text-blue-600">
                          {initials(person.displayName ?? person.fullName)}
                        </span>
                        <span className="truncate font-semibold text-slate-900">{person.displayName ?? person.fullName}</span>
                      </div>
                    </td>
                    {days.map((day) => {
                      const dayItems = itemsByUserDay.get(`${person.id}|${day}`) ?? [];
                      return (
                        <td key={day} className="px-1.5 py-1.5 align-top">
                          <div className="flex flex-col gap-1">
                            {dayItems.map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center gap-1 rounded-md border-l-[3px] px-1.5 py-1 text-[10.5px] font-bold text-slate-900"
                                style={{
                                  borderLeftColor: WORK_SHIFT_COLOR_HEX[item.workShiftColor],
                                  background: `color-mix(in srgb, ${WORK_SHIFT_COLOR_HEX[item.workShiftColor]} 12%, white)`,
                                }}
                              >
                                <span className="min-w-0 flex-1 truncate">{item.workShiftName}</span>
                                <button
                                  type="button"
                                  aria-label="Xoá ca"
                                  onClick={() => deleteMutation.mutate({ id: item.id, version: item.version })}
                                  className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                >
                                  <XIcon size={10} weight="bold" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => setPickerTarget({ userId: person.id, date: day })}
                              className="rounded-md border border-dashed border-blue-400 bg-blue-50 px-1.5 py-1 text-[10.5px] font-bold text-blue-600 hover:bg-blue-100"
                            >
                              +
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pickerTarget && (
        <WorkShiftPickerModal
          subtitle={`Ngày ${formatDDMM(pickerTarget.date)} — ${staff.find((p) => p.id === pickerTarget.userId)?.displayName ?? ''}`}
          workShifts={workShifts}
          saving={createMutation.isPending}
          showLockNotice={false}
          onClose={() => setPickerTarget(null)}
          onSave={(ids) => void handlePickerSave(ids)}
        />
      )}
    </div>
  );
}
