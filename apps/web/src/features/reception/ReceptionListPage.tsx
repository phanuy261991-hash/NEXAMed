import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, ClipboardText } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDoctorsQuery } from '../appointment/appointment.queries';
import { addDays, formatDateLabel, getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { ENCOUNTER_STATUS_META } from './encounter-status';
import { useReceptionListQuery } from './reception.queries';

const GRID_COLUMNS = '100px 1.3fr 130px 1fr 130px';
const ROW_HEIGHT_PX = 48;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * "Danh sách tiếp nhận" (Sprint 3, REC-01→03) — THUẦN theo dõi trạng thái cho lễ tân, không có
 * thao tác nào trên trang này (`docs/DECISIONS.md` #044): CHỈ hồ sơ đã có `encounter` (đã tiếp
 * nhận), theo dõi trạng thái trong ngày: Đã tiếp nhận → Đang khám → Đã khám xong (+ Đã huỷ/bỏ
 * về). KHÔNG gồm lịch hẹn `SCHEDULED` chưa tới — check-in từ lịch hẹn thực hiện ở panel chi tiết
 * Lịch hẹn; tạo mới không qua đặt lịch thực hiện ở trang riêng "Tiếp nhận bệnh nhân" (menu
 * sidebar, không lặp lại lối tắt trên trang này). "Sinh hiệu"/"Bắt đầu khám" đã chuyển hẳn khỏi
 * trang này — sinh hiệu nhập ngay lúc tiếp nhận (trên biểu mẫu), "Bắt đầu khám" là thao tác của
 * bác sĩ nên chuyển sang "Hàng đợi khám" (`ReceptionDoctorQueuePage.tsx`).
 */
export function ReceptionListPage() {
  useBreadcrumb([{ label: 'Tiếp nhận và Đặt lịch' }, { label: 'Danh sách tiếp nhận' }]);

  const [date, setDate] = useState(getVietnamTodayDateString());

  const doctorsQuery = useDoctorsQuery();
  const listQuery = useReceptionListQuery(date);

  const doctorNameById = useMemo(() => new Map((doctorsQuery.data?.items ?? []).map((d) => [d.id, d.fullName])), [doctorsQuery.data]);
  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Danh sách tiếp nhận</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2.5 px-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, -1))}
            aria-label="Ngày trước"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <span className="min-w-[168px] rounded-md border border-slate-300 px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900">
            {formatDateLabel(date)}
          </span>
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, 1))}
            aria-label="Ngày sau"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretRight size={15} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => setDate(getVietnamTodayDateString())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Hôm nay
          </button>
          {listQuery.isSuccess && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-[13px] font-bold text-blue-700">
              <ClipboardText size={15} weight="bold" aria-hidden="true" />
              {items.length} lượt tiếp nhận
            </span>
          )}
        </div>
      </div>

      {(listQuery.isPending || doctorsQuery.isPending) && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isError && (
        <ErrorBanner
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách tiếp nhận.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}

      {listQuery.isSuccess && !doctorsQuery.isPending && items.length === 0 && (
        <EmptyState
          icon={ClipboardText}
          title="Chưa có ai được tiếp nhận trong ngày này"
          description="Tiếp nhận từ lịch hẹn ở trang Lịch hẹn, hoặc khách đến thẳng phòng khám ở mục &quot;Tiếp nhận bệnh nhân&quot;."
        />
      )}

      {listQuery.isSuccess && !doctorsQuery.isPending && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách tiếp nhận" className="flex h-full flex-col">
            <div
              role="row"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
              className="grid flex-shrink-0 border-b border-slate-200 bg-slate-50 px-4 text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              <div role="columnheader" className="py-2.5">Giờ tiếp nhận</div>
              <div role="columnheader" className="py-2.5">Họ tên / SĐT</div>
              <div role="columnheader" className="py-2.5">Bác sĩ</div>
              <div role="columnheader" className="py-2.5">Mã lượt khám</div>
              <div role="columnheader" className="py-2.5">Trạng thái</div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.map((item) => {
                const meta = ENCOUNTER_STATUS_META[item.status];
                return (
                  <div
                    key={item.encounterId}
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                    className="grid items-center border-b border-slate-100 px-4 text-sm"
                  >
                    <div role="cell" className="tabular-nums text-slate-600">{formatTime(item.checkedInAt)}</div>
                    <div role="cell" className="truncate">
                      <div className="text-slate-900">{item.fullName}</div>
                      <div className="text-xs text-slate-500">{item.phone}</div>
                    </div>
                    <div role="cell" className="truncate text-slate-600">{doctorNameById.get(item.doctorId) ?? '—'}</div>
                    <div role="cell" className="font-mono text-xs text-slate-500">{item.encounterNo}</div>
                    <div role="cell">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.bg} ${meta.text}`}>
                        {meta.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
