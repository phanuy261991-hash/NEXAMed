/**
 * Định dạng ngày `YYYY-MM-DD` (giá trị lưu/API, chuẩn ISO) sang `DD/MM/YYYY` để HIỂN THỊ — dùng ở
 * mọi nơi đọc `patient.dob` dạng chỉ-xem (danh sách, dropdown gợi ý, xem chi tiết). Chỉ đổi cách
 * HIỂN THỊ, không đổi giá trị lưu trữ/gửi API (vẫn `YYYY-MM-DD` theo chuẩn ISO).
 *
 * KHÔNG áp dụng được cho `<input type="date">` — trình duyệt tự hiển thị theo locale hệ điều
 * hành, không có cách ép định dạng hiển thị bằng CSS/JS thuần cho ô nhập ngày gốc. Nơi cần ô nhập
 * hiển thị đúng `DD/MM/YYYY` phải thay bằng ô nhập dạng text có mặt nạ riêng (chưa xây ở v1).
 */
export function formatDobDisplay(dob: string): string {
  const [year, month, day] = dob.split('-');
  if (!year || !month || !day) return dob;
  return `${day}/${month}/${year}`;
}