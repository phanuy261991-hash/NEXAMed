import { DomainError } from './domain-error';

// ============ Yêu cầu cấp hàng theo cấp (docs/DECISIONS.md #298) ============

/** Công tắc "Dùng yêu cầu cấp hàng" đang TẮT — mọi API của chức năng bị từ chối. 409. */
export class StockRequestDisabledError extends DomainError {
  readonly code = 'STOCK_REQUEST_DISABLED';

  constructor() {
    super('Phòng khám đã tắt tính năng "Yêu cầu cấp hàng" ở Cấu hình phòng khám.');
  }
}

/** Thao tác không hợp lệ với trạng thái hiện tại của phiếu (đã tiếp nhận, đã hoàn thành...). 409 — không phải lỗi nhập liệu. */
export class StockRequestInvalidStateError extends DomainError {
  readonly code = 'STOCK_REQUEST_INVALID_STATE';

  constructor(message = 'Phiếu yêu cầu cấp hàng không còn ở trạng thái cho phép thao tác này.') {
    super(message);
  }
}

/** Kho xin không có kho cấp cấp trên (kho chính của chi nhánh chính) — chỉ còn cách đặt hàng nhà cung cấp. 422. */
export class StockRequestNoSupplierError extends DomainError {
  readonly code = 'STOCK_REQUEST_NO_SUPPLIER';

  constructor() {
    super('Kho này không có kho cấp trên để xin hàng.');
  }
}

/** Kho cấp không đủ tồn để cấp đúng số đã chọn. 422. */
export class StockRequestInsufficientStockError extends DomainError {
  readonly code = 'STOCK_REQUEST_INSUFFICIENT_STOCK';

  constructor(drugName: string) {
    super(`Kho không đủ tồn để cấp "${drugName}" theo số đã nhập.`);
  }
}

/** Số cấp/quyết định cho phần chưa cấp không hợp lệ (vượt số còn thiếu, thiếu lý do...). 422. */
export class StockRequestAllocationInvalidError extends DomainError {
  readonly code = 'STOCK_REQUEST_ALLOCATION_INVALID';

  constructor(message: string) {
    super(message);
  }
}
