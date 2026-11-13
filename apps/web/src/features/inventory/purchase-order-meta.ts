import type { PurchaseOrderStatus } from '@nexamed/shared';
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge';

/** Nhãn + màu trạng thái "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2). Nền đặc theo `StatusBadge`. */
export const ORDER_STATUS_META: Record<PurchaseOrderStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'warning' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  ORDERED: { label: 'Đã đặt NCC', tone: 'info' },
  PARTIALLY_RECEIVED: { label: 'Nhận một phần', tone: 'info' },
  RECEIVED: { label: 'Đã nhận đủ', tone: 'success' },
  CLOSED: { label: 'Đã đóng (nhận thiếu)', tone: 'neutral' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

/** Đơn đang Chờ duyệt mà người duyệt là chi nhánh chính (mockup màn 7) hiện nhãn riêng để chi nhánh lập đơn biết đang chờ ai. */
export function orderStatusMeta(status: PurchaseOrderStatus, requiresMainApproval: boolean): { label: string; tone: StatusBadgeTone } {
  if (status === 'PENDING_APPROVAL' && requiresMainApproval) return { label: 'Chờ chi nhánh chính duyệt', tone: 'warning' };
  return ORDER_STATUS_META[status];
}

/** Thứ tự các ô đếm ở đầu danh sách. */
export const ORDER_STATUS_ORDER: PurchaseOrderStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CLOSED', 'CANCELLED'];

/** Các bước ở đầu đơn: Đã duyệt → Đã đặt NCC → Nhận một phần → Đã nhận đủ. */
export const ORDER_STEPS: { key: 'APPROVED' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED'; label: string }[] = [
  { key: 'APPROVED', label: 'Đã duyệt' },
  { key: 'ORDERED', label: 'Đã đặt NCC' },
  { key: 'PARTIALLY_RECEIVED', label: 'Nhận một phần' },
  { key: 'RECEIVED', label: 'Đã nhận đủ' },
];

const STEP_RANK: Record<PurchaseOrderStatus, number> = {
  DRAFT: -1,
  PENDING_APPROVAL: -1,
  REJECTED: -1,
  APPROVED: 0,
  ORDERED: 1,
  PARTIALLY_RECEIVED: 2,
  RECEIVED: 3,
  CLOSED: 2,
  CANCELLED: -1,
};

/** `done` = bước đã qua, `current` = đang ở bước này, `todo` = chưa tới. Đơn chưa duyệt/từ chối/huỷ không có bước nào hoàn thành. */
export function orderStepState(status: PurchaseOrderStatus, step: (typeof ORDER_STEPS)[number]['key']): 'done' | 'current' | 'todo' {
  const current = STEP_RANK[status];
  const rank = STEP_RANK[step];
  if (current < 0) return 'todo';
  if (status === 'RECEIVED') return 'done';
  if (rank < current) return 'done';
  return rank === current ? 'current' : 'todo';
}

/** Đơn còn nhận hàng được (nút "Nhận hàng"). */
export function canReceiveOrder(status: PurchaseOrderStatus): boolean {
  return status === 'ORDERED' || status === 'PARTIALLY_RECEIVED';
}

/** Bản sao hiển thị của ma trận thao tác ở `packages/core` (web không import `@nexamed/core`, #073); máy chủ luôn kiểm lại thật. */
export function orderActionsFor(status: PurchaseOrderStatus) {
  return {
    edit: status === 'DRAFT' || status === 'REJECTED',
    submit: status === 'DRAFT',
    approve: status === 'DRAFT' || status === 'PENDING_APPROVAL',
    reject: status === 'PENDING_APPROVAL',
    order: status === 'APPROVED',
    receive: canReceiveOrder(status),
    close: canReceiveOrder(status),
    cancel: ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'ORDERED'].includes(status),
  };
}

/** Số tiền đồng có dấu chấm nghìn. */
export function formatMoneyVn(value: number): string {
  return value.toLocaleString('vi-VN');
}
