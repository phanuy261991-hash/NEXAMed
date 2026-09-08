import { create } from 'zustand';
import type { CurrentUser } from '@nexamed/shared';

/**
 * Session state tạm thời (không phải server entity data qua TanStack Query) — đúng theo
 * .claude/docs/architecture.md mục "Luồng dữ liệu phía web". `accessToken` chỉ giữ trong bộ nhớ
 * (không localStorage, tránh lộ qua XSS) — mất khi reload trang, khôi phục lại qua
 * `AppBootstrap` (gọi `/auth/refresh` bằng cookie httpOnly + `/auth/me`).
 */
export type AuthStatus = 'idle' | 'authenticated' | 'unauthenticated';

interface AuthState {
  accessToken: string | null;
  user: CurrentUser | null;
  status: AuthStatus;
  setSession: (accessToken: string, user: CurrentUser) => void;
  /** Cập nhật một phần `user` tại chỗ — dùng sau khi đổi mật khẩu (xoá cờ `mustChangePassword`), không cần re-login/refetch `/auth/me`. */
  updateUser: (patch: Partial<CurrentUser>) => void;
  clear: () => void;
}

/**
 * Cờ gợi ý "trình duyệt này đã từng đăng nhập" — CHỈ là `'1'`/không có gì, KHÔNG phải
 * access/refresh token (không lộ thông tin nhạy cảm qua XSS, khác hẳn lý do `accessToken` cố ý
 * không lưu localStorage ở comment trên). Dùng để `AppBootstrap` bỏ qua hẳn lượt gọi
 * `/auth/refresh` CHẮC CHẮN thất bại (401, gây nhiễu console) cho trình duyệt/tab chưa từng đăng
 * nhập hoặc đã đăng xuất tường minh — không đổi hành vi khôi phục phiên thật (2026-09-08, chủ dự
 * án phản hồi trực tiếp lỗi 401 lặp lại mỗi lần tải trang).
 */
const SESSION_HINT_KEY = 'nexamed_had_session';

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function setSessionHint(value: boolean) {
  try {
    if (value) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Trình duyệt chặn localStorage (chế độ ẩn danh nghiêm ngặt...) — bỏ qua, chỉ mất tác dụng
    // tối ưu bỏ-qua-refresh-thừa, không ảnh hưởng luồng đăng nhập/khôi phục phiên chính.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'idle',
  setSession: (accessToken, user) => {
    setSessionHint(true);
    set({ accessToken, user, status: 'authenticated' });
  },
  updateUser: (patch) => set((state) => (state.user ? { user: { ...state.user, ...patch } } : {})),
  clear: () => {
    setSessionHint(false);
    set({ accessToken: null, user: null, status: 'unauthenticated' });
  },
}));
