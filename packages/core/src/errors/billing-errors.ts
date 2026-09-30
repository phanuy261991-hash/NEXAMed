import { DomainError } from './domain-error';

/**
 * Thu ngân cơ bản (Sprint 5/6, BIL-01→04) — đánh dấu "Đã thu" cho phiếu thu đã ở trạng thái `PAID`
 * (double-submit/race) — xung đột trạng thái, không phải lỗi input, cùng nhóm
 * `PRESCRIPTION_ALREADY_SIGNED`.
 */
export class InvoiceAlreadyPaidError extends DomainError {
  readonly code = 'INVOICE_ALREADY_PAID';

  constructor() {
    super('Phiếu thu này đã được đánh dấu đã thu trước đó.');
  }
}

/** "Đánh dấu chưa thu" (revert) trên phiếu thu đang ở trạng thái `UNPAID` — không có gì để hoàn tác. */
export class InvoiceNotPaidError extends DomainError {
  readonly code = 'INVOICE_NOT_PAID';

  constructor() {
    super('Phiếu thu này chưa được đánh dấu đã thu.');
  }
}

/**
 * #085 — mọi thao tác tiền bạc (thu tiền/lưu tạm/đánh dấu chưa thu/hoàn tiền) trên phiếu thu đã
 * ĐÓNG SỔ (`CANCELLED` do lượt khám bị huỷ khi chưa thu, hoặc `REFUNDED` do đã hoàn tiền xong).
 * Trước #085 không tồn tại tình huống này (phiếu chỉ có UNPAID/PAID, luôn thao tác được).
 */
export class InvoiceClosedError extends DomainError {
  readonly code = 'INVOICE_CLOSED';

  constructor() {
    super('Phiếu thu này đã đóng sổ (lượt khám đã huỷ hoặc đã hoàn tiền) — không thao tác được nữa.');
  }
}

/**
 * #085 — hoàn tiền khi chưa đủ điều kiện: phiếu chưa ở `PAID` (chưa thu thì không có gì để hoàn),
 * hoặc lượt khám CHƯA bị huỷ (chặn hoàn nhầm cho ca vẫn đang khám bình thường — phải huỷ lượt khám
 * trước, xem `canRefundInvoice()` ở `@nexamed/core` `billing/invoice-lifecycle.ts`).
 */
export class InvoiceNotRefundableError extends DomainError {
  readonly code = 'INVOICE_NOT_REFUNDABLE';

  constructor() {
    super('Chỉ hoàn tiền được cho phiếu thu đã thu tiền của lượt khám đã huỷ.');
  }
}

/**
 * Chiết khấu — chỉ sửa được khi phiếu còn `UNPAID` (chốt qua `AskUserQuestion`: muốn đổi chiết
 * khấu của phiếu đã thu phải "Đánh dấu chưa thu" trước, không sửa trực tiếp trên phiếu đã PAID —
 * tránh phải tính lại chênh lệch thu thêm/hoàn lại, ngoài phạm vi "Thu ngân cơ bản" v1).
 */
export class InvoiceDiscountNotAllowedError extends DomainError {
  readonly code = 'INVOICE_DISCOUNT_NOT_ALLOWED';

  constructor() {
    super('Chỉ chỉnh chiết khấu khi phiếu đang ở trạng thái chờ thu.');
  }
}

/**
 * Hoàn tiền một phần theo dòng thuốc (#203) — dòng không hoàn được: không phải dòng thuốc (dịch vụ
 * khám chỉ hoàn toàn phần khi huỷ lượt khám), hoặc không thuộc hoá đơn này.
 */
export class InvoiceLineNotRefundableError extends DomainError {
  readonly code = 'INVOICE_LINE_NOT_REFUNDABLE';

  constructor() {
    super('Chỉ hoàn tiền được từng dòng THUỐC của hoá đơn đã thu.');
  }
}

/** Hoàn tiền một phần (#203) — số lượng hoàn vượt số còn hoàn được của dòng (đã bán − đã hoàn). */
export class InvoiceRefundQuantityExceededError extends DomainError {
  readonly code = 'INVOICE_REFUND_QUANTITY_EXCEEDED';

  constructor() {
    super('Số lượng hoàn vượt quá số lượng còn hoàn được của dòng thuốc.');
  }
}

/** Hoàn tiền một phần (#203) — tổng tiền hoàn bằng 0đ (ví dụ dòng chiết khấu 100%): không có tiền để hoàn. */
export class InvoiceRefundZeroAmountError extends DomainError {
  readonly code = 'INVOICE_REFUND_ZERO_AMOUNT';

  constructor() {
    super('Các dòng đã chọn không có tiền để hoàn (số tiền hoàn bằng 0).');
  }
}

/**
 * "Đánh dấu chưa thu" trên phiếu ĐÃ CÓ hoàn tiền một phần (#203) — sẽ xoá cả dòng hoàn và cộng ví
 * thừa; sai trái với bản chất "sửa thao tác bấm nhầm". Tiền đã hoàn ra khỏi két thì không đảo được.
 */
export class InvoiceHasRefundsError extends DomainError {
  readonly code = 'INVOICE_HAS_REFUNDS';

  constructor() {
    super('Phiếu thu này đã hoàn tiền một phần — không thể "Đánh dấu chưa thu".');
  }
}
