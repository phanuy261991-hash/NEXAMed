import { useState } from 'react';
import { ClipboardText, Play } from '@phosphor-icons/react';
import type { ReceptionListItem } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useReceptionListQuery, useStartConsultationMutation } from './reception.queries';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * "Hàng đợi khám" — khu vực/trang RIÊNG cho bác sĩ (khác "Danh sách tiếp nhận" của lễ tân, đã
 * chốt lại với chủ dự án — xem docs/DECISIONS.md), chỉ hiển thị bệnh nhân đang chờ (`CHECKED_IN`)
 * của CHÍNH bác sĩ đang đăng nhập trong ngày hôm nay. `encounter.read` của bác sĩ là scope
 * `global` (cần để tra cứu bệnh nhân khác khi cần) nên phải LỌC TƯỜNG MINH theo `doctorId` ở đây,
 * không dựa vào permission scope. "Bắt đầu khám" (CHECKED_IN→IN_CONSULTATION) chuyển hẳn về đây
 * từ "Danh sách tiếp nhận" — đúng đối tượng thao tác (`docs/DECISIONS.md` #044). Chưa mở màn hình
 * khám bệnh thật (chặn bởi ICD-10, ngoài phạm vi hiện tại) — bấm xong chỉ chuyển trạng thái, dòng
 * tự biến mất khỏi hàng đợi (đã sang IN_CONSULTATION).
 */
export function ReceptionDoctorQueuePage() {
  useBreadcrumb([{ label: 'Tiếp nhận và Đặt lịch' }, { label: 'Hàng đợi khám' }]);
  const currentUser = useAuthStore((s) => s.user);
  const today = getVietnamTodayDateString();
  const [rowError, setRowError] = useState<string | null>(null);

  const listQuery = useReceptionListQuery(today, currentUser?.id);
  const startConsultationMutation = useStartConsultationMutation();
  const items = (listQuery.data?.items ?? []).filter((i) => i.status === 'CHECKED_IN');

  async function handleStartConsultation(item: ReceptionListItem) {
    setRowError(null);
    try {
      await startConsultationMutation.mutateAsync({ id: item.encounterId, body: { version: item.version } });
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h1 className="text-[17px] font-bold text-slate-900">Hàng đợi khám hôm nay</h1>

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
              <div>
                <div className="text-sm font-semibold text-slate-900">{item.fullName}</div>
                <div className="text-xs text-slate-500">
                  {item.phone} · Tiếp nhận lúc {formatTime(item.checkedInAt)} · {item.encounterNo}
                </div>
              </div>
              <Button type="button" loading={startConsultationMutation.isPending} onClick={() => void handleStartConsultation(item)}>
                <Play size={13} weight="bold" aria-hidden="true" />
                Bắt đầu khám
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
