import { useNavigate } from 'react-router-dom';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ReceptionIntakeForm } from './ReceptionIntakeForm';

/**
 * "Tiếp nhận bệnh nhân" (Sprint 3, sub-menu riêng dưới "Tiếp nhận và Đặt lịch") — khách đến thẳng
 * phòng khám, KHÔNG qua đặt lịch trước, KHÔNG tạo `appointment`. Nội dung form dùng chung với
 * popup check-in trên panel Lịch hẹn (`ReceptionIntakeForm.tsx`, `docs/DECISIONS.md` #044) — trang
 * này chỉ là khung chrome (breadcrumb + điều hướng), không lặp lại logic biểu mẫu.
 */
export function ReceptionRegisterPage() {
  useBreadcrumb([{ label: 'Tiếp nhận và Đặt lịch' }, { label: 'Tiếp nhận bệnh nhân' }]);
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <h1 className="sr-only">Tiếp nhận bệnh nhân</h1>
      <ReceptionIntakeForm mode="direct" onSuccess={() => navigate('/reception')} onCancel={() => navigate('/reception')} />
    </div>
  );
}
