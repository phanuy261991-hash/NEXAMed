import type { ClinicalOrderListGroup, ClinicalOrderListProgress, ClinicalOrderListRow, ClinicalOrderRowPayment, ParaclinicalLookupStatus, ParaclinicalLookupSummary } from '@nexamed/shared';
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge';

/**
 * Nhãn + màu badge của hai menu "Phiếu chỉ định" và "Tra cứu kết quả" (docs/DECISIONS.md #232). Hàm thuần, tách khỏi component để test được; màu theo token "Tín hiệu Y tế"
 * (`StatusBadge`): xanh lá = xong/đã thu, hổ phách = chờ/chưa thu, xanh dương = đang làm, tím = ra ngoài/hoàn/đính chính, xám = huỷ/không thu.
 */

export const ORDER_GROUP_TABS: readonly { id: ClinicalOrderListGroup; label: string }[] = [
  { id: 'LAB', label: 'Xét nghiệm' },
  { id: 'IMAGING', label: 'CĐHA & Thăm dò chức năng' },
  { id: 'EXTERNAL', label: 'Chỉ định ra ngoài' },
];

export const ORDER_PROGRESS_FILTERS: readonly { id: ClinicalOrderListProgress | ''; label: string }[] = [
  { id: '', label: 'Tất cả' },
  { id: 'WAITING', label: 'Chờ thực hiện' },
  { id: 'IN_PROGRESS', label: 'Đang thực hiện' },
  { id: 'DONE', label: 'Đã có kết quả' },
  { id: 'CANCELLED', label: 'Đã huỷ' },
];

export interface BadgeSpec {
  tone: StatusBadgeTone;
  label: string;
}

export function orderProgressBadge(progress: ClinicalOrderListRow['progress']): BadgeSpec {
  const fraction = `${progress.done}/${progress.total}`;
  switch (progress.state) {
    case 'WAITING':
      return { tone: 'warning', label: `Chờ thực hiện ${fraction}` };
    case 'IN_PROGRESS':
      return { tone: 'info', label: `Đang thực hiện ${fraction}` };
    case 'DONE':
      return { tone: 'success', label: `Đã có kết quả ${fraction}` };
    case 'CANCELLED':
      return { tone: 'neutral', label: 'Đã huỷ' };
    case 'EXTERNAL':
      return { tone: 'accent', label: 'Chỉ định ra ngoài' };
  }
}

export const ORDER_PAYMENT_BADGE: Record<ClinicalOrderRowPayment, BadgeSpec> = {
  PAID: { tone: 'success', label: 'Đã thu' },
  UNPAID: { tone: 'warning', label: 'Chưa thu' },
  REFUNDED: { tone: 'accent', label: 'Đã hoàn' },
  NOT_CHARGED: { tone: 'neutral', label: 'Không thu' },
};

/** Dòng phụ dưới tên dịch vụ: "4 dịch vụ xét nghiệm", "1 dịch vụ CĐHA & thăm dò", "1 dịch vụ ra ngoài". */
export function orderGroupCountLabel(group: ClinicalOrderListGroup, count: number): string {
  const kind = group === 'LAB' ? 'xét nghiệm' : group === 'IMAGING' ? 'CĐHA & thăm dò' : 'ra ngoài';
  return `${count} dịch vụ ${kind}`;
}

export const LOOKUP_STATUS_OPTIONS: readonly { value: ParaclinicalLookupStatus | ''; label: string }[] = [
  { value: '', label: 'Mọi trạng thái' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'AMENDED', label: 'Đã đính chính' },
];

export function lookupStatusBadge(status: ParaclinicalLookupStatus): BadgeSpec {
  return status === 'AMENDED' ? { tone: 'accent', label: 'Đã đính chính' } : { tone: 'success', label: 'Đã duyệt' };
}

export function lookupSummaryBadge(summary: ParaclinicalLookupSummary, abnormalCount: number): BadgeSpec | null {
  switch (summary) {
    case 'ABNORMAL':
      return { tone: 'warning', label: `${abnormalCount} chỉ số bất thường` };
    case 'NORMAL':
      return { tone: 'success', label: 'Bình thường' };
    case 'HAS_CONCLUSION':
      return { tone: 'info', label: 'Có kết luận' };
    case 'NONE':
      return null;
  }
}
