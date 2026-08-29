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

  /**
   * "Phòng làm việc hôm nay" của từng bác sĩ (docs/DECISIONS.md #054) — key = doctorId. Chỉ để
   * hiển thị cạnh tên bác sĩ ở danh sách chọn (`GET /appointments/doctors`), KHÔNG dùng để lọc
   * quyền/hàng đợi khám (vẫn theo doctor_id như trước). Bác sĩ chưa chọn phòng hôm nay, hoặc
   * tenant chưa có ≥2 phòng active, thì không có key tương ứng trong kết quả.
   */
  getTodayDoctorRoomAssignments(tenantId: string): Promise<Record<string, { roomId: string; roomName: string }>>;

  /**
   * Thu ngân cơ bản (Sprint 5/6) — bật/tắt tính năng "Thanh toán sau" CẤP PHÒNG KHÁM (`tenant_setting`
   * key `deferred_payment_enabled`). `encounter`/`reception` đọc qua port này (không import thẳng
   * module `clinic`) để gate "Hàng đợi khám" (`EncounterService.startConsultation`,
   * `EncounterRepository.listForDay`) — tắt thì mọi `Encounter.allowsDeferredPayment` bị coi như
   * `false`, không phân biệt giá trị đã lưu.
   */
  getDeferredPaymentEnabled(tenantId: string): Promise<boolean>;

  /**
   * Tự động đánh dấu "Không đến" (S5-07, APP-05) — job nền (`apps/api/src/modules/appointment/
   * no-show.ts`) đọc qua port này thay vì import thẳng `ClinicSettingsRepository`, cùng lý do
   * `getDeferredPaymentEnabled` ở trên. `enabled=false` (mặc định) — job bỏ qua tenant này hoàn
   * toàn, lễ tân/bác sĩ tự đánh dấu thủ công.
   */
  getNoShowConfig(tenantId: string): Promise<{ enabled: boolean; thresholdMinutes: number }>;
}

export const CLINIC_CONFIG_READER_PORT = Symbol('CLINIC_CONFIG_READER_PORT');
