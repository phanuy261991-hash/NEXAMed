import { X } from '@phosphor-icons/react';
import type { AppointmentSummary } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { minutesToLabel, vnTimeOfDayMinutes } from './schedule-grid.utils';

/**
 * Panel "Lịch hẹn cần xử lý" bên phải lưới ("Đơn xin nghỉ", #224, mockup đã duyệt màn 3): lịch còn "Đã đặt"
 * nằm trong khung nghỉ ĐÃ DUYỆT của bác sĩ. Lễ tân gọi bệnh nhân rồi dùng chức năng có sẵn — Đổi bác sĩ
 * (Sửa lịch), Dời lịch, Huỷ lịch; hệ thống KHÔNG tự huỷ hay tự chuyển.
 */
export function LeaveAttentionPanel({
  appointments,
  doctorNameById,
  onAction,
  onClose,
}: {
  appointments: AppointmentSummary[];
  doctorNameById: Map<string, string>;
  onAction: (appointment: AppointmentSummary, mode: 'edit' | 'reschedule' | 'view') => void;
  onClose: () => void;
}) {
  return (
    <aside className="w-[340px] flex-shrink-0 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm" aria-label="Lịch hẹn cần xử lý">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="text-sm font-bold text-slate-900">Lịch hẹn cần xử lý</div>
        <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-slate-600">
          <X size={16} weight="bold" />
        </button>
      </div>
      <p className="px-4 pt-3 text-xs text-slate-500">Bác sĩ đã được duyệt nghỉ. Gọi bệnh nhân rồi chọn cách xử lý.</p>
      {appointments.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm font-medium text-slate-500">Không còn lịch hẹn nào cần xử lý.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {appointments.map((a) => {
            const start = vnTimeOfDayMinutes(a.scheduledAt);
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold tabular-nums text-brand-teal">
                    {minutesToLabel(start)} – {minutesToLabel(start + a.durationMinutes)}
                  </span>
                  <span className="truncate text-xs font-semibold text-rose-600">{doctorNameById.get(a.doctorId) ?? 'Bác sĩ'} nghỉ</span>
                </div>
                <div className="mt-0.5 font-medium text-slate-900">{a.fullName}</div>
                <div className="text-xs tabular-nums text-slate-500">{a.phone}</div>
                <div className="mt-2 flex gap-1.5">
                  <Button type="button" className="px-2.5 py-1 text-xs" onClick={() => onAction(a, 'edit')}>
                    Đổi bác sĩ
                  </Button>
                  <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => onAction(a, 'reschedule')}>
                    Dời lịch
                  </Button>
                  <Button type="button" variant="dangerGhost" className="px-2.5 py-1 text-xs" onClick={() => onAction(a, 'view')}>
                    Huỷ lịch
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
