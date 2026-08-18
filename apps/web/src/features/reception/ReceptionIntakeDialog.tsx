import { X } from '@phosphor-icons/react';
import { ReceptionIntakeForm, type ReceptionIntakeCheckinContext } from './ReceptionIntakeForm';

/**
 * Popup tiếp nhận mở từ panel chi tiết Lịch hẹn (`AppointmentDetailPanel.tsx`) — bấm "Tiếp nhận"
 * gọi thẳng biểu mẫu tiếp nhận đầy đủ (`ReceptionIntakeForm`, `mode='checkin'`) hiển thị dạng
 * popup thay vì điều hướng sang trang riêng (`docs/DECISIONS.md` #044, thay hẳn dialog tối giản
 * "chỉ chọn bệnh nhân" trước đây).
 */
export function ReceptionIntakeDialog({
  context,
  onClose,
  onSuccess,
}: {
  context: ReceptionIntakeCheckinContext | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  if (!context) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-8">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Tiếp nhận</h2>
            <p className="text-xs text-slate-500">
              {context.fullName} · {context.phone}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-slate-600">
            <X size={17} weight="bold" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <ReceptionIntakeForm mode="checkin" checkin={context} onSuccess={onSuccess} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
}
