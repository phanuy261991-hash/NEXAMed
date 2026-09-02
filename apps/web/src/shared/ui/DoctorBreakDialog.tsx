import { useState } from 'react';
import { useSetDoctorAvailabilityMutation } from '../../features/clinic/clinic.queries';
import { ApiError } from '../api/client';
import { Button } from './Button';

/**
 * "Tạm nghỉ" — Trường hợp việc vặt (đi họp/ăn trưa/nghe điện thoại), lý do KHÔNG bắt buộc (khác
 * hẳn `DoctorEndShiftDialog.tsx`). Không đụng lượt khám nào đang có — bác sĩ tự "Quay lại làm
 * việc" bất cứ lúc nào. Dùng chung 2 nơi: dropdown avatar bác sĩ (`TopBar.tsx`) và "…" thao tác hộ
 * ở board điều phối lễ tân (`ReceptionIntakeForm.tsx`), cùng khuôn `CancelEncounterDialog.tsx`.
 */
export function DoctorBreakDialog({ doctorId, onDone, onClose }: { doctorId: string; onDone: () => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useSetDoctorAvailabilityMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutation.mutateAsync({ doctorId, body: { status: 'BREAK', reason: reason.trim() || undefined } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không chuyển sang "Tạm nghỉ" được, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="doctor-break-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-md ring-1 ring-slate-200">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="doctor-break-title" className="text-sm font-semibold text-slate-900">
            Tạm nghỉ?
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Ca làm việc vẫn mở — bạn chỉ tạm ngừng nhận ca khám mới cho tới khi bấm "Quay lại làm việc". Các lượt khám đang có không bị ảnh hưởng.
          </p>

          <div className="mt-3.5">
            <label htmlFor="doctor-break-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="font-normal text-slate-400">(không bắt buộc)</span>
            </label>
            <textarea
              id="doctor-break-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: đi họp, ăn trưa, có việc gấp..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant="amber" loading={mutation.isPending}>
              Xác nhận tạm nghỉ
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
