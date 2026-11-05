/**
 * Kỳ báo cáo của các báo cáo điều hành (docs/DECISIONS.md #287) — hàm THUẦN, ngày `YYYY-MM-DD` theo lịch Việt Nam (nơi gọi truyền "hôm nay" theo giờ Việt Nam). Web không import giá trị
 * từ `@nexamed/core` nên bản này tách riêng; máy chủ nhận sẵn `from`/`to` và tự kiểm khoảng ngày, nên hai bên không cần dùng chung hàm. Các kỳ "đến nay" (tháng này, quý, năm) chạy
 * từ ngày đầu kỳ đến HÔM NAY (không lấy cả kỳ tương lai); "tháng trước" là cả tháng trước.
 */
export type PeriodKind = 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'quarter' | 'year' | 'custom';

export interface PeriodRange {
  from: string;
  to: string;
}

/** Khoảng ngày tối đa máy chủ nhận cho một lần xem (khớp `VISIT_BOOK_MAX_RANGE_DAYS`). */
export const REPORT_MAX_RANGE_DAYS = 366;

const pad = (n: number): string => String(n).padStart(2, '0');
const format = (y: number, m: number, d: number): string => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

function parts(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Ngày không hợp lệ: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Cộng/trừ ngày (âm = lùi). */
export function shiftDate(date: string, days: number): string {
  const { y, m, d } = parts(date);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return format(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Số ngày từ `from` đến `to` tính cả hai đầu; âm nếu `from` sau `to`. */
export function daysInclusive(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
}

/** Khoảng ngày của kỳ `kind` tính đến `today`. `custom` lấy khoảng người dùng nhập (mặc định hôm nay). */
export function resolvePeriod(kind: PeriodKind, today: string, custom?: PeriodRange): PeriodRange {
  const { y, m } = parts(today);
  switch (kind) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: shiftDate(today, -6), to: today };
    case 'thisMonth':
      return { from: format(y, m, 1), to: today };
    case 'lastMonth': {
      const first = new Date(Date.UTC(y, m - 2, 1));
      const last = new Date(Date.UTC(y, m - 1, 0));
      return { from: format(first.getUTCFullYear(), first.getUTCMonth() + 1, 1), to: format(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate()) };
    }
    case 'quarter':
      return { from: format(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today };
    case 'year':
      return { from: format(y, 1, 1), to: today };
    case 'custom':
      return custom ?? { from: today, to: today };
  }
}

export function periodLabel(kind: PeriodKind, today: string): string {
  switch (kind) {
    case 'today':
      return 'Hôm nay';
    case 'last7':
      return '7 ngày';
    case 'thisMonth':
      return 'Tháng này';
    case 'lastMonth':
      return 'Tháng trước';
    case 'quarter':
      return 'Quý';
    case 'year':
      return `Năm ${parts(today).y}`;
    case 'custom':
      return 'Tuỳ chọn';
  }
}

/** Lỗi nhập khoảng ngày (tiếng Việt) hoặc `null` nếu hợp lệ — để báo ngay trên giao diện thay vì chờ máy chủ từ chối. */
export function periodError(range: PeriodRange): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) return 'Nhập đủ ngày bắt đầu và ngày kết thúc.';
  if (range.from > range.to) return 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.';
  if (daysInclusive(range.from, range.to) > REPORT_MAX_RANGE_DAYS) return `Chỉ xem được tối đa ${REPORT_MAX_RANGE_DAYS} ngày một lần.`;
  return null;
}

/** "01/10/2026 – 31/10/2026" cho dòng mô tả kỳ và bản in. */
export function formatPeriodRange(range: PeriodRange): string {
  const dmy = (d: string) => {
    const p = parts(d);
    return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
  };
  return `${dmy(range.from)} – ${dmy(range.to)}`;
}

/** "Tháng 10/2026" khi khoảng đúng là một tháng đầy đủ; còn lại "01/10/2026 – 15/10/2026" — chú thích trên đầu khung biểu đồ/bảng. */
export function periodCaption(range: PeriodRange): string {
  const f = parts(range.from);
  const t = parts(range.to);
  const lastDay = new Date(Date.UTC(f.y, f.m, 0)).getUTCDate();
  if (f.y === t.y && f.m === t.m && f.d === 1 && t.d === lastDay) return `Tháng ${pad(f.m)}/${f.y}`;
  return formatPeriodRange(range);
}
