import { useState } from 'react';
import { CalendarBlank, CheckCircle, Clock, Pill, Prohibit, Stethoscope, Warning } from '@phosphor-icons/react';
import { getVietnamTodayDateString } from '../../features/appointment/schedule-grid.utils';
import { useReceptionListQuery } from '../../features/reception/reception.queries';
import { useDoctorShiftSummaryQuery, useSetDoctorAvailabilityMutation } from '../../features/clinic/clinic.queries';
import { getInitials } from '../format/initials';
import { ApiError } from '../api/client';
import { Button } from './Button';
import { Skeleton } from './Skeleton';

const WEEKDAY_LABELS_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** `dateStr` dạng `YYYY-MM-DD` (ngày lịch VN, đã đúng từ `getVietnamTodayDateString()`) — chỉ cần
 * suy ra thứ trong tuần, không liên quan múi giờ hiển thị nên dùng `Date.UTC` thuần cho gọn. */
function formatTodayChipLabel(dateStr: string): string {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAY_LABELS_VI[weekdayIndex]}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/**
 * "Đóng ca hôm nay" — 2 trường hợp, CÙNG dialog/1 logic (ENDED + bulk trả lượt khám về hàng chờ
 * chung Khoa), chỉ khác nội dung điền sẵn theo `trigger`:
 * - Trường hợp 1 (mặc định, `trigger` không truyền) — "đóng đột xuất": bác sĩ/lễ tân tự bấm bất
 *   kỳ lúc nào, lý do tự nhập.
 * - Trường hợp 2 (`trigger='SCHEDULED_END'`) — "hết giờ làm việc": tự bật khi client phát hiện đã
 *   qua giờ đóng cửa phòng khám (polling 30s so với `ClinicSettings.businessHours`), lý do điền
 *   sẵn "Hết giờ làm việc" (sửa được). Luôn được phép bất kể cấu hình `allowEmergencyEndShift` —
 *   đã hỏi và chốt riêng với chủ dự án.
 *
 * Mở đầu bằng khối "Tổng hợp ca khám hôm nay" (mockup duyệt qua nhiều vòng trước khi code) — lời
 * chào có tên bác sĩ + 5 chỉ số (Đã gọi khám/Đã hoàn thành/TB thời gian-ca/Huỷ khám/Đơn thuốc đã
 * kê) trên panel nền `brand-teal-panel`, giúp bác sĩ nhìn lại 1 ngày làm việc trước khi xác nhận.
 * Tính theo CẢ NGÀY hôm nay (không riêng phiên ACTIVE hiện tại), xem `GET .../shift-summary`.
 *
 * Dùng chung 2 nơi: dropdown avatar bác sĩ (`TopBar.tsx`) và "…" thao tác hộ ở board điều phối lễ
 * tân (`ReceptionIntakeForm.tsx`), cùng khuôn `CancelEncounterDialog.tsx`.
 */
export function DoctorEndShiftDialog({
  doctorId,
  trigger,
  onDone,
  onClose,
}: {
  doctorId: string;
  trigger?: 'SCHEDULED_END';
  onDone: () => void;
  onClose: () => void;
}) {
  const isScheduled = trigger === 'SCHEDULED_END';
  const [reason, setReason] = useState(isScheduled ? 'Hết giờ làm việc' : '');
  const [error, setError] = useState<string | null>(null);
  const today = getVietnamTodayDateString();
  const listQuery = useReceptionListQuery(today, doctorId, false, false);
  const summaryQuery = useDoctorShiftSummaryQuery(doctorId);
  const mutation = useSetDoctorAvailabilityMutation();

  const pendingCount = (listQuery.data?.items ?? []).filter((i) => i.status === 'CHECKED_IN' || i.status === 'IN_CONSULTATION').length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutation.mutateAsync({ doctorId, body: { status: 'ENDED', reason: reason.trim() || undefined, trigger } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không đóng ca được, vui lòng thử lại.');
    }
  }

  const summary = summaryQuery.data;
  const doctorName = summary?.doctorName || '...';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="doctor-end-shift-title">
      <div className="max-h-[calc(100dvh-72px)] w-full max-w-[900px] overflow-y-auto rounded-xl bg-white p-8 shadow-md ring-1 ring-slate-200">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="flex items-start justify-between gap-6">
            <div>
              <p id="doctor-end-shift-title" className="text-xl font-bold text-slate-900">
                {isScheduled ? 'Đã hết giờ làm việc hôm nay' : 'Đóng ca hôm nay?'}
              </p>
              <p className="mt-1 max-w-[50ch] text-sm font-medium text-slate-500">
                {isScheduled ? 'Xác nhận để hệ thống ngừng điều phối ca khám mới cho bạn.' : 'Bạn sẽ ngừng nhận bệnh cho tới hết ngày.'}
              </p>
            </div>
            <span className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-teal/25 bg-brand-teal-panel px-3 py-1.5 text-xs font-bold text-brand-teal-active">
              <CalendarBlank size={13} weight="bold" aria-hidden="true" />
              {formatTodayChipLabel(today)}
            </span>
          </div>

          {isScheduled && (
            <div className="mt-4 flex items-start gap-2 rounded-r-lg border-l-[3px] border-rose-600 bg-rose-50 px-3.5 py-2.5 text-[13px] font-medium text-rose-800">
              <Warning size={15} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              Phòng khám đã đóng cửa — hệ thống tự nhắc, không phải bạn chủ động bấm.
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-brand-teal/20 bg-brand-teal-panel px-5 py-[18px]">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] border-brand-teal/30 bg-white text-[13px] font-bold text-brand-teal-active">
                {getInitials(doctorName)}
              </div>
              <div className="flex min-w-0 flex-col gap-px">
                <span className="text-[15px] font-bold text-slate-900">BS. {doctorName}</span>
                <span className="text-[12.5px] font-medium text-brand-teal-active">đã hoàn thành ngày làm việc hôm nay với:</span>
              </div>
            </div>

            {summaryQuery.isError ? (
              <p className="text-xs font-medium text-rose-700">Không tải được số liệu hôm nay.</p>
            ) : summary ? (
              <div className="flex items-stretch gap-2.5">
                <ShiftStatTile icon={Stethoscope} iconColor="text-blue-600" iconBg="bg-blue-50" label="Đã gọi khám" value={summary.calledCount} unit="ca" primary />
                <ShiftStatTile
                  icon={CheckCircle}
                  iconColor="text-emerald-600"
                  iconBg="bg-emerald-50"
                  label="Đã hoàn thành"
                  value={summary.completedCount}
                  unit="ca"
                  primary
                />
                <ShiftStatTile
                  icon={Clock}
                  iconColor="text-slate-600"
                  iconBg="bg-slate-100"
                  label="TB / ca"
                  value={summary.avgConsultMinutes}
                  unit="phút"
                />
                <ShiftStatTile
                  icon={Prohibit}
                  iconColor="text-rose-600"
                  iconBg="bg-rose-50"
                  label="Huỷ khám"
                  value={summary.cancelledCount}
                  unit="ca"
                  attention
                />
                <ShiftStatTile icon={Pill} iconColor="text-violet-600" iconBg="bg-violet-50" label="Đơn thuốc" value={summary.prescriptionCount} unit="đơn" />
              </div>
            ) : (
              <div className="flex items-stretch gap-2.5" aria-hidden="true">
                <ShiftStatTileSkeleton primary />
                <ShiftStatTileSkeleton primary />
                <ShiftStatTileSkeleton />
                <ShiftStatTileSkeleton />
                <ShiftStatTileSkeleton />
              </div>
            )}
          </div>

          {pendingCount > 0 && (
            <div className="mt-[18px] flex items-center gap-3 rounded-md bg-amber-50/70 py-2 pl-2.5 pr-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-400 text-[15px] font-bold text-white">
                {pendingCount}
              </div>
              <p className="text-xs leading-snug text-slate-700">
                <span className="font-semibold text-slate-900">lượt khám chưa xử lý</span> — tự động chuyển về hàng chờ chung của Khoa.
              </p>
            </div>
          )}

          <div className="mt-5">
            <label htmlFor="doctor-end-shift-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="font-normal text-slate-400">(không bắt buộc)</span>
            </label>
            <textarea
              id="doctor-end-shift-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: có việc đột xuất, cần rời phòng khám sớm..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-[18px]">
            <span className="text-xs font-medium text-slate-500">Số liệu tính theo cả ngày hôm nay, kể cả trước lúc Tạm nghỉ (nếu có).</span>
            <div className="flex flex-shrink-0 gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                {isScheduled ? 'Để sau' : 'Đóng'}
              </Button>
              <Button type="submit" variant="danger" loading={mutation.isPending}>
                Xác nhận đóng ca
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ShiftStatTile({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  unit,
  primary = false,
  attention = false,
}: {
  icon: typeof Stethoscope;
  iconColor: string;
  iconBg: string;
  label: string;
  value: number | null;
  unit: string;
  primary?: boolean;
  attention?: boolean;
}) {
  return (
    <div className={`flex items-center gap-[11px] rounded-[11px] border border-brand-teal/15 bg-white ${primary ? 'flex-[1.2] px-3.5 py-3.5' : 'flex-[0.92] px-3 py-2.5'}`}>
      <div className={`flex flex-shrink-0 items-center justify-center rounded-full ${iconBg} ${primary ? 'h-[42px] w-[42px]' : 'h-[34px] w-[34px]'}`}>
        <Icon size={primary ? 20 : 16} weight="bold" className={iconColor} aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`tabular-nums font-bold leading-tight ${attention ? 'text-rose-700' : 'text-slate-900'} ${primary ? 'text-[26px]' : 'text-[19px]'}`}>
          {value ?? '—'}
          {value !== null && <span className="ml-0.5 text-[12.5px] font-semibold text-slate-500">{unit}</span>}
        </span>
      </div>
    </div>
  );
}

function ShiftStatTileSkeleton({ primary = false }: { primary?: boolean }) {
  return (
    <div className={`flex items-center gap-[11px] rounded-[11px] border border-brand-teal/15 bg-white ${primary ? 'flex-[1.2] px-3.5 py-3.5' : 'flex-[0.92] px-3 py-2.5'}`}>
      <Skeleton className={`flex-shrink-0 rounded-full ${primary ? 'h-[42px] w-[42px]' : 'h-[34px] w-[34px]'}`} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <Skeleton className="h-2 w-14" />
        <Skeleton className={primary ? 'h-5 w-10' : 'h-4 w-8'} />
      </div>
    </div>
  );
}
