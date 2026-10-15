import { create } from 'zustand';
import type { PlatformOperator } from '@nexamed/shared';
import { setPlatformToken } from './platform.api';

/**
 * Phiên người vận hành (docs/DECISIONS.md #237): access token 60 phút, KHÔNG có refresh — hết hạn thì đăng nhập lại (mật khẩu + OTP). Lưu ở `sessionStorage` (mất khi đóng tab) để tải lại trang
 * không bắt nhập OTP lại; đánh đổi: mã còn trong tab đang mở (khu này không có nội dung của bệnh nhân, token tối đa 60 phút).
 */
const STORAGE_KEY = 'nexamed.platform.session';

interface StoredSession {
  token: string;
  operator: PlatformOperator;
}

function read(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function write(session: StoredSession | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Trình duyệt chặn lưu trữ: phiên chỉ sống trong bộ nhớ, tải lại trang phải đăng nhập lại.
  }
}

interface PlatformSessionState {
  operator: PlatformOperator | null;
  setSession: (token: string, operator: PlatformOperator) => void;
  clear: () => void;
}

const stored = read();
if (stored) setPlatformToken(stored.token);

export const usePlatformSession = create<PlatformSessionState>((set) => ({
  operator: stored?.operator ?? null,
  setSession: (token, operator) => {
    setPlatformToken(token);
    write({ token, operator });
    set({ operator });
  },
  clear: () => {
    setPlatformToken(null);
    write(null);
    set({ operator: null });
  },
}));
