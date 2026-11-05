/**
 * Phần THUẦN của trang báo cáo "Bác sĩ" (docs/DECISIONS.md #287): định dạng số, thời lượng, đường dẫn "Xem". Không gọi API, không biết gì về giao diện — để test được và dùng chung cho màn hình và bản in.
 */

/** "13 phút" / "2 giờ 05 phút" / "—" (chưa có số). */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} giờ` : `${h} giờ ${String(m).padStart(2, '0')} phút`;
}

/** Số giờ làm tròn một chữ số thập phân cho dải KPI ("11,5 giờ"). */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours.toLocaleString('vi-VN')} giờ`;
}

/** Số thập phân một chữ số kiểu Việt ("1,5"); `null` → "—". */
export function formatDecimal(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
}

/** Phần trăm làm tròn nguyên cho bảng gọn như mockup ("47%"); `null` → "—". */
export function formatWholePercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

/** Chú thích khung bảng: "Bác sĩ, tháng 10/2026" khi kỳ là đúng một tháng; còn lại "Bác sĩ, 01/10/2026 – 15/10/2026". */
export function doctorCardTitle(caption: string): string {
  return `Bác sĩ, ${caption.replace(/^Tháng/, 'tháng')}`;
}

/** Đường dẫn "Xem" của một bác sĩ: mở Sổ khám bệnh đã lọc đúng bác sĩ và kỳ đang xem. */
export function doctorVisitBookLink(doctorId: string, from: string, to: string): string {
  return `/reports/operations?${new URLSearchParams({ doctorId, from, to }).toString()}`;
}

/** Màu chữ của tỉ lệ sử dụng giờ ca: dưới 30% hổ phách (ca bỏ trống nhiều), từ 85% xanh lục, còn lại thường; `null` xám. */
export function utilizationToneClass(value: number | null): string {
  if (value === null) return 'text-slate-600';
  if (value >= 85) return 'font-semibold text-emerald-700';
  if (value < 30) return 'text-amber-700';
  return 'text-slate-800';
}
