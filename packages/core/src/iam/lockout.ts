/**
 * Khoá tài khoản tạm sau N lần đăng nhập sai trong M phút — xem .claude/docs/security-audit.md
 * mục Xác thực ("Khoá tài khoản tạm sau 5 lần đăng nhập sai trong 15 phút").
 *
 * `FAILED_LOGIN_WINDOW_MINUTES` và `ACCOUNT_LOCK_DURATION_MINUTES` cố ý bằng nhau: nhờ vậy khi
 * `lockedUntil` hết hạn thì cửa sổ đếm lỗi cũng vừa hết hạn theo cùng mốc `lastFailedLoginAt`,
 * nên không cần xử lý riêng "vừa hết khoá thì có reset bộ đếm không" — logic cửa sổ ở
 * `recordFailedLogin` tự nhiên cho kết quả đúng. Đổi một trong hai hằng số riêng lẻ sẽ phá vỡ
 * giả định này.
 *
 * Ngữ nghĩa cửa sổ: "reset khi có khoảng trống quá M phút giữa hai lần sai", không phải sliding
 * window nghiêm ngặt (không lưu danh sách timestamp) — đơn giản, đủ đúng với yêu cầu, dễ test.
 */

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const FAILED_LOGIN_WINDOW_MINUTES = 15;
export const ACCOUNT_LOCK_DURATION_MINUTES = 15;

export interface LoginAttemptState {
  failedLoginCount: number;
  lastFailedLoginAt: Date | null;
  lockedUntil: Date | null;
}

export function isAccountLocked(state: Pick<LoginAttemptState, 'lockedUntil'>, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

export function recordFailedLogin(state: LoginAttemptState, now: Date): LoginAttemptState {
  const windowMs = FAILED_LOGIN_WINDOW_MINUTES * 60 * 1000;
  const withinWindow =
    state.lastFailedLoginAt !== null && now.getTime() - state.lastFailedLoginAt.getTime() <= windowMs;

  const failedLoginCount = (withinWindow ? state.failedLoginCount : 0) + 1;
  const lockedUntil =
    failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + ACCOUNT_LOCK_DURATION_MINUTES * 60 * 1000)
      : null;

  return { failedLoginCount, lastFailedLoginAt: now, lockedUntil };
}

export function resetLoginAttempts(): LoginAttemptState {
  return { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null };
}
