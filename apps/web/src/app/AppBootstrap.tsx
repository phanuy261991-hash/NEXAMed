import { useEffect, useRef } from 'react';
import { getMe, refresh } from '../features/auth/auth.api';
import { hasSessionHint, useAuthStore } from '../features/auth/auth.store';
import { setSessionExpiredHandler } from '../shared/api/client';

/**
 * Khôi phục phiên đăng nhập lúc app khởi động (reload trang) — chỉ còn cookie refresh_token
 * (httpOnly), không còn `accessToken`/`user` trong bộ nhớ. Gọi `/auth/refresh` lấy access token
 * mới, rồi `/auth/me` để lấy lại danh tính/vai trò (xem docs/DECISIONS.md #022). Refresh thất
 * bại (chưa từng đăng nhập, cookie hết hạn...) không phải lỗi hiển thị — coi là chưa đăng nhập.
 *
 * **Bỏ qua hẳn lượt gọi `/auth/refresh` khi `hasSessionHint()` false** (2026-09-08, chủ dự án
 * phản hồi trực tiếp lỗi `401` lặp lại mỗi lần tải trang gây nhiễu console) — trình duyệt/tab
 * chưa từng đăng nhập hoặc đã đăng xuất tường minh CHẮC CHẮN không có cookie refresh hợp lệ (JS
 * không đọc được cookie httpOnly để biết trước), gọi vẫn 401 100% các lần. Cờ `hasSessionHint()`
 * (localStorage, không phải token) chỉ là gợi ý "trình duyệt này đã từng đăng nhập" — sai lệch
 * DUY NHẤT có thể xảy ra là cookie hết hạn tự nhiên trong khi cờ còn `true` (phiên rất cũ), lúc đó
 * vẫn gọi refresh như cũ và nhận đúng 1 lần 401 hợp lý (phiên thật đã hết), không lặp lại ở các
 * lần tải trang SAU vì `clear()` xoá cờ ngay khi đó.
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

    // Access token hết hạn giữa chừng và refresh token (cookie) cũng không còn dùng được nữa —
    // client.ts đã tự thử làm mới trước khi tới đây; chỉ khi đó thất bại mới coi là hết phiên thật.
    setSessionExpiredHandler(clear);

    async function bootstrap() {
      if (!hasSessionHint()) {
        clear();
        return;
      }
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
