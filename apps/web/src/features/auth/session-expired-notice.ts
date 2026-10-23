/**
 * Báo "phiên làm việc đã hết hạn" ở màn đăng nhập (docs/DECISIONS.md #255): khi access token hết hạn VÀ không làm mới được, ứng dụng dọn phiên và
 * đưa người dùng về `/login` — trước đây không có lời giải thích nào. Cờ lưu ở `sessionStorage` (sống qua lần chuyển trang trong cùng tab, tự mất khi
 * đóng tab). Màn đăng nhập ĐỌC cờ bằng `peekSessionExpiredNotice()` (thuần, không đổi trạng thái — an toàn khi React chạy hàm khởi tạo hai lần ở chế độ
 * phát triển) rồi XOÁ bằng `clearSessionExpiredNotice()` trong `useEffect`, nên lời nhắn chỉ hiện ở MỘT lần mở màn đăng nhập.
 *
 * Mọi thao tác storage bọc try/catch: trình duyệt chặn dữ liệu trang (chế độ riêng tư/chính sách) không được làm hỏng luồng đăng nhập.
 */
const KEY = 'nexamed.sessionExpiredNotice';

export function markSessionExpiredNotice(): void {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    // Không ghi được thì chỉ mất lời nhắn, không ảnh hưởng đăng nhập.
  }
}

/** `true` nếu có cờ chờ hiện. KHÔNG xoá cờ. */
export function peekSessionExpiredNotice(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function clearSessionExpiredNotice(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Bỏ qua.
  }
}
