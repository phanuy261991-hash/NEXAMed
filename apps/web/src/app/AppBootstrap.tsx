import { useEffect, useRef } from 'react';
import { getMe, refresh } from '../features/auth/auth.api';
import { useAuthStore } from '../features/auth/auth.store';

/**
 * Khôi phục phiên đăng nhập lúc app khởi động (reload trang) — chỉ còn cookie refresh_token
 * (httpOnly), không còn `accessToken`/`user` trong bộ nhớ. Gọi `/auth/refresh` lấy access token
 * mới, rồi `/auth/me` để lấy lại danh tính/vai trò (xem docs/DECISIONS.md #022). Refresh thất
 * bại (chưa từng đăng nhập, cookie hết hạn...) không phải lỗi hiển thị — coi là chưa đăng nhập.
 *
 * `hasRun` chặn React StrictMode (dev) gọi effect 2 lần khi mount — nếu không, hai request
 * `/auth/refresh` bắn gần như đồng thời có thể đụng cơ chế phát hiện reuse-token (rotation ở
 * S1-04, docs/DECISIONS.md #019: refresh token dùng lại sau khi đã rotate bị coi là rò rỉ, thu
 * hồi toàn bộ phiên) — quan sát được lúc kiểm bằng Playwright, chỉ xảy ra ở StrictMode dev-only
 * nhưng chặn cho chắc thay vì phụ thuộc vào tốc độ round-trip.
 */
export function AppBootstrap() {
  const setSession = useAuthStore((s) => s.setSession);
  const clear = useAuthStore((s) => s.clear);
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) {
      return;
    }
    hasRun.current = true;

    async function bootstrap() {
      try {
        const token = await refresh();
        const user = await getMe();
        setSession(token.accessToken, user);
      } catch {
        clear();
      }
    }

    void bootstrap();
  }, [setSession, clear]);

  return null;
}
