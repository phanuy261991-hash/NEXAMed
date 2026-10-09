/**
 * Hẹn tái khám (docs/DECISIONS.md #222) — quy đổi qua lại giữa "sau N ngày" và ngày hẹn cụ thể, tính từ NGÀY KHÁM (ngày lịch theo giờ Việt Nam, dạng `YYYY-MM-DD`).
 * Hàm thuần (không đụng giờ hệ thống) để dùng chung API (kiểm hợp lệ lúc lưu) và test; web có bản phản chiếu riêng (`apps/web` không import GIÁ TRỊ từ `@nexamed/core`, #073).
 */

/** Tối đa 365 ngày kể từ ngày khám. */
export const FOLLOW_UP_MAX_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60_000;

function parseDateString(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const check = new Date(t);
  // Chặn ngày không tồn tại (31/02...) — Date.UTC tự "tràn" sang tháng sau nên phải đối chiếu lại.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return t;
}

function formatDateString(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Cộng `days` ngày vào ngày lịch `YYYY-MM-DD`; `null` nếu chuỗi ngày không hợp lệ. */
export function addDaysToDateString(dateStr: string, days: number): string | null {
  const t = parseDateString(dateStr);
  if (t === null || !Number.isInteger(days)) return null;
  return formatDateString(t + days * MS_PER_DAY);
}

/** Số ngày từ `fromStr` đến `toStr` (dương nếu `toStr` sau `fromStr`); `null` nếu một trong hai không hợp lệ. */
export function diffDateStrings(fromStr: string, toStr: string): number | null {
  const a = parseDateString(fromStr);
  const b = parseDateString(toStr);
  if (a === null || b === null) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

export type FollowUpResolution = { ok: true; date: string; days: number } | { ok: false; message: string };

/** Nhập "hẹn sau N ngày" → ngày hẹn. N phải là số nguyên từ 1 đến 365. */
export function resolveFollowUpFromDays(examDate: string, days: number): FollowUpResolution {
  if (!Number.isInteger(days) || days < 1 || days > FOLLOW_UP_MAX_DAYS) {
    return { ok: false, message: `Nhập số ngày từ 1 đến ${FOLLOW_UP_MAX_DAYS}.` };
  }
  const date = addDaysToDateString(examDate, days);
  if (date === null) return { ok: false, message: 'Ngày khám không hợp lệ.' };
  return { ok: true, date, days };
}

/** Chọn ngày hẹn cụ thể → số ngày kể từ ngày khám. Ngày hẹn phải SAU ngày khám và không quá 365 ngày. */
export function resolveFollowUpFromDate(examDate: string, followUpDate: string): FollowUpResolution {
  const days = diffDateStrings(examDate, followUpDate);
  if (days === null) return { ok: false, message: 'Ngày hẹn không hợp lệ.' };
  if (days < 1) return { ok: false, message: 'Ngày hẹn phải sau ngày khám.' };
  if (days > FOLLOW_UP_MAX_DAYS) return { ok: false, message: `Ngày hẹn không quá ${FOLLOW_UP_MAX_DAYS} ngày sau ngày khám.` };
  return { ok: true, date: followUpDate, days };
}

const WEEKDAY_LABELS_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const;

/** "Thứ Năm" cho ngày lịch `YYYY-MM-DD`; chuỗi rỗng nếu không hợp lệ. */
export function vietnameseWeekdayLabel(dateStr: string): string {
  const t = parseDateString(dateStr);
  return t === null ? '' : WEEKDAY_LABELS_VI[new Date(t).getUTCDay()]!;
}

/** "15/10/2026" từ `2026-10-15`; giữ nguyên nếu không đúng định dạng. */
export function formatDateStringVi(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dateStr;
}
