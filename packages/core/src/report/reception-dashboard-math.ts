import { appointmentOverlapsLeaveWindow, vietnamMinuteOfDay } from '../leave/leave-window';

/**
 * Phép tính thuần cho Trang Tổng quan của LỄ TÂN (docs/DECISIONS.md #284) — không biết gì về DB hay HTTP.
 */

export interface ReceptionAppointmentInput {
  id: string;
  /** Chỉ hai trạng thái đang hiệu lực: chưa đến (`SCHEDULED`) và đã chuyển thành lượt khám (`CONVERTED`). */
  status: 'SCHEDULED' | 'CONVERTED';
  scheduledAt: Date;
  durationMinutes: number;
  patientName: string;
  doctorId: string;
  doctorName: string;
  /** Ngày sinh `YYYY-MM-DD` nếu lịch gắn hồ sơ bệnh nhân. */
  dob: string | null;
}

export interface ApprovedLeaveInput {
  userId: string;
  startMinute: number;
  endMinute: number;
}

export interface ReceptionUpcomingItem {
  appointmentId: string;
  scheduledAt: string;
  patientName: string;
  age: number | null;
  doctorName: string;
  doctorOnLeave: boolean;
}

export interface ReceptionLeaveAlert {
  doctorName: string;
  startMinute: number;
  endMinute: number;
  appointmentCount: number;
}

export interface ReceptionAppointmentSummary {
  total: number;
  arrived: number;
  notArrived: number;
  hourly: Array<{ hour: number; arrived: number; notArrived: number }>;
  upcoming: { items: ReceptionUpcomingItem[]; moreCount: number };
  leaveAlerts: ReceptionLeaveAlert[];
}

/** Số phút trước giờ hiện tại mà lịch chưa đến vẫn còn hiện trong "Lịch hẹn sắp tới" (khách đến trễ). */
export const UPCOMING_GRACE_MINUTES = 30;

/** Tuổi tròn năm của người sinh ngày `dob` tại ngày `today` (cả hai `YYYY-MM-DD`); `null` nếu ngày sinh sai định dạng hoặc sau hôm nay. */
export function ageInYears(dob: string, today: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!d || !t) return null;
  const [dy, dm, dd] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [ty, tm, td] = [Number(t[1]), Number(t[2]), Number(t[3])];
  let age = ty - dy;
  if (tm < dm || (tm === dm && td < dd)) age -= 1;
  return age < 0 ? null : age;
}

/**
 * Tổng hợp lịch hẹn HÔM NAY cho Tổng quan lễ tân: đếm đã đến/chưa đến, chia theo giờ hẹn (giờ VN), "Lịch hẹn sắp tới" (chưa đến, từ `UPCOMING_GRACE_MINUTES` trước `now`, sớm trước)
 * và cảnh báo bác sĩ nghỉ — lịch CHƯA ĐẾN trùng khung nghỉ ĐÃ DUYỆT của bác sĩ đó, đúng quy tắc `appointmentOverlapsLeaveWindow` của trang Lịch hẹn. Mỗi bác sĩ một cảnh báo,
 * khung nghỉ lấy từ sớm nhất đến muộn nhất của các đơn trùng.
 */
export function summarizeReceptionAppointments(
  appointments: readonly ReceptionAppointmentInput[],
  leaves: readonly ApprovedLeaveInput[],
  today: string,
  now: Date,
  upcomingLimit: number,
): ReceptionAppointmentSummary {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, arrived: 0, notArrived: 0 }));
  let arrived = 0;
  let notArrived = 0;
  const leavesByDoctor = new Map<string, ApprovedLeaveInput[]>();
  for (const l of leaves) leavesByDoctor.set(l.userId, [...(leavesByDoctor.get(l.userId) ?? []), l]);

  const alertsByDoctor = new Map<string, ReceptionLeaveAlert>();
  const upcoming: Array<ReceptionUpcomingItem & { at: number }> = [];
  const cutoff = now.getTime() - UPCOMING_GRACE_MINUTES * 60_000;

  for (const a of appointments) {
    const hour = Math.min(23, Math.floor(vietnamMinuteOfDay(a.scheduledAt) / 60));
    if (a.status === 'CONVERTED') {
      arrived += 1;
      hourly[hour]!.arrived += 1;
      continue;
    }
    notArrived += 1;
    hourly[hour]!.notArrived += 1;

    const overlapping = (leavesByDoctor.get(a.doctorId) ?? []).filter((l) => appointmentOverlapsLeaveWindow(a.scheduledAt, a.durationMinutes, l));
    if (overlapping.length > 0) {
      const start = Math.min(...overlapping.map((l) => l.startMinute));
      const end = Math.max(...overlapping.map((l) => l.endMinute));
      const existing = alertsByDoctor.get(a.doctorId);
      alertsByDoctor.set(a.doctorId, {
        doctorName: a.doctorName,
        startMinute: existing ? Math.min(existing.startMinute, start) : start,
        endMinute: existing ? Math.max(existing.endMinute, end) : end,
        appointmentCount: (existing?.appointmentCount ?? 0) + 1,
      });
    }
    if (a.scheduledAt.getTime() >= cutoff) {
      upcoming.push({
        appointmentId: a.id,
        scheduledAt: a.scheduledAt.toISOString(),
        patientName: a.patientName,
        age: a.dob ? ageInYears(a.dob, today) : null,
        doctorName: a.doctorName,
        doctorOnLeave: overlapping.length > 0,
        at: a.scheduledAt.getTime(),
      });
    }
  }

  upcoming.sort((x, y) => x.at - y.at || x.patientName.localeCompare(y.patientName, 'vi'));
  const items = upcoming.slice(0, upcomingLimit).map(({ at: _at, ...item }) => item);
  return {
    total: arrived + notArrived,
    arrived,
    notArrived,
    hourly,
    upcoming: { items, moreCount: Math.max(0, upcoming.length - upcomingLimit) },
    leaveAlerts: [...alertsByDoctor.values()].sort((x, y) => x.startMinute - y.startMinute || x.doctorName.localeCompare(y.doctorName, 'vi')),
  };
}
