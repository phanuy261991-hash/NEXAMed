import { useState } from 'react';
import type { DoctorPendingClosuresBoard } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { CloseOnBehalfDialog } from '../../shared/ui/CloseOnBehalfDialog';
import { NoticeRow } from '../../shared/ui/NoticeRow';
import { formatDayMonth } from '../../shared/ui/DoctorEndShiftDialog';
import { useHasPermissionAtLeast } from '../auth/usePermission';
import { usePendingClosuresBoardQuery } from '../clinic/clinic.queries';

type PendingDoctor = DoctorPendingClosuresBoard['items'][number];

/**
 * Dải nhắc "bác sĩ chưa đóng ca ngày trước" cho lễ tân/quản trị (mockup duyệt 28/10/2026, màn 4) — đặt phía trên danh sách "Bệnh nhân trong ngày".
 * Chỉ hiện với tài khoản đóng hộ được (`doctor_availability.update` phạm vi toàn bộ — bác sĩ phạm vi cá nhân chỉ đóng được ca của chính mình, ở thanh đỉnh/Hàng đợi khám)
 * và chỉ có dòng khi thật sự có bác sĩ chưa đóng; máy chủ chỉ trả bác sĩ của chi nhánh đang làm việc, và trả rỗng khi phòng khám tắt "Bắt buộc đóng ca ngày trước".
 */
export function PendingClosuresStrip() {
  const canCloseOnBehalf = useHasPermissionAtLeast('doctor_availability', 'update', 'global');
  const boardQuery = usePendingClosuresBoardQuery(canCloseOnBehalf);
  const [closing, setClosing] = useState<PendingDoctor | null>(null);
  const items = boardQuery.data?.items ?? [];

  if (!canCloseOnBehalf) return null;
  if (boardQuery.isError) {
    return <ErrorBanner message="Không tải được danh sách bác sĩ chưa đóng ca." onRetry={() => void boardQuery.refetch()} />;
  }
  if (items.length === 0) return null;

  return (
    <>
      <div className="flex flex-shrink-0 flex-col gap-2" role="region" aria-label="Bác sĩ chưa đóng ca ngày trước">
        {items.map((doctor) => (
          <NoticeRow
            key={doctor.doctorId}
            title={`${doctor.doctorName} chưa đóng ca ${doctor.days.map((d) => `ngày ${formatDayMonth(d.date)}`).join(', ')}.`}
            action={
              <Button type="button" variant="amber" className="flex-shrink-0 whitespace-nowrap" onClick={() => setClosing(doctor)}>
                Đóng ca hộ
              </Button>
            }
          >
            Bác sĩ chưa nhận được bệnh nhân mới cho tới khi ca đó được đóng.
          </NoticeRow>
        ))}
      </div>

      {closing && (
        <CloseOnBehalfDialog
          doctorId={closing.doctorId}
          doctorName={closing.doctorName}
          days={closing.days}
          onDone={() => setClosing(null)}
          onClose={() => setClosing(null)}
        />
      )}
    </>
  );
}
