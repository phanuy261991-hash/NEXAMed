import type { CashierDashboard, CashierShiftSummary } from '@nexamed/shared';
import { formatMillions } from '../../shared/ui/charts/chart-scale';
import type { BarStripItem } from '../../shared/ui/dashboard/BarStrip';
import { visibleHours } from './dashboard-model';

/** Logic hiển thị THUẦN của Trang Tổng quan thu ngân — tách khỏi React để test được. Máy chủ đã tính mọi số tiền; ở đây chỉ chọn chữ và đoạn dữ liệu hiển thị. */

/** "Chờ thu · 5 phiếu"; không có phiếu nào thì chỉ nhãn trơn. */
export function labelWithCount(label: string, invoiceCount: number): string {
  return invoiceCount > 0 ? `${label} · ${invoiceCount.toLocaleString('vi-VN')} phiếu` : label;
}

/** Đường dẫn mở đúng phiếu thu của lượt khám (phiếu thuốc/cận lâm sàng riêng cần `invoiceId`). */
export function pendingInvoiceHref(item: Pick<CashierDashboard['pending']['items'][number], 'encounterId' | 'invoiceId'>): string {
  return `/billing/${item.encounterId}?invoiceId=${item.invoiceId}`;
}

export interface CashBoxRow {
  key: 'opening' | 'examIn' | 'otherIn' | 'otherOut' | 'refund';
  label: string;
  amount: number;
  /** Chiều tiền: `none` = số đầu kỳ, `plus` = vào két, `minus` = ra khỏi két. */
  direction: 'none' | 'plus' | 'minus';
}

/**
 * Các dòng "Tiền mặt dự kiến trong két" từ tổng kết ca SỐNG (cùng nguồn với bước 1 của hộp Chốt ca). `cashIn/OutAmount` của máy chủ đã gộp cả phiếu thu/chi khác,
 * nên thu khám tiền mặt = tổng thu trừ phiếu thu khác, hoàn tiền mặt = tổng chi trừ phiếu chi khác. Vốn + các dòng cộng − các dòng trừ luôn bằng `expectedCashAmount`.
 */
export function buildCashBoxRows(openingFloat: number, summary: Pick<CashierShiftSummary, 'cashInAmount' | 'cashOutAmount' | 'otherCashInAmount' | 'otherCashOutAmount'>): CashBoxRow[] {
  return [
    { key: 'opening', label: 'Vốn đầu ca', amount: openingFloat, direction: 'none' },
    { key: 'examIn', label: 'Thu khám bằng tiền mặt', amount: summary.cashInAmount - summary.otherCashInAmount, direction: 'plus' },
    { key: 'otherIn', label: 'Phiếu thu khác', amount: summary.otherCashInAmount, direction: 'plus' },
    { key: 'otherOut', label: 'Phiếu chi khác', amount: summary.otherCashOutAmount, direction: 'minus' },
    { key: 'refund', label: 'Hoàn tiền mặt', amount: summary.cashOutAmount - summary.otherCashOutAmount, direction: 'minus' },
  ];
}

export interface HourlyChart {
  items: BarStripItem[];
  /** Chỉ số cột đông nhất trong `items`; `null` khi cả ngày chưa thu đồng nào. */
  peakIndex: number | null;
  peakHour: number | null;
  peakAmount: number;
  /** Tổng thực thu ròng trong ngày (đọc cho trình đọc màn hình). */
  total: number;
}

/**
 * Cột "Tiền thu theo giờ": giờ hiển thị mặc định 07–18 và mở rộng nếu có tiền ngoài khoảng đó (dùng lại `visibleHours`). Giờ thu ròng âm (hoàn nhiều hơn thu) vẽ cột 0 vì biểu đồ chỉ vẽ
 * chiều dương; tổng cả ngày vẫn là số thật. Hoà đỉnh thì lấy giờ sớm hơn.
 */
export function buildHourlyChart(hourly: ReadonlyArray<{ hour: number; amount: number }>): HourlyChart {
  const visible = visibleHours(hourly.map((h) => ({ hour: h.hour, count: h.amount })));
  const items: BarStripItem[] = visible.map((h) => {
    const amount = Math.max(0, h.count);
    return { label: String(h.hour).padStart(2, '0'), value: amount, valueLabel: formatMillions(amount) };
  });
  let peakIndex: number | null = null;
  items.forEach((item, i) => {
    if (item.value > 0 && (peakIndex === null || item.value > items[peakIndex]!.value)) peakIndex = i;
  });
  return {
    items,
    peakIndex,
    peakHour: peakIndex === null ? null : visible[peakIndex]!.hour,
    peakAmount: peakIndex === null ? 0 : items[peakIndex]!.value,
    total: hourly.reduce((s, h) => s + h.amount, 0),
  };
}
