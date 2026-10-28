import { useState } from 'react';
import { Clock } from '@phosphor-icons/react';
import type { PendingClosureDayDto } from '@nexamed/shared';
import { useClosePendingShiftsMutation } from '../../features/clinic/clinic.queries';
import { ApiError } from '../api/client';
import { classifySystemFailure } from '../errors/system-failure';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { defaultCloseReason, sumUnprocessed } from './ClosePreviousDaysDialog';
import { formatDayMonth, formatTodayChipLabel } from './DoctorEndShiftDialog';

/**
 * "Đóng ca hộ bác sĩ" — lễ tân/quản trị đóng các ngày bác sĩ quên đóng hoặc nghỉ ốm (mockup duyệt 28/10/2026, màn 4). Dùng `ConfirmDialog`
 * dùng chung (ui-guidelines 15b). Luôn được phép, không phụ thuộc chính sách "lễ tân đóng ca hộ" — đây là việc bắt buộc để bác sĩ được khám tiếp.
 */
export function CloseOnBehalfDialog({
  doctorId,
  doctorName,
  days,
  onDone,
  onClose,
}: {
  doctorId: string;
  doctorName: string;
  days: PendingClosureDayDto[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(() => defaultCloseReason(days, true));
  const [error, setError] = useState<string | null>(null);
  const mutation = useClosePendingShiftsMutation();
  const unprocessed = sumUnprocessed(days);

  async function handleConfirm() {
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

  return (
    <ConfirmDialog
      icon={Clock}
      tone="danger"
      size="md"
      title="Đóng ca hộ bác sĩ"
      rows={[
        { label: 'Bác sĩ', value: doctorName },
        days.length === 1
          ? { label: 'Ngày chưa đóng', value: formatTodayChipLabel(days[0]!.date) }
          : { label: 'Ngày chưa đóng', value: `${days.length} ngày`, sub: days.map((d) => formatDayMonth(d.date)).join(', ') },
        { label: 'Lượt khám chưa xử lý', value: `${unprocessed} ca`, sub: unprocessed > 0 ? 'về hàng chờ chung' : undefined },
      ]}
      note="Ghi nhật ký: ai đóng hộ, lý do."
      error={error}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="button" variant="danger" loading={mutation.isPending} onClick={() => void handleConfirm()}>
            Xác nhận đóng ca
          </Button>
        </>
      }
      onClose={onClose}
    >
      <label htmlFor="close-on-behalf-reason" className="mb-1 block text-sm font-semibold text-slate-800">
        Lý do <span className="font-normal text-slate-400">(không bắt buộc)</span>
      </label>
      <input
        id="close-on-behalf-reason"
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
    </ConfirmDialog>
  );
}
