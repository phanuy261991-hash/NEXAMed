import { useState } from 'react';
import { CalendarX, Plus } from '@phosphor-icons/react';
import type { LeaveRequestItem, LeaveRequestStatus } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { useUserAccountsQuery } from '../user-account/user-account.queries';
import { LeaveApproveDialog } from './LeaveApproveDialog';
import { LeaveRequestDialog } from './LeaveRequestDialog';
import { useCancelLeaveRequestMutation, useLeaveRequestPendingCountQuery, useLeaveRequestsQuery, useRejectLeaveRequestMutation } from './leave-request.queries';
import { formatLeaveWindow } from './leave-window';

type StatusFilter = LeaveRequestStatus | 'ALL';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'PENDING', label: 'Chờ duyệt' },
  { id: 'APPROVED', label: 'Đã duyệt' },
  { id: 'REJECTED', label: 'Từ chối' },
  { id: 'ALL', label: 'Tất cả' },
];

const STATUS_BADGE: Record<LeaveRequestStatus, { label: string; tone: StatusBadgeTone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'neutral' },
  WITHDRAWN: { label: 'Đã rút', tone: 'neutral' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

const WEEKDAY_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function formatDdMmYyyy(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function getTodayDateString(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Tab "Đơn xin nghỉ" ở "Lịch làm việc nhân viên" ("Đơn xin nghỉ", #224, mockup đã duyệt màn 2) — bảng
 * đơn theo trạng thái, Duyệt (kèm danh sách lịch hẹn bị ảnh hưởng)/Từ chối (bắt buộc lý do)/Huỷ đơn
 * đã duyệt, và "Ghi nghỉ hộ nhân viên" (duyệt luôn). Quyền gate ở nơi gọi + từng nút.
 */
export function LeaveRequestsPane() {
  const ownUserId = useAuthStore((s) => s.user?.id);
  const canApprove = useHasPermission('leave_request', 'approve');
  const canFileOnBehalf = useHasPermission('leave_request', 'file_on_behalf');

  const [filter, setFilter] = useState<StatusFilter>('PENDING');
  const [approving, setApproving] = useState<LeaveRequestItem | null>(null);
  const [rejecting, setRejecting] = useState<LeaveRequestItem | null>(null);
  const [cancelling, setCancelling] = useState<LeaveRequestItem | null>(null);
  const [onBehalfOpen, setOnBehalfOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const listQuery = useLeaveRequestsQuery(filter === 'ALL' ? {} : { status: filter });
  const pendingCountQuery = useLeaveRequestPendingCountQuery(canApprove);
  const usersQuery = useUserAccountsQuery();
  const rejectMutation = useRejectLeaveRequestMutation();
  const cancelMutation = useCancelLeaveRequestMutation();

  const items = listQuery.data?.items ?? [];
  const pendingCount = pendingCountQuery.data?.count ?? 0;
  const showStatusColumn = filter !== 'PENDING';
  const onBehalfUsers = (usersQuery.data?.items ?? [])
    .filter((u) => u.isActive && !u.roleNames.includes('system_admin'))
    .map((u) => ({ value: u.id, label: u.displayName ?? u.fullName }));

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
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
              {f.id === 'PENDING' && pendingCount > 0 && ` ${pendingCount}`}
            </button>
          ))}
        </div>
        {canFileOnBehalf && (
          <Button type="button" className="ml-auto px-3 py-1.5 text-xs" onClick={() => setOnBehalfOpen(true)}>
            <Plus size={14} weight="bold" aria-hidden="true" />
            Ghi nghỉ hộ
          </Button>
        )}
      </div>

      {toast && (
        <div className="flex flex-shrink-0 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{toast}</div>
      )}

      {listQuery.isPending && <Skeleton className="h-40 w-full" />}
      {listQuery.isError && (
        <ErrorBanner
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách đơn nghỉ.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}
      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={CalendarX}
          title={filter === 'PENDING' ? 'Không có đơn nào chờ duyệt' : 'Chưa có đơn nghỉ nào'}
          description="Nhân viên xin nghỉ ở Lịch làm việc của tôi; đơn mới sẽ hiện ở đây."
        />
      )}
      {listQuery.isSuccess && items.length > 0 && (
        <div className="scroll-hover min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                <th className="px-3 py-2.5 text-center">Nhân viên</th>
                <th className="px-3 py-2.5 text-center">Ngày nghỉ</th>
                <th className="px-3 py-2.5 text-center">Ca</th>
                <th className="px-3 py-2.5 text-center">Lý do</th>
                <th className="px-3 py-2.5 text-center">Lịch hẹn bị ảnh hưởng</th>
                {showStatusColumn && <th className="px-3 py-2.5 text-center">Trạng thái</th>}
                <th className="px-3 py-2.5 text-center">Gửi lúc</th>
                <th className="px-3 py-2.5 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const weekday = WEEKDAY_LONG[new Date(`${item.leaveDate}T00:00:00.000Z`).getUTCDay()];
                const own = item.userId === ownUserId;
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2.5 font-medium">
                      {item.userFullName}
                      {item.departmentName && <div className="text-xs text-slate-500">{item.departmentName}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="font-bold tabular-nums text-brand-teal">{formatDdMmYyyy(item.leaveDate)}</div>
                      <div className="text-xs text-slate-500">{weekday}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center font-medium">
                      {item.workShiftName ?? 'Cả ngày'}
                      {!item.isWholeDay && <div className="text-xs text-slate-500">{formatLeaveWindow(item)}</div>}
                    </td>
                    <td className="max-w-[260px] px-3 py-2.5 font-medium text-slate-700">
                      <div className="truncate" title={item.reason}>
                        {item.reason}
                      </div>
                      {item.decisionReason && (
                        <div className="truncate text-xs text-slate-500" title={item.decisionReason}>
                          {STATUS_BADGE[item.status].label}: {item.decisionReason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.affectedAppointmentCount > 0 ? (
                        <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">{item.affectedAppointmentCount} lịch hẹn</span>
                      ) : (
                        <span className="text-slate-400">Không có</span>
                      )}
                    </td>
                    {showStatusColumn && (
                      <td className="px-3 py-2.5 text-center">
                        <StatusBadge tone={STATUS_BADGE[item.status].tone}>{STATUS_BADGE[item.status].label}</StatusBadge>
                        {item.filedOnBehalf && <div className="mt-0.5 text-[11px] text-slate-500">Ghi hộ</div>}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-center text-xs font-medium tabular-nums text-slate-600">{formatShortDateTimeVn(item.createdAt).replace(' ', ' · ')}</td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex justify-center gap-1.5">
                        {canApprove && item.status === 'PENDING' && !own && (
                          <>
                            <Button type="button" variant="success" className="px-3 py-1.5 text-xs" onClick={() => setApproving(item)}>
                              Duyệt
                            </Button>
                            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setRejecting(item)}>
                              Từ chối
                            </Button>
                          </>
                        )}
                        {item.status === 'PENDING' && own && <span className="text-xs text-slate-400">Đơn của bạn</span>}
                        {canApprove && item.status === 'APPROVED' && (
                          <Button type="button" variant="dangerGhost" className="px-3 py-1.5 text-xs" onClick={() => setCancelling(item)}>
                            Huỷ đơn
                          </Button>
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

      {approving && (
        <LeaveApproveDialog
          item={approving}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            flash('Đã duyệt đơn nghỉ.');
          }}
        />
      )}
      {rejecting && (
        <ReasonConfirmDialog
          title="Từ chối đơn nghỉ"
          description={`${rejecting.userFullName} · ${formatDdMmYyyy(rejecting.leaveDate)} · ${rejecting.workShiftName ?? 'Cả ngày'}. Lý do sẽ hiện cho người xin nghỉ.`}
          confirmLabel="Từ chối đơn"
          confirmVariant="danger"
          onConfirm={(reason) => rejectMutation.mutateAsync({ id: rejecting.id, version: rejecting.version, reason })}
          onDone={() => {
            setRejecting(null);
            flash('Đã từ chối đơn nghỉ.');
          }}
          onClose={() => setRejecting(null)}
        />
      )}
      {cancelling && (
        <ReasonConfirmDialog
          title="Huỷ đơn nghỉ đã duyệt"
          description={`${cancelling.userFullName} · ${formatDdMmYyyy(cancelling.leaveDate)} · ${cancelling.workShiftName ?? 'Cả ngày'}. Khung giờ này sẽ mở lại bình thường.`}
          confirmLabel="Huỷ đơn"
          confirmVariant="danger"
          onConfirm={(reason) => cancelMutation.mutateAsync({ id: cancelling.id, version: cancelling.version, reason })}
          onDone={() => {
            setCancelling(null);
            flash('Đã huỷ đơn nghỉ.');
          }}
          onClose={() => setCancelling(null)}
        />
      )}
      {onBehalfOpen && (
        <LeaveRequestDialog
          date={getTodayDateString()}
          onBehalfUsers={onBehalfUsers}
          onClose={() => setOnBehalfOpen(false)}
          onDone={() => {
            setOnBehalfOpen(false);
            flash('Đã ghi nghỉ hộ.');
          }}
        />
      )}
    </div>
  );
}
