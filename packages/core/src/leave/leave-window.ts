/**
 * "Đơn xin nghỉ" (#224) — khung nghỉ trong MỘT ngày, tính bằng phút kể từ 00:00 GIỜ VIỆT NAM
 * (`[startMinute, endMinute)`). Đơn "cả ngày" = 0–1440 nên không phụ thuộc mẫu ca đăng ký sau đó.
 * Hàm thuần — dùng chung `leave-request` (kiểm chồng lấn) lẫn `appointment` (chặn đặt lịch, đánh dấu
 * "Cần xử lý"); bản phản chiếu ở `apps/web` (#073, web không import giá trị từ core).
 */
export interface LeaveWindow {
  startMinute: number;
  endMinute: number;
}

export const LEAVE_DAY_START_MINUTE = 0;
export const LEAVE_DAY_END_MINUTE = 24 * 60;

const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;
const MINUTES_PER_DAY = 24 * 60;
const NOON_MINUTE = 12 * 60;

/** `"07:30"` → 450. */
export function hhmmToMinute(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Khung nghỉ đúng bằng giờ của một ca (snapshot lúc gửi đơn). */
export function leaveWindowFromShift(startTime: string, endTime: string): LeaveWindow {
  return { startMinute: hhmmToMinute(startTime), endMinute: hhmmToMinute(endTime) };
}

export function wholeDayLeaveWindow(): LeaveWindow {
  return { startMinute: LEAVE_DAY_START_MINUTE, endMinute: LEAVE_DAY_END_MINUTE };
}

export function isWholeDayLeaveWindow(window: LeaveWindow): boolean {
  return window.startMinute <= LEAVE_DAY_START_MINUTE && window.endMinute >= LEAVE_DAY_END_MINUTE;
}

/** Hai khoảng nửa mở `[start,end)` chồng lấn nhau (chạm đầu mút KHÔNG tính là chồng). */
export function windowsOverlap(a: LeaveWindow, b: LeaveWindow): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/** Phút kể từ 00:00 giờ VN của `date` (UTC+7 cố định, không mùa hè). */
export function vietnamMinuteOfDay(date: Date): number {
  return (date.getUTCHours() * 60 + date.getUTCMinutes() + VIETNAM_UTC_OFFSET_MINUTES) % MINUTES_PER_DAY;
}

/** Lịch hẹn `[scheduledAt, scheduledAt + duration)` có nằm chồng lên khung nghỉ của CÙNG ngày VN không. */
export function appointmentOverlapsLeaveWindow(scheduledAt: Date, durationMinutes: number, window: LeaveWindow): boolean {
  const start = vietnamMinuteOfDay(scheduledAt);
  return windowsOverlap({ startMinute: start, endMinute: start + durationMinutes }, window);
}

/** Nhãn ngắn cho thẻ bác sĩ ở Tiếp nhận: "Nghỉ hôm nay" / "Nghỉ sáng nay" / "Nghỉ chiều nay". */
export function describeLeaveToday(window: LeaveWindow): string {
  if (isWholeDayLeaveWindow(window)) return 'Nghỉ hôm nay';
  return window.startMinute < NOON_MINUTE ? 'Nghỉ sáng nay' : 'Nghỉ chiều nay';
}
