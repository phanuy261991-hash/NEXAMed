import { useState } from 'react';
import { CalendarCheck, CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { ScheduleSubmissionItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { ScheduleMonthGrid } from './ScheduleMonthGrid';
import { addMonthsToMonthString, formatMinutesAsHours, formatMonthLabel } from './schedule-month';
import { useApproveScheduleSubmissionMutation, useReturnScheduleSubmissionMutation, useScheduleSubmissionsQuery } from './schedule-submission.queries';
import { useWorkShiftAssignmentsQuery } from './work-shift-assignment.queries';

type Filter = 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'ALL';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'SUBMITTED', label: 'Chờ duyệt' },
  { id: 'APPROVED', label: 'Đã duyệt' },
  { id: 'RETURNED', label: 'Trả lại' },
  { id: 'ALL', label: 'Tất cả' },
];

function statusBadge(item: ScheduleSubmissionItem): { label: string; tone: StatusBadgeTone } {
  if (item.status === 'SUBMITTED') return { label: 'Chờ duyệt', tone: 'warning' };
  if (item.status === 'APPROVED') return { label: 'Đã duyệt', tone: 'success' };
  return item.returnReason ? { label: 'Trả lại', tone: 'danger' } : { label: 'Nháp', tone: 'neutral' };
}

function getTodayMonth(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
}

/** Hộp "Xem lịch" chỉ đọc + Duyệt/Trả lại ngay trong hộp (mockup #225 màn 3). */
function ScheduleMonthDialog({
  item,
  onClose,
  onApprove,
  onReturn,
}: {
  item: ScheduleSubmissionItem;
  onClose: () => void;
  onApprove: () => void;
  onReturn: () => void;
}) {
  const [y, m] = item.month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  const itemsQuery = useWorkShiftAssignmentsQuery(`${item.month}-01`, `${item.month}-${String(lastDay).padStart(2, '0')}`, item.userId);
  const tone = item.status === 'APPROVED' ? 'APPROVED' : item.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="submission-month-title">
      <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader
          icon={CalendarCheck}
          title={`Lịch đăng ký ${formatMonthLabel(item.month).toLowerCase()}`}
          subtitle={`${item.userFullName} · ${item.shiftCount} ca · ${formatMinutesAsHours(item.totalMinutes)} giờ · chỉ xem`}
          onClose={onClose}
        />
        {itemsQuery.isPending && <Skeleton className="h-64 w-full" />}
        {itemsQuery.isError && <p className="text-sm font-medium text-rose-600">Không tải được lịch đăng ký.</p>}
        {itemsQuery.isSuccess && <ScheduleMonthGrid month={item.month} items={itemsQuery.data.items} tone={tone} />}
        {item.status === 'SUBMITTED' && (
          <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={onReturn}>
              Trả lại…
            </Button>
            <Button type="button" variant="success" onClick={onApprove}>
              Duyệt cả tháng
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tab "Đăng ký ca" ở "Lịch làm việc nhân viên" ("Duyệt đăng ký ca theo tháng", #225, mockup đã duyệt màn 3) —
 * bảng đăng ký tháng của từng nhân viên: Xem lịch (chỉ đọc), Duyệt cả tháng, Trả lại (bắt buộc lý do → về Nháp).
 */
export function ScheduleSubmissionsPane() {
  const [filter, setFilter] = useState<Filter>('SUBMITTED');
  const [month, setMonth] = useState<string>(() => addMonthsToMonthString(getTodayMonth(), 1));
  const [viewing, setViewing] = useState<ScheduleSubmissionItem | null>(null);
  const [returning, setReturning] = useState<ScheduleSubmissionItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const listQuery = useScheduleSubmissionsQuery({ month, ...(filter === 'ALL' ? {} : { status: filter }) });
  const pendingQuery = useScheduleSubmissionsQuery({ month, status: 'SUBMITTED' });
  const approveMutation = useApproveScheduleSubmissionMutation();
  const returnMutation = useReturnScheduleSubmissionMutation();
  const items = listQuery.data?.items ?? [];
  const pendingCount = pendingQuery.data?.items.length ?? 0;
  const showStatusColumn = filter !== 'SUBMITTED';

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  async function handleApprove(item: ScheduleSubmissionItem) {
    setError(null);
    try {
      await approveMutation.mutateAsync({ id: item.id, version: item.version });
      setViewing(null);
      flash(`Đã duyệt lịch ${formatMonthLabel(item.month).toLowerCase()} của ${item.userFullName}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Duyệt thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-1">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm font-semibold" role="group" aria-label="Lọc theo trạng thái">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-3 py-1.5 ${filter === f.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {f.label}
              {f.id === 'SUBMITTED' && pendingCount > 0 && ` ${pendingCount}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Tháng trước"
            onClick={() => setMonth((x) => addMonthsToMonthString(x, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <span className="min-w-[128px] rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900">{formatMonthLabel(month)}</span>
          <button
            type="button"
            aria-label="Tháng sau"
            onClick={() => setMonth((x) => addMonthsToMonthString(x, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretRight size={15} weight="bold" />
          </button>
        </div>
      </div>

      {toast && <div className="flex flex-shrink-0 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{toast}</div>}
      {error && <div className="flex-shrink-0 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}

      {listQuery.isPending && <Skeleton className="h-40 w-full" />}
      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách đăng ký ca.'} onRetry={() => void listQuery.refetch()} />
      )}
      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={CalendarCheck}
          title={filter === 'SUBMITTED' ? 'Không có bảng đăng ký nào chờ duyệt' : 'Chưa có bảng đăng ký nào'}
          description="Nhân viên đăng ký ca tháng sau ở Lịch làm việc của tôi rồi bấm Gửi duyệt; bảng gửi lên sẽ hiện ở đây."
        />
      )}
      {listQuery.isSuccess && items.length > 0 && (
        <div className="scroll-hover min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                <th className="px-3 py-2.5 text-center">Nhân viên</th>
                <th className="px-3 py-2.5 text-center">Tháng</th>
                <th className="px-3 py-2.5 text-center">Số ca</th>
                <th className="px-3 py-2.5 text-center">Số giờ</th>
                {showStatusColumn && <th className="px-3 py-2.5 text-center">Trạng thái</th>}
                <th className="px-3 py-2.5 text-center">Gửi lúc</th>
                <th className="px-3 py-2.5 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const badge = statusBadge(item);
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2.5 font-medium">
                      {item.userFullName}
                      {item.departmentName && <div className="text-xs text-slate-500">{item.departmentName}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold tabular-nums text-brand-teal">{item.month.slice(5)}/{item.month.slice(0, 4)}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">{item.shiftCount}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">{formatMinutesAsHours(item.totalMinutes)}</td>
                    {showStatusColumn && (
                      <td className="px-3 py-2.5 text-center">
                        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                        {item.returnReason && (
                          <div className="mx-auto mt-0.5 max-w-[200px] truncate text-[11px] text-slate-500" title={item.returnReason}>
                            &quot;{item.returnReason}&quot;
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-center text-xs font-medium tabular-nums text-slate-600">
                      {item.submittedAt ? formatShortDateTimeVn(item.submittedAt).replace(' ', ' · ') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex justify-center gap-1.5">
                        <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setViewing(item)}>
                          Xem lịch
                        </Button>
                        {item.status === 'SUBMITTED' && (
                          <>
                            <Button type="button" variant="success" className="px-3 py-1.5 text-xs" loading={approveMutation.isPending} onClick={() => void handleApprove(item)}>
                              Duyệt
                            </Button>
                            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setReturning(item)}>
                              Trả lại
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <ScheduleMonthDialog
          item={viewing}
          onClose={() => setViewing(null)}
          onApprove={() => void handleApprove(viewing)}
          onReturn={() => {
            setReturning(viewing);
            setViewing(null);
          }}
        />
      )}
      {returning && (
        <ReasonConfirmDialog
          title={`Trả lại đăng ký ${formatMonthLabel(returning.month).toLowerCase()}`}
          description={`${returning.userFullName} sẽ thấy lý do và sửa lại được.`}
          confirmLabel="Trả lại"
          confirmVariant="danger"
          onConfirm={(reason) => returnMutation.mutateAsync({ id: returning.id, version: returning.version, reason })}
          onDone={() => {
            setReturning(null);
            flash('Đã trả lại đăng ký.');
          }}
          onClose={() => setReturning(null)}
        />
      )}
    </div>
  );
}
