import { describe, expect, it } from 'vitest';
import {
  FAMILIAR_LOCK_MINUTES,
  FAMILIAR_MAX_FAILED_ATTEMPTS,
  FAILED_LOGIN_WINDOW_MINUTES,
  recordFailedFamiliarLogin,
  recordFailedStaffLogin,
  resetFamiliarLoginAttempts,
  resetStaffLoginAttempts,
  resolveLoginBlock,
  type FamiliarLoginAttemptState,
} from './lockout';

const T0 = new Date('2026-10-23T08:00:00.000Z');
const plusMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

describe('khoá thông minh theo máy quen (#259)', () => {
  describe('recordFailedFamiliarLogin', () => {
    it(`sai ${FAMILIAR_MAX_FAILED_ATTEMPTS - 1} lần chưa khoá; lần thứ ${FAMILIAR_MAX_FAILED_ATTEMPTS} khoá tạm ${FAMILIAR_LOCK_MINUTES} phút và bộ đếm về 0`, () => {
      let state: FamiliarLoginAttemptState = resetFamiliarLoginAttempts();
      for (let i = 1; i < FAMILIAR_MAX_FAILED_ATTEMPTS; i += 1) {
        state = recordFailedFamiliarLogin(state, plusMin(T0, i * 0.1));
        expect(state.familiarLockedUntil, `lần ${i}`).toBeNull();
        expect(state.familiarFailedLoginCount).toBe(i);
      }
      const locked = recordFailedFamiliarLogin(state, plusMin(T0, 2));
      expect(locked.familiarFailedLoginCount).toBe(0);
      expect(locked.familiarLockedUntil?.getTime()).toBe(plusMin(plusMin(T0, 2), FAMILIAR_LOCK_MINUTES).getTime());
    });

    it('khoảng trống quá cửa sổ giữa hai lần sai → đếm lại từ 1', () => {
      const first = recordFailedFamiliarLogin(resetFamiliarLoginAttempts(), T0);
      const later = recordFailedFamiliarLogin(first, plusMin(T0, FAILED_LOGIN_WINDOW_MINUTES + 1));
      expect(later.familiarFailedLoginCount).toBe(1);
    });

    it('KHÔNG BAO GIỜ vĩnh viễn: khoá lặp lại nhiều lần vẫn chỉ là khoá tạm (kiểu trả về không có mốc vĩnh viễn)', () => {
      let state = resetFamiliarLoginAttempts();
      let now = T0;
      for (let round = 0; round < 5; round += 1) {
        for (let i = 0; i < FAMILIAR_MAX_FAILED_ATTEMPTS; i += 1) {
          now = plusMin(now, 0.05);
          state = recordFailedFamiliarLogin(state, now);
        }
        expect(state.familiarLockedUntil).not.toBeNull();
        expect(Object.keys(state).sort()).toEqual(['familiarFailedLoginCount', 'familiarLastFailedLoginAt', 'familiarLockedUntil']);
        now = plusMin(now, FAMILIAR_LOCK_MINUTES + 1);
      }
    });
  });

  describe('resolveLoginBlock — khoá do MÁY LẠ chỉ chặn máy lạ', () => {
    const noLock = { lockedUntil: null, lockedPermanentlyAt: null, familiarLockedUntil: null };

    it('không khoá → không chặn (cả máy quen lẫn máy lạ)', () => {
      expect(resolveLoginBlock(noLock, true, T0)).toBeNull();
      expect(resolveLoginBlock(noLock, false, T0)).toBeNull();
    });

    it('KHOÁ VĨNH VIỄN do máy lạ: chặn máy lạ, KHÔNG chặn máy quen (chính chủ vẫn vào được)', () => {
      const account = { ...noLock, lockedPermanentlyAt: T0 };
      expect(resolveLoginBlock(account, false, plusMin(T0, 5))).toEqual({ kind: 'permanent' });
      expect(resolveLoginBlock(account, true, plusMin(T0, 5))).toBeNull();
    });

    it('khoá tạm do máy lạ: chặn máy lạ tới lúc hết hạn, KHÔNG chặn máy quen; hết hạn thì thôi chặn', () => {
      const account = { ...noLock, lockedUntil: plusMin(T0, 10) };
      expect(resolveLoginBlock(account, false, T0)).toEqual({ kind: 'temporary', until: plusMin(T0, 10) });
      expect(resolveLoginBlock(account, true, T0)).toBeNull();
      expect(resolveLoginBlock(account, false, plusMin(T0, 11))).toBeNull();
    });

    it('khoá tạm CỦA MÁY QUEN chặn tất cả — cả máy quen lẫn máy lạ', () => {
      const account = { ...noLock, familiarLockedUntil: plusMin(T0, 15) };
      expect(resolveLoginBlock(account, true, T0)).toEqual({ kind: 'temporary', until: plusMin(T0, 15) });
      expect(resolveLoginBlock(account, false, T0)).toEqual({ kind: 'temporary', until: plusMin(T0, 15) });
      expect(resolveLoginBlock(account, true, plusMin(T0, 16))).toBeNull();
    });

    it('nhiều khoá tạm cùng lúc → báo mốc hết MUỘN nhất (máy lạ); máy quen chỉ thấy khoá của máy quen', () => {
      const account = { ...noLock, lockedUntil: plusMin(T0, 30), familiarLockedUntil: plusMin(T0, 15) };
      expect(resolveLoginBlock(account, false, T0)).toEqual({ kind: 'temporary', until: plusMin(T0, 30) });
      expect(resolveLoginBlock(account, true, T0)).toEqual({ kind: 'temporary', until: plusMin(T0, 15) });
    });

    it('vĩnh viễn thắng khoá tạm đối với máy lạ', () => {
      const account = { lockedUntil: plusMin(T0, 30), lockedPermanentlyAt: T0, familiarLockedUntil: plusMin(T0, 15) };
      expect(resolveLoginBlock(account, false, T0)).toEqual({ kind: 'permanent' });
    });
  });

  describe('chính sách cũ (#239) cho máy lạ không đổi', () => {
    it('máy lạ vẫn: 5 lần sai → khoá 5 phút → ... → khoá vĩnh viễn', () => {
      let state = resetStaffLoginAttempts();
      let now = T0;
      for (let i = 0; i < 5; i += 1) state = recordFailedStaffLogin(state, (now = plusMin(now, 0.05)));
      expect(state.lockedUntil).not.toBeNull();
      expect(state.lockoutLevel).toBe(1);
    });
  });
});
