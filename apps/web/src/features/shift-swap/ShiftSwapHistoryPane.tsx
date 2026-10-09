import { useEffect, useRef } from 'react';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import type { ShiftSwapItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { useMarkShiftSwapsSeenMutation, useShiftSwapsQuery } from './shift-swap.queries';

const STATUS: Record<ShiftSwapItem['status'], { label: string; tone: StatusBadgeTone }> = {
  PENDING: { label: 'Chờ xác nhận', tone: 'warning' },
  ACCEPTED: { label: 'Đã đổi', tone: 'success' },
  DECLINED: { label: 'Từ chối', tone: 'neutral' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
  EXPIRED: { label: 'Quá hạn', tone: 'neutral' },
};

function ddmm(dateStr: string): string {
  return `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

/**
 * Tab "Đổi ca" ở "Lịch làm việc nhân viên" ("Đổi ca", #225, mockup đã duyệt màn 7) — CHỈ XEM lịch sử, quản lý
 * không duyệt/sửa. Mở tab thì đánh dấu đã xem (chấm số tắt) nhưng các dòng mới của lần mở này vẫn giữ nhãn "Mới".
 */
export function ShiftSwapHistoryPane() {
  const listQuery = useShiftSwapsQuery({});
  const markSeen = useMarkShiftSwapsSeenMutation();
  // Chụp danh sách "mới" ở lần tải ĐẦU TIÊN — sau khi đánh dấu đã xem, dữ liệu tải lại không còn cờ mới.
  const newIds = useRef<Set<string> | null>(null);
  if (listQuery.isSuccess && newIds.current === null) {
    newIds.current = new Set(listQuery.data.items.filter((i) => i.isNewForManager).map((i) => i.id));
  }
  const markedRef = useRef(false);
  useEffect(() => {
    if (listQuery.isSuccess && !markedRef.current) {
      markedRef.current = true;
      if ((newIds.current?.size ?? 0) > 0) markSeen.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery.isSuccess]);

  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {listQuery.isPending && <Skeleton className="h-40 w-full" />}
      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được lịch sử đổi ca.'} onRetry={() => void listQuery.refetch()} />
      )}
      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={ArrowsLeftRight} title="Chưa có yêu cầu đổi ca nào" description="Nhân viên đổi ca với nhau từ Lịch làm việc của tôi; lịch sử hiện ở đây." />
      )}
      {listQuery.isSuccess && items.length > 0 && (
        <>
          <div className="scroll-hover min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="px-3 py-2.5 text-center">Gửi lúc</th>
                  <th className="px-3 py-2.5 text-center">Người gửi</th>
                  <th className="px-3 py-2.5 text-center">Ca đưa</th>
                  <th className="px-3 py-2.5 text-center">Người nhận</th>
                  <th className="px-3 py-2.5 text-center">Ca nhận lại</th>
                  <th className="px-3 py-2.5 text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const badge = STATUS[item.status];
                  const isNew = newIds.current?.has(item.id) ?? false;
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2.5 text-center text-xs font-medium tabular-nums text-slate-600">
                        {formatShortDateTimeVn(item.createdAt).replace(' ', ' · ')}
                        {isNew && (
                          <div className="mt-0.5">
                            <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Mới</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center font-medium">{item.requesterName}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="font-bold tabular-nums text-brand-teal">{ddmm(item.requesterAssignment.workDate)}</span> · {item.requesterAssignment.workShiftName}
                      </td>
                      <td className="px-3 py-2.5 text-center font-medium">{item.counterpartName}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="font-bold tabular-nums text-brand-teal">{ddmm(item.counterpartAssignment.workDate)}</span> · {item.counterpartAssignment.workShiftName}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                        {item.status === 'ACCEPTED' && item.respondedAt && (
                          <div className="mt-0.5 text-[11px] text-slate-500">xác nhận {formatShortDateTimeVn(item.respondedAt).replace(' ', ' · ')}</div>
                        )}
                        {item.status === 'DECLINED' && item.declineReason && (
                          <div className="mx-auto mt-0.5 max-w-[200px] truncate text-[11px] text-slate-500" title={item.declineReason}>
                            &quot;{item.declineReason}&quot;
                          </div>
                        )}
                        {item.status === 'CANCELLED' && <div className="mt-0.5 text-[11px] text-slate-500">người gửi huỷ</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Chỉ xem. Quản lý không duyệt hoặc sửa ở đây; muốn đổi lại thì dùng quyền &quot;Sửa lịch đã khoá&quot; ở lịch tháng.</p>
        </>
      )}
    </div>
  );
}
