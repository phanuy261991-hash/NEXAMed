import { DomainError } from './domain-error';

/** "Công nợ nhà cung cấp" — Khai nợ đầu kỳ chỉ được 1 lần, chỉ khi NCC CHƯA có bút toán nào (Q7,
 * docs/DECISIONS.md #180/#182). */
export class SupplierDebtOpeningBalanceAlreadyExistsError extends DomainError {
  readonly code = 'SUPPLIER_DEBT_OPENING_BALANCE_ALREADY_EXISTS';

  constructor() {
    super('Nhà cung cấp này đã có bút toán công nợ — không khai nợ đầu kỳ được nữa.');
  }
}

/** Phần D — "Phiếu điều chỉnh công nợ"/"Đề nghị huỷ" đã Duyệt/Từ chối rồi, không Duyệt/Từ chối lại
 * được (đúng nguyên tắc "không có nút Sửa trên chứng từ đã duyệt", mục 4.2 điểm 1). */
export class SupplierDebtAdjustmentNotPendingError extends DomainError {
  readonly code = 'SUPPLIER_DEBT_ADJUSTMENT_NOT_PENDING';

  constructor() {
    super('Phiếu này đã được xử lý (Duyệt/Từ chối) trước đó — không thể xử lý lại.');
  }
}

/** Phần D, mục 4.2 điểm 6 — kiểm tra toàn vẹn số dư trước khi Thanh toán/Thu tiền NCC hoàn lại:
 * `SUM(amountChange)` lệch với `balance` snapshot (lỗi hệ thống, không do người dùng). */
export class SupplierDebtIntegrityMismatchError extends DomainError {
  readonly code = 'SUPPLIER_DEBT_INTEGRITY_MISMATCH';

  constructor() {
    super('Số dư công nợ không khớp sổ — liên hệ quản trị hệ thống trước khi tiếp tục.');
  }
}

/** Phần E — ngày đối chiếu (`asOfDate`) không được sớm hơn/bằng biên bản `FINALIZED` gần nhất của
 * cùng NCC (mốc chốt chỉ tăng dần, không lùi — đúng khuôn "Khoá bảng ca" #110). */
export class SupplierDebtReconciliationAsOfDateTooEarlyError extends DomainError {
  readonly code = 'SUPPLIER_DEBT_RECONCILIATION_AS_OF_DATE_TOO_EARLY';

  constructor() {
    super('Ngày đối chiếu phải sau ngày của biên bản đã chốt gần nhất của nhà cung cấp này.');
  }
}

/** Phần E — gọi "Chốt" khi biên bản không còn ở trạng thái Nháp, hoặc phiếu điều chỉnh tự sinh do
 * chênh lệch vẫn còn Chờ duyệt (phải xử lý xong phiếu đó trước). */
export class SupplierDebtReconciliationNotReadyError extends DomainError {
  readonly code = 'SUPPLIER_DEBT_RECONCILIATION_NOT_READY';

  constructor() {
    super('Biên bản này chưa thể Chốt — phiếu điều chỉnh chênh lệch chưa được xử lý xong, hoặc biên bản đã Chốt/Huỷ trước đó.');
  }
}

/** Phần E — chứng từ thuộc kỳ công nợ đã CHỐT (`occurredAt` ≤ `lockedAsOfDate` của NCC), actor thiếu
 * quyền `supplier_debt.unlock` để Huỷ/Điều chỉnh. */
export class SupplierDebtPeriodLockedError extends DomainError {
  readonly code = 'SUPPLIER_DEBT_PERIOD_LOCKED';

  constructor() {
    super('Chứng từ này thuộc kỳ công nợ đã chốt với nhà cung cấp — liên hệ người có quyền mở khoá kỳ công nợ.');
  }
}
