import { z } from 'zod';

/**
 * Request/response xin phá kính (break-glass) — xem .claude/docs/security-audit.md mục
 * Break-glass. `entityType` giữ dạng chuỗi tự do (khớp cột `entity_type` không ràng buộc enum
 * trong schema) vì các domain (encounter, clinical_note...) chưa tồn tại hết ở thời điểm này.
 */
export const breakGlassRequestSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  reason: z.string().min(1),
  password: z.string().min(1),
});

export type BreakGlassRequest = z.infer<typeof breakGlassRequestSchema>;

export const breakGlassResponseSchema = z.object({
  expiresAt: z.string().datetime(),
});

export type BreakGlassResponse = z.infer<typeof breakGlassResponseSchema>;
