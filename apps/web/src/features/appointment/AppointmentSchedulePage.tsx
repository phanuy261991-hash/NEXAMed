import { useEffect, useState } from 'react';
import { CalendarBlank, CaretLeft, CaretRight, Clock, ListBullets, Plus, SquaresFour } from '@phosphor-icons/react';
import type { AppointmentSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { AppointmentDetailPanel } from './AppointmentDetailPanel';
import { AppointmentGridView } from './AppointmentGridView';
import { AppointmentListView } from './AppointmentListView';
import { AppointmentQuickCreatePanel } from './AppointmentQuickCreatePanel';
import { useAppointmentsByDateQuery, useDoctorsQuery, useScheduleConfigQuery } from './appointment.queries';
import { addDays, formatDateLabel, getVietnamTodayDateString } from './schedule-grid.utils';

const LEGEND = [
  { label: 'Đã đặt', className: 'bg-blue-600' },
  { label: 'Đã chuyển khám', className: 'bg-emerald-500' },
  { label: 'Không đến', className: 'bg-amber-500' },
  { label: 'Đã huỷ', className: 'bg-slate-300' },
];

/**
 * Lịch hẹn (S2-09, APP-01) — 2 chế độ hiển thị đã duyệt qua mockup: lưới theo bác sĩ/khung giờ
 * (mặc định) và danh sách (List Screen Pattern). Toggle bằng state cục bộ, không phải 2 route
 * riêng — cùng breadcrumb.
 */
export function AppointmentSchedulePage() {
  useBreadcrumb([{ label: 'Tiếp nhận và Đặt lịch' }, { label: 'Lịch hẹn' }]);

  const [date, setDate] = useState(getVietnamTodayDateString());
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [quickCreate, setQuickCreate] = useState<{ open: boolean; doctorId: string | null; time: string }>({
    open: false,
    doctorId: null,
    time: '08:00',
  });
  const [detailAppointment, setDetailAppointment] = useState<AppointmentSummary | null>(null);

  const doctorsQuery = useDoctorsQuery();
  const scheduleConfigQuery = useScheduleConfigQuery();
  const dayQuery = useAppointmentsByDateQuery(date);

  const doctors = doctorsQuery.data?.items ?? [];
  const dayAppointments = dayQuery.data?.items ?? [];
  const defaultDuration = scheduleConfigQuery.data?.slotDurationMinutes ?? 15;

  function openQuickCreate(doctorId: string | null, time: string) {
    setDetailAppointment(null);
    setQuickCreate({ open: true, doctorId, time });
  }

  function openDetail(appointment: AppointmentSummary) {
    setQuickCreate((s) => ({ ...s, open: false }));
    setDetailAppointment(appointment);
  }

  const loadingBase = doctorsQuery.isPending || scheduleConfigQuery.isPending;
  const baseError = doctorsQuery.error ?? scheduleConfigQuery.error;

  // Phím tắt F2 = bấm nút "Đặt lịch" — bỏ qua khi đang gõ trong một ô nhập/textarea/select khác
  // (ví dụ ô tìm kiếm ở trang khác điều hướng tới đây) để không cướp phím tắt hệ điều hành/trình
  // duyệt có thể gán riêng cho ô đó.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'F2') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      openQuickCreate(null, '08:00');
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Lịch hẹn</h1>

      {/* Gộp 2 hàng công cụ cũ (nút "Đặt lịch" riêng + hàng điều hướng ngày) thành 1 hàng —
          nhường thêm vùng nhìn thấy cho lưới mà không đổi ROW_HEIGHT_PX/bước 30 phút (quyết
          định đã chốt lúc S2-09, không tự đổi mật độ dữ liệu — xem docs/CURRENT.md). */}
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
          {dayQuery.isSuccess && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-[13px] font-bold text-blue-700">
              <CalendarBlank size={15} weight="bold" aria-hidden="true" />
              {dayAppointments.length} lịch hẹn trong ngày
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {view === 'grid' && (
            <div className="hidden items-center gap-3.5 text-xs text-slate-500 lg:flex">
              {LEGEND.map((l) => (
                <span key={l.label} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${l.className}`} aria-hidden="true" />
                  {l.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5 border-l border-slate-200 pl-3.5">
                <Clock size={11} weight="bold" className="text-amber-500" aria-hidden="true" />
                Trễ hẹn
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0 w-3 border-t-[1.5px] border-dashed border-rose-500" aria-hidden="true" />
                Bây giờ
              </span>
            </div>
          )}
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold ${
                view === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <SquaresFour size={14} weight="bold" aria-hidden="true" />
              Lưới
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 border-l border-slate-300 px-3 py-1.5 text-[13px] font-semibold ${
                view === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <ListBullets size={14} weight="bold" aria-hidden="true" />
              Danh sách
            </button>
          </div>
          <Button type="button" title="Đặt lịch nhanh — bấm F2 để mở nhanh" onClick={() => openQuickCreate(null, '08:00')}>
            <Plus size={15} weight="bold" aria-hidden="true" />
            Đặt lịch
          </Button>
        </div>
      </div>

      {loadingBase && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {!loadingBase && baseError && (
        <ErrorBanner
          message={baseError instanceof ApiError ? baseError.message : 'Không tải được dữ liệu lịch hẹn.'}
          onRetry={() => {
            void doctorsQuery.refetch();
            void scheduleConfigQuery.refetch();
          }}
        />
      )}

      {!loadingBase && !baseError && view === 'grid' && (
        <>
          {dayQuery.isPending && (
            <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {dayQuery.isError && (
            <ErrorBanner
              message={dayQuery.error instanceof ApiError ? dayQuery.error.message : 'Không tải được lịch hẹn trong ngày.'}
              onRetry={() => void dayQuery.refetch()}
            />
          )}
          {dayQuery.isSuccess && (
            <AppointmentGridView
              date={date}
              appointments={dayAppointments}
              doctors={doctors}
              businessHours={scheduleConfigQuery.data?.businessHours ?? null}
              onSlotClick={(doctorId, time) => openQuickCreate(doctorId, time)}
              onCardClick={openDetail}
            />
          )}
        </>
      )}

      {!loadingBase && !baseError && view === 'list' && <AppointmentListView date={date} doctors={doctors} onOpenAppointment={openDetail} />}

      <AppointmentQuickCreatePanel
        open={quickCreate.open}
        onClose={() => setQuickCreate((s) => ({ ...s, open: false }))}
        date={date}
        initialDoctorId={quickCreate.doctorId}
        initialTime={quickCreate.time}
        doctors={doctors}
        defaultDurationMinutes={defaultDuration}
      />

      <AppointmentDetailPanel
        appointment={detailAppointment}
        onClose={() => setDetailAppointment(null)}
        date={date}
        doctors={doctors}
        defaultDurationMinutes={defaultDuration}
      />

      {doctors.length === 0 && !loadingBase && !baseError && (
        <p className="flex flex-shrink-0 items-center gap-1.5 px-1 text-xs text-slate-400">
          <CalendarBlank size={13} aria-hidden="true" />
          Chưa có bác sĩ nào — vào Quản trị để tạo tài khoản và gán vai trò bác sĩ.
        </p>
      )}
    </div>
  );
}
