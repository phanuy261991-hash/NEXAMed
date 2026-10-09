import { DomainError } from './domain-error';

/** "Đổi ca" (#225) — ca không đổi được (có lịch hẹn, đơn nghỉ, đã qua, trùng ca...). `message` nêu đúng lý do. */
export class ShiftSwapBlockedError extends DomainError {
  readonly code = 'SHIFT_SWAP_BLOCKED';

  constructor(reason: string) {
    super(reason);
  }
}

/** Thao tác không hợp lệ với trạng thái hiện tại của yêu cầu đổi ca (đã xác nhận/từ chối/huỷ). */
export class ShiftSwapInvalidStatusError extends DomainError {
  readonly code = 'SHIFT_SWAP_INVALID_STATUS';

  constructor() {
    super('Yêu cầu đổi ca không còn ở trạng thái cho phép thao tác này.');
  }
}

/** Yêu cầu quá hạn: ngày của ca đầu tiên đã tới mà chưa xác nhận. */
export class ShiftSwapExpiredError extends DomainError {
  readonly code = 'SHIFT_SWAP_EXPIRED';

  constructor() {
    super('Yêu cầu đổi ca đã quá hạn (đã tới ngày của ca).');
  }
}

/** Chỉ người nhận xác nhận/từ chối; chỉ người gửi huỷ. */
export class ShiftSwapNotAllowedActorError extends DomainError {
  readonly code = 'SHIFT_SWAP_NOT_ALLOWED_ACTOR';

  constructor() {
    super('Bạn không phải người được phép thao tác yêu cầu đổi ca này.');
  }
}
