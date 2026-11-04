/**
 * Quy tắc trạng thái HẸN TÁI KHÁM (docs/DECISIONS.md #285) — một nơi duy nhất cho trang "Hẹn tái khám" và các số tổng hợp ở Tổng quan, để hai nơi không lệch nhau.
 * Ngày là `YYYY-MM-DD` theo lịch Việt Nam. "Đã quay lại" = bệnh nhân có lượt khám đã tiếp nhận SAU lượt khám gốc (tính ở truy vấn).
 */

/** "Quá hạn chưa đến" chỉ tính trong chừng này ngày gần nhất (hẹn quá cũ coi như đã bỏ); tab "Tất cả" vẫn xem được xa hơn. */
export const FOLLOW_UP_OVERDUE_DAYS = 30;
/** Tab "Sắp tới": hẹn trong chừng này ngày tới (không gồm hôm nay). */
export const FOLLOW_UP_UPCOMING_DAYS = 7;

export type FollowUpStatus = 'DUE_TODAY' | 'ARRIVED' | 'OVERDUE' | 'UPCOMING';
export type FollowUpTab = 'today' | 'overdue' | 'upcoming' | 'all';

/** Đã quay lại → `ARRIVED`; chưa quay lại thì theo ngày hẹn: hôm nay `DUE_TODAY`, đã qua `OVERDUE`, chưa tới `UPCOMING`. */
export function classifyFollowUp(followUpDate: string, today: string, returned: boolean): FollowUpStatus {
  if (returned) return 'ARRIVED';
  if (followUpDate === today) return 'DUE_TODAY';
  return followUpDate < today ? 'OVERDUE' : 'UPCOMING';
}

/**
 * Hẹn thuộc tab nào. `today`: hẹn hôm nay (cả đã đến); `overdue`: quá hạn trong `FOLLOW_UP_OVERDUE_DAYS` ngày qua mà chưa quay lại; `upcoming`: trong `FOLLOW_UP_UPCOMING_DAYS` ngày tới mà chưa
 * quay lại; `all`: mọi hẹn. Chuỗi ngày `YYYY-MM-DD` so sánh được theo thứ tự chữ. Bản máy chủ dùng cùng quy tắc bằng SQL (có test đối chiếu).
 */
export function followUpInTab(tab: FollowUpTab, followUpDate: string, today: string, returned: boolean, overdueFrom: string, upcomingTo: string): boolean {
  switch (tab) {
    case 'today':
      return followUpDate === today;
    case 'overdue':
      return !returned && followUpDate < today && followUpDate >= overdueFrom;
    case 'upcoming':
      return !returned && followUpDate > today && followUpDate <= upcomingTo;
    case 'all':
      return true;
  }
}
