import type { EncounterSummary } from '@nexamed/shared';
import { useReleaseEncounterMutation } from '../../features/reception/reception.queries';
import { ApiError } from '../api/client';
import { Button } from './Button';

/**
 * "Trả về hàng chờ" (`IN_CONSULTATION → CHECKED_IN`, #085) — bác sĩ nhả `doctorId` về `NULL`, ca
 * quay lại hàng chờ chung Khoa cho bác sĩ khác nhận, KHÔNG phải huỷ (không đóng ca, không đụng
 * phiếu thu). Trích xuất từ `ReceptionDoctorQueuePage.tsx` (nơi dùng đầu tiên) để dùng lại ở màn
 * hình khám và panel "Hàng chờ" (`DoctorQueueButton.tsx`) — theo yêu cầu chủ dự án: bác sĩ đang
 * đứng NGAY TẠI màn khám phải trả được ca về hàng chờ, không phải quay ra "Hàng đợi khám" trước.
 *
 * KHÔNG cần lý do bắt buộc (khác `CancelEncounterDialog`) — đây là thao tác điều phối nội bộ, vết
 * đã đủ ở `audit_log`.
 */
export function ReleaseEncounterDialog({
  encounterId,
  patientFullName,
  version,
  onReleased,
  onClose,
}: {
  encounterId: string;
  patientFullName: string;
  version: number;
  onReleased: (updated: EncounterSummary) => void;
  onClose: () => void;
}) {
  const mutation = useReleaseEncounterMutation();

  async function handleConfirm() {
    try {
      const updated = await mutation.mutateAsync({ id: encounterId, body: { version } });
      onReleased(updated);
    } catch {
      // Giữ dialog mở, hiện lỗi ngay bên dưới (`mutation.isError`) — không tự đóng để bác sĩ có
      // thể đọc lỗi rồi tự quyết định đóng/thử lại.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4" role="dialog" aria-modal="true" aria-labelledby="release-encounter-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
        <h3 id="release-encounter-title" className="text-base font-bold text-slate-900">
          Trả về hàng chờ?
        </h3>
        <p className="mt-1.5 text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{patientFullName}</span> sẽ quay lại hàng chờ chung Khoa cho bác sĩ khác nhận, không huỷ lượt khám.
        </p>
        {mutation.isError && (
          <p className="mt-2 text-xs font-medium text-rose-600">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Không trả về hàng chờ được, vui lòng thử lại.'}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => void handleConfirm()}>
            Xác nhận
          </Button>
        </div>
      </div>
    </div>
  );
}