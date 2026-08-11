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
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'idle',
  setSession: (accessToken, user) => set({ accessToken, user, status: 'authenticated' }),
  clear: () => set({ accessToken: null, user: null, status: 'unauthenticated' }),
}));
