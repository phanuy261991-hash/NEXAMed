/**
 * "Khoá bảng ca" theo tháng (2026-09-03, ngoài kế hoạch, chuẩn bị nền cho chấm công/tính lương v2)
 * — một tháng `work_shift_assignment` hoặc khoá NGUYÊN VẸN hoặc còn mở HOÀN TOÀN, không khoá một
 * phần trong tháng. Tháng `month` (`YYYY-MM`) bị khoá khi hôm nay (giờ VN, `YYYY-MM-DD`) đã qua
 * mốc "ngày 1 của tháng kế tiếp + `graceDays`". `graceDays=0` = khoá ngay khi sang tháng mới;
 * `graceDays=5` = còn sửa được tới hết ngày 5 tháng sau. So sánh trực tiếp trên chuỗi `YYYY-MM-DD`
 * (cùng kiểu `getVietnamDateString()`), không parse `Date` để so sánh.
 */

/** Ngày 1 của tháng kế tiếp `month`, cộng thêm `graceDays` — mốc mà từ đó `month` bắt đầu bị khoá.
 * Dùng mẹo `Date.UTC(year, monthIndex1Based, 1)` (tháng 1-index của `month` LÀ tháng kế tiếp ở
 * 0-index của `Date.UTC`) — cùng kỹ thuật `monthRange()`/`mapDayToMonth()` ở
 * `apps/api/src/modules/work-shift-assignment/work-shift-assignment.service.ts`. */
export function getMonthUnlockDeadline(month: string, graceDays: number): string {
  const parts = month.split('-').map(Number);
  const year = parts[0] ?? 1970;
  const monthIndex1Based = parts[1] ?? 1;
  const d = new Date(Date.UTC(year, monthIndex1Based, 1));
  d.setUTCDate(d.getUTCDate() + graceDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `today >= mốc khoá` — biên bao gồm (đúng ngày mốc đã tính là NGÀY ĐẦU TIÊN `month` bị khoá). */
export function isMonthLocked(month: string, today: string, graceDays: number): boolean {
  return today >= getMonthUnlockDeadline(month, graceDays);
}
