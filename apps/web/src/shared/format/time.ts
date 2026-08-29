/** "HH:mm" giờ Việt Nam — dùng cho chip/badge trạng thái "Tạm nghỉ / Đóng ca" (TopBar, board điều
 * phối lễ tân) — dùng chung ở ≥2 nơi nên trích xuất thay vì lặp lại `toLocaleTimeString` từng chỗ. */
export function formatClockTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
}
