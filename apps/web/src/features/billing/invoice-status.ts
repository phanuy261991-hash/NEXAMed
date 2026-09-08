import type { BillingListItem } from '@nexamed/shared';
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge';

/**
 * Nhãn/tone cho 4 trạng thái phiếu thu (`InvoiceStatus`) — trích xuất từ `InvoiceListPage.tsx`
 * (#085) lúc có nơi dùng thứ hai ("Trung tâm Điều phối Tiếp nhận", `ReceptionListPage.tsx`), đúng
 * quy tắc CLAUDE.md "trùng lặp lần 2 mới trích xuất". Nền đặc, đúng token `ui-guidelines.md` #105.
 */
export const INVOICE_STATUS_META: Record<BillingListItem['status'], { label: string; tone: StatusBadgeTone }> = {
  UNPAID: { label: 'Chờ thu', tone: 'warning' },
  PAID: { label: 'Đã thu', tone: 'success' },
  CANCELLED: { label: 'Đã huỷ (chưa thu)', tone: 'neutral' },
  REFUNDED: { label: 'Đã hoàn tiền', tone: 'accent' },
};
