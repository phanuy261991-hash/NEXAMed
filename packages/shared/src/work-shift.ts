import { z } from 'zod';

/**
 * "Ca làm việc" (docs/DECISIONS.md #101) — danh mục mẫu ca do clinic_admin tự quản lý RIÊNG cho
 * từng phòng khám (bảng `work_shift`, tenant-scoped — KHÔNG dùng chung khuôn `reference_catalog`
 * toàn hệ thống). Dùng để bác sĩ đăng ký lịch làm việc theo tuần/tháng (giai đoạn kế tiếp, chưa
 * xây) — xem plan lưu ở phiên dựng tính năng này.
 */
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Định dạng giờ phải là HH:mm (24 giờ)');

/** 8 màu cố định trong hệ thống — không color-picker tự do (tránh chọn hex lệch tông giao diện). */
export const workShiftColorSchema = z.enum(['blue', 'teal', 'emerald', 'amber', 'rose', 'purple', 'cyan', 'slate']);
export type WorkShiftColor = z.infer<typeof workShiftColorSchema>;

export const workShiftItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  color: workShiftColorSchema,
  restStartTime: timeOfDaySchema.nullable(),
  restEndTime: timeOfDaySchema.nullable(),
  /** Phút — UI tự quy đổi qua lại "giờ"/"phút" lúc nhập, server chỉ lưu/trả về phút. */
  restMinutes: z.number().int().nonnegative().nullable(),
  standardWorkMinutes: z.number().int().nonnegative().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type WorkShiftItem = z.infer<typeof workShiftItemSchema>;

export const createWorkShiftRequestSchema = z.object({
  name: z.string().min(1),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  color: workShiftColorSchema,
  restStartTime: timeOfDaySchema.nullable().optional(),
  restEndTime: timeOfDaySchema.nullable().optional(),
  restMinutes: z.number().int().nonnegative().nullable().optional(),
  standardWorkMinutes: z.number().int().nonnegative().nullable().optional(),
  sortOrder: z.number().int().default(0),
});
export type CreateWorkShiftRequest = z.infer<typeof createWorkShiftRequestSchema>;

export const updateWorkShiftRequestSchema = z.object({
  name: z.string().min(1).optional(),
  startTime: timeOfDaySchema.optional(),
  endTime: timeOfDaySchema.optional(),
  color: workShiftColorSchema.optional(),
  restStartTime: timeOfDaySchema.nullable().optional(),
  restEndTime: timeOfDaySchema.nullable().optional(),
  restMinutes: z.number().int().nonnegative().nullable().optional(),
  standardWorkMinutes: z.number().int().nonnegative().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateWorkShiftRequest = z.infer<typeof updateWorkShiftRequestSchema>;

/** Không phân trang — cùng lý do `listRoomsResponseSchema` (số ca của một phòng khám rất nhỏ). */
export const listWorkShiftsResponseSchema = z.object({
  items: z.array(workShiftItemSchema),
});
export type ListWorkShiftsResponse = z.infer<typeof listWorkShiftsResponseSchema>;
