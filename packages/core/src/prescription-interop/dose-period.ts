/**
 * Gợi ý tự điền "Đợt dùng thuốc" của đơn N/H/Y (docs/DECISIONS.md #242 GĐ3, mockup 8b): đợt 1, từ ngày = ngày kê, đến ngày = ngày kê + số ngày thuốc dài nhất của đơn − 1.
 * Hàm thuần theo ngày lịch `YYYY-MM-DD` (nơi gọi đã đổi sang giờ Việt Nam), không đọc đồng hồ.
 */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const ms = Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10)) + days * 86_400_000;
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function suggestInteropDosePeriod(prescribedDate: string, longestDurationDays: number): { number: number; from: string; to: string } {
  const days = Math.max(1, Math.floor(longestDurationDays));
  return { number: 1, from: prescribedDate, to: addDaysToIsoDate(prescribedDate, days - 1) };
}
