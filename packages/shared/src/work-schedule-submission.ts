import { z } from 'zod';

/**
 * "Duyệt đăng ký ca theo tháng" (#225) — bảng đăng ký ca của MỘT nhân viên trong MỘT tháng: DRAFT (Nháp) →
 * SUBMITTED (Chờ duyệt) → APPROVED (Đã duyệt); quản lý "Trả lại" đưa về DRAFT kèm `returnReason`.
 * Không có dòng nào = Nháp ảo (web tự dựng).
 */
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Định dạng tháng phải là YYYY-MM');
const versionSchema = z.number().int().positive();

export const scheduleSubmissionStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'APPROVED']);
export type ScheduleSubmissionStatus = z.infer<typeof scheduleSubmissionStatusSchema>;

/** `RETURNED` là bộ lọc "Trả lại" = DRAFT có `returnReason`. */
export const listScheduleSubmissionsQuerySchema = z.object({
  month: monthSchema.optional(),
  status: z.enum(['SUBMITTED', 'APPROVED', 'RETURNED']).optional(),
  /** Chỉ có tác dụng với scope `global`; scope `personal` luôn bị ép về chính actor. */
  userId: z.string().uuid().optional(),
});
export type ListScheduleSubmissionsQuery = z.infer<typeof listScheduleSubmissionsQuerySchema>;

export const scheduleSubmissionItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string(),
  departmentName: z.string().nullable(),
  month: z.string(),
  status: scheduleSubmissionStatusSchema,
  /** Số ca và tổng phút (giờ ca, chưa trừ giờ nghỉ) đã đăng ký trong tháng — tính lúc đọc. */
  shiftCount: z.number().int(),
  totalMinutes: z.number().int(),
  submittedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  returnReason: z.string().nullable(),
  version: z.number().int(),
});
export type ScheduleSubmissionItem = z.infer<typeof scheduleSubmissionItemSchema>;

export const listScheduleSubmissionsResponseSchema = z.object({ items: z.array(scheduleSubmissionItemSchema) });
export type ListScheduleSubmissionsResponse = z.infer<typeof listScheduleSubmissionsResponseSchema>;

export const submitScheduleSubmissionRequestSchema = z.object({ month: monthSchema });
export type SubmitScheduleSubmissionRequest = z.infer<typeof submitScheduleSubmissionRequestSchema>;

export const approveScheduleSubmissionRequestSchema = z.object({ version: versionSchema });
export type ApproveScheduleSubmissionRequest = z.infer<typeof approveScheduleSubmissionRequestSchema>;

export const returnScheduleSubmissionRequestSchema = z.object({
  version: versionSchema,
  reason: z.string().trim().min(1, 'Lý do là bắt buộc').max(500),
});
export type ReturnScheduleSubmissionRequest = z.infer<typeof returnScheduleSubmissionRequestSchema>;

export const scheduleSubmissionPendingCountResponseSchema = z.object({ count: z.number().int() });
export type ScheduleSubmissionPendingCountResponse = z.infer<typeof scheduleSubmissionPendingCountResponseSchema>;
