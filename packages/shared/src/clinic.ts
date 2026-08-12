import { z } from 'zod';
import { DEFAULT_APPOINTMENT_DURATION_MINUTES } from './appointment';

/**
 * Cấu hình phòng khám (S2-07, ADM-02 — trừ "mẫu in", lùi lại tới khi làm PRE-04/S4-04) — module
 * `clinic` sở hữu (.claude/docs/architecture.md: "clinic | Tenant, cấu hình phòng khám, phòng,
 * danh mục nội bộ"). Dùng chung permission `clinic_config.read`/`clinic_config.update` cho cả
 * phòng lẫn giờ làm/slot — PRD ADM-02 gộp chung "giờ làm việc, độ dài slot, phòng, mẫu in" làm
 * một yêu cầu, không có lý do tách quyền riêng cho "phòng" ở v1 (1-3 bác sĩ, 1 địa điểm).
 */
export const createRoomRequestSchema = z.object({
  name: z.string().min(1),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateRoomRequest = z.infer<typeof updateRoomRequestSchema>;

export const roomSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
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
