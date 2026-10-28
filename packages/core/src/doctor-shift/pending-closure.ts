/**
 * "Phiên trước chưa đóng" của bác sĩ (mockup duyệt 28/10/2026) — thuần tính toán, không IO.
 *
 * Hệ thống KHÔNG ghi gì khi bác sĩ làm việc bình thường (ACTIVE là ngầm định, xem
 * `doctor_availability`), nên "ngày chưa đóng" được SUY RA từ dấu hiệu có làm việc:
 * - bác sĩ có nhận lượt khám trong ngày đó (`workedDates`), HOẶC
 * - ngày đó có ca đã xếp (`assignedDates`) mà không nghỉ phép cả ngày đã được duyệt (`wholeDayLeaveDates`),
 * rồi trừ các ngày đã có bản ghi "Đã đóng ca" (`endedDates`).
 */
export const MAX_PENDING_CLOSURE_LOOKBACK_DAYS = 31;

/** Cộng/trừ ngày trên chuỗi `YYYY-MM-DD` (lịch VN) — dùng UTC thuần nên không dính múi giờ máy. */
export function addDaysToVietnamDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Khoảng ngày cần xét: từ `max(ngày bắt đầu áp dụng, hôm nay − 31 ngày)` đến HÔM QUA. `null` khi không còn
 * ngày nào (vừa bắt đầu áp dụng hôm nay). `enforcedFrom = null` = chưa có mốc, coi như áp dụng từ đầu giới hạn lùi.
 */
export function pendingClosureWindow(today: string, enforcedFrom: string | null): { from: string; to: string } | null {
  const lookbackStart = addDaysToVietnamDate(today, -MAX_PENDING_CLOSURE_LOOKBACK_DAYS);
  const from = enforcedFrom !== null && enforcedFrom > lookbackStart ? enforcedFrom : lookbackStart;
  const to = addDaysToVietnamDate(today, -1);
  return from > to ? null : { from, to };
}

export interface PendingClosureInput {
  from: string;
  to: string;
  workedDates: Iterable<string>;
  assignedDates: Iterable<string>;
  wholeDayLeaveDates: Iterable<string>;
  endedDates: Iterable<string>;
}

/** Các ngày trong `[from, to]` còn chưa đóng ca, tăng dần. */
export function computePendingClosureDates(input: PendingClosureInput): string[] {
  const leave = new Set(input.wholeDayLeaveDates);
  const ended = new Set(input.endedDates);
  const candidates = new Set<string>(input.workedDates);
  for (const date of input.assignedDates) {
    if (!leave.has(date)) candidates.add(date);
  }
  return [...candidates].filter((date) => date >= input.from && date <= input.to && !ended.has(date)).sort();
}

/** `2026-10-27` → `27/10/2026` (dùng trong thông báo lỗi tiếng Việt). */
export function formatVietnamDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

/** Giờ kết thúc muộn nhất trong các ca của ngày (`HH:mm` so chuỗi), `null` nếu không có ca. */
export function latestShiftEndTime(shifts: ReadonlyArray<{ endTime: string }>): string | null {
  let latest: string | null = null;
  for (const shift of shifts) {
    if (latest === null || shift.endTime > latest) latest = shift.endTime;
  }
  return latest;
}
