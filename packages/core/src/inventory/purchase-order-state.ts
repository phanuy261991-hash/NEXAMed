// Đơn đặt hàng NCC (docs/DECISIONS.md #298 giai đoạn 2) — hàm thuần về vòng đời trạng thái, quyền duyệt theo chi nhánh và số còn thiếu. Không phụ thuộc framework.

export type PurchaseOrderStatusValue = 'DRAFT' | 'PENDING_APPROVAL' | 'REJECTED' | 'APPROVED' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';

export type PurchaseOrderAction = 'update' | 'submit' | 'approve' | 'reject' | 'order' | 'cancel' | 'close' | 'receive';

/** Trạng thái đã gửi nhà cung cấp (hàng đang/đã về) — dòng yêu cầu cấp hàng chờ đơn này phải "Yêu cầu rút" thay vì rút thẳng. */
const PLACED_STATUSES: readonly PurchaseOrderStatusValue[] = ['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED'];

export function isPurchaseOrderPlaced(status: PurchaseOrderStatusValue): boolean {
  return PLACED_STATUSES.includes(status);
}

/**
 * Ma trận thao tác theo trạng thái:
 * - `update`: Nháp hoặc đã bị Từ chối (sửa rồi gửi lại).
 * - `submit`: Nháp → Chờ duyệt (đơn bị Từ chối phải sửa trước — sửa xong quay về Nháp). `approve`: Nháp (tự duyệt, đơn không cần chi nhánh chính) hoặc Chờ duyệt → Đã duyệt. `reject`: Chờ duyệt → Từ chối.
 * - `order`: Đã duyệt → Đã đặt NCC. `receive`: lập Phiếu nhập kho liên kết khi Đã đặt NCC/Nhận một phần.
 * - `close`: Đã đặt/Nhận một phần → Đã đóng (nhận thiếu). `cancel`: trước khi đặt NCC, hoặc đã đặt NCC nhưng chưa nhận gì (kiểm số đã nhận ở service).
 */
export function canPerformPurchaseOrderAction(status: PurchaseOrderStatusValue, action: PurchaseOrderAction): boolean {
  switch (action) {
    case 'update':
      return status === 'DRAFT' || status === 'REJECTED';
    case 'submit':
      return status === 'DRAFT';
    case 'approve':
      return status === 'DRAFT' || status === 'PENDING_APPROVAL';
    case 'reject':
      return status === 'PENDING_APPROVAL';
    case 'order':
      return status === 'APPROVED';
    case 'receive':
      return status === 'ORDERED' || status === 'PARTIALLY_RECEIVED';
    case 'close':
      return status === 'ORDERED' || status === 'PARTIALLY_RECEIVED';
    case 'cancel':
      return status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'APPROVED' || status === 'ORDERED' || status === 'REJECTED';
  }
}

/** Đơn của chi nhánh PHỤ chỉ cần chi nhánh chính duyệt khi công tắc bật; chi nhánh chính (hoặc công ty một chi nhánh) tự duyệt. */
export function requiresMainBranchApproval(input: { needsMainApprovalSetting: boolean; orderBranchIsMain: boolean }): boolean {
  return input.needsMainApprovalSetting && !input.orderBranchIsMain;
}

/**
 * Người xem đứng đúng phía duyệt không: đơn cần chi nhánh chính duyệt → phải thuộc chi nhánh chính; ngược lại → thuộc chính chi nhánh của đơn.
 * Quyền `purchase_order.approve` kiểm riêng ở controller.
 */
export function isPurchaseOrderApproverBranch(input: { requiresMainApproval: boolean; viewerBranchId: string; viewerBranchIsMain: boolean; orderBranchId: string }): boolean {
  return input.requiresMainApproval ? input.viewerBranchIsMain : input.viewerBranchId === input.orderBranchId;
}

/** Số còn thiếu của một dòng đơn (không âm). */
export function purchaseOrderRemainingQty(orderedQty: number, receivedQty: number): number {
  return Math.max(0, orderedQty - receivedQty);
}

/**
 * Trạng thái đơn sau khi số đã nhận (phiếu nhập ĐÃ DUYỆT) đổi. Chỉ đơn đã đặt NCC mới đổi; Nháp/Chờ duyệt/Đã duyệt/Từ chối/Đã đóng/Đã huỷ giữ nguyên.
 * Đủ mọi dòng → Đã nhận đủ; có nhận nhưng chưa đủ → Nhận một phần; chưa nhận gì (kể cả sau khi huỷ phiếu nhập đã duyệt) → Đã đặt NCC.
 */
export function derivePurchaseOrderStatusFromReceipts(current: PurchaseOrderStatusValue, lines: readonly { orderedQty: number; receivedQty: number }[]): PurchaseOrderStatusValue {
  if (!isPurchaseOrderPlaced(current)) return current;
  if (lines.length === 0) return current;
  const allReceived = lines.every((l) => l.receivedQty >= l.orderedQty);
  if (allReceived) return 'RECEIVED';
  if (lines.some((l) => l.receivedQty > 0)) return 'PARTIALLY_RECEIVED';
  return 'ORDERED';
}

/** Tổng dự kiến = Σ số đặt × đơn giá dự kiến, bỏ qua dòng chưa nhập đơn giá. Không làm tròn trung gian (mọi số đều nguyên đồng). */
export function computePurchaseOrderTotal(lines: readonly { quantity: number; expectedUnitCost: number | null }[]): number {
  return lines.reduce((sum, l) => (l.expectedUnitCost == null ? sum : sum + l.quantity * l.expectedUnitCost), 0);
}

export interface ReceiptLineCheckInput {
  orderedQty: number;
  /** Đã nhận trên các phiếu nhập ĐÃ DUYỆT. */
  receivedQty: number;
  /** Số lượng của dòng đang lập/duyệt (trong cùng đơn vị với dòng đơn). */
  receiveQty: number;
}

/** Nhận vượt số còn thiếu bị chặn trừ khi công tắc "Cho phép nhận vượt số đặt" bật. Trả `true` nếu hợp lệ. */
export function isReceiptQtyWithinOrder(input: ReceiptLineCheckInput, allowOverReceipt: boolean): boolean {
  if (allowOverReceipt) return true;
  return input.receiveQty <= purchaseOrderRemainingQty(input.orderedQty, input.receivedQty);
}
