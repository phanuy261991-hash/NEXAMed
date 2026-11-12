import type { SystemAlertDto, SystemKpi, SystemRankingReport } from '@nexamed/shared';
import type { ReportKpiSubTone } from '../../../shared/ui/ReportKpiStrip';
import type { PeriodKind, PeriodRange } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';

/**
 * Phần THUẦN của trang báo cáo "Toàn hệ thống" (docs/DECISIONS.md #287): thứ tự tab, nhãn, định dạng so sánh kỳ trước, kiểu nét biểu đồ, liên kết của "Cần chú ý", danh sách tháng. Không gọi API,
 * không biết gì về giao diện — để test được và dùng chung cho màn hình, bản in. Web không import giá trị từ `@nexamed/shared`/`core` nên các nhãn khai báo cục bộ (kiểu thì import được).
 */
export const SYSTEM_TABS = [
  { id: 'overview', label: 'So sánh chi nhánh' },
  { id: 'ranking', label: 'Xếp hạng' },
  { id: 'monthly', label: 'Tổng hợp tháng' },
  { id: 'cross', label: 'Khám chéo chi nhánh' },
] as const;

export type SystemTabId = (typeof SYSTEM_TABS)[number]['id'];

export const SYSTEM_DEFAULT_TAB: SystemTabId = 'overview';

export function parseSystemTab(raw: string | null): SystemTabId {
  return SYSTEM_TABS.find((t) => t.id === raw)?.id ?? SYSTEM_DEFAULT_TAB;
}

/** Kỳ của các tab theo khoảng ngày (đúng mockup): Hôm nay, 7 ngày, Tháng này, Tháng trước, Quý, Năm, Tuỳ chọn. */
export const SYSTEM_PERIOD_KINDS: readonly PeriodKind[] = ['today', 'last7', 'thisMonth', 'lastMonth', 'quarter', 'year', 'custom'];

export type SystemGroup = 'EXAM' | 'PARACLINICAL' | 'DRUG' | 'PACKAGE';

export const SYSTEM_GROUP_LABEL: Record<SystemGroup, string> = { EXAM: 'Khám bệnh', PARACLINICAL: 'Cận lâm sàng', DRUG: 'Thuốc và vật tư', PACKAGE: 'Gói dịch vụ' };

/** Màu thanh của cơ cấu theo nhóm (đúng mockup). */
export const SYSTEM_GROUP_COLOR: Record<SystemGroup, string> = { EXAM: '#1d4ed8', PARACLINICAL: '#0f766e', DRUG: '#b45309', PACKAGE: '#6d28d9' };

/** Kiểu nét của từng chuỗi chi nhánh: màu VÀ nét khác nhau (liền, gạch, chấm...) để phân biệt được cả khi không thấy màu. */
export const BRANCH_LINE_STYLES: ReadonlyArray<{ color: string; dash: string | undefined }> = [
  { color: '#1d4ed8', dash: undefined },
  { color: '#0f766e', dash: '8 4' },
  { color: '#b45309', dash: '2 3' },
  { color: '#6d28d9', dash: '10 3 2 3' },
  { color: '#be123c', dash: '4 4' },
  { color: '#475569', dash: '1 4' },
];

export function branchLineStyle(index: number): { color: string; dash: string | undefined } {
  return BRANCH_LINE_STYLES[index % BRANCH_LINE_STYLES.length]!;
}

// ---- So với kỳ trước ----

/** "8,4%" kèm dấu: "+8,4%", "-2,1%", "0%"; `null` (kỳ trước bằng 0) → "—". */
export function formatSignedPercent(percent: number | null): string {
  if (percent === null) return '—';
  const text = String(Math.abs(percent)).replace('.', ',');
  return percent > 0 ? `+${text}%` : percent < 0 ? `-${text}%` : '0%';
}

/** Dòng phụ của ô số: "▲ 8,4% so với kỳ trước"; kỳ trước bằng 0 → "Kỳ trước chưa có số liệu"; không đổi → "Không đổi so với kỳ trước". Tăng = tốt (xanh lục), giảm = đỏ. */
export function describeKpiChange(kpi: SystemKpi, previousLabel: string): { text: string; tone: ReportKpiSubTone | undefined } {
  if (kpi.percent === null) return { text: `${capitalize(previousLabel)} chưa có số liệu`, tone: undefined };
  if (kpi.direction === 'flat') return { text: `Không đổi so với ${previousLabel}`, tone: undefined };
  const arrow = kpi.direction === 'up' ? '▲' : '▼';
  return { text: `${arrow} ${String(Math.abs(kpi.percent)).replace('.', ',')}% so với ${previousLabel}`, tone: kpi.direction === 'up' ? 'good' : 'bad' };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** % thay đổi của `current` so với `previous` (một chữ số thập phân); `null` khi `previous` bằng 0. */
export function changePercent(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function changeToneClass(percent: number | null): string {
  return percent === null || percent === 0 ? 'text-slate-600' : percent > 0 ? 'text-emerald-700' : 'text-rose-700';
}

// ---- Cần chú ý ----

/** Trang để xem chi tiết từng loại cảnh báo (báo cáo hoặc màn hình của chính vấn đề đó). */
export function alertLink(kind: SystemAlertDto['kind']): string {
  switch (kind) {
    case 'OPEN_SHIFTS':
      return '/billing/cashier-shifts';
    case 'OVERDUE_UNPAID':
      return '/reports/revenue?tab=unpaid';
    case 'EXPIRING_BATCHES':
      return '/inventory/balances';
    case 'LONG_WAIT':
      return '/reports/operations?tab=waiting';
  }
}

// ---- Tháng ----

/** "Tháng 10/2026" từ "2026-10". */
export function monthLabel(month: string): string {
  return `Tháng ${month.slice(5)}/${month.slice(0, 4)}`;
}

/** "10/2026" từ "2026-10". */
export function monthShort(month: string): string {
  return `${month.slice(5)}/${month.slice(0, 4)}`;
}

/** Tháng liền trước của `today` (`YYYY-MM-DD`) dưới dạng `YYYY-MM`. */
export function previousMonthOf(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** Các tháng để chọn: từ tháng của `today` lùi `count` tháng, mới nhất trước. */
export function monthOptions(today: string, count = 24): Array<{ value: string; label: string }> {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const result: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const value = `${year}-${String(month).padStart(2, '0')}`;
    result.push({ value, label: monthLabel(value) });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return result;
}

/** Ngày đầu và ngày cuối của tháng `YYYY-MM`. */
export function monthRangeOf(month: string): PeriodRange {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Trạng thái "kỳ" giả cho tab theo tháng: khoảng ngày của tháng đã chọn, không có lỗi, không đổi được kiểu kỳ — để dùng lại khung `PeriodReportTab`. */
export function monthPeriodState(month: string, today: string): ReportPeriodState {
  const range = monthRangeOf(month);
  return { kind: 'custom', range, custom: range, error: null, today, setKind: () => undefined, setCustom: () => undefined };
}

// ---- Biểu đồ đường ----

/** Nhãn ngày trên trục ngang: "05/10" từ "2026-10-05". */
export function formatDayMonthLabel(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Vị trí các nhãn trên trục ngang: tối đa `maxLabels` nhãn, luôn có điểm đầu và điểm cuối. */
export function axisLabelIndexes(pointCount: number, maxLabels: number): number[] {
  if (pointCount <= 0) return [];
  if (pointCount <= maxLabels) return Array.from({ length: pointCount }, (_, i) => i);
  const step = (pointCount - 1) / (maxLabels - 1);
  const indexes = new Set<number>();
  for (let i = 0; i < maxLabels; i += 1) indexes.add(Math.round(i * step));
  return [...indexes].sort((a, b) => a - b);
}

// ---- Xếp hạng ----

export type RankingKind = 'services' | 'doctors' | 'drugs' | 'serviceMargins';

export const RANKING_KIND_ITEMS: ReadonlyArray<{ id: RankingKind; label: string }> = [
  { id: 'services', label: 'Dịch vụ' },
  { id: 'doctors', label: 'Bác sĩ' },
  { id: 'drugs', label: 'Thuốc và vật tư' },
  { id: 'serviceMargins', label: 'Lãi gộp dịch vụ' },
];

/** Nhãn cột của từng bảng xếp hạng: tên cột phụ, số lượng và số dùng để xếp. */
export const RANKING_COLUMNS: Record<RankingKind, { subtitle: string; quantity: string; total: string; empty: string }> = {
  services: { subtitle: 'Nhóm', quantity: 'Số lượng', total: 'Ghi nhận', empty: 'Chưa có dịch vụ nào được dùng trong kỳ' },
  doctors: { subtitle: 'Khoa', quantity: 'Lượt khám', total: 'Doanh thu sinh ra', empty: 'Chưa có bác sĩ nào khám trong kỳ' },
  drugs: { subtitle: 'Loại', quantity: 'Số lượng', total: 'Lãi gộp', empty: 'Chưa bán thuốc hay vật tư trong kỳ' },
  serviceMargins: { subtitle: 'Nhóm', quantity: 'Số lượt', total: 'Lãi gộp dịch vụ', empty: 'Chưa có lượt dịch vụ nào ghi tiêu hao trong kỳ' },
};

export function rankingRows(report: SystemRankingReport, kind: RankingKind): SystemRankingReport['services'] {
  return report[kind];
}
