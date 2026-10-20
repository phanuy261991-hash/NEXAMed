import type { InteropSubmissionInput } from '../prescription-interop/submission';

/**
 * Nguồn dữ liệu để gửi đơn thuốc lên cổng Đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3, mockup 8c). Module liên thông (`prescription-interop`) sở hữu hàng chờ gửi nhưng KHÔNG import module
 * lượt khám/bệnh nhân (.claude/docs/architecture.md) — nó hỏi dữ liệu qua port này; adapter thật (`apps/api/src/infrastructure/prescription-interop/`) gom từ lượt khám, đơn thuốc, bệnh nhân,
 * chẩn đoán, hẹn tái khám và các ô bổ sung 8b.
 *
 * Dữ liệu dựng lại MỖI LẦN gửi từ trạng thái hiện tại (không lưu bản sao gói), vì các ô 8b và hồ sơ bệnh nhân còn sửa được tới lúc đơn được gửi.
 */
export interface InteropEncounterSnapshot {
  /** Chi nhánh của lượt khám — nơi đặt hàng chờ và token cơ sở. */
  branchId: string;
  /** Bác sĩ KÝ đơn (gửi bằng danh tính bác sĩ này). */
  doctorUserId: string | null;
  doctorName: string | null;
  /** Một phần tử cho mỗi đơn pháp lý (loại C/N/H/Y) đang hiệu lực của lượt khám. */
  inputs: InteropSubmissionInput[];
}

export interface InteropSubmissionSourcePort {
  /** `null` khi lượt khám không còn / chưa có đơn pháp lý. */
  loadForEncounter(tenantId: string, encounterId: string): Promise<InteropEncounterSnapshot | null>;
}

export const INTEROP_SUBMISSION_SOURCE_PORT = Symbol('INTEROP_SUBMISSION_SOURCE_PORT');
