import { useState } from 'react';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import type { ShiftSwapItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { formatWeekdayDate } from '../work-shift-assignment/schedule-month';
import { useAcceptShiftSwapMutation, useDeclineShiftSwapMutation, useShiftSwapsQuery } from './shift-swap.queries';

/**
 * Hộp "Yêu cầu đổi ca" của NGƯỜI NHẬN ("Đổi ca", #225, mockup đã duyệt màn 6): "Bạn nhận … / Bạn đưa …".
 * Xác nhận xong hai ca đổi chủ ngay, không cần quản lý duyệt.
 */
export function IncomingShiftSwapDialog({ onClose }: { onClose: () => void }) {
  const listQuery = useShiftSwapsQuery({ status: 'PENDING' });
  const acceptMutation = useAcceptShiftSwapMutation();
  const declineMutation = useDeclineShiftSwapMutation();
  const [error, setError] = useState<string | null>(null);
  const incoming = (listQuery.data?.items ?? []).filter((i) => i.canRespond);

  async function respond(item: ShiftSwapItem, action: 'accept' | 'decline') {
    setError(null);
    try {
      if (action === 'accept') await acceptMutation.mutateAsync({ id: item.id, version: item.version });
      else await declineMutation.mutateAsync({ id: item.id, version: item.version });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thao tác thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="incoming-swap-title">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader icon={ArrowsLeftRight} title="Yêu cầu đổi ca" subtitle="Xác nhận xong, hai ca đổi cho nhau ngay" onClose={onClose} />
        {listQuery.isPending && <Skeleton className="h-32 w-full" />}
        {listQuery.isSuccess && incoming.length === 0 && <p className="py-6 text-center text-sm font-medium text-slate-500">Không còn yêu cầu nào chờ bạn xác nhận.</p>}
        <div className="flex flex-col gap-5">
          {incoming.map((item) => (
            <div key={item.id} className="flex flex-col gap-3">
              <div className="text-xs text-slate-500">
                {item.requesterName} gửi lúc {formatShortDateTimeVn(item.createdAt).replace(' ', ' · ')}
              </div>
              <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Bạn nhận</div>
                  <div className="text-sm font-bold">
                    {item.requesterAssignment.workShiftName} · {formatWeekdayDate(item.requesterAssignment.workDate)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {item.requesterAssignment.startTime} – {item.requesterAssignment.endTime} (của {item.requesterName})
                  </div>
                </div>
                <ArrowsLeftRight size={20} weight="bold" className="mx-auto text-slate-400" aria-hidden="true" />
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Bạn đưa</div>
                  <div className="text-sm font-bold">
                    {item.counterpartAssignment.workShiftName} · {formatWeekdayDate(item.counterpartAssignment.workDate)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {item.counterpartAssignment.startTime} – {item.counterpartAssignment.endTime} (của bạn)
                  </div>
                </div>
              </div>
              {item.note && (
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-800">Ghi chú:</span> {item.note}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" loading={declineMutation.isPending} onClick={() => void respond(item, 'decline')}>
                  Từ chối
                </Button>
                <Button type="button" loading={acceptMutation.isPending} onClick={() => void respond(item, 'accept')}>
                  Xác nhận đổi ca
                </Button>
              </div>
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
