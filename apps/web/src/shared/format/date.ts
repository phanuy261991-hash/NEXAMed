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

/**
 * `today` còn nằm trong khoảng `[from, to]` không — 3 tham số đều `YYYY-MM-DD` (ngày lịch thuần,
 * so sánh chuỗi ISO đúng thứ tự thời gian, không cần parse `Date`). `to` trống = vô thời hạn.
 * Dùng cho "Đơn giá dịch vụ" (`exam_type_price`, `docs/DECISIONS.md` #079/#080) — lọc dòng giá còn
 * hiệu lực hôm nay khi cascade Loại khám → Loại giá dịch vụ ở Tiếp nhận.
 */
export function isDateRangeActiveToday(from: string, to: string | undefined, today: string): boolean {
  return from <= today && (to === undefined || to >= today);
}