import { z } from 'zod';

/**
 * Phạm vi dữ liệu (Data Scope) — xem .claude/docs/security-audit.md.
 * Khớp 1-1 với enum DataScope trong apps/api/prisma/schema.prisma.
 * Không có mức "branch" ở v1 — xem docs/DECISIONS.md #013.
 */
export const DATA_SCOPES = ['none', 'personal', 'department', 'global'] as const;

export const dataScopeSchema = z.enum(DATA_SCOPES);

export type DataScope = z.infer<typeof dataScopeSchema>;