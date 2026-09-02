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

  /**
   * "Tạm nghỉ / Đóng ca" của bác sĩ — 2 công tắc độc lập (`tenant_setting`):
   * `allowEmergencyEndShift` (mặc định BẬT) gate riêng Trường hợp 1 "đóng đột xuất" (nút "Đóng ca
   * hôm nay" bấm bất kỳ lúc nào) — KHÔNG ảnh hưởng Trường hợp 2 "hết giờ làm việc" (tự nhắc theo
   * giờ đóng cửa phòng khám, luôn hoạt động). `allowReceptionistEndShift` (mặc định TẮT) gate lễ
   * tân/clinic_admin thao tác hộ trạng thái của bác sĩ khác. Module `doctor-availability` đọc qua
   * port này thay vì import thẳng `ClinicSettingsRepository`, cùng lý do `getNoShowConfig` ở trên.
   */
  getDoctorAvailabilityPolicy(tenantId: string): Promise<{ allowEmergencyEndShift: boolean; allowReceptionistEndShift: boolean }>;

  /**
   * "Đăng ký ca làm việc" Giai đoạn 2 — bật/tắt chặn đặt lịch hẹn ngoài ca bác sĩ đã đăng ký
   * (`tenant_setting` key `block_booking_outside_work_shift_enabled`, mặc định `false`).
   * `AppointmentService` đọc qua port này (module `clinic` sở hữu `tenant_setting`), cùng lý do
   * `getNoShowConfig`/`getDoctorAvailabilityPolicy` ở trên.
   */
  getBlockBookingOutsideWorkShiftEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Cấu hình chung" — bật/tắt cho phép nhân viên tự đăng ký ca trên "Lịch làm việc của tôi"
   * (`tenant_setting` key `allow_staff_self_schedule_enabled`, mặc định `true`). Module
   * `work-shift-assignment` đọc qua port này (module `clinic` sở hữu `tenant_setting`), cùng lý do
   * `getBlockBookingOutsideWorkShiftEnabled` ở trên. Chỉ chặn `create`/`bulkCreate`/`copy`/`remove`
   * khi `dataScope==='personal'` — `list()` (xem) và scope `global` (clinic_admin ở "Lịch làm việc
   * nhân viên") không bị ảnh hưởng.
   */
  getAllowStaffSelfScheduleEnabled(tenantId: string): Promise<boolean>;
}

export const CLINIC_CONFIG_READER_PORT = Symbol('CLINIC_CONFIG_READER_PORT');
