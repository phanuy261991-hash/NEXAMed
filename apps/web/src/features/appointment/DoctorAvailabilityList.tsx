import { useState } from 'react';
import type { AppointmentSummary, DoctorOption } from '@nexamed/shared';
import { useDoctorWorkShiftsQuery } from './appointment.queries';
import { findDoctorBusyUntilLabel, toMinutes } from './schedule-grid.utils';

/**
 * Danh sách bác sĩ kèm trạng thái trống/bận theo giờ đã chọn — dùng chung cho Đặt lịch nhanh
 * (`AppointmentQuickCreatePanel.tsx`) và Dời lịch (`AppointmentDetailPanel.tsx`, 2026-08-18) —
 * trùng lặp lần 2 nên tách theo CLAUDE.md.
 *
 * "Đơn xin nghỉ" (#224, mockup đã duyệt màn 4): bác sĩ được DUYỆT nghỉ trong đúng khung giờ đang chọn
 * thì mờ + không chọn được; nghỉ ca khác trong ngày / đơn chờ duyệt vẫn chọn được kèm ghi chú. Ngày
 * có ít nhất 1 bác sĩ đăng ký ca thì bác sĩ CHƯA đăng ký ca gập vào mục "Bác sĩ chưa đăng ký ca (N)"
 * (không đổi gì ở phòng khám không dùng ca — danh sách phẳng như cũ).
 */
export function DoctorAvailabilityList({
  doctors,
  selectedDoctorId,
  onSelect,
  date,
  time,
  durationMinutes,
  dayAppointments,
  excludeAppointmentId,
}: {
  doctors: DoctorOption[];
  selectedDoctorId: string | null;
  onSelect: (doctorId: string) => void;
  /** Ngày đang đặt/dời (`YYYY-MM-DD`) — để đọc ca đăng ký và đơn nghỉ đúng ngày đó. */
  date: string;
  time: string;
  durationMinutes: number;
  dayAppointments: AppointmentSummary[];
  /** Bỏ qua chính lịch hẹn đang thao tác (ví dụ đang dời lịch) — không tự báo bận với chính mình. */
  excludeAppointmentId?: string;
}) {
  const shiftsQuery = useDoctorWorkShiftsQuery(date);
  const shiftsByDoctor = shiftsQuery.data?.byDoctorId ?? {};
  const leaveByDoctor = shiftsQuery.data?.leaveByDoctorId ?? {};
  const slotStart = toMinutes(time);
  const slotEnd = slotStart + durationMinutes;

  const registered = doctors.filter((d) => (shiftsByDoctor[d.id] ?? []).length > 0);
  const dayUsesShifts = registered.length > 0;
  const unregistered = dayUsesShifts ? doctors.filter((d) => (shiftsByDoctor[d.id] ?? []).length === 0) : [];
  const visible = dayUsesShifts ? registered : doctors;
  const selectedIsUnregistered = unregistered.some((d) => d.id === selectedDoctorId);
  const [showUnregistered, setShowUnregistered] = useState(false);

  function renderDoctor(d: DoctorOption) {
    const busyUntil = findDoctorBusyUntilLabel(d.id, time, durationMinutes, dayAppointments, excludeAppointmentId);
    const active = selectedDoctorId === d.id;
    const shifts = shiftsByDoctor[d.id] ?? [];
    const leaves = leaveByDoctor[d.id] ?? [];
    const blocking = leaves.find((l) => l.status === 'APPROVED' && l.startMinute < slotEnd && slotStart < l.endMinute);
    const approvedOther = leaves.find((l) => l.status === 'APPROVED' && l !== blocking);
    const pending = leaves.find((l) => l.status === 'PENDING');
    const leaveName = (l: { isWholeDay: boolean; workShiftName: string | null }) => (l.isWholeDay ? 'cả ngày' : (l.workShiftName ?? 'ca'));

    return (
      <button
        key={d.id}
        type="button"
        disabled={blocking !== undefined}
        onClick={() => onSelect(d.id)}
        className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
          blocking
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
            : active
              ? 'border-brand-teal bg-brand-teal'
              : 'border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint'
        }`}
      >
        <span className="min-w-0">
          <span className={`block text-sm font-semibold ${blocking ? 'text-slate-500' : active ? 'text-white' : 'text-slate-900'}`}>
            {d.displayName ?? d.fullName}
            {/* "Phòng làm việc hôm nay" (docs/DECISIONS.md #054) — tự ẩn khi bác sĩ chưa chọn phòng hoặc tenant chưa dùng mô hình nhiều phòng. */}
            {d.currentRoomName && (
              <span className={`ml-1.5 font-normal ${active ? 'text-white/80' : 'text-slate-500'}`}>· {d.currentRoomName}</span>
            )}
          </span>
          {blocking ? (
            <span className="block text-xs font-semibold text-rose-600">Nghỉ {leaveName(blocking)} — không đặt được</span>
          ) : (
            <span className={`block text-xs ${active ? 'text-white/90' : 'text-slate-500'}`}>
              {shifts.length > 0 ? shifts.map((s) => s.name).join(' · ') : dayUsesShifts ? 'Chưa đăng ký ca — theo giờ chung' : null}
              {approvedOther && (
                <span className={`font-semibold ${active ? 'text-white' : 'text-rose-600'}`}>
                  {shifts.length > 0 ? ' · ' : ''}Nghỉ {leaveName(approvedOther)}
                </span>
              )}
              {pending && (
                <span className={`font-semibold ${active ? 'text-white' : 'text-amber-600'}`}>
                  {shifts.length > 0 || approvedOther ? ' · ' : ''}Chờ duyệt nghỉ {leaveName(pending)}
                </span>
              )}
            </span>
          )}
        </span>
        {!blocking &&
          (busyUntil ? (
            <span className="flex-shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10.5px] font-bold text-white">Bận tới {busyUntil}</span>
          ) : (
            <span className="flex-shrink-0 rounded-full bg-emerald-500 px-2 py-0.5 text-[10.5px] font-bold text-white">Trống</span>
          ))}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {visible.map(renderDoctor)}
      {unregistered.length > 0 && (
        <div className="mt-0.5">
          <button
            type="button"
            aria-expanded={showUnregistered || selectedIsUnregistered}
            onClick={() => setShowUnregistered((v) => !v)}
            className="text-sm font-semibold text-blue-600 hover:underline"
          >
            Bác sĩ chưa đăng ký ca ({unregistered.length})
          </button>
          {(showUnregistered || selectedIsUnregistered) && <div className="mt-1.5 flex flex-col gap-1.5">{unregistered.map(renderDoctor)}</div>}
        </div>
      )}
    </div>
  );
}
