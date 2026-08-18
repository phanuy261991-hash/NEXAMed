import type { AppointmentSummary, DoctorOption } from '@nexamed/shared';
import { findDoctorBusyUntilLabel } from './schedule-grid.utils';

/**
 * Danh sách bác sĩ kèm trạng thái trống/bận theo giờ đã chọn — dùng chung cho Đặt lịch nhanh
 * (`AppointmentQuickCreatePanel.tsx`) và Dời lịch (`AppointmentDetailPanel.tsx`, 2026-08-18) —
 * trùng lặp lần 2 nên tách theo CLAUDE.md.
 */
export function DoctorAvailabilityList({
  doctors,
  selectedDoctorId,
  onSelect,
  time,
  durationMinutes,
  dayAppointments,
  excludeAppointmentId,
}: {
  doctors: DoctorOption[];
  selectedDoctorId: string | null;
  onSelect: (doctorId: string) => void;
  time: string;
  durationMinutes: number;
  dayAppointments: AppointmentSummary[];
  /** Bỏ qua chính lịch hẹn đang thao tác (ví dụ đang dời lịch) — không tự báo bận với chính mình. */
  excludeAppointmentId?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {doctors.map((d) => {
        const busyUntil = findDoctorBusyUntilLabel(d.id, time, durationMinutes, dayAppointments, excludeAppointmentId);
        const active = selectedDoctorId === d.id;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id)}
            className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
              active ? 'border-brand-teal bg-brand-teal' : 'border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint'
            }`}
          >
            <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-slate-900'}`}>{d.fullName}</span>
            {busyUntil ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${active ? 'bg-white text-amber-700' : 'bg-amber-50 text-amber-700'}`}
              >
                Bận tới {busyUntil}
              </span>
            ) : (
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${active ? 'bg-white text-emerald-700' : 'bg-emerald-50 text-emerald-700'}`}
              >
                Trống
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}