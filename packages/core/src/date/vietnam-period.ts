/**
 * Mốc ngày/kỳ theo GIỜ VIỆT NAM dùng chung cho mọi báo cáo và bộ lọc theo khoảng ngày (docs/DECISIONS.md #279, `docs/product/reporting-plan.md` mục 6.2).
 *
 * Việt Nam dùng UTC+7 cố định, không có giờ mùa hè. Ngày luôn là chuỗi `YYYY-MM-DD` theo LỊCH VIỆT NAM; mốc thời gian trả về là `Date` (UTC) chính xác.
 * KHÔNG viết cứng `+07:00` ở nơi khác — một khoản thu lúc 23:30 giờ VN sẽ rơi sai ngày nếu mỗi nơi tự cắt mốc một kiểu.
 */

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
import { addDaysToDateString, diffDateStrings } from '../encounter/follow-up-date';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ngày hợp lệ theo lịch (từ chối `2026-02-30`). Trả `null` khi sai định dạng. */
function parseDateParts(dateStr: string): { y: number; m: number; d: number } | null {
  const match = DATE_PATTERN.exec(dateStr);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function isValidDateString(dateStr: string): boolean {
  return parseDateParts(dateStr) !== null;
}

function requireDateParts(dateStr: string): { y: number; m: number; d: number } {
  const parts = parseDateParts(dateStr);
  if (!parts) throw new Error(`Ngày không hợp lệ (cần YYYY-MM-DD): "${dateStr}"`);
  return parts;
}

function formatDateString(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 00:00:00.000 giờ VN của ngày `dateStr` (bao gồm). */
export function vietnamDayStartUtc(dateStr: string): Date {
  const { y, m, d } = requireDateParts(dateStr);
  return new Date(Date.UTC(y, m - 1, d) - VIETNAM_UTC_OFFSET_MS);
}

/** 23:59:59.999 giờ VN của ngày `dateStr` (bao gồm) — dùng cho điều kiện `<=`. */
export function vietnamDayEndUtc(dateStr: string): Date {
  return new Date(vietnamDayStartUtc(dateStr).getTime() + DAY_MS - 1);
}

/** Khoảng `[from 00:00, to 23:59:59.999]` giờ VN từ hai ngày `YYYY-MM-DD` (cả hai bao gồm). */
export function vietnamDateRangeUtc(fromDate: string, toDate: string): { from: Date; to: Date } {
  return { from: vietnamDayStartUtc(fromDate), to: vietnamDayEndUtc(toDate) };
}

/** Khoảng nửa mở `[start, end)` của các ngày `fromDate..toDate` — dùng cho điều kiện `>= start AND < end`. */
export function vietnamDateRangeHalfOpenUtc(fromDate: string, toDate: string): { startUtc: Date; endUtc: Date } {
  return { startUtc: vietnamDayStartUtc(fromDate), endUtc: new Date(vietnamDayStartUtc(toDate).getTime() + DAY_MS) };
}

/** Cộng/trừ số ngày lịch (ném lỗi nếu ngày sai) — dùng lại `addDaysToDateString` của `encounter/follow-up-date`. */
function shiftDate(dateStr: string, days: number): string {
  const result = addDaysToDateString(dateStr, days);
  if (result === null) throw new Error(`Ngày không hợp lệ (cần YYYY-MM-DD): "${dateStr}"`);
  return result;
}

function daysBetween(fromDate: string, toDate: string): number {
  const result = diffDateStrings(fromDate, toDate);
  if (result === null) throw new Error(`Ngày không hợp lệ (cần YYYY-MM-DD): "${fromDate}" / "${toDate}"`);
  return result;
}

/** Liệt kê từng ngày `from..to` (bao gồm cả hai); khoảng ngược hoặc dài quá `maxDays` thì ném lỗi (chặn vòng lặp vô hạn từ đầu vào sai). */
export function listDateStrings(fromDate: string, toDate: string, maxDays = 3660): string[] {
  const span = daysBetween(fromDate, toDate);
  if (span < 0) throw new Error('Khoảng ngày ngược (from sau to).');
  if (span + 1 > maxDays) throw new Error(`Khoảng ngày quá dài (tối đa ${maxDays} ngày).`);
  return Array.from({ length: span + 1 }, (_, i) => shiftDate(fromDate, i));
}

export type ReportPeriodKind = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Cạnh `to` của tháng: ngày cuối tháng. */
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Kỳ báo cáo chứa ngày `anchorDate`: ngày / tuần (thứ Hai → Chủ nhật) / tháng / quý / năm. Trả `{ from, to }` đều là `YYYY-MM-DD`, cả hai bao gồm.
 */
export function resolveReportPeriod(kind: ReportPeriodKind, anchorDate: string): { from: string; to: string } {
  const { y, m, d } = requireDateParts(anchorDate);
  switch (kind) {
    case 'day':
      return { from: anchorDate, to: anchorDate };
    case 'week': {
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Chủ nhật
      const sinceMonday = (weekday + 6) % 7;
      const from = shiftDate(anchorDate, -sinceMonday);
      return { from, to: shiftDate(from, 6) };
    }
    case 'month':
      return { from: formatDateString(y, m, 1), to: formatDateString(y, m, lastDayOfMonth(y, m)) };
    case 'quarter': {
      const firstMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const lastMonth = firstMonth + 2;
      return { from: formatDateString(y, firstMonth, 1), to: formatDateString(y, lastMonth, lastDayOfMonth(y, lastMonth)) };
    }
    case 'year':
      return { from: formatDateString(y, 1, 1), to: formatDateString(y, 12, 31) };
  }
}

/**
 * Kỳ ngay TRƯỚC kỳ `[from, to]` có cùng độ dài (kỳ liền kề). Kỳ là CẢ tháng/quý/năm lịch thì lùi đúng một tháng/quý/năm (tháng 3 → tháng 2 đủ ngày của tháng 2),
 * còn lại lùi đúng số ngày của kỳ.
 */
export function previousPeriod(fromDate: string, toDate: string): { from: string; to: string } {
  for (const kind of ['year', 'quarter', 'month'] as const) {
    const whole = resolveReportPeriod(kind, fromDate);
    if (whole.from === fromDate && whole.to === toDate) {
      const before = shiftDate(fromDate, -1);
      return resolveReportPeriod(kind, before);
    }
  }
  const length = daysBetween(fromDate, toDate) + 1;
  return { from: shiftDate(fromDate, -length), to: shiftDate(fromDate, -1) };
}

/**
 * "Cùng kỳ tháng trước": cùng khoảng ngày trong tháng liền trước, cắt về ngày cuối tháng nếu tháng trước ngắn hơn (so 1–31/3 với 1–28/2).
 * Dùng cho phép so "tháng này tính đến hôm nay so với tháng trước tính đến cùng ngày".
 */
export function sameSpanPreviousMonth(fromDate: string, toDate: string): { from: string; to: string } {
  const f = requireDateParts(fromDate);
  const t = requireDateParts(toDate);
  const shift = (y: number, m: number, d: number): string => {
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevYear = m === 1 ? y - 1 : y;
    return formatDateString(prevYear, prevMonth, Math.min(d, lastDayOfMonth(prevYear, prevMonth)));
  };
  return { from: shift(f.y, f.m, f.d), to: shift(t.y, t.m, t.d) };
}
