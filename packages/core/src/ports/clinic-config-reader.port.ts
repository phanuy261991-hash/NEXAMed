/** Giờ mở/đóng cửa một ngày trong tuần; `null` = đóng cửa cả ngày. Khớp `businessHoursSchema` ở
 * `packages/shared/src/clinic.ts` — định nghĩa lại cục bộ (không import `packages/shared` vào
 * `packages/core`, giữ đúng chiều phụ thuộc `.claude/docs/project-structure.md`). */
export interface DayHours {
  open: string;
  close: string;
}

export interface WeeklyBusinessHours {
  monday: DayHours | null;
  tuesday: DayHours | null;
  wednesday: DayHours | null;
  thursday: DayHours | null;
  friday: DayHours | null;
  saturday: DayHours | null;
  sunday: DayHours | null;
}

/**
 * Đọc cấu hình lịch (giờ làm việc + độ dài slot) cho màn hình Lịch hẹn (S2-09) — dữ liệu thuộc
 * module `clinic` (`tenant_setting`). Cùng lý do dùng port thay vì import thẳng như
 * `DoctorDirectoryPort` (xem file đó) — `appointment` không tự đọc bảng của module khác.
 */
export interface ClinicConfigReaderPort {
  getScheduleConfig(tenantId: string): Promise<{ businessHours: WeeklyBusinessHours | null; slotDurationMinutes: number }>;
}

export const CLINIC_CONFIG_READER_PORT = Symbol('CLINIC_CONFIG_READER_PORT');
