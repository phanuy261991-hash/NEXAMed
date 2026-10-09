/**
 * BẢN PHẢN CHIẾU của `packages/core/src/leave/leave-window.ts` ("Đơn xin nghỉ", #224) — `apps/web`
 * không import GIÁ TRỊ từ `@nexamed/core` (#073, Rollup không dò được named export qua
 * `__exportStar`). Khung nghỉ = phút kể từ 00:00 giờ VN, khoảng nửa mở `[start, end)`. Test
 * `leave-window.spec.ts` chạy lại đúng các ca của bản core để bắt lệch.
 */
export interface LeaveWindow {
  startMinute: number;
  endMinute: number;
}

const DAY_MINUTES = 24 * 60;
const NOON_MINUTE = 12 * 60;

export function hhmmToMinute(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minuteToHhmm(minute: number): string {
  const clamped = Math.min(minute, DAY_MINUTES);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isWholeDayWindow(window: LeaveWindow): boolean {
  return window.startMinute <= 0 && window.endMinute >= DAY_MINUTES;
}

export function windowsOverlap(a: LeaveWindow, b: LeaveWindow): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/** "Nghỉ hôm nay" / "Nghỉ sáng nay" / "Nghỉ chiều nay" — nhãn thẻ bác sĩ ở Tiếp nhận. */
export function describeLeaveToday(window: LeaveWindow): string {
  if (isWholeDayWindow(window)) return 'Nghỉ hôm nay';
  return window.startMinute < NOON_MINUTE ? 'Nghỉ sáng nay' : 'Nghỉ chiều nay';
}

/** "07:30 – 11:30" hoặc "Cả ngày". */
export function formatLeaveWindow(window: LeaveWindow): string {
  return isWholeDayWindow(window) ? 'Cả ngày' : `${minuteToHhmm(window.startMinute)} – ${minuteToHhmm(window.endMinute)}`;
}
