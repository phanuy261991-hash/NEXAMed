/**
 * Hẹn tái khám (docs/DECISIONS.md #222) — BẢN PHẢN CHIẾU của `packages/core/src/encounter/follow-up-date.ts` (`apps/web` không import GIÁ TRỊ từ `@nexamed/core`, #073 — Rollup không dò được
 * named export qua `__exportStar`). Hai bản phải cho kết quả GIỐNG HỆT: `follow-up-date.spec.ts` ở web chạy lại đúng các ca của bản core. Ngày lịch dạng `YYYY-MM-DD` theo giờ Việt Nam.
 */

export const FOLLOW_UP_MAX_DAYS = 365;
/** Số ngày mặc định khi vừa tích "Hẹn tái khám" (như mockup đã duyệt). */
export const FOLLOW_UP_DEFAULT_DAYS = 7;
export const FOLLOW_UP_QUICK_DAYS = [3, 7, 14] as const;

const MS_PER_DAY = 24 * 60 * 60_000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60_000;

function parseDateString(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const check = new Date(t);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return t;
}

function formatDateString(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDaysToDateString(dateStr: string, days: number): string | null {
  const t = parseDateString(dateStr);
  if (t === null || !Number.isInteger(days)) return null;
  return formatDateString(t + days * MS_PER_DAY);
}

export function diffDateStrings(fromStr: string, toStr: string): number | null {
  const a = parseDateString(fromStr);
  const b = parseDateString(toStr);
  if (a === null || b === null) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

export type FollowUpResolution = { ok: true; date: string; days: number } | { ok: false; message: string };

export function resolveFollowUpFromDays(examDate: string, days: number): FollowUpResolution {
  if (!Number.isInteger(days) || days < 1 || days > FOLLOW_UP_MAX_DAYS) {
    return { ok: false, message: `Nhập số ngày từ 1 đến ${FOLLOW_UP_MAX_DAYS}.` };
  }
  const date = addDaysToDateString(examDate, days);
  if (date === null) return { ok: false, message: 'Ngày khám không hợp lệ.' };
  return { ok: true, date, days };
}

export function resolveFollowUpFromDate(examDate: string, followUpDate: string): FollowUpResolution {
  const days = diffDateStrings(examDate, followUpDate);
  if (days === null) return { ok: false, message: 'Ngày hẹn không hợp lệ.' };
  if (days < 1) return { ok: false, message: 'Ngày hẹn phải sau ngày khám.' };
  if (days > FOLLOW_UP_MAX_DAYS) return { ok: false, message: `Ngày hẹn không quá ${FOLLOW_UP_MAX_DAYS} ngày sau ngày khám.` };
  return { ok: true, date: followUpDate, days };
}

const WEEKDAY_LABELS_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const;

export function vietnameseWeekdayLabel(dateStr: string): string {
  const t = parseDateString(dateStr);
  return t === null ? '' : WEEKDAY_LABELS_VI[new Date(t).getUTCDay()]!;
}

/** "15/10/2026" từ `2026-10-15`. */
export function formatDateStringVi(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dateStr;
}

/** Ngày lịch Việt Nam (`YYYY-MM-DD`) của một mốc ISO — dùng để lấy "ngày khám" từ `encounter.checkedInAt`. */
export function toVietnamDateString(iso: string): string {
  return formatDateString(new Date(iso).getTime() + VIETNAM_OFFSET_MS);
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/**
 * Nhắc nhẹ (không chặn) khi ngày hẹn rơi vào NGÀY PHÒNG KHÁM NGHỈ theo giờ làm việc đã cấu hình ("Cấu hình phòng khám" → Giờ làm việc, `null` = đóng cửa cả ngày).
 * Trả tên thứ ("Chủ nhật") nếu ngày đó đang đóng cửa; `null` nếu có mở cửa, chưa cấu hình giờ làm việc, hoặc ngày không hợp lệ. Chưa tính ngày lễ (hệ thống chưa có lịch nghỉ lễ).
 */
export function closedDayName(businessHours: Partial<Record<(typeof DAY_KEYS)[number], unknown>> | null | undefined, dateStr: string): string | null {
  if (!businessHours) return null;
  const t = parseDateString(dateStr);
  if (t === null) return null;
  const key = DAY_KEYS[new Date(t).getUTCDay()]!;
  return key in businessHours && businessHours[key] === null ? vietnameseWeekdayLabel(dateStr) : null;
}
