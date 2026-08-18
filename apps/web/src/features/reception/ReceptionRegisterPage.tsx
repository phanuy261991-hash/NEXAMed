import { useLocation, useNavigate } from 'react-router-dom';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ReceptionIntakeForm, type ReceptionIntakeCheckinContext } from './ReceptionIntakeForm';

/**
 * "Tiếp nhận bệnh nhân" (Sprint 3, sub-menu riêng dưới "Tiếp nhận và Đặt lịch") — khách đến thẳng
 * phòng khám, KHÔNG qua đặt lịch trước, KHÔNG tạo `appointment`. Nội dung form dùng chung với
 * luồng tiếp nhận từ lịch hẹn có sẵn (`ReceptionIntakeForm.tsx`, `docs/DECISIONS.md` #044) — trang
 * này chỉ là khung chrome (breadcrumb + điều hướng), không lặp lại logic biểu mẫu.
 *
 * **Tiếp nhận từ Lịch hẹn (2026-08-18, thay popup cũ)**: nút "Tiếp nhận" trên panel chi tiết Lịch
 * hẹn (`AppointmentDetailPanel.tsx`) điều hướng thẳng tới đây, kèm `ReceptionIntakeCheckinContext`
 * qua `location.state.checkin` (không còn mở popup `ReceptionIntakeDialog` — đã xoá) — trang render
 * `mode='checkin'` khi có state này, ngược lại `mode='direct'` như bình thường (vào từ menu).
 */
export function ReceptionRegisterPage() {
  useBreadcrumb([{ label: 'Tiếp nhận và Đặt lịch' }, { label: 'Tiếp nhận bệnh nhân' }]);
  const navigate = useNavigate();
  const location = useLocation();
  const checkin = (location.state as { checkin?: ReceptionIntakeCheckinContext } | null)?.checkin;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <h1 className="sr-only">Tiếp nhận bệnh nhân</h1>
      {checkin ? (
        <ReceptionIntakeForm mode="checkin" checkin={checkin} onSuccess={() => navigate('/reception')} onCancel={() => navigate(-1)} />
      ) : (
        <ReceptionIntakeForm mode="direct" onSuccess={() => navigate('/reception')} onCancel={() => navigate('/reception')} />
      )}
    </div>
  );
}