import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_LOCK_DURATION_MINUTES,
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

  it('lockedUntil đúng bằng lastFailedLoginAt + ACCOUNT_LOCK_DURATION_MINUTES', () => {
    let state = resetLoginAttempts();
    const now = T0;
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      state = recordFailedLogin(state, now);
    }
    expect(state.lockedUntil!.getTime()).toBe(now.getTime() + minutes(ACCOUNT_LOCK_DURATION_MINUTES));
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
