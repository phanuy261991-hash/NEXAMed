import type { AppointmentSource, AppointmentStatus } from '@nexamed/shared';

/**
 * Màu theo trạng thái — đúng token "Tín hiệu Y tế" ở .claude/docs/ui-guidelines.md mục 2.1
 * (emerald=thành công, amber=lưu ý, slate=vô hiệu). SCHEDULED dùng brand blue (đang hoạt động,
 * chưa phải tín hiệu y tế). `bg`/`text` NHẠT — dùng làm NỀN TOÀN Ô thẻ lịch hẹn trên lưới
 * (`AppointmentGridView.tsx`, chữ tối `text-slate-900` đè lên phải đọc được, không phải badge nhỏ)
 * — KHÔNG đổi sang đặc. `badgeBg`/`badgeText` ĐẶC (chốt 2026-09-03, `docs/DECISIONS.md` #105) —
 * dùng cho badge "Trạng thái" nhỏ ở `AppointmentDetailPanel.tsx`/`AppointmentListView.tsx`.
 * `border`/`accent` (vạch màu đầu dòng) đã đặc sẵn từ trước, không đổi.
 */
export const APPOINTMENT_STATUS_META: Record<
  AppointmentStatus,
  { label: string; text: string; bg: string; badgeText: string; badgeBg: string; border: string; accent: string }
> = {
  SCHEDULED: {
    label: 'Đã đặt',
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    badgeText: 'text-white',
    badgeBg: 'bg-blue-600',
    border: 'border-blue-600',
    accent: 'bg-blue-600',
  },
  CONVERTED: {
    label: 'Đã chuyển khám',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    badgeText: 'text-white',
    badgeBg: 'bg-emerald-500',
    border: 'border-emerald-500',
    accent: 'bg-emerald-500',
  },
  NO_SHOW: {
    label: 'Không đến',
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    badgeText: 'text-white',
    badgeBg: 'bg-amber-500',
    border: 'border-amber-500',
    accent: 'bg-amber-500',
  },
  CANCELLED: {
    label: 'Đã huỷ',
    text: 'text-slate-500',
    bg: 'bg-slate-100',
    badgeText: 'text-slate-600',
    badgeBg: 'bg-slate-300',
    border: 'border-slate-300',
    accent: 'bg-slate-300',
  },
  // Lịch cũ sau khi dời sang lịch mới (2026-08-18) — cùng tông "vô hiệu" với CANCELLED (mục 2.1
  // ui-guidelines.md), chỉ khác nhãn để phân biệt lý do kết thúc.
  RESCHEDULED: {
    label: 'Đã dời lịch',
    text: 'text-slate-500',
    bg: 'bg-slate-100',
    badgeText: 'text-slate-600',
    badgeBg: 'bg-slate-300',
    border: 'border-slate-300',
    accent: 'bg-slate-300',
  },
};

export const APPOINTMENT_SOURCE_LABEL: Record<AppointmentSource, string> = {
  phone: 'Điện thoại',
  online: 'Online',
  walk_in: 'Walk-in',
};

/** Ngưỡng cảnh báo spam theo SĐT — 5 lần huỷ trở lên (docs/DECISIONS.md #032, đã chốt với chủ dự
 * án). Chỉ hiện banner cảnh báo, không chặn đặt lịch. Đặt ở đây (không phải `packages/shared`) vì
 * `apps/api` không tự so sánh/chặn theo ngưỡng này — chỉ trả `cancelledCount` thô, việc so sánh là
 * quyết định hiển thị thuần phía web. */
export const APPOINTMENT_SPAM_CANCELLED_THRESHOLD = 5;

/**
 * Ngưỡng cảnh báo trễ hẹn — chỉ gợi ý thị giác phía web, KHÔNG tự đổi status. `thresholdMinutes`
 * (S5-07, APP-05) truyền từ `ClinicSettings.noShowThresholdMinutes` thật (`DEFAULT_NO_SHOW_
 * THRESHOLD_MINUTES` làm fallback lúc chưa tải xong) — trước đây hardcode 60 phút cục bộ, nay
 * đồng bộ với đúng ngưỡng cấu hình được ở pill "Lịch hẹn", tránh lệch giữa cảnh báo thị giác và
 * ngưỡng job nền tự động đánh dấu thật sự dùng.
 */
export function isAppointmentLate(status: AppointmentStatus, scheduledAt: string, thresholdMinutes: number): boolean {
  if (status !== 'SCHEDULED') return false;
  const diffMinutes = (Date.now() - new Date(scheduledAt).getTime()) / 60_000;
  return diffMinutes > thresholdMinutes;
}

export type NoShowCountdownTier = 'warn15' | 'warn10' | 'warn5';

const COUNTDOWN_TIER_META: Record<NoShowCountdownTier, { label: string; text: string; bg: string; border: string }> = {
  warn15: { label: 'Còn ≤15 phút', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300' },
  warn10: { label: 'Còn ≤10 phút', text: 'text-amber-800', bg: 'bg-amber-100', border: 'border-amber-400' },
  warn5: { label: 'Còn ≤5 phút', text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-400' },
};

/**
 * Cảnh báo đếm ngược TRƯỚC khi job nền tự động chuyển "Không đến" (S5-07, chủ dự án yêu cầu trực
 * tiếp) — chỉ có ý nghĩa khi tenant đã BẬT `noShowAutoEnabled` (tắt thì không có gì "sắp tự động"
 * để cảnh báo). 3 mức theo số phút CÒN LẠI tới ngưỡng (`thresholdMinutes - phút đã trôi qua`):
 * ≤15 → ≤10 → ≤5. Sau khi ĐÃ quá ngưỡng (còn lại ≤0) thuộc trạng thái "trễ hẹn" của
 * `isAppointmentLate()`, không phải đếm ngược nữa — 2 hàm không chồng lấn khoảng thời gian.
 */
export function getNoShowCountdownTier(
  status: AppointmentStatus,
  scheduledAt: string,
  thresholdMinutes: number,
  autoEnabled: boolean,
): NoShowCountdownTier | null {
  if (!autoEnabled || status !== 'SCHEDULED') return null;
  const elapsedMinutes = (Date.now() - new Date(scheduledAt).getTime()) / 60_000;
  const remainingMinutes = thresholdMinutes - elapsedMinutes;
  if (remainingMinutes <= 0) return null;
  if (remainingMinutes <= 5) return 'warn5';
  if (remainingMinutes <= 10) return 'warn10';
  if (remainingMinutes <= 15) return 'warn15';
  return null;
}

export function noShowCountdownTierMeta(tier: NoShowCountdownTier) {
  return COUNTDOWN_TIER_META[tier];
}
