import { z } from 'zod';

/**
 * Quản lý tài khoản + gán vai trò (S2-07, ADM-01) — module `iam` sở hữu (xem
 * .claude/docs/architecture.md mục Domain module: "iam | Tài khoản, vai trò, phiên đăng nhập,
 * audit log"). `roleIds` nhận `role.id` bất kỳ trong tenant (5 vai trò hệ thống lẫn vai trò tuỳ
 * biến tạo qua ADM-07, `role.ts`) — trước ADM-07 trường này là `roleNames` giới hạn 5 tên cố
 * định (`USER_ROLES`), đã đổi cùng lúc ADM-07 hiện thực vì vai trò tuỳ biến không có tên cố định
 * để enum hoá.
 */
/**
 * Hồ sơ nhân sự (mở rộng ADM-01) — mọi trường dưới đều tuỳ chọn trừ `fullName`/`username`/
 * `password`/`roleIds` (đã bắt buộc từ trước). 4 trường `*Code` lưu `code` của `reference_catalog`
 * (category ACADEMIC_TITLE/STAFF_POSITION/EMPLOYMENT_STATUS/EMPLOYMENT_TYPE) — không FK cứng,
 * cùng khuôn `patient.ethnicity`/`occupation`. `mustChangePassword` bắt tài khoản đổi mật khẩu ở
 * lần đăng nhập kế tiếp (enforce thật, xem `changePasswordRequestSchema` ở auth.ts).
 */
export const createUserAccountRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  personalEmail: z.string().email().optional(),
  companyEmail: z.string().email().optional(),
  licenseNo: z.string().optional(),
  academicTitleCode: z.string().optional(),
  positionCode: z.string().optional(),
  employmentStatusCode: z.string().optional(),
  employmentTypeCode: z.string().optional(),
  canSignMedicalRecord: z.boolean().optional().default(false),
  mustChangePassword: z.boolean().optional().default(false),
  departmentId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).min(1),
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
  phone: z.string().nullable().optional(),
  personalEmail: z.string().email().nullable().optional(),
  companyEmail: z.string().email().nullable().optional(),
  licenseNo: z.string().nullable().optional(),
  academicTitleCode: z.string().nullable().optional(),
  positionCode: z.string().nullable().optional(),
  employmentStatusCode: z.string().nullable().optional(),
  employmentTypeCode: z.string().nullable().optional(),
  canSignMedicalRecord: z.boolean().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).min(1).optional(),
  version: z.number().int().positive(),
});
export type UpdateUserAccountRequest = z.infer<typeof updateUserAccountRequestSchema>;

export const resetUserPasswordRequestSchema = z.object({
  newPassword: z.string().min(8),
  /** Admin đặt lại mật khẩu kèm bắt đổi lại ở lần đăng nhập kế tiếp — mặc định giữ nguyên cờ cũ. */
  mustChangePassword: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;

/** Không bao giờ chứa `passwordHash` — chỉ tên vai trò để hiển thị, không phải ma trận quyền. */
export const userAccountSummarySchema = z.object({
  id: z.string().uuid(),
  employeeCode: z.string().nullable(),
  username: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  personalEmail: z.string().nullable(),
  companyEmail: z.string().nullable(),
  licenseNo: z.string().nullable(),
  academicTitleCode: z.string().nullable(),
  positionCode: z.string().nullable(),
  employmentStatusCode: z.string().nullable(),
  employmentTypeCode: z.string().nullable(),
  canSignMedicalRecord: z.boolean(),
  mustChangePassword: z.boolean(),
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
