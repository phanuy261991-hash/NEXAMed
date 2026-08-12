import { z } from 'zod';
import { userRoleSchema } from './roles';

/**
 * Quản lý tài khoản + gán vai trò (S2-07, ADM-01) — module `iam` sở hữu (xem
 * .claude/docs/architecture.md mục Domain module: "iam | Tài khoản, vai trò, phiên đăng nhập,
 * audit log"). `roleNames` dùng tên 5 vai trò hệ thống (`USER_ROLES`) thay vì `roleId` thô — v1
 * mỗi tenant chỉ có đúng 5 vai trò mặc định (seed lúc tạo tenant), vai trò tuỳ biến là ADM-07
 * (P1, chưa hiện thực). Khi ADM-07 xong, endpoint này cần đổi để nhận `roleId` tuỳ ý thay vì tên
 * cố định.
 */
export const createUserAccountRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  fullName: z.string().min(1),
  licenseNo: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  roleNames: z.array(userRoleSchema).min(1),
});
export type CreateUserAccountRequest = z.infer<typeof createUserAccountRequestSchema>;

/**
 * Sửa hồ sơ/vai trò/trạng thái tài khoản — bắt buộc kèm `version` (optimistic locking, cùng quy
 * ước `updatePatientRequestSchema`). Đổi mật khẩu KHÔNG nằm ở đây — xem
 * `resetUserPasswordRequestSchema` (tách riêng, đúng nguyên tắc "gộp mối lo khác nhau vào một
 * endpoint" nên tránh cho thao tác nhạy cảm).
 */
export const updateUserAccountRequestSchema = z.object({
  fullName: z.string().min(1).optional(),
  licenseNo: z.string().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  roleNames: z.array(userRoleSchema).min(1).optional(),
  version: z.number().int().positive(),
});
export type UpdateUserAccountRequest = z.infer<typeof updateUserAccountRequestSchema>;

export const resetUserPasswordRequestSchema = z.object({
  newPassword: z.string().min(8),
  version: z.number().int().positive(),
});
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;

/** Không bao giờ chứa `passwordHash` — chỉ tên vai trò để hiển thị, không phải ma trận quyền. */
export const userAccountSummarySchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  fullName: z.string(),
  licenseNo: z.string().nullable(),
  departmentId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  roleNames: z.array(z.string()),
  version: z.number().int(),
});
export type UserAccountSummary = z.infer<typeof userAccountSummarySchema>;

/** Phân trang cursor — không dùng offset, xem .claude/docs/architecture.md. */
export const listUserAccountsResponseSchema = z.object({
  items: z.array(userAccountSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListUserAccountsResponse = z.infer<typeof listUserAccountsResponseSchema>;

export const listUserAccountsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListUserAccountsQuery = z.infer<typeof listUserAccountsQuerySchema>;
