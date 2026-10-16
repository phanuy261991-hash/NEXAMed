import { ArrowUUpLeft } from '@phosphor-icons/react';
import type { EncounterSummary } from '@nexamed/shared';
import { useReleaseEncounterMutation } from '../../features/reception/reception.queries';
import { ApiError } from '../api/client';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';

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
    <ConfirmDialog
      icon={ArrowUUpLeft}
      title="Trả về hàng chờ"
      rows={[{ label: 'Bệnh nhân', value: patientFullName }]}
      note="Quay lại hàng chờ chung của Khoa cho bác sĩ khác nhận, không huỷ lượt khám."
      error={mutation.isError ? (mutation.error instanceof ApiError ? mutation.error.message : 'Không trả về hàng chờ được, vui lòng thử lại.') : null}
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => void handleConfirm()}>
            Xác nhận
          </Button>
        </>
      }
    />
  );
}
