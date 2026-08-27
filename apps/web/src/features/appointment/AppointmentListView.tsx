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

const GRID_COLUMNS = '130px 140px 1.4fr 1.1fr 110px 130px';
const ROW_HEIGHT_PX = 52;

/** Quy đổi UTC+7 cố định — cùng kỹ thuật `vietnam-day-range.ts`/`format-display-code.ts`. */
function toVietnamDate(iso: string): Date {
  return new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Cột "Thời gian" gộp giờ bắt đầu-kết thúc (thay cột "Thời lượng" đã bỏ, chốt 2026-08-15) — giờ
 * kết thúc tính từ `scheduledAt + durationMinutes`, không phải trường riêng trên `appointment`.
 */
function formatTimeRange(scheduledAtIso: string, durationMinutes: number): string {
  const start = toVietnamDate(scheduledAtIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const fmt = (d: Date) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return `${fmt(start)} - ${fmt(end)}`;
}

function formatDateLabel(scheduledAtIso: string): string {
  const d = toVietnamDate(scheduledAtIso);
  return `${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
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
  const doctorNameById = useMemo(() => new Map(doctors.map((d) => [d.id, d.displayName ?? d.fullName])), [doctors]);

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
          className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
        >
          <div role="columnheader" className="py-2.5 text-center">Mã đặt lịch</div>
          <div role="columnheader" className="py-2.5 text-center">Thời gian</div>
          <div role="columnheader" className="py-2.5 text-center">Họ tên</div>
          <div role="columnheader" className="py-2.5 text-center">Bác sĩ</div>
          <div role="columnheader" className="py-2.5 text-center">Nguồn</div>
          <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
        </div>

        <div ref={scrollParentRef} className="scroll-hover flex-1 overflow-y-auto">
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
                    className="cursor-pointer text-center font-medium text-blue-600 hover:text-blue-700"
                  >
                    {a.bookingCode}
                  </div>
                  <div role="cell" className="text-center leading-tight">
                    <div className="font-semibold text-brand-teal tabular-nums">{formatTimeRange(a.scheduledAt, a.durationMinutes)}</div>
                    <div className="text-xs font-medium text-slate-500 tabular-nums">{formatDateLabel(a.scheduledAt)}</div>
                  </div>
                  <div role="cell" className="truncate font-medium text-slate-900">{a.fullName}</div>
                  <div role="cell" className="truncate font-medium text-slate-600">{doctorNameById.get(a.doctorId) ?? '—'}</div>
                  <div role="cell" className="text-center font-medium text-slate-600">{APPOINTMENT_SOURCE_LABEL[a.source]}</div>
                  <div role="cell" className="text-center">
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
