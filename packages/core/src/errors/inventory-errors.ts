import { DomainError } from './domain-error';

/** Sửa/Duyệt/Từ chối một phiếu nhập kho không (còn) ở trạng thái Nháp. */
export class StockReceiptNotDraftError extends DomainError {
  readonly code = 'STOCK_RECEIPT_NOT_DRAFT';

  constructor() {
    super('Phiếu nhập kho này không còn ở trạng thái Nháp.');
  }
}

/** Huỷ phiếu — phiếu không (còn) ở trạng thái Đã duyệt, hoặc tồn kho của (ít nhất) 1 dòng đã bị
 * dùng bớt nên không đủ để trừ ngược lại. */
export class StockReceiptVoidNotAllowedError extends DomainError {
  readonly code = 'STOCK_RECEIPT_VOID_NOT_ALLOWED';

  constructor(message = 'Không thể huỷ phiếu này — tồn kho của một hoặc nhiều mặt hàng trong phiếu đã bị dùng bớt.') {
    super(message);
  }
}
