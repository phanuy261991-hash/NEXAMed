import type { AppointmentSummary, BusinessHours } from '@nexamed/shared';

/** Fallback khi tenant chưa cấu hình `clinic-settings` (businessHours null) — .claude/docs/ui-guidelines.md chưa định nghĩa giờ mặc định, chọn khung phổ biến cho phòng khám tư nhân. */
export const DEFAULT_OPEN_TIME = '07:00';
export const DEFAULT_CLOSE_TIME = '17:00';

/** Bước hiển thị cột giờ — 30 phút, đã chốt qua mockup (đỡ rối mắt so với bước 15 phút ban đầu). */
export const GRID_STEP_MINUTES = 30;

/** Chiều cao 1 hàng 30 phút (px) — đủ cao để lịch hẹn mặc định 15 phút không bị bóp chữ (bug thật
 * gặp ở mockup lúc 72px/hàng, sửa lên 92px — xem lịch sử trao đổi lúc duyệt mockup). */
export const ROW_HEIGHT_PX = 92;

const WEEKDAY_KEYS: (keyof BusinessHours)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface DayHoursRange {
  open: string;
  close: string;
}

/**
 * Giờ mở/đóng cửa của một ngày cụ thể (`dateStr` dạng `YYYY-MM-DD`, theo lịch Việt Nam — khớp
 * cách BE lọc bằng `vietnamDayRange()`). `businessHours === null` (chưa cấu hình) → dùng mặc định
 * cho mọi ngày. Ngày cụ thể đóng cửa (`null` trong cấu hình đã lưu) → trả `null` thật (tôn trọng
 * cấu hình đã có, không ép mặc định đè lên).
 */
export function resolveDayHours(businessHours: BusinessHours | null, dateStr: string): DayHoursRange | null {
  if (!businessHours) {
    return { open: DEFAULT_OPEN_TIME, close: DEFAULT_CLOSE_TIME };
  }
  const weekdayIndex = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const key = WEEKDAY_KEYS[weekdayIndex];
  const dayHours = key ? businessHours[key] : null;
  return dayHours ? { open: dayHours.open, close: dayHours.close } : null;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToLabel(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * "Đăng ký ca làm việc" Giai đoạn 2 — mở rộng biên hiển thị lưới bằng hợp của `businessHours` VÀ
 * mọi ca đã đăng ký hôm đó, tránh cắt mất ca ngoài giờ hành chính (ví dụ trực đêm) khi ít nhất một
 * bác sĩ có ca vượt ra ngoài `businessHours` mặc định.
 */
export function extendRangeWithShifts(range: DayHoursRange, allShiftsToday: { startTime: string; endTime: string }[]): DayHoursRange {
  let openMin = toMinutes(range.open);
  let closeMin = toMinutes(range.close);
  for (const shift of allShiftsToday) {
    openMin = Math.min(openMin, toMinutes(shift.startTime));
    closeMin = Math.max(closeMin, toMinutes(shift.endTime));
  }
  return { open: minutesToLabel(openMin), close: minutesToLabel(closeMin) };
}

/** Danh sách mốc giờ hiển thị bên trái lưới, bước `GRID_STEP_MINUTES`. */
export function generateSlotLabels(range: DayHoursRange): string[] {
  const start = toMinutes(range.open);
  const end = toMinutes(range.close);
  const labels: string[] = [];
  for (let t = start; t < end; t += GRID_STEP_MINUTES) {
    labels.push(minutesToLabel(t));
  }
  return labels;
}

/** Việt Nam UTC+7 cố định — cùng kỹ thuật `vietnamDayRange()` phía backend, chỉ lấy giờ:phút trong ngày để định vị thẻ trên lưới (ngày đã lọc đúng ở server qua tham số `date`). */
export function vnTimeOfDayMinutes(iso: string): number {
  const d = new Date(iso);
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + 7 * 60) % (24 * 60);
}

/** Ngày hôm nay theo lịch Việt Nam, dạng `YYYY-MM-DD` — dùng làm mặc định lúc mở trang + so khớp
 * để biết có nên vẽ đường kẻ "bây giờ" hay không (chỉ vẽ đúng ngày đang xem là hôm nay). */
export function getVietnamTodayDateString(): string {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60_000);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`;
}

/** Phút hiện tại trong ngày theo giờ Việt Nam — dùng cho đường kẻ "bây giờ". */
export function vietnamNowMinutes(): number {
  const now = new Date();
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + 7 * 60) % (24 * 60);
}

/** ISO UTC → `YYYY-MM-DD` theo giờ Việt Nam — cùng kỹ thuật `getVietnamTodayDateString()`, chỉ
 * khác nguồn (một mốc giờ bất kỳ thay vì "bây giờ"). Dùng để tính ngày mặc định của một lịch hẹn
 * đã có (ví dụ mở panel Dời lịch), không lệ thuộc vào ngày đang xem trên lưới. */
export function isoToVietnamDateString(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Giờ bận cuối cùng của một bác sĩ nếu khung `time`+`durationMinutes` chồng lịch — dùng cho danh
 * sách "Bác sĩ trống/bận" (Đặt lịch nhanh lẫn Dời lịch, trùng lặp lần 2 nên trích xuất theo
 * CLAUDE.md). Bỏ qua lịch `CANCELLED`/`RESCHEDULED` — không còn thật sự chiếm khung giờ đó.
 * `excludeAppointmentId`: bỏ qua chính lịch đang dời (nếu có) để không tự báo bận với chính mình.
 */
export function findDoctorBusyUntilLabel(
  doctorId: string,
  time: string,
  durationMinutes: number,
  dayAppointments: AppointmentSummary[],
  excludeAppointmentId?: string,
): string | null {
  const start = toMinutes(time);
  const end = start + durationMinutes;
  let busyUntil: number | null = null;
  for (const a of dayAppointments) {
    if (a.doctorId !== doctorId || a.status === 'CANCELLED' || a.status === 'RESCHEDULED' || a.id === excludeAppointmentId) continue;
    const aStart = vnTimeOfDayMinutes(a.scheduledAt);
    const aEnd = aStart + a.durationMinutes;
    if (start < aEnd && end > aStart) {
      busyUntil = busyUntil === null ? aEnd : Math.max(busyUntil, aEnd);
    }
  }
  return busyUntil === null ? null : minutesToLabel(busyUntil);
}

/** Thêm/bớt N ngày vào một ngày `YYYY-MM-DD`, trả về `YYYY-MM-DD` — dùng cho nút chuyển ngày trước/sau. */
export function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_LABELS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** Ngày `YYYY-MM-DD` + giờ `HH:mm` theo giờ Việt Nam → ISO UTC — dùng để gửi `scheduledAt` lên API. */
export function vnDateTimeToIso(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const utcMs = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0) - 7 * 60 * 60_000;
  return new Date(utcMs).toISOString();
}

/** `YYYY-MM-DD` → "Thứ Tư, 12/08/2026" (định dạng đã chốt ở mockup). */
export function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const weekday = WEEKDAY_LABELS_VI[d.getUTCDay()];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${weekday}, ${dd}/${mm}/${d.getUTCFullYear()}`;
}
