import { DomainError } from './domain-error';

// ============ Đơn đặt hàng NCC (docs/DECISIONS.md #298 giai đoạn 2) ============

/** Thao tác không hợp lệ với trạng thái hiện tại của đơn (đã đặt NCC, đã nhận đủ...). 409 — không phải lỗi nhập liệu. */
export class PurchaseOrderInvalidStateError extends DomainError {
  readonly code = 'PURCHASE_ORDER_INVALID_STATE';

  constructor(message = 'Đơn đặt hàng không còn ở trạng thái cho phép thao tác này.') {
    super(message);
  }
}

/** Chi nhánh phụ không được đặt hàng/nhập mua hàng NCC riêng (công tắc "Cho phép chi nhánh đặt hàng NCC riêng" đang TẮT). 409. */
export class BranchPurchasingDisabledError extends DomainError {
  readonly code = 'BRANCH_PURCHASING_DISABLED';

  constructor() {
    super('Phòng khám không cho chi nhánh này đặt hàng nhà cung cấp riêng. Hãy gửi yêu cầu cấp hàng lên chi nhánh chính.');
  }
}

/** Người thao tác không đứng đúng phía duyệt (đơn cần chi nhánh chính duyệt, hoặc ngược lại). 403. */
export class PurchaseOrderApproverBranchError extends DomainError {
  readonly code = 'PURCHASE_ORDER_APPROVER_BRANCH';

  constructor(requiresMainApproval: boolean) {
    super(requiresMainApproval ? 'Đơn này cần chi nhánh chính duyệt.' : 'Đơn này phải do người của chi nhánh lập đơn duyệt.');
  }
}

/** Phiếu nhập theo đơn lệch với đơn (NCC, kho, mặt hàng, đơn vị) hoặc nhận vượt số còn thiếu. 422. */
export class PurchaseOrderReceiptMismatchError extends DomainError {
  readonly code = 'PURCHASE_ORDER_RECEIPT_MISMATCH';

  constructor(message: string) {
    super(message);
  }
}

/** Nhận vượt số còn thiếu theo đơn khi công tắc "Cho phép nhận vượt số đặt" TẮT. 422. */
export class PurchaseOrderOverReceiptError extends DomainError {
  readonly code = 'PURCHASE_ORDER_OVER_RECEIPT';

  constructor(drugName: string, remaining: number) {
    super(`Số nhận "${drugName}" vượt số còn thiếu theo đơn (còn ${remaining}).`);
  }
}
