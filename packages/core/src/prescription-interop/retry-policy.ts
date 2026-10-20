/**
 * Chính sách thử lại khi gửi đơn lên cổng Đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3, mockup 8c). Hàm thuần: không đọc đồng hồ, nơi gọi truyền `now`.
 *
 * - Lỗi DỮ LIỆU (cổng trả 422/4xx = `rejected`): dừng ngay, KHÔNG tự thử lại — thử lại cùng dữ liệu sẽ cùng kết quả; người dùng bổ sung rồi bấm "Gửi lại".
 * - Lỗi MẠNG / cổng quá tải (`unreachable`): thử lại giãn dần 1 → 5 → 15 → 60 phút (các lần sau giữ 60 phút) tới `maxRetries`, hết lần thì dừng ở trạng thái lỗi.
 */
export const INTEROP_RETRY_DELAYS_MINUTES: readonly number[] = [1, 5, 15, 60];

/** Khoảng chờ trước lần thử kế tiếp, sau `attempts` lần đã thử (>= 1). */
export function interopRetryDelayMinutes(attempts: number): number {
  const index = Math.max(0, Math.min(attempts - 1, INTEROP_RETRY_DELAYS_MINUTES.length - 1));
  return INTEROP_RETRY_DELAYS_MINUTES[index]!;
}

export type InteropAttemptDecision =
  /** Gửi xong. */
  | { next: 'SENT' }
  /** Lỗi dữ liệu hoặc hết số lần thử — dừng, chờ người dùng "Gửi lại". */
  | { next: 'FAILED' }
  /** Thử lại lúc `at`. */
  | { next: 'RETRY'; at: Date };

/**
 * Quyết định bước kế tiếp sau một lần gọi cổng. `attemptsAfter` = số lần đã thử TÍNH CẢ lần vừa rồi. `maxRetries` = số lần thử tối đa (0 = chỉ thử một lần).
 */
export function decideAfterAttempt(
  result: 'ok' | 'rejected' | 'unreachable',
  attemptsAfter: number,
  maxRetries: number,
  now: Date,
): InteropAttemptDecision {
  if (result === 'ok') return { next: 'SENT' };
  if (result === 'rejected') return { next: 'FAILED' };
  if (attemptsAfter >= Math.max(1, maxRetries)) return { next: 'FAILED' };
  return { next: 'RETRY', at: new Date(now.getTime() + interopRetryDelayMinutes(attemptsAfter) * 60_000) };
}

/** Dòng chưa đủ dữ liệu hoặc thiếu cấu hình thì hẹn xem lại sau khoảng này (không tính là một lần thử). */
export const INTEROP_NOT_READY_RECHECK_MINUTES = 30;

/** "Thuê" ngắn khi một tiến trình đang gửi — tiến trình khác bỏ qua dòng này; tự hết hạn nếu máy chủ sập giữa chừng. */
export const INTEROP_SEND_LEASE_MINUTES = 5;
