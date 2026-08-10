import { DomainError } from './domain-error';

export class InvalidCredentialsError extends DomainError {
  readonly code = 'AUTH_INVALID_CREDENTIALS';

  constructor() {
    super('Sai tên đăng nhập hoặc mật khẩu.');
  }
}

export class AccountLockedError extends DomainError {
  readonly code = 'AUTH_ACCOUNT_LOCKED';

  constructor(public readonly lockedUntil: Date) {
    super('Tài khoản đang bị khoá tạm thời do đăng nhập sai nhiều lần.');
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
