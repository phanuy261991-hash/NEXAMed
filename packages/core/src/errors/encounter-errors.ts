import type { EncounterStatus } from '@nexamed/shared';
import { DomainError } from './domain-error';

/**
 * Chuyển trạng thái `encounter` không hợp lệ theo state machine đã chốt (xem
 * .claude/docs/clinical-workflow.md, `encounter-state-machine.ts`) — ví dụ chuyển thẳng
 * `CHECKED_IN → COMPLETED` bỏ qua `IN_CONSULTATION`, hoặc thao tác trên `encounter` đã
 * `COMPLETED`/`CANCELLED`/`NO_SHOW`. `from`/`to` chỉ để log/debug nội bộ, không lộ ra message
 * client (đúng .claude/docs/coding-standards.md — message không lộ chi tiết nội bộ).
 */
export class EncounterInvalidTransitionError extends DomainError {
  readonly code = 'ENCOUNTER_INVALID_TRANSITION';

  constructor(
    public readonly from: EncounterStatus,
    public readonly to: EncounterStatus,
  ) {
    super('Lượt khám không ở trạng thái có thể chuyển đổi này.');
  }
}

/**
 * Double check-in race: hai request check-in cùng một `appointment` gần như đồng thời — bắt từ
 * P2002 trên partial unique index `encounter_tenant_id_appointment_id_key` (xem migration). Cùng
 * tinh thần với `AppointmentSlotConflictError` (chặn ở DB, không phải read-then-write).
 */
export class EncounterAlreadyExistsError extends DomainError {
  readonly code = 'ENCOUNTER_ALREADY_EXISTS';

  constructor() {
    super('Lịch hẹn này đã được tiếp nhận (tạo lượt khám) trước đó.');
  }
}

/** Nhập sinh hiệu (REC-02) khi lượt khám không còn ở trạng thái `CHECKED_IN`. */
export class EncounterNotCheckedInError extends DomainError {
  readonly code = 'ENCOUNTER_NOT_CHECKED_IN';

  constructor() {
    super('Chỉ nhập được sinh hiệu khi lượt khám đang ở trạng thái đã tiếp nhận.');
  }
}
