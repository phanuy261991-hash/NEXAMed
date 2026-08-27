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
