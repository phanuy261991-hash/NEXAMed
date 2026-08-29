import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { getVietnamTodayDateString } from '../../features/appointment/schedule-grid.utils';
import { useReceptionListQuery } from '../../features/reception/reception.queries';
import { useSetDoctorAvailabilityMutation } from '../../features/clinic/clinic.queries';
import { ApiError } from '../api/client';
import { Button } from './Button';

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="doctor-end-shift-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="doctor-end-shift-title" className="text-sm font-semibold text-slate-900">
            {isScheduled ? 'Đã hết giờ làm việc hôm nay' : 'Đóng ca hôm nay?'}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            {isScheduled ? 'Xác nhận để hệ thống ngừng điều phối ca khám mới cho bạn.' : 'Bạn sẽ ngừng nhận bệnh cho tới hết ngày.'}
          </p>

          {isScheduled && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <Warning size={14} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              Phòng khám đã đóng cửa — hệ thống tự nhắc, không phải bạn chủ động bấm.
            </div>
          )}

          {pendingCount > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Warning size={14} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              Còn <strong>{pendingCount}</strong> lượt khám chưa xử lý — toàn bộ sẽ được trả về hàng chờ chung của Khoa để bác sĩ khác tiếp nhận.
            </div>
          )}

          <div className="mt-3.5">
            <label htmlFor="doctor-end-shift-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="font-normal text-slate-400">(không bắt buộc)</span>
            </label>
            <textarea
              id="doctor-end-shift-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: hết giờ làm, có việc đột xuất..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {isScheduled ? 'Để sau' : 'Đóng'}
            </Button>
            <Button type="submit" variant="danger" loading={mutation.isPending}>
              Xác nhận đóng ca
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
