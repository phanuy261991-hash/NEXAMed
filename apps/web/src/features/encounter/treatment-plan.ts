import type { TreatmentDirection, TreatmentPlanValue } from '@nexamed/shared';
import { resolveFollowUpFromDate } from './follow-up-date';

/**
 * Hướng điều trị + ngày hẹn tái khám đang soạn ở màn khám (docs/DECISIONS.md #222). Nhãn khai lại ở đây (không import GIÁ TRỊ `TREATMENT_DIRECTION_LABELS` từ `@nexamed/shared`, #073).
 * `followUpDate` là `YYYY-MM-DD` hoặc `null` (chưa chọn/đang gõ dở); có hướng "Hẹn tái khám" thì bắt buộc có ngày hợp lệ.
 */
export interface TreatmentPlanDraft {
  directions: TreatmentDirection[];
  followUpDate: string | null;
}

export const EMPTY_TREATMENT_PLAN: TreatmentPlanDraft = { directions: [], followUpDate: null };

/** Thứ tự hiển thị 4 hướng điều trị (đúng thứ tự mockup đã duyệt). */
export const TREATMENT_DIRECTION_ORDER: readonly TreatmentDirection[] = ['PRESCRIPTION', 'TRANSFER', 'FOLLOW_UP', 'EMERGENCY'];

export const TREATMENT_DIRECTION_LABEL: Record<TreatmentDirection, string> = {
  PRESCRIPTION: 'Kê đơn thuốc',
  TRANSFER: 'Chuyển viện',
  FOLLOW_UP: 'Hẹn tái khám',
  EMERGENCY: 'Cấp cứu',
};

export function treatmentPlanFromServer(value: TreatmentPlanValue | null | undefined): TreatmentPlanDraft {
  return value ? { directions: [...value.directions], followUpDate: value.followUpDate } : { ...EMPTY_TREATMENT_PLAN, directions: [] };
}

/** Lý do không lưu được (hoặc `null` nếu hợp lệ) — chỉ nói đến ngày hẹn vì hướng điều trị tự do tích. */
export function treatmentPlanError(plan: TreatmentPlanDraft, examDate: string): string | null {
  if (!plan.directions.includes('FOLLOW_UP')) return null;
  if (plan.followUpDate === null) return 'Chọn ngày hẹn tái khám hoặc nhập số ngày.';
  const resolved = resolveFollowUpFromDate(examDate, plan.followUpDate);
  return resolved.ok ? null : resolved.message;
}

/** Gửi lên server: bỏ tích "Hẹn tái khám" thì KHÔNG gửi ngày (khớp CHECK ở DB). */
export function toTreatmentPlanPayload(plan: TreatmentPlanDraft, version: number | undefined) {
  const followUp = plan.directions.includes('FOLLOW_UP');
  return { directions: plan.directions, followUpDate: followUp ? plan.followUpDate : null, ...(version !== undefined ? { version } : {}) };
}

export function sameTreatmentPlan(a: TreatmentPlanDraft, b: TreatmentPlanDraft): boolean {
  const aFollow = a.directions.includes('FOLLOW_UP') ? a.followUpDate : null;
  const bFollow = b.directions.includes('FOLLOW_UP') ? b.followUpDate : null;
  return a.directions.length === b.directions.length && a.directions.every((d) => b.directions.includes(d)) && aFollow === bFollow;
}
