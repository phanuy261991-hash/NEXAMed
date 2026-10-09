/**
 * Đọc các lịch hẹn còn `SCHEDULED` nằm trong một khung nghỉ — cho module `leave-request` (#224)
 * hiện "Lịch hẹn bị ảnh hưởng" ở bảng đơn nghỉ và hộp thoại Duyệt. Module `leave-request` không
 * import `appointment` (.claude/docs/coding-standards.md) nên đọc qua port; adapter tự mở
 * transaction riêng.
 */
export interface AffectedAppointment {
  id: string;
  bookingCode: string;
  fullName: string;
  phone: string;
  /** ISO UTC. */
  scheduledAt: string;
  durationMinutes: number;
}

export interface AppointmentImpactQuery {
  doctorId: string;
  /** Ngày lịch VN, `YYYY-MM-DD`. */
  date: string;
  startMinute: number;
  endMinute: number;
}

export interface AppointmentImpactReaderPort {
  /** Kết quả cùng thứ tự/độ dài với `queries`. */
  listScheduledInWindows(tenantId: string, queries: AppointmentImpactQuery[]): Promise<AffectedAppointment[][]>;
}

export const APPOINTMENT_IMPACT_READER_PORT = Symbol('APPOINTMENT_IMPACT_READER_PORT');
