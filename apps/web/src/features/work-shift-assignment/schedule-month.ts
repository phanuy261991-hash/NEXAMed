/**
 * BẢN PHẢN CHIẾU của `packages/core/src/work-shift-assignment/self-registration.ts` ("Duyệt đăng ký ca theo
 * tháng", #225) — `apps/web` không import GIÁ TRỊ từ `@nexamed/core` (#073). Test `schedule-month.spec.ts` chạy
 * lại đúng các ca của bản core.
 */
export function isMonthOpenForSelfRegistration(month: string, today: string): boolean {
  return month > today.slice(0, 7);
}

export type MonthSubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED';
export type MonthBannerKind = 'APPROVED' | 'SUBMITTED' | 'RETURNED' | 'DRAFT_OPEN' | null;

/**
 * Nhãn trạng thái + loại banner của bảng tháng ở "Lịch làm việc của tôi" (#225). Nhãn "Bị trả lại" hiện mọi lúc khi
 * Nháp còn `returnReason`, nhưng banner Nháp/Bị trả lại chỉ hiện khi tháng còn mở đăng ký (tháng đã qua thì không).
 */
export function resolveMonthBanner(
  status: MonthSubmissionStatus,
  returnReason: string | null | undefined,
  monthOpen: boolean,
): { label: 'Đã duyệt' | 'Chờ duyệt' | 'Bị trả lại' | 'Nháp'; tone: 'emerald' | 'amber' | 'rose' | 'slate'; banner: MonthBannerKind } {
  if (status === 'APPROVED') return { label: 'Đã duyệt', tone: 'emerald', banner: 'APPROVED' };
  if (status === 'SUBMITTED') return { label: 'Chờ duyệt', tone: 'amber', banner: 'SUBMITTED' };
  if (returnReason) return { label: 'Bị trả lại', tone: 'rose', banner: monthOpen ? 'RETURNED' : null };
  return { label: 'Nháp', tone: 'slate', banner: monthOpen ? 'DRAFT_OPEN' : null };
}

export function addMonthsToMonthString(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `Tháng ${Number(m)}/${year}`;
}

/** 7140 phút → "119" giờ (làm tròn 1 chữ số thập phân, bỏ ".0" nếu tròn). */
export function formatMinutesAsHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

const WEEKDAY_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** "Thứ Ba 17/11" từ `YYYY-MM-DD`. */
export function formatWeekdayDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${WEEKDAY_LONG[new Date(`${dateStr}T00:00:00.000Z`).getUTCDay()]} ${d}/${m}`;
}
