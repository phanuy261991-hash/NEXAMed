import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardText, MapPinLine, Play } from '@phosphor-icons/react';
import type { ReceptionListItem } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { RoomSessionDialog } from '../clinic/RoomSessionDialog';
import { useMyRoomSessionQuery, useRoomOptionsQuery } from '../clinic/clinic.queries';
import { useReceptionListQuery, useStartConsultationMutation } from './reception.queries';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * "Hàng đợi khám" — khu vực/trang RIÊNG cho bác sĩ (khác "Danh sách tiếp nhận" của lễ tân, đã
 * chốt lại với chủ dự án — xem docs/DECISIONS.md), chỉ hiển thị bệnh nhân đang chờ (`CHECKED_IN`)
 * hoặc đang khám dở (`IN_CONSULTATION`) của CHÍNH bác sĩ đang đăng nhập trong ngày hôm nay.
 * `encounter.read` của bác sĩ là scope `global` (cần để tra cứu bệnh nhân khác khi cần) nên phải
 * LỌC TƯỜNG MINH theo `doctorId` ở đây, không dựa vào permission scope. "Bắt đầu khám"
 * (CHECKED_IN→IN_CONSULTATION) chuyển hẳn về đây từ "Danh sách tiếp nhận" — đúng đối tượng thao
 * tác (`docs/DECISIONS.md` #044). Sau khi chuyển trạng thái, điều hướng thẳng vào màn hình khám
 * (`/encounters/:id`, S3-06/07) — dòng `IN_CONSULTATION` vẫn hiện ở đây với nút "Tiếp tục khám" để
 * bác sĩ quay lại nếu lỡ rời màn hình/F5 giữa chừng.
 */
export function ReceptionDoctorQueuePage() {
  useBreadcrumb([{ label: 'Khám bệnh' }, { label: 'Hàng đợi khám' }]);
  const currentUser = useAuthStore((s) => s.user);
  const today = getVietnamTodayDateString();
  const navigate = useNavigate();
  const [rowError, setRowError] = useState<string | null>(null);

  const listQuery = useReceptionListQuery(today, currentUser?.id);
  const startConsultationMutation = useStartConsultationMutation();
  const items = (listQuery.data?.items ?? []).filter((i) => i.status === 'CHECKED_IN' || i.status === 'IN_CONSULTATION');

  // "Đang ở phòng nào" (docs/DECISIONS.md #054) — 0-1 phòng active thì tự ẩn hoàn toàn, cùng logic
  // RoomSessionGate.tsx (không lặp query khi tenant chưa dùng mô hình nhiều phòng).
  const roomOptionsQuery = useRoomOptionsQuery();
  const multiRoomActive = (roomOptionsQuery.data?.items.length ?? 0) > 1;
  const mySessionQuery = useMyRoomSessionQuery(multiRoomActive);
  const [changingRoom, setChangingRoom] = useState(false);

  async function handleStartConsultation(item: ReceptionListItem) {
    setRowError(null);
    try {
      await startConsultationMutation.mutateAsync({ id: item.encounterId, body: { version: item.version } });
      navigate(`/encounters/${item.encounterId}`);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-[17px] font-bold text-slate-900">Hàng đợi khám hôm nay</h1>
        {multiRoomActive && mySessionQuery.data && (
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            <MapPinLine size={13} weight="bold" aria-hidden="true" />
            Đang ở: {mySessionQuery.data.roomName}
            <button type="button" onClick={() => setChangingRoom(true)} className="font-semibold text-blue-600 hover:text-blue-700">
              Đổi phòng
            </button>
          </span>
        )}
      </div>

      {changingRoom && (
        <RoomSessionDialog
          options={roomOptionsQuery.data?.items ?? []}
          currentRoomId={mySessionQuery.data?.roomId}
          dismissible
          onClose={() => setChangingRoom(false)}
        />
      )}

      {rowError && <ErrorBanner message={rowError} />}

      {listQuery.isPending && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {listQuery.isError && (
        <ErrorBanner
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được hàng đợi.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={ClipboardText} title="Chưa có bệnh nhân nào chờ khám" description="Bệnh nhân đã tiếp nhận và đang chờ bạn khám sẽ hiện ở đây." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.encounterId}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex items-center gap-2">
                {item.status === 'IN_CONSULTATION' && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Đang khám</span>
                )}
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.fullName}</div>
                  <div className="text-xs text-slate-500">
                    {item.phone} · Tiếp nhận lúc {formatTime(item.checkedInAt)} · {item.encounterNo}
                  </div>
                </div>
              </div>
              {item.status === 'IN_CONSULTATION' ? (
                <Button type="button" variant="secondary" onClick={() => navigate(`/encounters/${item.encounterId}`)}>
                  <ArrowRight size={13} weight="bold" aria-hidden="true" />
                  Tiếp tục khám
                </Button>
              ) : (
                <Button type="button" loading={startConsultationMutation.isPending} onClick={() => void handleStartConsultation(item)}>
                  <Play size={13} weight="bold" aria-hidden="true" />
                  Bắt đầu khám
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
