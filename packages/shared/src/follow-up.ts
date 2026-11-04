import { z } from 'zod';

/**
 * Trang "Hẹn tái khám" (docs/DECISIONS.md #285, mockup đã chốt 04/11/2026): danh sách các kế hoạch điều trị ĐÃ KÝ có hướng "Hẹn tái khám", kèm nhật ký các lần nhắc.
 * Ngày là `YYYY-MM-DD` theo lịch Việt Nam; thời điểm là ISO UTC.
 */

export const followUpTabSchema = z.enum(['today', 'overdue', 'upcoming', 'all']);
export type FollowUpTabKind = z.infer<typeof followUpTabSchema>;

export const followUpStatusSchema = z.enum(['DUE_TODAY', 'ARRIVED', 'OVERDUE', 'UPCOMING']);
export type FollowUpStatusKind = z.infer<typeof followUpStatusSchema>;

export const followUpReminderResultSchema = z.enum(['REACHED', 'NO_ANSWER', 'CALL_BACK_LATER', 'NOT_RETURNING']);
export type FollowUpReminderResultKind = z.infer<typeof followUpReminderResultSchema>;

export const FOLLOW_UP_REMINDER_NOTE_MAX = 1000;

export const listFollowUpsQuerySchema = z.object({
  tab: followUpTabSchema.default('today'),
  /** Tìm theo tên (không dấu), mã bệnh nhân hoặc số điện thoại. */
  q: z.string().trim().max(100).optional(),
  doctorId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;

export const followUpLastReminderSchema = z.object({ remindedAt: z.string(), result: followUpReminderResultSchema, byName: z.string() });

export const followUpItemSchema = z.object({
  /** Lượt khám gốc (khoá của hẹn tái khám và của nhật ký nhắc). */
  encounterId: z.string().uuid(),
  encounterNo: z.string(),
  patientId: z.string().uuid(),
  patientCode: z.string(),
  patientName: z.string(),
  phone: z.string(),
  followUpDate: z.string(),
  status: followUpStatusSchema,
  /** Ngày khám của lượt gốc. */
  sourceDate: z.string(),
  doctorId: z.string().uuid().nullable(),
  doctorName: z.string().nullable(),
  /** Chẩn đoán chính — CHỈ có khi người xem có quyền xem nội dung lâm sàng (`encounter.read_clinical`); không thì `null`. */
  diagnosisName: z.string().nullable(),
  reminderCount: z.number(),
  lastReminder: followUpLastReminderSchema.nullable(),
});
export type FollowUpItem = z.infer<typeof followUpItemSchema>;

export const listFollowUpsResponseSchema = z.object({
  items: z.array(followUpItemSchema),
  nextCursor: z.string().nullable(),
  /** Số hẹn từng tab (theo cùng bộ lọc bác sĩ/tìm kiếm của yêu cầu); "Tất cả" không đếm. */
  counts: z.object({ today: z.number(), overdue: z.number(), upcoming: z.number() }),
});
export type ListFollowUpsResponse = z.infer<typeof listFollowUpsResponseSchema>;

export const followUpReminderSchema = z.object({
  id: z.string().uuid(),
  result: followUpReminderResultSchema,
  note: z.string().nullable(),
  remindedAt: z.string(),
  byName: z.string(),
});
export type FollowUpReminder = z.infer<typeof followUpReminderSchema>;

export const listFollowUpRemindersResponseSchema = z.object({ items: z.array(followUpReminderSchema) });
export type ListFollowUpRemindersResponse = z.infer<typeof listFollowUpRemindersResponseSchema>;

export const createFollowUpReminderRequestSchema = z.object({
  result: followUpReminderResultSchema,
  note: z.string().trim().max(FOLLOW_UP_REMINDER_NOTE_MAX).optional(),
});
export type CreateFollowUpReminderRequest = z.infer<typeof createFollowUpReminderRequestSchema>;

/** Nhãn tiếng Việt dùng chung (web, Excel). */
export const FOLLOW_UP_REMINDER_RESULT_LABEL: Record<FollowUpReminderResultKind, string> = {
  REACHED: 'Liên lạc được, sẽ đến',
  NO_ANSWER: 'Không nghe máy',
  CALL_BACK_LATER: 'Hẹn gọi lại sau',
  NOT_RETURNING: 'Bệnh nhân không tái khám',
};

export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatusKind, string> = {
  DUE_TODAY: 'Chờ đến',
  ARRIVED: 'Đã đến',
  OVERDUE: 'Quá hạn',
  UPCOMING: 'Sắp tới',
};
