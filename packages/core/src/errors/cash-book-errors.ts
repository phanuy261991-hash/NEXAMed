import { DomainError } from './domain-error';

/** Sửa/huỷ phiếu thu/chi khi đã bị KHOÁ — đã duyệt (POSTED qua approve), đang chờ duyệt bị người
 * khác duyệt/từ chối trước, hoặc ca thu ngân gắn với phiếu đã chốt. */
export class CashVoucherNotEditableError extends DomainError {
  readonly code = 'CASH_VOUCHER_NOT_EDITABLE';

  constructor() {
    super('Phiếu này không còn sửa/huỷ được — đã duyệt hoặc ca thu ngân liên quan đã chốt.');
  }
}

/** Duyệt/Từ chối gọi trên phiếu không (còn) ở trạng thái Chờ duyệt. */
export class CashVoucherNotPendingApprovalError extends DomainError {
  readonly code = 'CASH_VOUCHER_NOT_PENDING_APPROVAL';

  constructor() {
    super('Phiếu này không ở trạng thái chờ duyệt.');
  }
}
