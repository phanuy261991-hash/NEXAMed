/**
 * "Duyệt đăng ký ca theo tháng" (#225) — nhân viên tự đăng ký ca (scope `personal`) CHỈ cho tháng SAU
 * tháng hiện tại (giờ VN, `YYYY-MM`); tháng hiện tại và đã qua do quản lý xếp. Hàm thuần — bản phản
 * chiếu ở `apps/web` (#073).
 */
export function isMonthOpenForSelfRegistration(month: string, today: string): boolean {
  return month > today.slice(0, 7);
}

/** Cộng `delta` tháng vào `YYYY-MM` (dùng để tính "tháng sau"). */
export function addMonthsToMonthString(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Số phút của một ca "HH:mm"–"HH:mm" (không trừ giờ nghỉ) — cộng dồn ra "số giờ" ở bảng duyệt tháng. */
export function shiftDurationMinutes(startTime: string, endTime: string): number {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return Math.max(0, toMin(endTime) - toMin(startTime));
}
