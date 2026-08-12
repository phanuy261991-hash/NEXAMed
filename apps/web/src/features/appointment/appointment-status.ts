import type { AppointmentSource, AppointmentStatus } from '@nexamed/shared';

/** Màu theo trạng thái — đúng token "Tín hiệu Y tế" ở .claude/docs/ui-guidelines.md mục 2.1 (emerald=thành công, amber=lưu ý, slate=vô hiệu). SCHEDULED dùng brand blue (đang hoạt động, chưa phải tín hiệu y tế). */
export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, { label: string; text: string; bg: string; border: string; accent: string }> = {
  SCHEDULED: { label: 'Đã đặt', text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-600', accent: 'bg-blue-600' },
  CONVERTED: { label: 'Đã chuyển khám', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-500', accent: 'bg-emerald-500' },
  NO_SHOW: { label: 'Không đến', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-500', accent: 'bg-amber-500' },
  CANCELLED: { label: 'Đã huỷ', text: 'text-slate-500', bg: 'bg-slate-100', border: 'border-slate-300', accent: 'bg-slate-300' },
};

export const APPOINTMENT_SOURCE_LABEL: Record<AppointmentSource, string> = {
  phone: 'Điện thoại',
  online: 'Online',
  walk_in: 'Walk-in',
};

/** Ngưỡng cảnh báo trễ hẹn — chỉ gợi ý thị giác phía web, KHÔNG tự đổi status (đã chốt với chủ dự
 * án: NO_SHOW tự động qua job nền vẫn thuộc APP-05/Sprint 5, xem docs/DECISIONS.md). Dùng lại đúng
 * ngưỡng mặc định no-show đã ghi ở .claude/docs/clinical-workflow.md (60 phút), không bịa ngưỡng
 * thứ hai. */
export const LATE_APPOINTMENT_THRESHOLD_MINUTES = 60;

/** Ngưỡng cảnh báo spam theo SĐT — 5 lần huỷ trở lên (docs/DECISIONS.md #032, đã chốt với chủ dự
 * án). Chỉ hiện banner cảnh báo, không chặn đặt lịch. Đặt ở đây (không phải `packages/shared`) vì
 * `apps/api` không tự so sánh/chặn theo ngưỡng này — chỉ trả `cancelledCount` thô, việc so sánh là
 * quyết định hiển thị thuần phía web, cùng khuôn `LATE_APPOINTMENT_THRESHOLD_MINUTES` ở trên. */
export const APPOINTMENT_SPAM_CANCELLED_THRESHOLD = 5;

export function isAppointmentLate(status: AppointmentStatus, scheduledAt: string): boolean {
  if (status !== 'SCHEDULED') return false;
  const diffMinutes = (Date.now() - new Date(scheduledAt).getTime()) / 60_000;
  return diffMinutes > LATE_APPOINTMENT_THRESHOLD_MINUTES;
}
