import { useEffect, useState } from 'react';
import { CalendarBlank, Warning } from '@phosphor-icons/react';
import type { PendingClosureDayDto } from '@nexamed/shared';
import { useClosePendingShiftsMutation } from '../../features/clinic/clinic.queries';
import { ApiError } from '../api/client';
import { classifySystemFailure } from '../errors/system-failure';
import { Button } from './Button';
import { DoctorShiftSummaryPanel, formatDayMonth, formatTodayChipLabel } from './DoctorEndShiftDialog';
import { ErrorBanner } from './ErrorBanner';

/** Lưới bảng nhiều ngày — tiêu đề và dòng dữ liệu dùng CHUNG một khuôn cột và khoảng cách (ui-guidelines mục 14). */
const MULTI_DAY_COLUMNS = 'minmax(0,1.6fr) repeat(3,minmax(0,1fr))';

/** "07:30–11:30 và 13:30–17:30" — các ca đã xếp của một ngày, nối bằng "và". */
export function formatShiftRanges(shifts: ReadonlyArray<{ startTime: string; endTime: string }>): string {
  return shifts.map((shift) => `${shift.startTime}–${shift.endTime}`).join(' và ');
}

/** Tổng số lượt khám dở của các ngày — "lượt khám chưa xử lý" tự chuyển về hàng chờ chung Khoa khi đóng ca. */
export function sumUnprocessed(days: readonly PendingClosureDayDto[]): number {
  return days.reduce((total, day) => total + day.unprocessedCount, 0);
}

/** Lý do điền sẵn: "Quên đóng ca ngày 27/10" / "Quên đóng ca các ngày 23/10, 26/10 và 27/10". */
export function defaultCloseReason(days: readonly PendingClosureDayDto[], onBehalf: boolean): string {
  const labels = days.map((day) => formatDayMonth(day.date));
  const list = labels.length === 1 ? `ngày ${labels[0]}` : `các ngày ${labels.slice(0, -1).join(', ')} và ${labels[labels.length - 1]}`;
  return onBehalf ? `Đóng ca hộ ${list}` : `Quên đóng ca ${list}`;
}

/**
 * "Đóng ca ngày trước" — hộp BẮT BUỘC khi bác sĩ còn ngày trước chưa đóng ca (mockup duyệt 28/10/2026): chưa đóng thì chưa nhận
 * được bệnh nhân mới. Một ngày: tổng hợp ca của ngày đó (dùng lại `DoctorShiftSummaryPanel`); nhiều ngày: một bảng liệt kê, MỘT lần
 * xác nhận đóng tất cả. Máy chủ tự tính lại danh sách ngày — hộp chỉ gửi lý do. "Để sau" đóng hộp nhưng lượt khám vẫn bị chặn.
 */
export function ClosePreviousDaysDialog({
  doctorId,
  days,
  onDone,
  onClose,
}: {
  doctorId: string;
  days: PendingClosureDayDto[];
  onDone: () => void;
  onClose: () => void;
}) {
  const single = days.length === 1 ? days[0]! : null;
  const unprocessed = sumUnprocessed(days);
  const [reason, setReason] = useState(() => defaultCloseReason(days, false));
  const [error, setError] = useState<string | null>(null);
  const mutation = useClosePendingShiftsMutation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutation.mutateAsync({ doctorId, body: { reason: reason.trim() || undefined } });
      onDone();
    } catch (err) {
      // Lỗi hệ thống (5xx, mất mạng) đã có hộp thông báo chung giữ nguyên dữ liệu — không báo trùng trong hộp này; chỉ báo tại chỗ lỗi nghiệp vụ (4xx).
      if (classifySystemFailure(err)) return;
      setError(err instanceof ApiError ? err.message : 'Không đóng ca được, vui lòng thử lại.');
    }
  }

  const totalCalled = days.reduce((total, day) => total + day.calledCount, 0);
  const totalCompleted = days.reduce((total, day) => total + day.completedCount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="close-previous-days-title">
      <div className="max-h-[calc(100dvh-72px)] w-full max-w-[960px] overflow-y-auto rounded-xl bg-white p-8 shadow-md ring-1 ring-slate-200">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="flex items-start justify-between gap-6">
            <div>
              <p id="close-previous-days-title" className="text-xl font-semibold text-slate-900">
                {single ? `Đóng ca ngày ${single.date.split('-').reverse().join('/')}` : `Đóng ca ${days.length} ngày chưa đóng`}
              </p>
              <p className="mt-1 max-w-[54ch] text-sm font-medium text-slate-500">
                {single
                  ? 'Ngày này chưa được đóng ca. Xác nhận để hệ thống ghi nhận và bạn bắt đầu khám hôm nay.'
                  : 'Một lần xác nhận đóng tất cả các ngày dưới đây, rồi bạn bắt đầu khám hôm nay.'}
              </p>
            </div>
            <span className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-teal/25 bg-brand-teal-panel px-3 py-1.5 text-xs font-semibold text-brand-teal-active">
              <CalendarBlank size={13} weight="bold" aria-hidden="true" />
              {single ? formatTodayChipLabel(single.date) : 'Còn ngày chưa đóng ca'}
            </span>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-r-lg border-l-[3px] border-rose-600 bg-rose-50 px-3.5 py-2.5 text-[13px] font-medium text-rose-800">
            <Warning size={15} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            Chưa đóng ca thì chưa nhận được bệnh nhân mới.
            {single && single.shifts.length > 0 && ` Ca đã xếp ngày ${formatDayMonth(single.date)}: ${formatShiftRanges(single.shifts)}.`}
          </div>

          {single ? (
            <DoctorShiftSummaryPanel doctorId={doctorId} date={single.date} />
          ) : (
            <div role="table" aria-label="Các ngày chưa đóng ca" className="mt-5 border-t-2 border-blue-600">
              <div role="row" className="grid gap-x-4 border-b border-slate-300 bg-slate-100 px-3 py-2" style={{ gridTemplateColumns: MULTI_DAY_COLUMNS }}>
                <span role="columnheader" className="text-xs font-semibold uppercase tracking-wide text-slate-700">Ngày</span>
                <span role="columnheader" className="text-right text-xs font-semibold uppercase tracking-wide text-slate-700">Đã gọi khám</span>
                <span role="columnheader" className="text-right text-xs font-semibold uppercase tracking-wide text-slate-700">Hoàn thành</span>
                <span role="columnheader" className="text-right text-xs font-semibold uppercase tracking-wide text-slate-700">Chưa xử lý</span>
              </div>
              {days.map((day) => (
                <div key={day.date} role="row" className="grid gap-x-4 border-b border-slate-200 px-3 py-2.5 text-sm" style={{ gridTemplateColumns: MULTI_DAY_COLUMNS }}>
                  <span role="cell" className="text-slate-900">{formatTodayChipLabel(day.date)}</span>
                  <span role="cell" className="text-right tabular-nums text-slate-700">{day.calledCount} ca</span>
                  <span role="cell" className="text-right tabular-nums text-slate-700">{day.completedCount} ca</span>
                  <span role="cell" className={`text-right tabular-nums ${day.unprocessedCount > 0 ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>{day.unprocessedCount} ca</span>
                </div>
              ))}
              <div role="row" className="grid gap-x-4 border-b-2 border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold" style={{ gridTemplateColumns: MULTI_DAY_COLUMNS }}>
                <span role="cell">Tổng cộng</span>
                <span role="cell" className="text-right tabular-nums">{totalCalled} ca</span>
                <span role="cell" className="text-right tabular-nums">{totalCompleted} ca</span>
                <span role="cell" className="text-right tabular-nums text-amber-700">{unprocessed} ca</span>
              </div>
            </div>
          )}

          {unprocessed > 0 && (
            <div className="mt-[18px] flex items-center gap-3 rounded-md bg-amber-50/70 py-2 pl-2.5 pr-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-400 text-[15px] font-semibold text-white">{unprocessed}</div>
              <p className="text-xs leading-snug text-slate-700">
                <span className="font-semibold text-slate-900">{single ? `lượt khám của ngày ${formatDayMonth(single.date)} chưa xử lý` : 'lượt khám chưa xử lý'}</span> — tự động chuyển về hàng chờ chung của Khoa.
              </p>
            </div>
          )}

          <div className="mt-5">
            <label htmlFor="close-previous-days-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="font-normal text-slate-400">(không bắt buộc)</span>
            </label>
            <textarea
              id="close-previous-days-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && (
            <div className="mt-3">
              <ErrorBanner message={error} />
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-[18px]">
            <span className="text-xs font-medium text-slate-500">
              {single ? `Số liệu tính theo cả ngày ${formatDayMonth(single.date)}, kể cả trước lúc Tạm nghỉ (nếu có).` : 'Mỗi ngày được ghi một bản ghi đóng ca riêng, cùng lý do.'}
            </span>
            <div className="flex flex-shrink-0 gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Để sau
              </Button>
              <Button type="submit" variant="danger" loading={mutation.isPending}>
                {single ? 'Xác nhận đóng ca' : `Xác nhận đóng ${days.length} ngày`}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
