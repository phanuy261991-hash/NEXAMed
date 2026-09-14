import { z } from 'zod';

/**
 * `GET /backup-status` (S6-01, ADM-04) — trạng thái sao lưu Postgres gần nhất, đọc từ file
 * `backup/backup.sh` ghi ra (xem `packages/core/src/ports/backup-status.port.ts`). `configured:
 * false` khi máy hiện tại không chạy container `backup` (ví dụ máy dev) — FE không hiện banner
 * trong trường hợp này, khác với `needsAttention: true` (đã cấu hình nhưng có vấn đề thật).
 */
export const backupAlertReasonSchema = z.enum(['NEVER_RUN', 'LAST_RUN_FAILED', 'STALE']);
export type BackupAlertReason = z.infer<typeof backupAlertReasonSchema>;

export const backupStatusResponseSchema = z.object({
  configured: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastRunOk: z.boolean().nullable(),
  lastSuccessAt: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  needsAttention: z.boolean(),
  reason: backupAlertReasonSchema.nullable(),
});
export type BackupStatusResponse = z.infer<typeof backupStatusResponseSchema>;
