import { useEffect, useMemo, useRef } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AppointmentSummary, DoctorOption } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { APPOINTMENT_SOURCE_LABEL, APPOINTMENT_STATUS_META } from './appointment-status';
import { useAppointmentsListQuery } from './appointment.queries';

const GRID_COLUMNS = '130px 1.4fr 1.1fr 150px 90px 110px 130px';
const ROW_HEIGHT_PX = 44;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${vn.getUTCFullYear()} ${hh}:${mi}`;
}

/**
 * Chế độ danh sách (S2-09) — tái dùng nguyên List Screen Pattern đã có ở `PatientListPage.tsx`
 * (.claude/docs/ui-guidelines.md mục 9, tài liệu đó đã nêu đích danh "lịch hẹn" là nơi áp dụng
 * tiếp theo): CSS Grid + `@tanstack/react-virtual`, cuộn vô hạn cursor, mở chi tiết bằng
 * double-click vào cột định danh (mã đặt lịch).
 */
export function AppointmentListView({
  date,
  doctors,
  onOpenAppointment,
}: {
  date: string;
  doctors: DoctorOption[];
  onOpenAppointment: (a: AppointmentSummary) => void;
}) {
  const query = useAppointmentsListQuery(date);
  const doctorNameById = useMemo(() => new Map(doctors.map((d) => [d.id, d.fullName])), [doctors]);

  const appointments = query.data?.pages.flatMap((page) => page.items) ?? [];
  const hasNextPage = query.hasNextPage ?? false;
  const rowCount = hasNextPage ? appointments.length + 1 : appointments.length;

  const scrollParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastVirtualRowIndex = virtualRows[virtualRows.length - 1]?.index;

  useEffect(() => {
    if (lastVirtualRowIndex === undefined) return;
    if (lastVirtualRowIndex >= appointments.length - 1 && hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [lastVirtualRowIndex, appointments.length, hasNextPage, query.isFetchingNextPage, query]);

  if (query.isPending) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorBanner
        message={query.error instanceof ApiError ? query.error.message : 'Không tải được danh sách lịch hẹn.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (appointments.length === 0) {
    return <EmptyState icon={CalendarBlank} title="Chưa có lịch hẹn nào" description="Đặt lịch mới từ chế độ Lưới hoặc nút Đặt lịch." />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div role="table" aria-label="Danh sách lịch hẹn" className="flex h-full flex-col">
        <div
          role="row"
          style={{ gridTemplateColumns: GRID_COLUMNS }}
          className="grid flex-shrink-0 border-b border-slate-200 bg-slate-50 px-4 text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          <div role="columnheader" className="py-2.5">Mã đặt lịch</div>
          <div role="columnheader" className="py-2.5">Họ tên</div>
          <div role="columnheader" className="py-2.5">Bác sĩ</div>
          <div role="columnheader" className="py-2.5">Ngày giờ</div>
          <div role="columnheader" className="py-2.5">Thời lượng</div>
          <div role="columnheader" className="py-2.5">Nguồn</div>
          <div role="columnheader" className="py-2.5">Trạng thái</div>
        </div>

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {virtualRows.map((virtualRow) => {
              const a = appointments[virtualRow.index];
              const rowStyle = {
                position: 'absolute' as const,
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              };

              if (!a) {
                return (
                  <div key="loading-sentinel" style={rowStyle} className="flex items-center justify-center gap-2 text-xs text-slate-400">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" aria-hidden="true" />
                    Đang tải thêm lịch hẹn…
                  </div>
                );
              }

              const meta = APPOINTMENT_STATUS_META[a.status];
              return (
                <div
                  key={a.id}
                  role="row"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onOpenAppointment(a)}
                  style={{ ...rowStyle, gridTemplateColumns: GRID_COLUMNS }}
                  className="grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/40"
                >
                  <div
                    role="cell"
                    onDoubleClick={() => onOpenAppointment(a)}
                    className="w-fit cursor-pointer font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700"
                  >
                    {a.bookingCode}
                  </div>
                  <div role="cell" className="truncate text-slate-900">{a.fullName}</div>
                  <div role="cell" className="truncate text-slate-600">{doctorNameById.get(a.doctorId) ?? '—'}</div>
                  <div role="cell" className="tabular-nums text-slate-600">{formatDateTime(a.scheduledAt)}</div>
                  <div role="cell" className="tabular-nums text-slate-600">{a.durationMinutes} phút</div>
                  <div role="cell" className="text-slate-600">{APPOINTMENT_SOURCE_LABEL[a.source]}</div>
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
    </div>
  );
}
