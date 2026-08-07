import { z } from 'zod';

/**
 * 5 vai trò v1 — xem .claude/docs/security-audit.md mục "Vai trò trong v1".
 * Giá trị này khớp 1-1 với enum UserRoleName trong apps/api/prisma/schema.prisma.
 */
export const USER_ROLES = ['receptionist', 'nurse', 'doctor', 'clinic_admin', 'system_admin'] as const;

export const userRoleSchema = z.enum(USER_ROLES);

export type UserRole = z.infer<typeof userRoleSchema>;