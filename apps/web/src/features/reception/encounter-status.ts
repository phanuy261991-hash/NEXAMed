import type { EncounterStatus } from '@nexamed/shared';

/**
 * Cùng khuôn `APPOINTMENT_STATUS_META.badgeBg/badgeText` (`features/appointment/appointment-
 * status.ts`) — token "Tín hiệu Y tế" ở .claude/docs/ui-guidelines.md mục 2.1, nền ĐẶC + chữ trắng
 * (chốt 2026-09-03, thay kiểu nhạt `bg-*-50/text-*-700` cũ — xem `docs/DECISIONS.md` #105).
 */
export const ENCOUNTER_STATUS_META: Record<EncounterStatus, { label: string; text: string; bg: string }> = {
  SCHEDULED: { label: 'Đã đặt', text: 'text-white', bg: 'bg-blue-600' },
  CHECKED_IN: { label: 'Đã tiếp nhận', text: 'text-white', bg: 'bg-blue-600' },
  IN_CONSULTATION: { label: 'Đang khám', text: 'text-white', bg: 'bg-emerald-500' },
  COMPLETED: { label: 'Đã hoàn tất', text: 'text-slate-600', bg: 'bg-slate-300' },
  CANCELLED: { label: 'Đã huỷ', text: 'text-slate-600', bg: 'bg-slate-300' },
  NO_SHOW: { label: 'Không đến', text: 'text-white', bg: 'bg-amber-500' },
};
