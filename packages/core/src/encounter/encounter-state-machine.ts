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
  // 2 cạnh dưới thêm ở #085 (huỷ lượt khám + hoàn tiền) — trước đó `IN_CONSULTATION` chỉ có đúng
  // một đường ra là `COMPLETED`, mà "Hoàn tất khám" lại bắt buộc có chẩn đoán chính: bác sĩ đã
  // "Nhận ca"/"Bắt đầu khám" rồi khách bỏ về giữa chừng là NGÕ CỤT thật, không đóng ca được.
  //   → CANCELLED  = khách bỏ về thật (bắt buộc lý do, đóng ca hẳn).
  //   → CHECKED_IN = "Trả về hàng chờ": bác sĩ nhả ca (doctorId về null) khi nhận nhầm ca của
  //     người khác hoặc bận đột xuất — lượt khám quay lại hàng chờ chung cho bác sĩ khác nhận.
  // `CHECKED_IN` là ĐƯỜNG LÙI ĐẦU TIÊN của state machine này. Không vi phạm quy tắc đã chốt ở
  // .claude/docs/clinical-workflow.md (chỉ cấm đường lùi TỪ `COMPLETED` — dữ liệu đã ký/hoàn tất),
  // nhưng vẫn là nới nguyên tắc có chủ đích, đã ghi rõ ở tài liệu đó cùng #085.
  IN_CONSULTATION: ['COMPLETED', 'CANCELLED', 'CHECKED_IN'],
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
