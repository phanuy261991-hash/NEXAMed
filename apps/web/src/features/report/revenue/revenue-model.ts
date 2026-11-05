import type { RevenueGroupByCode, RevenueGroupCode } from '@nexamed/shared';

/**
 * Phần THUẦN của trang báo cáo "Doanh thu" (docs/DECISIONS.md #287): nhãn, định dạng, thang trục biểu đồ. Không gọi API, không biết gì về giao diện — để test được và dùng chung cho màn hình
 * và bản in. Web không import giá trị từ `@nexamed/shared`/`core` nên các nhãn khai báo cục bộ.
 */
export const REVENUE_GROUP_LABEL: Record<RevenueGroupCode, string> = {
  EXAM: 'Khám bệnh',
  PARACLINICAL: 'Cận lâm sàng',
  DRUG: 'Thuốc và vật tư',
  PACKAGE: 'Gói dịch vụ',
};

export const REVENUE_GROUP_ORDER: readonly RevenueGroupCode[] = ['EXAM', 'PARACLINICAL', 'DRUG', 'PACKAGE'];

export const REVENUE_GROUP_BY_ITEMS: ReadonlyArray<{ id: RevenueGroupByCode; label: string }> = [
  { id: 'day', label: 'Ngày' },
  { id: 'week', label: 'Tuần' },
  { id: 'month', label: 'Tháng' },
  { id: 'quarter', label: 'Quý' },
];

export const REVENUE_GROUP_BY_LABEL: Record<RevenueGroupByCode, string> = { day: 'Ngày', week: 'Tuần', month: 'Tháng', quarter: 'Quý' };

export const INVOICE_TYPE_LABEL: Record<string, string> = { SERVICE: 'Dịch vụ khám', DRUG: 'Thuốc', PARACLINICAL: 'Cận lâm sàng' };

/** "▲ 12,5%" / "▼ 10,0%" / "—" (khoảng đầu hoặc khoảng trước bằng 0). */
export function formatDeltaPercent(value: number | null): string {
  if (value === null) return '—';
  const text = Math.abs(value).toFixed(1).replace('.', ',');
  return value > 0 ? `▲ ${text}%` : value < 0 ? `▼ ${text}%` : `${text}%`;
}

/** Lớp màu chữ của mức thay đổi: xanh khi tăng, đỏ khi giảm, xám khi không có/không đổi. */
export function deltaToneClass(value: number | null): string {
  return value === null || value === 0 ? 'text-slate-600' : value > 0 ? 'text-emerald-700' : 'text-rose-700';
}

/** Chênh lệch số tiền có dấu: "+1.200" / "-500" / "0". */
export function formatSigned(value: number): string {
  const text = Math.abs(value).toLocaleString('vi-VN');
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

export interface ChartAxis {
  /** Giá trị trần của trục (đồng), luôn ≥ giá trị lớn nhất. */
  max: number;
  /** Vạch trục từ 0 đến `max`, đều nhau. */
  ticks: number[];
  /** Đơn vị hiển thị trên trục. */
  unit: number;
  unitLabel: 'Triệu đồng' | 'Nghìn đồng' | 'Đồng';
}

/** Trần trục "đẹp" (1, 2, 2,5, 5 × 10^n) và 4 vạch đều nhau; đơn vị triệu khi trần từ 1 triệu, nghìn khi từ 1 nghìn. */
export function niceAxis(maxValue: number, tickCount = 4): ChartAxis {
  const unit = maxValue >= 1_000_000 ? 1_000_000 : maxValue >= 1_000 ? 1_000 : 1;
  const unitLabel = unit === 1_000_000 ? 'Triệu đồng' : unit === 1_000 ? 'Nghìn đồng' : 'Đồng';
  const safe = Math.max(maxValue, 1);
  const rough = safe / tickCount;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const max = step * tickCount;
  return { max, ticks: Array.from({ length: tickCount + 1 }, (_, i) => step * i), unit, unitLabel };
}

/** Số trên trục theo đơn vị: 1.500.000 với đơn vị triệu → "1,5". */
export function formatAxisTick(value: number, unit: number): string {
  const scaled = value / unit;
  return Number.isInteger(scaled) ? scaled.toLocaleString('vi-VN') : scaled.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/** Chữ "Chênh lệch" Ghi nhận − Thực thu cho dòng phụ KPI. */
export function recognizedMinusNet(recognized: number, net: number): number {
  return recognized - net;
}

/** "5 ngày" / "Hôm nay" cho cột tuổi phiếu. */
export function formatAgeDays(days: number): string {
  return days <= 0 ? 'Hôm nay' : `${days} ngày`;
}

/** Màu chữ của tuổi phiếu: càng cũ càng đậm (quá 30 ngày đỏ, quá 7 ngày hổ phách). */
export function ageToneClass(days: number): string {
  return days > 30 ? 'font-semibold text-rose-700' : days > 7 ? 'text-amber-700' : 'text-slate-700';
}
