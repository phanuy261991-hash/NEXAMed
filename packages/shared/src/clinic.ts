import { z } from 'zod';
import { DEFAULT_APPOINTMENT_DURATION_MINUTES } from './appointment';
import { currencyCodeSchema } from './currency';
import { timezoneSchema } from './timezone';

/**
 * Cấu hình phòng khám (S2-07, ADM-02 — trừ "mẫu in", lùi lại tới khi làm PRE-04/S4-04) — module
 * `clinic` sở hữu (.claude/docs/architecture.md: "clinic | Tenant, cấu hình phòng khám, phòng,
 * danh mục nội bộ"). Dùng chung permission `clinic_config.read`/`clinic_config.update` cho cả
 * phòng lẫn giờ làm/slot — PRD ADM-02 gộp chung "giờ làm việc, độ dài slot, phòng, mẫu in" làm
 * một yêu cầu, không có lý do tách quyền riêng cho "phòng" ở v1 (1-3 bác sĩ, 1 địa điểm).
 */
/**
 * "Tầng" (docs/DECISIONS.md #055) — cấp cha TÙY CHỌN của `room`. Cùng lý do không phân trang ở
 * `listRoomsResponseSchema` dưới — số tầng của một phòng khám luôn rất nhỏ.
 */
export const createFloorRequestSchema = z.object({
  name: z.string().min(1),
});
export type CreateFloorRequest = z.infer<typeof createFloorRequestSchema>;

export const updateFloorRequestSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateFloorRequest = z.infer<typeof updateFloorRequestSchema>;

export const floorSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type FloorSummary = z.infer<typeof floorSummarySchema>;

export const listFloorsResponseSchema = z.object({
  items: z.array(floorSummarySchema),
});
export type ListFloorsResponse = z.infer<typeof listFloorsResponseSchema>;

/** `floorId: null` = không thuộc tầng nào (hợp lệ — đa số phòng khám 1 tầng không dùng cấp này). */
export const createRoomRequestSchema = z.object({
  name: z.string().min(1),
  floorId: z.string().uuid().nullable().optional(),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = z.object({
  name: z.string().min(1).optional(),
  floorId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateRoomRequest = z.infer<typeof updateRoomRequestSchema>;

export const roomSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  floorId: z.string().uuid().nullable(),
  floorName: z.string().nullable(),
  examStationCount: z.number().int(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

/**
 * Không phân trang — số phòng của một phòng khám 1-3 bác sĩ rất nhỏ (không như danh sách bệnh
 * nhân/lịch hẹn), thêm cursor pagination ở đây là dựng abstraction cho quy mô chưa từng xảy ra.
 */
export const listRoomsResponseSchema = z.object({
  items: z.array(roomSummarySchema),
});
export type ListRoomsResponse = z.infer<typeof listRoomsResponseSchema>;

/**
 * "Bàn khám / Ghế" (docs/DECISIONS.md #055) — cấp con BẮT BUỘC thuộc 1 `room`, thuần mô tả
 * (không phải đơn vị điều phối — xem `RoomOption`/`RoomSession` ở dưới, vẫn dừng ở cấp `room`).
 */
export const createExamStationRequestSchema = z.object({
  roomId: z.string().uuid(),
  name: z.string().min(1),
});
export type CreateExamStationRequest = z.infer<typeof createExamStationRequestSchema>;

export const updateExamStationRequestSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateExamStationRequest = z.infer<typeof updateExamStationRequestSchema>;

export const examStationSummarySchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type ExamStationSummary = z.infer<typeof examStationSummarySchema>;

export const listExamStationsResponseSchema = z.object({
  items: z.array(examStationSummarySchema),
});
export type ListExamStationsResponse = z.infer<typeof listExamStationsResponseSchema>;

export const listExamStationsQuerySchema = z.object({
  roomId: z.string().uuid(),
});
export type ListExamStationsQuery = z.infer<typeof listExamStationsQuerySchema>;

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOfDaySchema = z.string().regex(HHMM_PATTERN, 'Định dạng giờ phải là HH:mm (24 giờ)');

/** `null` = đóng cửa cả ngày hôm đó. */
const dayHoursSchema = z.object({ open: timeOfDaySchema, close: timeOfDaySchema }).nullable();

export const businessHoursSchema = z.object({
  monday: dayHoursSchema,
  tuesday: dayHoursSchema,
  wednesday: dayHoursSchema,
  thursday: dayHoursSchema,
  friday: dayHoursSchema,
  saturday: dayHoursSchema,
  sunday: dayHoursSchema,
});
export type BusinessHours = z.infer<typeof businessHoursSchema>;

/**
 * `businessHours: null` = chưa cấu hình (chưa từng lưu vào `tenant_setting`).
 * `deferredPaymentEnabled` (Thu ngân cơ bản, Sprint 5/6, pill "Cấu hình thanh toán" ở
 * `/admin/system-config`) — bật/tắt tính năng "Thanh toán sau" CẤP PHÒNG KHÁM, mặc định `false`
 * khi chưa cấu hình (mọi phòng khám mới bắt buộc thu tiền trước khi vào Hàng đợi khám). Tắt thì
 * `ReceptionIntakeForm.tsx` tự ẩn hẳn checkbox "Thanh toán sau", không riêng disable.
 */
export const clinicSettingsSchema = z.object({
  businessHours: businessHoursSchema.nullable(),
  slotDurationMinutes: z.number().int().min(5).max(240),
  deferredPaymentEnabled: z.boolean(),
  /**
   * Ngưỡng "chờ lâu" ở Hàng đợi khám (`ReceptionDoctorQueuePage.tsx`) — khách chờ (tính từ
   * `checkedInAt`) vượt số phút này thì hiện cảnh báo (viền/nền đỏ, badge "Chờ lâu"). Trước đây
   * hardcode `WAIT_WARNING_MINUTES=30` ở web, chuyển thành cấu hình được theo yêu cầu chủ dự án
   * (2026-08-28) — pill "Cấu hình khám" ở `/admin/system-config`.
   */
  overdueWaitWarningMinutes: z.number().int().min(1).max(240),
  /**
   * Tự động đánh dấu "Không đến" (S5-07, APP-05) — pill "Lịch hẹn" trong "Cấu hình phòng khám".
   * Tắt (mặc định — an toàn, giữ hành vi trước khi có job này): job nền KHÔNG tự chuyển trạng thái
   * cho tenant này, lễ tân/bác sĩ tự đánh dấu qua `POST /appointments/:id/no-show`. Bật:
   * `noShowThresholdMinutes` mới có ý nghĩa, job nền (mỗi 5 phút) tự chuyển `SCHEDULED` quá giờ
   * hẹn cộng ngưỡng này sang `NO_SHOW`.
   */
  noShowAutoEnabled: z.boolean(),
  noShowThresholdMinutes: z.number().int().min(1).max(1440),
  /**
   * "Tạm nghỉ / Đóng ca" của bác sĩ — pill "Cấu hình khám". `allowEmergencyEndShift` (mặc định
   * BẬT) gate riêng nút "Đóng ca hôm nay" bấm thủ công bất kỳ lúc nào (Trường hợp 1, "đóng đột
   * xuất") — KHÔNG ảnh hưởng nhắc tự động đúng giờ đóng cửa phòng khám (Trường hợp 2, luôn hoạt
   * động, đã hỏi và chốt riêng). `allowReceptionistEndShift` (mặc định TẮT) gate lễ tân/clinic_admin
   * thao tác hộ trạng thái của bác sĩ khác — tắt thì lễ tân chỉ xem badge, không thao tác được.
   */
  allowEmergencyEndShift: z.boolean(),
  allowReceptionistEndShift: z.boolean(),
  /**
   * "Đăng ký ca làm việc" Giai đoạn 2 — pill "Cấu hình phòng khám" → mục con "Lịch hẹn" (cùng khối
   * với "Tự động đánh dấu Không đến", KHÔNG phải pill "Cấu hình khám" — cả hai đều là quy tắc đặt/
   * xử lý lịch hẹn). Tắt (mặc định — an toàn, giữ nguyên hành vi hiện tại): đặt/dời/sửa lịch không
   * bị giới hạn gì thêm ngoài giờ làm việc chung. Bật: bác sĩ CÓ đăng ký ≥1 ca cho đúng ngày đó thì
   * chỉ đặt được trong khung giờ đã đăng ký; bác sĩ CHƯA đăng ký ca ngày đó thì KHÔNG bị giới hạn gì
   * thêm (tránh khoá cứng toàn bộ lịch hẹn khi mới bật lúc chưa ai kịp đăng ký đủ ca).
   */
  blockBookingOutsideWorkShiftEnabled: z.boolean(),
  /**
   * "Cấu hình chung" — pill "Cấu hình phòng khám" → mục con mới, dưới "Ca làm việc" (chủ dự án yêu
   * cầu trực tiếp, 02/09/2026, tiếp sau #104). Bật (mặc định — giữ đúng hành vi hiện tại): mọi
   * nhân viên tự đăng ký/xoá ca trên "Lịch làm việc của tôi" như đang có. Tắt: ẩn hết chức năng tự
   * đăng ký (nút "+ Đăng ký ca"/xoá/"Chọn nhiều ngày"/"Sao chép tuần trước"), trang chỉ còn xem
   * lịch ĐÃ ĐƯỢC PHÂN CÔNG từ "Lịch làm việc nhân viên" (read-only) — không ảnh hưởng scope
   * `global` (clinic_admin) ở "Lịch làm việc nhân viên", vẫn tạo/sửa/xoá hộ được bình thường.
   */
  allowStaffSelfScheduleEnabled: z.boolean(),
});
export type ClinicSettings = z.infer<typeof clinicSettingsSchema>;

/**
 * PATCH từng phần — chỉ field có mặt mới bị ghi đè trong `tenant_setting` (mỗi field một dòng
 * key riêng, xem clinic-settings.repository.ts). `slotDurationMinutes` mặc định khi chưa cấu
 * hình lấy đúng `DEFAULT_APPOINTMENT_DURATION_MINUTES` (packages/shared/src/appointment.ts) —
 * một nguồn sự thật duy nhất cho "15 phút", không khai hằng số thứ hai.
 */
export const updateClinicSettingsRequestSchema = z.object({
  businessHours: businessHoursSchema.optional(),
  slotDurationMinutes: z.number().int().min(5).max(240).optional(),
  deferredPaymentEnabled: z.boolean().optional(),
  overdueWaitWarningMinutes: z.number().int().min(1).max(240).optional(),
  noShowAutoEnabled: z.boolean().optional(),
  noShowThresholdMinutes: z.number().int().min(1).max(1440).optional(),
  allowEmergencyEndShift: z.boolean().optional(),
  allowReceptionistEndShift: z.boolean().optional(),
  blockBookingOutsideWorkShiftEnabled: z.boolean().optional(),
  allowStaffSelfScheduleEnabled: z.boolean().optional(),
});
export type UpdateClinicSettingsRequest = z.infer<typeof updateClinicSettingsRequestSchema>;

export const DEFAULT_SLOT_DURATION_MINUTES = DEFAULT_APPOINTMENT_DURATION_MINUTES;
/** Giữ đúng ngưỡng hardcode cũ (`WAIT_WARNING_MINUTES`) làm mặc định khi tenant chưa cấu hình. */
export const DEFAULT_OVERDUE_WAIT_WARNING_MINUTES = 30;
/** Tắt theo mặc định (an toàn — giữ đúng hành vi "chưa từng có job này" cho tenant chưa cấu hình). */
export const DEFAULT_NO_SHOW_AUTO_ENABLED = false;
/** Khớp PRD APP-05 ("ngưỡng cấu hình, mặc định 60 phút") + hardcode cũ ở FE (`LATE_APPOINTMENT_THRESHOLD_MINUTES`). */
export const DEFAULT_NO_SHOW_THRESHOLD_MINUTES = 60;
/** "Tạm nghỉ / Đóng ca" — bật theo mặc định (tính năng chính, không phải ngoại lệ cần bật thủ công). */
export const DEFAULT_ALLOW_EMERGENCY_END_SHIFT = true;
/** Tắt theo mặc định (an toàn — lễ tân KHÔNG thao tác hộ trạng thái bác sĩ khác tới khi chủ động bật). */
export const DEFAULT_ALLOW_RECEPTIONIST_END_SHIFT = false;
/** Tắt theo mặc định (an toàn — giữ nguyên hành vi hiện tại tới khi chủ động bật). */
export const DEFAULT_BLOCK_BOOKING_OUTSIDE_WORK_SHIFT_ENABLED = false;
/** Bật theo mặc định — giữ đúng hành vi hiện tại (mọi nhân viên tự đăng ký ca) tới khi chủ động tắt. */
export const DEFAULT_ALLOW_STAFF_SELF_SCHEDULE_ENABLED = true;

/**
 * `GET /clinic-settings/deferred-payment-enabled` — chiếu tối thiểu tự-phục vụ (Thu ngân cơ bản,
 * Sprint 5/6), đúng khuôn `GET /appointments/doctors`/`roomOptionSchema` (docs/DECISIONS.md #030):
 * lễ tân (`ReceptionIntakeForm.tsx`) cần biết tính năng "Thanh toán sau" đã bật hay chưa để hiện/ẩn
 * checkbox, nhưng KHÔNG có `clinic_config.read` (chỉ `clinic_admin` mới có) — phát hiện thật lúc
 * kiểm bằng trình duyệt (403), cùng lỗ hổng lớp đã gặp ở #030. Không dùng `GET /clinic-settings`
 * đầy đủ (không lộ `businessHours` không cần thiết cho lễ tân).
 */
export const deferredPaymentStatusSchema = z.object({ enabled: z.boolean() });
export type DeferredPaymentStatus = z.infer<typeof deferredPaymentStatusSchema>;

/**
 * `GET /clinic-settings/allow-staff-self-schedule-enabled` — chiếu tối thiểu tự-phục vụ ("Cấu hình
 * chung"), đúng khuôn `deferredPaymentStatusSchema` ở trên: MỌI nhân viên (không chỉ `clinic_admin`)
 * cần biết công tắc này để `MyWorkSchedulePage.tsx` ẩn/hiện đúng thao tác tự đăng ký, nhưng không
 * có `clinic_config.read`.
 */
export const allowStaffSelfScheduleStatusSchema = z.object({ enabled: z.boolean() });
export type AllowStaffSelfScheduleStatus = z.infer<typeof allowStaffSelfScheduleStatusSchema>;

/**
 * Trang "Thông tin phòng khám" (2026-08-13, `/admin/system-config`) — mở rộng `tenant`
 * (`.claude/docs/data-model.md`, `docs/DECISIONS.md` #041). Dùng lại quyền `clinic_config.read`/
 * `.update` sẵn có, không thêm permission mới. `currency`/`timezone` chỉ lưu giá trị hiển thị,
 * chưa nối vào logic tính toán/ngày giờ hệ thống — xem comment ở `currency.ts`/`timezone.ts`.
 */
export const clinicProfileSchema = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  currency: currencyCodeSchema,
  taxCode: z.string().nullable(),
  timezone: timezoneSchema,
  logoUrl: z.string().nullable(),
  printLogoUrl: z.string().nullable(),
  version: z.number().int(),
});
export type ClinicProfile = z.infer<typeof clinicProfileSchema>;

/**
 * `GET /clinic-profile/print-header` — chiếu tối thiểu tự-phục vụ cho tiêu đề bản in (tên/địa chỉ/
 * SĐT/logo in), đúng khuôn `deferredPaymentStatusSchema`/`GET /appointments/doctors` (#030): lễ
 * tân (Thu ngân, in phiếu thu) và bác sĩ (kê đơn, in đơn thuốc) đều KHÔNG có `clinic_config.read`
 * (chỉ `clinic_admin`) — phát hiện thật lúc kiểm bằng trình duyệt cho màn Thu ngân, tiện vá luôn
 * `PrescriptionPanel.tsx` (cùng lỗ hổng, trước đó chỉ chưa lộ ra vì luôn kiểm bằng tài khoản admin).
 * Không lộ `taxCode`/`currency`/`timezone`/`version` (không cần cho tiêu đề in).
 */
export const clinicPrintHeaderSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  printLogoUrl: z.string().nullable(),
});
export type ClinicPrintHeader = z.infer<typeof clinicPrintHeaderSchema>;

/** PATCH từng phần, `version` bắt buộc cho optimistic locking (cùng mẫu `updateRoomRequestSchema`). */
export const updateClinicProfileRequestSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  currency: currencyCodeSchema.optional(),
  taxCode: z.string().nullable().optional(),
  timezone: timezoneSchema.optional(),
  version: z.number().int().positive(),
});
export type UpdateClinicProfileRequest = z.infer<typeof updateClinicProfileRequestSchema>;

/**
 * "Phòng làm việc hôm nay" của bác sĩ (docs/DECISIONS.md #054) — mô hình định tuyến theo phòng
 * tham khảo từ chủ dự án, chỉ điều phối/hiển thị UI, KHÔNG đổi `data_scope`/cách lọc hàng đợi
 * khám (vẫn theo `doctor_id`). Chiếu tối thiểu `{id, name}` (khác `roomSummarySchema` đầy đủ) vì
 * endpoint tự-phục vụ (`JwtAuthGuard` thuần, không `@RequirePermission` — mọi user đã đăng nhập
 * đều đọc được, không lộ `isActive`/`version` không cần thiết).
 */
export const roomOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type RoomOption = z.infer<typeof roomOptionSchema>;

export const listRoomOptionsResponseSchema = z.object({
  items: z.array(roomOptionSchema),
});
export type ListRoomOptionsResponse = z.infer<typeof listRoomOptionsResponseSchema>;

export const setRoomSessionRequestSchema = z.object({
  roomId: z.string().uuid(),
});
export type SetRoomSessionRequest = z.infer<typeof setRoomSessionRequestSchema>;

/** `null` khi bác sĩ chưa chọn phòng cho ngày hôm nay (giờ Việt Nam). */
export const roomSessionSchema = z.object({
  roomId: z.string().uuid(),
  roomName: z.string(),
  workDate: z.string(),
});
export type RoomSession = z.infer<typeof roomSessionSchema>;
