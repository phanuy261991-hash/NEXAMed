import { DomainError } from './domain-error';

export class InvalidCredentialsError extends DomainError {
  readonly code = 'AUTH_INVALID_CREDENTIALS';

  constructor() {
    super('Sai tên đăng nhập hoặc mật khẩu.');
  }
}

export class AccountLockedError extends DomainError {
  readonly code = 'AUTH_ACCOUNT_LOCKED';

  /** Số phút còn lại tới lúc hết khoá, làm tròn LÊN (còn 10 giây vẫn báo "1 phút"), tối thiểu 1. */
  readonly retryAfterMinutes: number;
  /** Số giây còn lại (làm tròn lên, tối thiểu 1) — web đếm lùi theo số giây TƯƠNG ĐỐI này, không phụ thuộc đồng hồ máy khách lệch máy chủ. */
  readonly retryAfterSeconds: number;

  constructor(
    public readonly lockedUntil: Date,
    now: Date,
  ) {
    const seconds = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    super(`Tài khoản bị khoá tạm thời ${minutes} phút do đăng nhập sai nhiều lần. Vui lòng thử lại sau ${minutes} phút.`);
    this.retryAfterMinutes = minutes;
    this.retryAfterSeconds = seconds;
  }
}

/**
 * Khoá vĩnh viễn sau chuỗi khoá tạm (docs/DECISIONS.md #239) — chỉ quản trị có quyền
 * `user_account.unlock` (hoặc lệnh đặt lại mật khẩu quản trị trên máy chủ) mới gỡ được.
 */
export class AccountLockedPermanentlyError extends DomainError {
  readonly code = 'AUTH_ACCOUNT_LOCKED_PERMANENT';

  constructor() {
    super('Tài khoản đã bị khoá do đăng nhập sai nhiều lần từ thiết bị này. Hãy đăng nhập từ máy bạn vẫn thường dùng (khoá sẽ tự gỡ) hoặc liên hệ quản trị viên để được mở khoá.');
  }
}

export class AccountDisabledError extends DomainError {
  readonly code = 'AUTH_ACCOUNT_DISABLED';

  constructor() {
    super('Tài khoản đã bị vô hiệu hoá.');
  }
}

export class RefreshTokenInvalidError extends DomainError {
  readonly code = 'AUTH_REFRESH_TOKEN_INVALID';

  constructor() {
    super('Refresh token không hợp lệ hoặc đã hết hạn.');
  }
}

/**
 * Refresh token đã bị rotate (không còn là phiên hiện hành) nhưng vẫn bị dùng lại — dấu hiệu
 * token bị đánh cắp. Service phải thu hồi toàn bộ phiên của user khi ném lỗi này — xem
 * .claude/docs/security-audit.md, docs/DECISIONS.md #019.
 */
export class RefreshTokenReuseDetectedError extends DomainError {
  readonly code = 'AUTH_REFRESH_TOKEN_REUSED';

  constructor() {
    super('Refresh token đã bị dùng lại sau khi xoay vòng — toàn bộ phiên đã bị thu hồi.');
  }
}
