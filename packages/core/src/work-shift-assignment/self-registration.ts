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

/** Cộng `delta` ngày vào `YYYY-MM-DD` (UTC thuần, không phụ thuộc múi giờ máy). */
function addDaysToDateString(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Quota "nghỉ tối thiểu N ngày/tuần" (09/10/2026) — trả các tuần (Thứ Hai–Chủ nhật, TRỌN trong `month`) có ít ngày
 * nghỉ hơn `minDaysOff`. Ngày không có ca = ngày nghỉ; tuần bị cắt ở đầu/cuối tháng bỏ qua (không đủ 7 ngày để
 * kiểm). `minDaysOff <= 0` → luôn rỗng. Hàm thuần, `workDates` là các ngày `YYYY-MM-DD` có ca (trùng ngày không
 * tính 2 lần).
 */
export function findWeeksBelowMinDaysOff(
  month: string,
  workDates: string[],
  minDaysOff: number,
): Array<{ weekStart: string; weekEnd: string; daysOff: number }> {
  if (minDaysOff <= 0) return [];
  const worked = new Set(workDates);
  const result: Array<{ weekStart: string; weekEnd: string; daysOff: number }> = [];
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year ?? 1970, m ?? 1, 0)).getUTCDate();
  const first = `${month}-01`;
  // Thứ Hai đầu tiên trong tháng (getUTCDay: 0 = Chủ nhật).
  const dow = new Date(`${first}T00:00:00.000Z`).getUTCDay();
  let weekStart = addDaysToDateString(first, dow === 1 ? 0 : (8 - dow) % 7);
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
  while (addDaysToDateString(weekStart, 6) <= monthEnd) {
    let daysOff = 0;
    for (let i = 0; i < 7; i++) {
      if (!worked.has(addDaysToDateString(weekStart, i))) daysOff += 1;
    }
    if (daysOff < minDaysOff) result.push({ weekStart, weekEnd: addDaysToDateString(weekStart, 6), daysOff });
    weekStart = addDaysToDateString(weekStart, 7);
  }
  return result;
}
