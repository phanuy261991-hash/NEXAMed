/**
 * Phép tính thuần cho nhóm báo cáo "Khám bệnh và vận hành" (docs/DECISIONS.md #287): giờ cao điểm, thời gian chờ, huỷ và không đến, tái khám, nguồn đặt lịch.
 * Truy vấn SQL chỉ gom số đếm theo nhóm; việc ghép thành bản đồ nhiệt, khung giờ, phân bố, tỉ lệ nằm ở đây để test được kỹ và không lặp ở nhiều nơi.
 * Ngày `YYYY-MM-DD` theo lịch Việt Nam; thứ theo chuẩn ISO (1 = Thứ Hai ... 7 = Chủ nhật).
 */

/** Giờ đầu/cuối mặc định của bản đồ nhiệt (cùng mockup): cột tự rộng ra nếu có lượt ngoài khoảng này. */
export const HEATMAP_DEFAULT_FIRST_HOUR = 7;
export const HEATMAP_DEFAULT_LAST_HOUR = 19;

/** Ngưỡng "chờ lâu" (phút) của chỉ số "Chờ quá 30 phút". */
export const LONG_WAIT_MINUTES = 30;

export interface HourCountRow {
  /** 1 = Thứ Hai ... 7 = Chủ nhật. */
  isoDow: number;
  hour: number;
  count: number;
}

export interface PeakHoursDay {
  isoDow: number;
  /** Số lượt theo từng cột của `hours` (cùng thứ tự). */
  counts: number[];
  total: number;
}

export interface PeakHours {
  hours: number[];
  days: PeakHoursDay[];
  totalVisits: number;
  /** Ô thứ-giờ đông nhất; hoà thì thứ rồi giờ sớm hơn. `null` khi không có lượt nào. */
  peak: { isoDow: number; hour: number; count: number } | null;
  /** Thứ ít khách nhất trong các thứ CÓ xuất hiện trong kỳ (kỳ 3 ngày không có đủ 7 thứ); tổng lượt cả kỳ của thứ đó. */
  quietestDay: { isoDow: number; total: number } | null;
}

/** Các thứ (ISO) có ít nhất một ngày trong khoảng `[from, to]`. Khoảng tối đa 366 ngày vẫn đủ 7 thứ nên dừng sớm. */
export function occurringIsoWeekdays(from: string, to: string): Set<number> {
  const seen = new Set<number>();
  const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!start || !end) return seen;
  const startMs = Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3]));
  const endMs = Date.UTC(Number(end[1]), Number(end[2]) - 1, Number(end[3]));
  for (let ms = startMs; ms <= endMs && seen.size < 7; ms += 86_400_000) {
    const js = new Date(ms).getUTCDay();
    seen.add(js === 0 ? 7 : js);
  }
  return seen;
}

/** Ghép số lượt theo (thứ, giờ) thành bản đồ nhiệt đủ 7 thứ; cột giờ là 7–19 và tự mở rộng nếu có lượt ngoài khoảng đó. */
export function buildPeakHours(rows: readonly HourCountRow[], from: string, to: string): PeakHours {
  const valid = rows.filter((r) => r.isoDow >= 1 && r.isoDow <= 7 && r.hour >= 0 && r.hour <= 23 && r.count > 0);
  let first = HEATMAP_DEFAULT_FIRST_HOUR;
  let last = HEATMAP_DEFAULT_LAST_HOUR;
  for (const r of valid) {
    first = Math.min(first, r.hour);
    last = Math.max(last, r.hour);
  }
  const hours: number[] = [];
  for (let h = first; h <= last; h += 1) hours.push(h);

  const days: PeakHoursDay[] = [1, 2, 3, 4, 5, 6, 7].map((isoDow) => ({ isoDow, counts: hours.map(() => 0), total: 0 }));
  let peak: PeakHours['peak'] = null;
  for (const r of valid) {
    const day = days[r.isoDow - 1]!;
    day.counts[r.hour - first]! += r.count;
    day.total += r.count;
  }
  for (const day of days) {
    day.counts.forEach((count, i) => {
      if (count > 0 && (peak === null || count > peak.count)) peak = { isoDow: day.isoDow, hour: hours[i]!, count };
    });
  }

  const occurring = occurringIsoWeekdays(from, to);
  let quietest: PeakHours['quietestDay'] = null;
  for (const day of days) {
    if (!occurring.has(day.isoDow)) continue;
    if (quietest === null || day.total < quietest.total) quietest = { isoDow: day.isoDow, total: day.total };
  }
  const totalVisits = days.reduce((sum, d) => sum + d.total, 0);
  return { hours, days, totalVisits, peak, quietestDay: totalVisits === 0 ? null : quietest };
}

/** Các mốc phân bố thời gian chờ (phút): bucket `i` là `[min_i, max_i)`; mốc cuối không có cận trên. */
export const WAIT_BUCKETS = [
  { label: '0–10 phút', upTo: 10 },
  { label: '10–20 phút', upTo: 20 },
  { label: '20–30 phút', upTo: 30 },
  { label: '30–45 phút', upTo: 45 },
  { label: 'Trên 45 phút', upTo: null },
] as const;

/** Chỉ số mốc phân bố của một thời gian chờ (phút). */
export function waitBucketIndex(minutes: number): number {
  const i = WAIT_BUCKETS.findIndex((b) => b.upTo !== null && minutes < b.upTo);
  return i === -1 ? WAIT_BUCKETS.length - 1 : i;
}

export interface WaitHourRow {
  hour: number;
  /** Chỉ số mốc phân bố (`waitBucketIndex`). */
  bucket: number;
  count: number;
  /** Tổng số phút chờ của các lượt trong nhóm. */
  sumMinutes: number;
}

export interface WaitSlot {
  label: string;
  visits: number;
  averageMinutes: number | null;
  over30Percent: number | null;
}

export interface WaitingSummary {
  /** Số lượt đo được thời gian chờ (có cả giờ tiếp nhận và giờ vào khám). */
  measuredCount: number;
  averageMinutes: number | null;
  over30Count: number;
  over30Percent: number | null;
  slots: WaitSlot[];
  distribution: Array<{ label: string; count: number; percent: number }>;
}

/** Làm tròn một chữ số thập phân (phần trăm). */
export function roundPercent(part: number, whole: number): number | null {
  return whole <= 0 ? null : Math.round((part / whole) * 1000) / 10;
}

function roundedAverage(sum: number, count: number): number | null {
  return count <= 0 ? null : Math.round(sum / count);
}

/** Số lượt của mốc phân bố `i` có phải là "chờ quá 30 phút" không (các mốc từ 30 phút trở lên). */
const OVER30_FIRST_BUCKET = WAIT_BUCKETS.findIndex((b) => b.upTo === 45);

/**
 * Thời gian chờ từ số liệu gom theo (giờ tiếp nhận, mốc phân bố): trung bình, tỉ lệ chờ quá 30 phút, các khung 2 giờ tính từ 7h (07–09h, 09–11h...; lượt trước 7h hoặc từ 19h
 * thêm khung ở hai đầu), và phân bố theo mốc. Khung/mốc không có lượt vẫn hiện (khung rỗng chỉ ở giữa dải) để bảng không đứt quãng.
 */
export function summarizeWaiting(rows: readonly WaitHourRow[]): WaitingSummary {
  const valid = rows.filter((r) => r.count > 0 && r.hour >= 0 && r.hour <= 23 && r.bucket >= 0 && r.bucket < WAIT_BUCKETS.length);
  const measuredCount = valid.reduce((s, r) => s + r.count, 0);
  const totalMinutes = valid.reduce((s, r) => s + r.sumMinutes, 0);
  const over30Count = valid.filter((r) => r.bucket >= OVER30_FIRST_BUCKET).reduce((s, r) => s + r.count, 0);

  const slotIndex = (hour: number) => Math.floor((hour - HEATMAP_DEFAULT_FIRST_HOUR) / 2);
  let minSlot = 0;
  let maxSlot = 5;
  for (const r of valid) {
    minSlot = Math.min(minSlot, slotIndex(r.hour));
    maxSlot = Math.max(maxSlot, slotIndex(r.hour));
  }
  const slots: WaitSlot[] = [];
  if (measuredCount > 0) {
    for (let s = minSlot; s <= maxSlot; s += 1) {
      const inSlot = valid.filter((r) => slotIndex(r.hour) === s);
      const visits = inSlot.reduce((sum, r) => sum + r.count, 0);
      const over = inSlot.filter((r) => r.bucket >= OVER30_FIRST_BUCKET).reduce((sum, r) => sum + r.count, 0);
      const startHour = HEATMAP_DEFAULT_FIRST_HOUR + s * 2;
      const pad = (h: number) => String(h).padStart(2, '0');
      slots.push({ label: `${pad(startHour)}–${pad(startHour + 2)}h`, visits, averageMinutes: roundedAverage(inSlot.reduce((sum, r) => sum + r.sumMinutes, 0), visits), over30Percent: roundPercent(over, visits) });
    }
  }

  const distribution = WAIT_BUCKETS.map((b, i) => {
    const count = valid.filter((r) => r.bucket === i).reduce((s, r) => s + r.count, 0);
    return { label: b.label, count, percent: roundPercent(count, measuredCount) ?? 0 };
  });

  return {
    measuredCount,
    averageMinutes: roundedAverage(totalMinutes, measuredCount),
    over30Count,
    over30Percent: roundPercent(over30Count, measuredCount),
    slots,
    distribution,
  };
}

/** Một nhóm (bác sĩ, ngày) của bảng thời gian chờ: số lượt đo được, tổng phút, số lượt chờ trên 30 phút. */
export interface WaitGroupRow {
  count: number;
  sumMinutes: number;
  over30Count: number;
}

/** Tên thứ theo ISO (1 = Thứ Hai ... 7 = Chủ nhật) cho Excel do máy chủ dựng (web có bản riêng vì chỉ được import KIỂU từ core/shared). */
export const ISO_WEEKDAY_LABEL: Record<number, string> = { 1: 'Thứ Hai', 2: 'Thứ Ba', 3: 'Thứ Tư', 4: 'Thứ Năm', 5: 'Thứ Sáu', 6: 'Thứ Bảy', 7: 'Chủ nhật' };

export function summarizeWaitGroup(row: WaitGroupRow): { visits: number; averageMinutes: number | null; over30Count: number; over30Percent: number | null } {
  return { visits: row.count, averageMinutes: roundedAverage(row.sumMinutes, row.count), over30Count: row.over30Count, over30Percent: roundPercent(row.over30Count, row.count) };
}
