/**
 * Khoá tài khoản khi đăng nhập sai — xem .claude/docs/security-audit.md mục Xác thực và
 * docs/DECISIONS.md #239.
 *
 * Hai chính sách, cùng cách đếm "5 lần sai liên tiếp":
 *
 * 1. NHÂN VIÊN PHÒNG KHÁM (`recordFailedStaffLogin`) — khoá LUỸ TIẾN rồi VĨNH VIỄN:
 *    5 lần sai → khoá 5 phút; hết khoá, 5 lần sai nữa → 15 phút; rồi 30 phút; sau lần khoá 30 phút
 *    chỉ cần sai thêm MỘT lần nữa là khoá vĩnh viễn — chỉ người có quyền `user_account.unlock` hoặc
 *    lệnh đặt lại mật khẩu quản trị mới gỡ được. Bậc khoá (`lockoutLevel`) KHÔNG tự hạ theo
 *    thời gian: chỉ về 0 khi đăng nhập đúng hoặc khi quản trị mở khoá (chủ dự án chốt, #239).
 *
 * 2. NGƯỜI VẬN HÀNH NỀN TẢNG (`recordFailedLogin`) — khoá CỐ ĐỊNH 60 phút sau 5 lần sai, không luỹ
 *    tiến, không vĩnh viễn (đã có xác thực 2 lớp OTP, chủ dự án chốt — và không có ai cao hơn để mở
 *    khoá một người vận hành bị khoá vĩnh viễn).
 *
 * Ngữ nghĩa cửa sổ: "reset khi có khoảng trống quá M phút giữa hai lần sai", không phải sliding
 * window nghiêm ngặt (không lưu danh sách timestamp) — đơn giản, đủ đúng với yêu cầu, dễ test.
 */

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const FAILED_LOGIN_WINDOW_MINUTES = 15;
/** Thời gian khoá của chính sách cố định (người vận hành nền tảng). */
export const OPERATOR_LOCK_DURATION_MINUTES = 60;
/** Thời gian khoá của từng lần khoá liên tiếp ở chính sách luỹ tiến (nhân viên): lần 1, 2, 3. */
export const STAFF_LOCK_STEPS_MINUTES: readonly number[] = [5, 15, 30];

export interface LoginAttemptState {
  failedLoginCount: number;
  lastFailedLoginAt: Date | null;
  lockedUntil: Date | null;
}

export interface StaffLoginAttemptState extends LoginAttemptState {
  /** Số lần đã bị khoá tạm liên tiếp (0..STAFF_LOCK_STEPS_MINUTES.length). */
  lockoutLevel: number;
  /** Khác null = khoá vĩnh viễn, cho tới khi quản trị mở khoá. */
  lockedPermanentlyAt: Date | null;
}

export function isAccountLocked(state: Pick<LoginAttemptState, 'lockedUntil'>, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

export function isAccountLockedPermanently(state: Pick<StaffLoginAttemptState, 'lockedPermanentlyAt'>): boolean {
  return state.lockedPermanentlyAt !== null;
}

function nextFailureCount(state: LoginAttemptState, now: Date): number {
  const windowMs = FAILED_LOGIN_WINDOW_MINUTES * 60 * 1000;
  const withinWindow = state.lastFailedLoginAt !== null && now.getTime() - state.lastFailedLoginAt.getTime() <= windowMs;
  return (withinWindow ? state.failedLoginCount : 0) + 1;
}

/** Chính sách cố định (người vận hành nền tảng): 5 lần sai → khoá `OPERATOR_LOCK_DURATION_MINUTES` phút. */
export function recordFailedLogin(
  state: LoginAttemptState,
  now: Date,
  lockDurationMinutes: number = OPERATOR_LOCK_DURATION_MINUTES,
): LoginAttemptState {
  const failedLoginCount = nextFailureCount(state, now);
  const lockedUntil = failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS ? new Date(now.getTime() + lockDurationMinutes * 60 * 1000) : null;
  return { failedLoginCount, lastFailedLoginAt: now, lockedUntil };
}

/**
 * Chính sách luỹ tiến → vĩnh viễn (nhân viên phòng khám). Gọi cho MỖI lần sai mật khẩu của tài khoản
 * chưa bị khoá; tài khoản đang khoá (tạm hoặc vĩnh viễn) phải bị chặn trước đó và không đi qua hàm này.
 */
export function recordFailedStaffLogin(state: StaffLoginAttemptState, now: Date): StaffLoginAttemptState {
  const level = state.lockoutLevel;

  // Đã chịu đủ các bậc khoá tạm → MỘT lần sai nữa là khoá vĩnh viễn.
  if (level >= STAFF_LOCK_STEPS_MINUTES.length) {
    return { failedLoginCount: 0, lastFailedLoginAt: now, lockedUntil: null, lockoutLevel: level, lockedPermanentlyAt: now };
  }

  const failedLoginCount = nextFailureCount(state, now);
  if (failedLoginCount < MAX_FAILED_LOGIN_ATTEMPTS) {
    return { failedLoginCount, lastFailedLoginAt: now, lockedUntil: null, lockoutLevel: level, lockedPermanentlyAt: null };
  }

  // Đủ 5 lần sai → khoá tạm bậc kế tiếp; bộ đếm về 0 để mỗi bậc cần đủ 5 lần sai mới.
  const minutes = STAFF_LOCK_STEPS_MINUTES[level]!;
  return {
    failedLoginCount: 0,
    lastFailedLoginAt: now,
    lockedUntil: new Date(now.getTime() + minutes * 60 * 1000),
    lockoutLevel: level + 1,
    lockedPermanentlyAt: null,
  };
}

export function resetLoginAttempts(): LoginAttemptState {
  return { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null };
}

/** Xoá mọi khoá của nhân viên: đăng nhập đúng, đặt lại mật khẩu, hoặc quản trị bấm "Mở khoá". */
export function resetStaffLoginAttempts(): StaffLoginAttemptState {
  return { ...resetLoginAttempts(), lockoutLevel: 0, lockedPermanentlyAt: null };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// KHOÁ THÔNG MINH theo "máy quen" (docs/DECISIONS.md #259, sửa #239)
//
// Vấn đề của khoá vĩnh viễn thuần tuý: ai biết tên đăng nhập, gõ sai ~20 lần là khoá được tài khoản của NGƯỜI KHÁC (kể cả quản trị) — DoS tài khoản. Cách xử lý:
//  - "Máy quen" = trình duyệt đã từng đăng nhập ĐÚNG tài khoản đó và còn giữ dấu hiệu đã ký (cookie, xem `DeviceTrustService` ở API).
//  - Khoá luỹ tiến → vĩnh viễn (#239, các hàm phía trên) vẫn đếm đăng nhập sai từ máy LẠ, nhưng CHỈ chặn máy lạ: máy quen vẫn đăng nhập được, và đăng nhập đúng từ máy quen thì gỡ mọi khoá.
//  - Đăng nhập SAI từ máy quen đếm RIÊNG (dưới đây): quá ngưỡng thì khoá tạm — chặn CẢ máy quen lẫn máy lạ trong thời gian đó — và KHÔNG BAO GIỜ vĩnh viễn. Nhờ vậy dấu hiệu bị đánh cắp
//    cũng không dò mật khẩu vô hạn được, còn người dùng thật quên mật khẩu trên máy quen thì chỉ phải chờ, không cần quản trị.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Máy quen: số lần sai liên tiếp (trong cửa sổ `FAILED_LOGIN_WINDOW_MINUTES`) thì khoá tạm. Rộng hơn máy lạ (5) vì đây thường là chính chủ gõ nhầm. */
export const FAMILIAR_MAX_FAILED_ATTEMPTS = 10;
/** Thời gian khoá tạm của máy quen — cố định, không luỹ tiến, không vĩnh viễn. */
export const FAMILIAR_LOCK_MINUTES = 15;

export interface FamiliarLoginAttemptState {
  familiarFailedLoginCount: number;
  familiarLastFailedLoginAt: Date | null;
  familiarLockedUntil: Date | null;
}

/** Mỗi lần sai mật khẩu từ MÁY QUEN (tài khoản chưa bị khoá do máy quen). Đủ ngưỡng → khoá tạm, bộ đếm về 0. */
export function recordFailedFamiliarLogin(state: FamiliarLoginAttemptState, now: Date): FamiliarLoginAttemptState {
  const windowMs = FAILED_LOGIN_WINDOW_MINUTES * 60 * 1000;
  const withinWindow = state.familiarLastFailedLoginAt !== null && now.getTime() - state.familiarLastFailedLoginAt.getTime() <= windowMs;
  const count = (withinWindow ? state.familiarFailedLoginCount : 0) + 1;
  if (count >= FAMILIAR_MAX_FAILED_ATTEMPTS) {
    return { familiarFailedLoginCount: 0, familiarLastFailedLoginAt: now, familiarLockedUntil: new Date(now.getTime() + FAMILIAR_LOCK_MINUTES * 60 * 1000) };
  }
  return { familiarFailedLoginCount: count, familiarLastFailedLoginAt: now, familiarLockedUntil: null };
}

export function resetFamiliarLoginAttempts(): FamiliarLoginAttemptState {
  return { familiarFailedLoginCount: 0, familiarLastFailedLoginAt: null, familiarLockedUntil: null };
}

export type LoginBlock = { kind: 'permanent' } | { kind: 'temporary'; until: Date };

/**
 * Lần đăng nhập này có bị chặn bởi khoá tài khoản không? (`familiar` = đến từ máy quen)
 *  - Khoá tạm CỦA MÁY QUEN (`familiarLockedUntil`) chặn mọi lần thử.
 *  - Khoá do máy lạ gây ra (tạm hoặc vĩnh viễn) chỉ chặn MÁY LẠ — máy quen không bị liên luỵ.
 * Còn nhiều khoá cùng lúc thì báo cái kết thúc muộn nhất (vĩnh viễn thắng).
 */
export function resolveLoginBlock(
  account: Pick<StaffLoginAttemptState, 'lockedUntil' | 'lockedPermanentlyAt'> & Pick<FamiliarLoginAttemptState, 'familiarLockedUntil'>,
  familiar: boolean,
  now: Date,
): LoginBlock | null {
  if (!familiar && account.lockedPermanentlyAt !== null) return { kind: 'permanent' };
  const untils: Date[] = [];
  if (account.familiarLockedUntil !== null && account.familiarLockedUntil.getTime() > now.getTime()) untils.push(account.familiarLockedUntil);
  if (!familiar && account.lockedUntil !== null && account.lockedUntil.getTime() > now.getTime()) untils.push(account.lockedUntil);
  if (untils.length === 0) return null;
  return { kind: 'temporary', until: new Date(Math.max(...untils.map((d) => d.getTime()))) };
}
