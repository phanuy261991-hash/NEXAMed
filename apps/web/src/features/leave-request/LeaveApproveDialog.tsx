import { useState } from 'react';
import { CalendarCheck } from '@phosphor-icons/react';
import type { LeaveRequestItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatClockTime } from '../../shared/format/time';
import { useApproveLeaveRequestMutation, useLeaveRequestAffectedAppointmentsQuery } from './leave-request.queries';
import { formatLeaveWindow } from './leave-window';

function formatDdMmYyyy(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Hộp "Duyệt đơn nghỉ" ("Đơn xin nghỉ", #224, mockup đã duyệt màn 2) — liệt kê lịch hẹn còn "Đã đặt"
 * nằm trong khung nghỉ để người duyệt biết hệ quả: sau khi duyệt các lịch này chuyển "Cần xử lý" ở
 * Lịch hẹn (hệ thống KHÔNG tự huỷ/chuyển), không đặt thêm lịch mới vào khung đó.
 */
export function LeaveApproveDialog({ item, onClose, onDone }: { item: LeaveRequestItem; onClose: () => void; onDone: () => void }) {
  const affectedQuery = useLeaveRequestAffectedAppointmentsQuery(item.id);
  const approveMutation = useApproveLeaveRequestMutation();
  const [error, setError] = useState<string | null>(null);
  const affected = affectedQuery.data?.items ?? [];

  async function handleApprove() {
    setError(null);
    try {
      await approveMutation.mutateAsync({ id: item.id, version: item.version });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Duyệt đơn thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="leave-approve-title">
      <div className="max-h-full w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader
          icon={CalendarCheck}
          title="Duyệt đơn nghỉ"
          subtitle={`${item.userFullName} · ${item.workShiftName ?? 'Cả ngày'} ${formatDdMmYyyy(item.leaveDate)} (${formatLeaveWindow(item)})`}
          onClose={onClose}
        />
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleApprove();
          }}
        >
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-slate-800">Lý do:</span> {item.reason}
          </p>

          {affectedQuery.isPending && <Skeleton className="h-16 w-full" />}
          {affectedQuery.isError && <p className="text-xs font-medium text-rose-600">Không tải được danh sách lịch hẹn bị ảnh hưởng.</p>}
          {affectedQuery.isSuccess &&
            (affected.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-600">Không có lịch hẹn nào trong khung nghỉ này.</p>
            ) : (
              <>
                <div className="text-sm font-semibold text-slate-800">
                  {affected.length} lịch hẹn trong khung nghỉ — sau khi duyệt sẽ chuyển sang &quot;Cần xử lý&quot; ở Lịch hẹn:
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase text-slate-800">
                      <th className="px-3 py-2 text-center">Giờ</th>
                      <th className="px-3 py-2 text-center">Bệnh nhân</th>
                      <th className="px-3 py-2 text-center">SĐT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {affected.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 text-center font-semibold tabular-nums text-brand-teal">
                          {formatClockTime(a.scheduledAt)} – {formatClockTime(new Date(new Date(a.scheduledAt).getTime() + a.durationMinutes * 60_000).toISOString())}
                        </td>
                        <td className="px-3 py-2 font-medium">{a.fullName}</td>
                        <td className="px-3 py-2 text-center tabular-nums">{a.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ))}
          <p className="text-xs text-slate-500">Duyệt xong: không đặt lịch mới vào bác sĩ này trong khung nghỉ. Lịch đã có không tự huỷ.</p>

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" variant="success" loading={approveMutation.isPending}>
              Duyệt nghỉ
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
