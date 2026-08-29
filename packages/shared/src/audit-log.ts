import { z } from 'zod';

/**
 * "Nhật ký hoạt động" (S5-05, ADM-03) — `GET /api/v1/audit-log`. Lọc theo bệnh nhân (đầy đủ hồ sơ
 * bệnh án — gồm cả `entityType='encounter'` của bệnh nhân đó, không chỉ `entityType='patient'`,
 * xem `apps/api/src/modules/audit/audit-log.repository.ts`), theo người dùng, theo khoảng ngày.
 */
export const listAuditLogQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  patientId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  /** `YYYY-MM-DD`, quy đổi biên ngày Việt Nam qua `vietnamDayRange()` ở service — cùng khuôn `date` của `listAppointmentsQuerySchema`. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'from phải theo định dạng YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'to phải theo định dạng YYYY-MM-DD')
    .optional(),
});
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string(),
  actorId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  actionLabel: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  /** Tên/mã cụ thể chỉ resolve được cho `entityType` 'patient'/'encounter'; domain khác hiện nhãn tiếng Việt của entityType (không lộ UUID thô, xem `labelForEntityType`). */
  entityLabel: z.string(),
  /** `action` thuộc `break_glass.request`/`break_glass.access` — cảnh báo nổi bật (chủ dự án yêu cầu), vì đây luôn là thao tác vượt quyền thông thường, cần chú ý riêng khi rà soát nhật ký. */
  isBreakGlass: z.boolean(),
  beforeJson: z.unknown().nullable(),
  afterJson: z.unknown().nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const listAuditLogResponseSchema = z.object({
  items: z.array(auditLogEntrySchema),
  nextCursor: z.string().nullable(),
});
export type ListAuditLogResponse = z.infer<typeof listAuditLogResponseSchema>;
