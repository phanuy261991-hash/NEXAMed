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

/** `businessHours: null` = chưa cấu hình (chưa từng lưu vào `tenant_setting`). */
export const clinicSettingsSchema = z.object({
  businessHours: businessHoursSchema.nullable(),
  slotDurationMinutes: z.number().int().min(5).max(240),
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
});
export type UpdateClinicSettingsRequest = z.infer<typeof updateClinicSettingsRequestSchema>;

export const DEFAULT_SLOT_DURATION_MINUTES = DEFAULT_APPOINTMENT_DURATION_MINUTES;

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
