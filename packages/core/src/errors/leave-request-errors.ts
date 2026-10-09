import { DomainError } from './domain-error';

/** "Đơn xin nghỉ" (#224) — chỉ xin nghỉ từ HÔM NAY trở đi (ngày lịch VN). */
export class LeaveRequestPastDateError extends DomainError {
  readonly code = 'LEAVE_REQUEST_PAST_DATE';

  constructor() {
    super('Chỉ xin nghỉ được từ hôm nay trở đi.');
  }
}

/** Người nghỉ chưa đăng ký ca (hoặc ca đã chọn) cho ngày đó — nghỉ chỉ áp trên ca đã đăng ký. */
export class LeaveRequestNoShiftError extends DomainError {
  readonly code = 'LEAVE_REQUEST_NO_SHIFT';

  constructor() {
    super('Ngày này chưa đăng ký ca (hoặc ca đã chọn) nên không xin nghỉ được.');
  }
}

/** Đã có đơn (chờ duyệt/đã duyệt) chồng lên khung giờ này của cùng người, cùng ngày. */
export class LeaveRequestOverlapError extends DomainError {
  readonly code = 'LEAVE_REQUEST_OVERLAP';

  constructor() {
    super('Đã có đơn nghỉ (chờ duyệt hoặc đã duyệt) trùng khung giờ này.');
  }
}

/** Thao tác không hợp lệ với trạng thái hiện tại của đơn (đã duyệt/từ chối/rút...). */
export class LeaveRequestInvalidStatusError extends DomainError {
  readonly code = 'LEAVE_REQUEST_INVALID_STATUS';

  constructor() {
    super('Đơn nghỉ không còn ở trạng thái cho phép thao tác này.');
  }
}

/** Không tự duyệt/từ chối đơn của chính mình (trừ khi là người ghi nghỉ hộ — luôn tự duyệt lúc tạo). */
export class LeaveRequestSelfApproveError extends DomainError {
  readonly code = 'LEAVE_REQUEST_SELF_APPROVE';

  constructor() {
    super('Không thể tự duyệt hoặc từ chối đơn nghỉ của chính mình.');
  }
}

/** Chỉ người gửi mới rút được đơn của mình. */
export class LeaveRequestNotOwnerError extends DomainError {
  readonly code = 'LEAVE_REQUEST_NOT_OWNER';

  constructor() {
    super('Chỉ người gửi đơn mới rút được đơn này.');
  }
}
