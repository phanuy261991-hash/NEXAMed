import { DomainError } from './domain-error';

/** Lưu mã liên thông lần đầu mà chưa nhập mật khẩu (docs/DECISIONS.md #242, giai đoạn 3). Mặc định 422. */
export class InteropPasswordRequiredError extends DomainError {
  readonly code = 'INTEROP_PASSWORD_REQUIRED';

  constructor() {
    super('Nhập mật khẩu liên thông (lần đầu lưu bắt buộc).');
  }
}

/** Sửa thông tin liên thông (mockup 8b) của loại đơn đã được gửi lên cổng (hoặc đã đính chính sau khi gửi) — khoá. Xung đột trạng thái nên 409. */
export class InteropInfoLockedError extends DomainError {
  readonly code = 'INTEROP_INFO_LOCKED';

  constructor() {
    super('Đơn này đã được gửi lên cổng đơn thuốc quốc gia nên không sửa thông tin liên thông được nữa.');
  }
}

/** Ghi thông tin người giám hộ ngược vào hồ sơ bệnh nhân mà người dùng không có quyền sửa hồ sơ bệnh nhân. 403. */
export class InteropGuardianEditForbiddenError extends DomainError {
  readonly code = 'INTEROP_GUARDIAN_EDIT_FORBIDDEN';

  constructor() {
    super('Bạn không có quyền sửa hồ sơ bệnh nhân nên chưa lưu được thông tin người giám hộ.');
  }
}

/** "Gửi ngay"/"Gửi lại" khi công tắc "Gửi đơn lên cổng" đang tắt. 409. */
export class InteropSendDisabledError extends DomainError {
  readonly code = 'INTEROP_SEND_DISABLED';

  constructor() {
    super('Chưa bật "Gửi đơn lên cổng" ở Cấu hình hệ thống, mục "Liên thông đơn thuốc".');
  }
}

/** Đơn không ở trạng thái gửi được (đã gửi, đã đính chính sau khi gửi) hoặc đang được gửi bởi tiến trình khác. 409. */
export class InteropSubmissionNotSendableError extends DomainError {
  readonly code = 'INTEROP_SUBMISSION_NOT_SENDABLE';

  constructor(reason: 'STATE' | 'BUSY') {
    super(reason === 'BUSY' ? 'Đơn này đang được gửi, thử lại sau ít phút.' : 'Đơn này không ở trạng thái gửi được (đã gửi hoặc đã đính chính sau khi gửi).');
  }
}
