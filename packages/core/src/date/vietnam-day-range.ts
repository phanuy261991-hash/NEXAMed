const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;

/**
 * Việt Nam dùng UTC+7 cố định, không có giờ mùa hè — cùng kỹ thuật cộng offset rồi đọc field UTC
 * như `toVietnamYearMonth()` trong `packages/core/src/code-sequence/format-display-code.ts`.
 * Theo CLAUDE.md: "không dùng `new Date()` phía server để cắt mốc ngày" — lọc lịch hẹn "trong
 * ngày X" phải cắt đúng ranh giới ngày theo giờ Việt Nam, không phải UTC (lệch múi giờ có thể lấy
 * nhầm/thiếu lịch hẹn quanh khung nửa đêm tới 7h sáng UTC).
 *
 * `dateStr` dạng `YYYY-MM-DD` (ngày theo lịch Việt Nam). Trả về mốc UTC bắt đầu (00:00 giờ VN,
 * bao gồm) và kết thúc (00:00 ngày kế tiếp giờ VN, không bao gồm) — dùng cho điều kiện
 * `scheduledAt >= startUtc AND scheduledAt < endUtc`.
 */
export function vietnamDayRange(dateStr: string): { startUtc: Date; endUtc: Date } {
  const parts = dateStr.split('-').map(Number);
  const year = parts[0] ?? NaN;
  const month = parts[1] ?? NaN;
  const day = parts[2] ?? NaN;
  // Mốc 00:00 giờ VN của ngày `dateStr` = 00:00 - 7h = 17:00 UTC ngày hôm trước, biểu diễn bằng
  // cách dựng mốc UTC theo (y,m,d,0,0) rồi cộng thêm offset để bù lại — tương đương trừ offset khi
  // đổi từ giờ VN sang UTC.
  const startUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - VIETNAM_UTC_OFFSET_MINUTES * 60_000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60_000);
  return { startUtc, endUtc };
}
