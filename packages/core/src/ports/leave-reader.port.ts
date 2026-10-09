/**
 * Đọc "Đơn xin nghỉ" (#224, module `leave-request`) cho module `appointment` — chặn đặt/sửa/dời
 * lịch vào khung nghỉ đã duyệt, đánh dấu lịch "Cần xử lý", vẽ vùng nghỉ trên lưới + thẻ bác sĩ ở
 * Tiếp nhận. Qua port (không import chéo module, .claude/docs/coding-standards.md); adapter tự mở
 * transaction riêng nên caller phải gọi NGOÀI transaction đang mở (cùng khuôn
 * `WorkShiftAssignmentReaderPort`).
 */
export type LeaveWindowStatus = 'PENDING' | 'APPROVED';

export interface LeaveWindowRecord {
  leaveRequestId: string;
  userId: string;
  /** Ngày nghỉ theo lịch VN, `YYYY-MM-DD`. */
  date: string;
  status: LeaveWindowStatus;
  /** Phút kể từ 00:00 giờ VN, khoảng nửa mở `[startMinute, endMinute)`. */
  startMinute: number;
  endMinute: number;
  isWholeDay: boolean;
  /** Tên ca khi nghỉ theo ca; `null` khi nghỉ cả ngày. */
  workShiftName: string | null;
}

export interface LeaveReaderPort {
  /**
   * Đơn `PENDING` + `APPROVED` của các `userIds` trong `[fromDate, toDate]` (bao gồm 2 đầu). Đơn đã
   * từ chối/rút/huỷ không trả về. `userIds` rỗng trả mảng rỗng.
   */
  getLeaveInRange(tenantId: string, userIds: string[], fromDate: string, toDate: string): Promise<LeaveWindowRecord[]>;
}

export const LEAVE_READER_PORT = Symbol('LEAVE_READER_PORT');
