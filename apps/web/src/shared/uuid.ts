/**
 * UUID v4 cho giao diện — HÀM DUY NHẤT được dùng để sinh UUID ở `apps/web` (ESLint chặn gọi thẳng `crypto.randomUUID`, xem `eslint.config.js`).
 *
 * Vì sao: `crypto.randomUUID` của trình duyệt CHỈ có ở ngữ cảnh bảo mật (HTTPS hoặc localhost). Bản cài tại phòng khám chạy HTTP thường trong mạng LAN, máy trạm mở
 * `http://192.168.x.x` là ngữ cảnh KHÔNG bảo mật → `crypto.randomUUID is not a function` (đã tái hiện bằng Chrome thật 23/10/2026, docs/DECISIONS.md #257: chọn thuốc ở
 * "Đơn thuốc mẫu"/Kê đơn/Phát thuốc làm hỏng màn hình). `crypto.getRandomValues` thì dùng được ở mọi ngữ cảnh nên là đường dự phòng.
 */
export function generateUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
