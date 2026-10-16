import { describe, expect, it } from 'vitest';
import {
  OPERATOR_LOCK_DURATION_MINUTES,
  STAFF_LOCK_STEPS_MINUTES,
  isAccountLockedPermanently,
  recordFailedStaffLogin,
  resetStaffLoginAttempts,
  type StaffLoginAttemptState,
  FAILED_LOGIN_WINDOW_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  isAccountLocked,
  recordFailedLogin,
  resetLoginAttempts,
} from './lockout';

const T0 = new Date('2026-08-10T10:00:00.000Z');
const minutes = (n: number) => n * 60 * 1000;

describe('lockout', () => {
  it('resetLoginAttempts trả về trạng thái sạch', () => {
    expect(resetLoginAttempts()).toEqual({
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
    });
  });

  it('không khoá tài khoản mới (chưa có lần sai nào)', () => {
    expect(isAccountLocked(resetLoginAttempts(), T0)).toBe(false);
  });

  it('chưa đạt ngưỡng (4 lần sai liên tiếp trong cửa sổ) thì chưa khoá', () => {
    let state = resetLoginAttempts();
    let now = T0;
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i++) {
      state = recordFailedLogin(state, now);
      now = new Date(now.getTime() + minutes(1));
    }
    expect(state.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS - 1);
    expect(state.lockedUntil).toBeNull();
    expect(isAccountLocked(state, now)).toBe(false);
  });

  it('đúng lần sai thứ 5 trong cửa sổ 15 phút thì khoá tài khoản', () => {
    let state = resetLoginAttempts();
    let now = T0;
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      state = recordFailedLogin(state, now);
      now = new Date(now.getTime() + minutes(1));
    }
    expect(state.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
    expect(state.lockedUntil).not.toBeNull();
    expect(isAccountLocked(state, state.lastFailedLoginAt!)).toBe(true);
  });

  it('người vận hành: lockedUntil đúng bằng lastFailedLoginAt + OPERATOR_LOCK_DURATION_MINUTES (60 phút, cố định)', () => {
    let state = resetLoginAttempts();
    const now = T0;
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      state = recordFailedLogin(state, now);
    }
    expect(state.lockedUntil!.getTime()).toBe(now.getTime() + minutes(OPERATOR_LOCK_DURATION_MINUTES));
  });

  it('ngay trước mốc lockedUntil vẫn coi là đang khoá, ngay tại/qua mốc thì hết khoá', () => {
    let state = resetLoginAttempts();
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      state = recordFailedLogin(state, T0);
    }
    const lockedUntil = state.lockedUntil!;
    expect(isAccountLocked(state, new Date(lockedUntil.getTime() - 1))).toBe(true);
    expect(isAccountLocked(state, lockedUntil)).toBe(false);
    expect(isAccountLocked(state, new Date(lockedUntil.getTime() + 1))).toBe(false);
  });

  it('sai lần nữa ngay sau khi hết hạn khoá thì tính lại từ đầu (count=1), không cộng dồn', () => {
    let state = resetLoginAttempts();
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      state = recordFailedLogin(state, T0);
    }
    const afterLockExpires = new Date(state.lockedUntil!.getTime() + minutes(1));
    const next = recordFailedLogin(state, afterLockExpires);
    expect(next.failedLoginCount).toBe(1);
    expect(next.lockedUntil).toBeNull();
  });

  it('khoảng trống dài hơn cửa sổ (không do bị khoá) cũng reset bộ đếm về 1', () => {
    let state = recordFailedLogin(resetLoginAttempts(), T0);
    expect(state.failedLoginCount).toBe(1);

    const afterWindow = new Date(T0.getTime() + minutes(FAILED_LOGIN_WINDOW_MINUTES) + 1);
    state = recordFailedLogin(state, afterWindow);
    expect(state.failedLoginCount).toBe(1);
  });

  it('sai liên tiếp trong đúng cửa sổ thì cộng dồn đúng số lần', () => {
    let state = recordFailedLogin(resetLoginAttempts(), T0);
    const withinWindow = new Date(T0.getTime() + minutes(FAILED_LOGIN_WINDOW_MINUTES));
    state = recordFailedLogin(state, withinWindow);
    expect(state.failedLoginCount).toBe(2);
  });
});

describe('khoá luỹ tiến → vĩnh viễn (nhân viên, #239)', () => {
  const failTimes = (state: StaffLoginAttemptState, n: number, at: Date): StaffLoginAttemptState => {
    let s = state;
    for (let i = 0; i < n; i++) s = recordFailedStaffLogin(s, at);
    return s;
  };
  const afterLock = (s: StaffLoginAttemptState, extraMs = 1000) => new Date(s.lockedUntil!.getTime() + extraMs);

  it('trạng thái sạch: không khoá, bậc 0', () => {
    expect(resetStaffLoginAttempts()).toEqual({ failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, lockoutLevel: 0, lockedPermanentlyAt: null });
  });

  it('4 lần sai chưa khoá; lần thứ 5 khoá tạm 5 phút (bậc 1) và bộ đếm về 0', () => {
    const s4 = failTimes(resetStaffLoginAttempts(), 4, T0);
    expect(s4.lockedUntil).toBeNull();
    expect(s4.failedLoginCount).toBe(4);
    const s5 = recordFailedStaffLogin(s4, T0);
    expect(s5.lockedUntil!.getTime()).toBe(T0.getTime() + minutes(5));
    expect(s5.lockoutLevel).toBe(1);
    expect(s5.failedLoginCount).toBe(0);
    expect(s5.lockedPermanentlyAt).toBeNull();
  });

  it('thang khoá tạm đúng 5 → 15 → 30 phút, mỗi bậc cần đủ 5 lần sai mới (không khoá lại sau 1 lần sai)', () => {
    expect(STAFF_LOCK_STEPS_MINUTES).toEqual([5, 15, 30]);
    let s = failTimes(resetStaffLoginAttempts(), 5, T0);
    expect(s.lockoutLevel).toBe(1);

    // Hết khoá 5 phút: 4 lần sai chưa khoá lại, lần 5 khoá 15 phút.
    let now = afterLock(s);
    s = failTimes(s, 4, now);
    expect(s.lockedUntil).toBeNull();
    expect(isAccountLocked(s, now)).toBe(false);
    s = recordFailedStaffLogin(s, now);
    expect(s.lockedUntil!.getTime()).toBe(now.getTime() + minutes(15));
    expect(s.lockoutLevel).toBe(2);

    now = afterLock(s);
    s = failTimes(s, 5, now);
    expect(s.lockedUntil!.getTime()).toBe(now.getTime() + minutes(30));
    expect(s.lockoutLevel).toBe(3);
    expect(isAccountLockedPermanently(s)).toBe(false);
  });

  it('sau lần khoá 30 phút, chỉ MỘT lần sai nữa là khoá vĩnh viễn', () => {
    let s = failTimes(resetStaffLoginAttempts(), 5, T0);
    s = failTimes(s, 5, afterLock(s));
    s = failTimes(s, 5, afterLock(s));
    expect(s.lockoutLevel).toBe(3);
    const now = afterLock(s);
    const permanent = recordFailedStaffLogin(s, now);
    expect(isAccountLockedPermanently(permanent)).toBe(true);
    expect(permanent.lockedPermanentlyAt).toEqual(now);
    expect(permanent.lockedUntil).toBeNull();
  });

  it('khoá vĩnh viễn không tự hết theo thời gian (isAccountLocked không áp, cờ vẫn còn)', () => {
    let s = failTimes(resetStaffLoginAttempts(), 5, T0);
    s = failTimes(s, 5, afterLock(s));
    s = failTimes(s, 5, afterLock(s));
    s = recordFailedStaffLogin(s, afterLock(s));
    expect(isAccountLockedPermanently(s)).toBe(true);
    expect(isAccountLockedPermanently({ lockedPermanentlyAt: null })).toBe(false);
  });

  it('bậc khoá KHÔNG tự hạ theo thời gian: bậc 2 để lâu bao nhiêu ngày vẫn khoá bậc 3 (30 phút) ở lượt đủ 5 lần sai kế tiếp', () => {
    let s = failTimes(resetStaffLoginAttempts(), 5, T0);
    s = failTimes(s, 5, afterLock(s));
    expect(s.lockoutLevel).toBe(2);
    const muchLater = new Date(s.lastFailedLoginAt!.getTime() + 30 * 24 * 3600_000);
    s = failTimes(s, 5, muchLater);
    expect(s.lockoutLevel).toBe(3);
    expect(s.lockedUntil!.getTime()).toBe(muchLater.getTime() + minutes(30));
  });

  it('bậc 3: dù lần sai cuối đã rất lâu (vài tháng), MỘT lần sai là khoá vĩnh viễn', () => {
    let s = failTimes(resetStaffLoginAttempts(), 5, T0);
    s = failTimes(s, 5, afterLock(s));
    s = failTimes(s, 5, afterLock(s));
    const muchLater = new Date(s.lastFailedLoginAt!.getTime() + 120 * 24 * 3600_000);
    expect(isAccountLockedPermanently(recordFailedStaffLogin(s, muchLater))).toBe(true);
  });

  it('chỉ mở khoá/đăng nhập đúng (resetStaffLoginAttempts) mới đưa bậc về 0', () => {
    let s = failTimes(resetStaffLoginAttempts(), 5, T0);
    s = failTimes(s, 5, afterLock(s));
    s = failTimes(s, 5, afterLock(s));
    s = recordFailedStaffLogin(s, afterLock(s));
    expect(isAccountLockedPermanently(s)).toBe(true);
    expect(resetStaffLoginAttempts()).toMatchObject({ lockoutLevel: 0, lockedPermanentlyAt: null, lockedUntil: null });
  });

  it('người vận hành giữ khoá CỐ ĐỊNH 60 phút: không luỹ tiến, không vĩnh viễn', () => {
    expect(OPERATOR_LOCK_DURATION_MINUTES).toBe(60);
    let state = resetLoginAttempts();
    for (let i = 0; i < 5; i++) state = recordFailedLogin(state, T0);
    expect(state.lockedUntil!.getTime()).toBe(T0.getTime() + minutes(60));
    // Hết khoá rồi sai tiếp 5 lần nữa vẫn chỉ 60 phút, không tăng.
    const later = new Date(state.lockedUntil!.getTime() + 1000);
    for (let i = 0; i < 5; i++) state = recordFailedLogin(state, later);
    expect(state.lockedUntil!.getTime()).toBe(later.getTime() + minutes(60));
  });
});
