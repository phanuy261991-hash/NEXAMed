/**
 * Định dạng ngày/giờ DÙNG CHUNG cho mọi chứng từ in (gộp từ các bản `formatPrintDate` rải rác ở từng PrintView,
 * vốn lệch nhau: có nơi theo giờ trình duyệt, có nơi theo UTC+7). Luôn quy về giờ Việt Nam (UTC+7 cố định, đúng
 * `packages/core/src/date/vietnam-day-range.ts`) — tầng hiển thị, không phụ thuộc múi giờ máy in/máy tính.
 */
function vietnamParts(iso: string) {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: pad(vn.getUTCDate()), month: pad(vn.getUTCMonth() + 1), year: String(vn.getUTCFullYear()), hour: pad(vn.getUTCHours()), minute: pad(vn.getUTCMinutes()) };
}

/** "Ngày 01 tháng 10 năm 2026" — dòng ngày phía trên chữ ký. */
export function formatPrintDate(iso: string): string {
  const p = vietnamParts(iso);
  return `Ngày ${p.day} tháng ${p.month} năm ${p.year}`;
}

/** "14:30 ngày 01 tháng 10 năm 2026" — phiếu cần cả giờ (thu/chi, nạp ví). */
export function formatPrintDateTime(iso: string): string {
  const p = vietnamParts(iso);
  return `${p.hour}:${p.minute} ngày ${p.day} tháng ${p.month} năm ${p.year}`;
}

/** "14:30 01/10" — dòng ngắn trên phiếu cuộn nhỏ. */
export function formatPrintShortDateTime(iso: string): string {
  const p = vietnamParts(iso);
  return `${p.hour}:${p.minute} ${p.day}/${p.month}`;
}
