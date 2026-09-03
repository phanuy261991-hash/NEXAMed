import { DomainError } from './domain-error';

/** "Mở ca" khi tenant đã có 1 ca `OPEN` khác — v1 chỉ 1 két dùng chung, chưa hỗ trợ mở song song. */
export class CashierShiftAlreadyOpenError extends DomainError {
  readonly code = 'CASHIER_SHIFT_ALREADY_OPEN';

  constructor() {
    super('Đang có một ca khác chưa chốt — chốt ca đó trước khi mở ca mới.');
  }
}

/** "Chốt ca"/thao tác cần ca `OPEN` nhưng không tìm thấy ca nào đang mở (đã chốt trước đó, race). */
export class CashierShiftNotOpenError extends DomainError {
  readonly code = 'CASHIER_SHIFT_NOT_OPEN';

  constructor() {
    super('Không có ca nào đang mở.');
  }
}

/** Xử lý chênh lệch / Duyệt phiếu / Sửa (mở khoá) — chỉ áp dụng cho ca đã chốt (CLOSED/APPROVED). */
export class CashierShiftNotClosedError extends DomainError {
  readonly code = 'CASHIER_SHIFT_NOT_CLOSED';

  constructor() {
    super('Ca này chưa được chốt — không thao tác được.');
  }
}

/** Số tiền đếm được (mở ca hoặc chốt ca) lệch so với dự kiến mà không kèm lý do giải trình. */
export class CashierShiftDiscrepancyReasonRequiredError extends DomainError {
  readonly code = 'CASHIER_SHIFT_DISCREPANCY_REASON_REQUIRED';

  constructor() {
    super('Có chênh lệch — phải nhập lý do trước khi tiếp tục.');
  }
}
