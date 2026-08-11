const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;

/**
 * Việt Nam dùng UTC+7 cố định, không có giờ mùa hè — quy đổi bằng cách cộng offset rồi đọc field
 * UTC là đủ chính xác, không cần thư viện timezone. Theo CLAUDE.md: "Quy đổi Asia/Ho_Chi_Minh
 * chỉ ở tầng hiển thị; không dùng `new Date()` phía server để cắt mốc ngày" — mã hiển thị
 * (`patient_code`...) là dữ liệu NGƯỜI DÙNG THẤY nên phải tính đúng năm/tháng theo giờ Việt Nam,
 * không phải UTC (lệch múi giờ có thể sai tháng vào khoảng nửa đêm tới 7h sáng giờ UTC).
 */
function toVietnamYearMonth(utcDate: Date): { year: number; month: number } {
  const shifted = new Date(utcDate.getTime() + VIETNAM_UTC_OFFSET_MINUTES * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/**
 * Định dạng mã hiển thị `<prefix><yyMM><seq6>` (ví dụ `BN2508000123`) — xem .claude/docs/
 * data-model.md mục "Quy ước khác". `seq` do `CodeSequenceRepository` cấp theo tenant (atomic ở
 * tầng DB); hàm này chỉ định dạng chuỗi, thuần không phụ thuộc DB.
 */
export function formatDisplayCode(prefix: string, occurredAtUtc: Date, seq: bigint): string {
  const { year, month } = toVietnamYearMonth(occurredAtUtc);
  const yy = String(year % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const seqStr = seq.toString().padStart(6, '0');
  return `${prefix}${yy}${mm}${seqStr}`;
}
