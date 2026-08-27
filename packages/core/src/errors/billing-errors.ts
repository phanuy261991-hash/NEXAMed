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
