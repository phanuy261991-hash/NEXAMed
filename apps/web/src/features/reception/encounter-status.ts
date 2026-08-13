import type { EncounterStatus } from '@nexamed/shared';

/** Cùng khuôn `APPOINTMENT_STATUS_META` (`features/appointment/appointment-status.ts`) — token "Tín hiệu Y tế" ở .claude/docs/ui-guidelines.md mục 2.1. */
export const ENCOUNTER_STATUS_META: Record<EncounterStatus, { label: string; text: string; bg: string }> = {
  SCHEDULED: { label: 'Đã đặt', text: 'text-blue-700', bg: 'bg-blue-50' },
  CHECKED_IN: { label: 'Đã tiếp nhận', text: 'text-blue-700', bg: 'bg-blue-50' },
  IN_CONSULTATION: { label: 'Đang khám', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  COMPLETED: { label: 'Đã hoàn tất', text: 'text-slate-500', bg: 'bg-slate-100' },
  CANCELLED: { label: 'Đã huỷ', text: 'text-slate-500', bg: 'bg-slate-100' },
  NO_SHOW: { label: 'Không đến', text: 'text-amber-700', bg: 'bg-amber-50' },
};
