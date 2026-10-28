/** Một ngày bác sĩ còn chưa đóng ca, kèm số liệu để hộp "Đóng ca ngày trước" hiển thị. */
export interface PendingClosureDay {
  /** Ngày lịch VN, `YYYY-MM-DD`. */
  date: string;
  /** Số lượt khám bác sĩ đã gọi khám trong ngày đó. */
  calledCount: number;
  completedCount: number;
  /** Lượt khám của ngày đó còn dở (chờ/đang khám) — sẽ trả về hàng chờ chung Khoa khi đóng ca. */
  unprocessedCount: number;
  /** Ca đã xếp của ngày đó (sắp theo giờ bắt đầu, `HH:mm`); rỗng nếu ngày đó không có ca (ví dụ phòng khám không phân ca). */
  shifts: Array<{ startTime: string; endTime: string }>;
}

/**
 * "Phiên trước chưa đóng thì chưa được khám" (mockup duyệt 28/10/2026). Module `encounter` hỏi qua port này
 * (không import `doctor-availability`, .claude/docs/coding-standards.md "Ranh giới module") trước khi cho
 * "Bắt đầu khám"/"Nhận ca". Adapter tự mở transaction riêng nên caller phải gọi NGOÀI transaction đang mở
 * (CLAUDE.md "Một request = MỘT transaction").
 */
export interface DoctorShiftClosurePort {
  /** Các ngày trước hôm nay mà `doctorId` chưa đóng ca, tăng dần; rỗng = được phép khám. */
  listPendingClosures(tenantId: string, branchId: string, actorId: string, doctorId: string): Promise<PendingClosureDay[]>;
}

export const DOCTOR_SHIFT_CLOSURE_PORT = Symbol('DOCTOR_SHIFT_CLOSURE_PORT');
