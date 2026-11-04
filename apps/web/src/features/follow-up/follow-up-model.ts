import type { FollowUpItem, FollowUpReminderResultKind, FollowUpStatusKind, FollowUpTabKind } from '@nexamed/shared';
import { diffDateStrings } from '../encounter/follow-up-date';

/** Logic hiển thị THUẦN của trang Hẹn tái khám — tách khỏi React để test được. Máy chủ đã tính trạng thái và số liệu. */

/** `YYYY-MM-DD` → `DD-MM-YYYY` (kiểu ngày của các danh sách trong app). */
export function formatDmy(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}-${m}-${y}`;
}

/** Dòng đầu của cột "Ngày hẹn": "Hôm nay", "Ngày mai", "Trễ 3 ngày", "Còn 5 ngày". */
export function dueLabel(followUpDate: string, today: string): string {
  const diff = diffDateStrings(today, followUpDate);
  if (diff === null || diff === 0) return diff === 0 ? 'Hôm nay' : '';
  if (diff === 1) return 'Ngày mai';
  return diff < 0 ? `Trễ ${-diff} ngày` : `Còn ${diff} ngày`;
}

/** Màu huy hiệu trạng thái — nền ĐẶC theo token tín hiệu (ui-guidelines 2.1a): Chờ đến hổ phách, Đã đến xanh lá, Quá hạn đỏ, Sắp tới xám. */
export const FOLLOW_UP_STATUS_BADGE: Record<FollowUpStatusKind, string> = {
  DUE_TODAY: 'bg-amber-500 text-white',
  ARRIVED: 'bg-emerald-500 text-white',
  OVERDUE: 'bg-rose-600 text-white',
  UPCOMING: 'bg-slate-300 text-slate-600',
};

/** Hẹn còn có thể nhắc/đặt lịch: chưa quay lại (đã đến thì không cần). */
export function canRemind(item: Pick<FollowUpItem, 'status'>): boolean {
  return item.status !== 'ARRIVED';
}

/** Số điện thoại hiển thị cách nhóm cho dễ đọc ("0912 345 678"); không đúng 10 chữ số thì giữ nguyên. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\s+/g, '');
  return /^\d{10}$/.test(digits) ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : phone;
}

/** Đường dẫn mở trang Lịch hẹn với form Đặt lịch điền sẵn tên, SĐT, bác sĩ của lượt khám gốc và lý do "Tái khám"; ngày mở là ngày hẹn (đã qua thì là hôm nay). */
export function bookingHref(item: Pick<FollowUpItem, 'patientName' | 'phone' | 'doctorId' | 'followUpDate'>, today: string): string {
  const date = item.followUpDate < today ? today : item.followUpDate;
  const params = new URLSearchParams({ date, book: '1', name: item.patientName, phone: item.phone, reason: 'Tái khám' });
  if (item.doctorId) params.set('doctorId', item.doctorId);
  return `/appointments?${params.toString()}`;
}

/**
 * Hằng/nhãn khai riêng cho web (apps/web chỉ import KIỂU từ @nexamed/shared). Khoá kiểu `Record<...>` buộc phải đủ mọi giá trị của enum ở `packages/shared/src/follow-up.ts`,
 * nên thêm giá trị mới ở đó mà quên nhãn ở đây sẽ báo lỗi biên dịch.
 */
export const FOLLOW_UP_REMINDER_NOTE_MAX = 1000;

export const FOLLOW_UP_REMINDER_RESULT_LABEL: Record<FollowUpReminderResultKind, string> = {
  REACHED: 'Liên lạc được, sẽ đến',
  NO_ANSWER: 'Không nghe máy',
  CALL_BACK_LATER: 'Hẹn gọi lại sau',
  NOT_RETURNING: 'Bệnh nhân không tái khám',
};

export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatusKind, string> = {
  DUE_TODAY: 'Chờ đến',
  ARRIVED: 'Đã đến',
  OVERDUE: 'Quá hạn',
  UPCOMING: 'Sắp tới',
};

const FOLLOW_UP_TABS: readonly FollowUpTabKind[] = ['today', 'overdue', 'upcoming', 'all'];

/** Đọc tab từ `?tab=`; giá trị lạ hoặc thiếu thì về "Hôm nay". */
export function parseFollowUpTab(value: string | null): FollowUpTabKind {
  return FOLLOW_UP_TABS.find((t) => t === value) ?? 'today';
}
