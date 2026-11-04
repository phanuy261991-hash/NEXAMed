import type { DashboardKpi, DashboardPeriodKind, OwnerDashboard } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';
import { formatClockTime } from '../../shared/format/time';

/** Logic hiển thị THUẦN của Trang Tổng quan chủ phòng khám — tách khỏi React để test được. Máy chủ đã tính mọi số; ở đây chỉ chọn chữ, màu và đoạn dữ liệu hiển thị. */

export const DASHBOARD_PERIOD_ITEMS: ReadonlyArray<{ id: DashboardPeriodKind; label: string }> = [
  { id: 'today', label: 'Hôm nay' },
  { id: 'week', label: '7 ngày' },
  { id: 'month', label: 'Tháng này' },
];

export function periodTitle(kind: DashboardPeriodKind): string {
  return kind === 'today' ? 'Tổng quan hôm nay' : kind === 'week' ? 'Tổng quan 7 ngày gần nhất' : 'Tổng quan tháng này';
}

/** Tên kỳ dùng trong tiêu đề từng khối ("Dịch vụ dùng nhiều hôm nay"). */
export function periodNoun(kind: DashboardPeriodKind): string {
  return kind === 'today' ? 'hôm nay' : kind === 'week' ? '7 ngày qua' : 'tháng này';
}

export function compareLabel(kind: DashboardPeriodKind): string {
  return kind === 'today' ? 'hôm qua' : kind === 'week' ? '7 ngày trước' : 'cùng kỳ tháng trước';
}

export interface DeltaText {
  direction: 'up' | 'down' | 'flat';
  text: string;
  tone: 'good' | 'bad' | 'neutral';
}

/**
 * Dòng so sánh với kỳ trước. `unit='count'`: nêu hiệu số ("tăng 6 so với hôm qua"); `unit='money'`: nêu phần trăm nếu có ("tăng 12% so với hôm qua"), kỳ trước bằng 0 thì nêu số tiền.
 * Tăng là tốt, giảm là xấu (lượt khám, thực thu); kỳ trước và kỳ này đều 0 thì "bằng …" trung tính.
 */
export function describeDelta(kpi: Pick<DashboardKpi, 'diff' | 'diffPercent' | 'direction'>, kind: DashboardPeriodKind, unit: 'count' | 'money'): DeltaText {
  const cmp = compareLabel(kind);
  if (kpi.direction === 'flat') return { direction: 'flat', text: `bằng ${cmp}`, tone: 'neutral' };
  const verb = kpi.direction === 'up' ? 'tăng' : 'giảm';
  const size = Math.abs(kpi.diff);
  const amount =
    unit === 'count'
      ? size.toLocaleString('vi-VN')
      : kpi.diffPercent !== null
        ? `${Math.abs(kpi.diffPercent).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
        : formatVnd(size);
  return { direction: kpi.direction, text: `${verb} ${amount} so với ${cmp}`, tone: kpi.direction === 'up' ? 'good' : 'bad' };
}

/** Giờ hiển thị trên biểu đồ theo giờ: mặc định 07–18; mở rộng nếu có lượt ngoài khoảng đó, không bao giờ ít hơn 6 giờ liên tiếp. */
export function visibleHours(hourly: ReadonlyArray<{ hour: number; count: number }>): Array<{ hour: number; count: number }> {
  const active = hourly.filter((h) => h.count > 0).map((h) => h.hour);
  let from = Math.min(7, ...active);
  let to = Math.max(18, ...active);
  if (to - from < 5) to = Math.min(23, from + 5);
  from = Math.max(0, from);
  return hourly.filter((h) => h.hour >= from && h.hour <= to);
}

export function formatHourRange(hour: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hour)}:00 – ${pad((hour + 1) % 24)}:00`;
}

/** "28 phút", "1 giờ 5 phút", "2 giờ". */
export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}

export const GROUP_LABEL: Record<OwnerDashboard['collectedByGroup'][number]['group'], string> = {
  EXAM: 'Khám bệnh',
  PARACLINICAL: 'Cận lâm sàng',
  DRUG: 'Thuốc và vật tư',
  PACKAGE: 'Gói dịch vụ',
};

export interface AttentionItem {
  key: string;
  tone: 'amber' | 'rose';
  /** Biểu tượng: tiền, đồng hồ, thùng rác (hết hạn), kho. */
  kind: 'unpaid' | 'shift' | 'expiry' | 'stock';
  text: string;
  trailing: string;
  href: string;
}

/** Danh sách "Cần xử lý": chỉ những việc CÓ (số > 0); thứ tự theo mức gấp như mockup — phiếu chưa thu, ca chưa chốt, lô sắp hết hạn, mặt hàng dưới ngưỡng. */
export function buildAttentionItems(attention: OwnerDashboard['needsAttention']): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (attention.unpaidInvoices.count > 0) {
    items.push({ key: 'unpaid', tone: 'amber', kind: 'unpaid', text: `${attention.unpaidInvoices.count} phiếu thu chưa thanh toán`, trailing: formatVnd(attention.unpaidInvoices.amount), href: '/billing' });
  }
  for (const shift of attention.openShifts) {
    items.push({ key: `shift-${shift.openedAt}`, tone: 'amber', kind: 'shift', text: `${shift.label} chưa chốt`, trailing: `từ ${formatClockTime(shift.openedAt)}`, href: '/billing/cashier-shifts' });
  }
  if (attention.expiringBatches.count > 0) {
    items.push({ key: 'expiry', tone: 'rose', kind: 'expiry', text: `${attention.expiringBatches.count} lô thuốc sắp hết hạn`, trailing: `trong ${attention.expiringBatches.withinDays} ngày`, href: '/inventory/balances' });
  }
  if (attention.belowMinStockItems.count > 0) {
    items.push({ key: 'stock', tone: 'amber', kind: 'stock', text: `${attention.belowMinStockItems.count} mặt hàng tồn dưới ngưỡng`, trailing: 'cần đặt', href: '/inventory/balances' });
  }
  return items;
}

const WEEKDAY = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** "Thứ Hai, 02/11/2026" từ `YYYY-MM-DD` (lịch Việt Nam). */
export function formatWeekdayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY[weekday]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** "27/10" từ `YYYY-MM-DD`. */
export function formatDayMonth(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

/** Số trung bình mỗi ngày (làm tròn triệu 1 chữ số): "16,2". */
export function averageMillions(amounts: readonly number[]): string {
  if (amounts.length === 0) return '0';
  const avg = amounts.reduce((s, x) => s + x, 0) / amounts.length;
  return (Math.round(avg / 100_000) / 10).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
}
