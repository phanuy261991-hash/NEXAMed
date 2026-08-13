import type { EncounterStatus } from '@nexamed/shared';
import { EncounterInvalidTransitionError } from '../errors/encounter-errors';

/**
 * State machine của `encounter` — nguồn sự thật duy nhất cho cạnh chuyển trạng thái hợp lệ, xem
 * .claude/docs/clinical-workflow.md mục "State machine của encounter". Cùng phong cách bảng
 * tra cứu thuần như `rbac/data-scope.ts` (SCOPE_RANK).
 *
 * v1 chỉ tạo dòng `encounter` thẳng ở `CHECKED_IN` qua `ReceptionService.checkIn()` (không đi qua
 * `SCHEDULED`) — bảng dưới đây vẫn đủ 6 trạng thái theo đúng thiết kế đã chốt, `SCHEDULED`/
 * `NO_SHOW` hiện là cạnh chưa có luồng nào ghi tới, không phải state machine sai.
 */
const ENCOUNTER_TRANSITIONS: Record<EncounterStatus, readonly EncounterStatus[]> = {
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_CONSULTATION', 'CANCELLED'],
  IN_CONSULTATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransitionEncounter(from: EncounterStatus, to: EncounterStatus): boolean {
  return ENCOUNTER_TRANSITIONS[from].includes(to);
}

/** Ném `EncounterInvalidTransitionError` nếu cạnh không hợp lệ — dùng ở service trước mọi UPDATE trạng thái. */
export function assertEncounterTransition(from: EncounterStatus, to: EncounterStatus): void {
  if (!canTransitionEncounter(from, to)) {
    throw new EncounterInvalidTransitionError(from, to);
  }
}
