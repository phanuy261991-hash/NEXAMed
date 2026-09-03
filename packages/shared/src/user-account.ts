import { z } from 'zod';

/**
 * Quản lý tài khoản + gán vai trò (S2-07, ADM-01) — module `iam` sở hữu (xem
 * .claude/docs/architecture.md mục Domain module: "iam | Tài khoản, vai trò, phiên đăng nhập,
 * audit log"). `roleIds` nhận `role.id` bất kỳ trong tenant (5 vai trò hệ thống lẫn vai trò tuỳ
 * biến tạo qua ADM-07, `role.ts`) — trước ADM-07 trường này là `roleNames` giới hạn 5 tên cố
 * định (`USER_ROLES`), đã đổi cùng lúc ADM-07 hiện thực vì vai trò tuỳ biến không có tên cố định
 * để enum hoá.
 */
/** Chỉ 2 giá trị (khác `patientGenderSchema` ở `patient.ts` có thêm `other`) — đúng yêu cầu form Thêm tài khoản (redesign 3-tab, 2026-08-27). */
export const USER_ACCOUNT_GENDERS = ['male', 'female'] as const;
export const userAccountGenderSchema = z.enum(USER_ACCOUNT_GENDERS);
export type UserAccountGender = z.infer<typeof userAccountGenderSchema>;

/**
 * Hồ sơ nhân sự (mở rộng ADM-01, redesign 3-tab 2026-08-27 — `docs/DECISIONS.md` #082) — mọi
 * trường dưới đều tuỳ chọn trừ `fullName`/`username`/`password`/`displayName`/`roleIds`. 4 trường
 * `*Code` lưu `code` của `reference_catalog` (category ACADEMIC_TITLE/STAFF_POSITION/
 * EMPLOYMENT_STATUS/EMPLOYMENT_TYPE) — không FK cứng, cùng khuôn `patient.ethnicity`/`occupation`.
 * `mustChangePassword` bắt tài khoản đổi mật khẩu ở lần đăng nhập kế tiếp (enforce thật, xem
 * `changePasswordRequestSchema` ở auth.ts). `email` GỘP `personalEmail`/`companyEmail` cũ thành 1
 * trường duy nhất (đảo ngược thiết kế ADM-01 ban đầu). `displayName` bắt buộc — dùng khi in đơn
 * thuốc/HSBA và mọi nơi hiển thị tên tài khoản (web tự gợi ý ghép Học vị/Học hàm + Họ tên, người
 * dùng chỉnh lại được, xem `UserAccountFormDialog.tsx`). `signatureKey` KHÔNG có ở đây — chữ ký
 * chỉ upload được sau khi tài khoản đã tồn tại (cùng lý do `patient.photoKey`), xem
 * `uploadSignatureFormSchema` ở `user-account.controller.ts` (`apps/api`).
 */
export const createUserAccountRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  fullName: z.string().min(1),
  displayName: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  dob: z.string().date().optional(),
  gender: userAccountGenderSchema.optional(),
  licenseNo: z.string().optional(),
  licenseIssuedAt: z.string().date().optional(),
  licenseIssuedPlace: z.string().optional(),
  academicTitleCode: z.string().optional(),
  positionCode: z.string().optional(),
  employmentStatusCode: z.string().optional(),
  employmentTypeCode: z.string().optional(),
  canSignMedicalRecord: z.boolean().optional().default(false),
  mustChangePassword: z.boolean().optional().default(false),
  departmentId: z.string().uuid().optional(),
  defaultRoomId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).min(1),
});
export type CreateUserAccountRequest = z.infer<typeof createUserAccountRequestSchema>;

/**
 * Sửa hồ sơ/vai trò/trạng thái tài khoản — bắt buộc kèm `version` (optimistic locking, cùng quy
 * ước `updatePatientRequestSchema`). Đổi mật khẩu KHÔNG nằm ở đây — xem
 * `resetUserPasswordRequestSchema` (tách riêng, đúng nguyên tắc "gộp mối lo khác nhau vào một
 * endpoint" nên tránh cho thao tác nhạy cảm). `displayName` KHÔNG nullable (trường bắt buộc, chỉ
 * bỏ qua khi không đổi — client luôn gửi lại giá trị hiện tại nếu không sửa).
 */
export const updateUserAccountRequestSchema = z.object({
  fullName: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  dob: z.string().date().nullable().optional(),
  gender: userAccountGenderSchema.nullable().optional(),
  licenseNo: z.string().nullable().optional(),
  licenseIssuedAt: z.string().date().nullable().optional(),
  licenseIssuedPlace: z.string().nullable().optional(),
  academicTitleCode: z.string().nullable().optional(),
  positionCode: z.string().nullable().optional(),
  employmentStatusCode: z.string().nullable().optional(),
  employmentTypeCode: z.string().nullable().optional(),
  canSignMedicalRecord: z.boolean().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  defaultRoomId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).min(1).optional(),
  version: z.number().int().positive(),
});
export type UpdateUserAccountRequest = z.infer<typeof updateUserAccountRequestSchema>;

/**
 * Tự sửa hồ sơ CÁ NHÂN của chính mình (menu avatar "Thông tin tài khoản", popup
 * `MyAccountDialog.tsx`) — CHỈ 4 trường liên hệ thuần tuý, KHÔNG có `fullName`/`displayName`/vai
 * trò/hồ sơ nhân sự-pháp lý (Chức danh, Học hàm, CCHN, Khoa/Phòng, Trạng thái làm việc...) — những
 * trường đó vẫn do Quản trị kiểm soát qua `updateUserAccountRequestSchema`/`PATCH /users/:id`, vì
 * dùng để ký HSBA/in đơn thuốc, tự sửa dễ gây lệch tên trên hồ sơ đã ký. Route riêng `PATCH
 * /users/me` (không qua `PermissionGuard`, tự-phục vụ đúng mẫu `changePasswordRequestSchema`) —
 * xem `user-account.controller.ts`.
 */
export const updateOwnProfileRequestSchema = z.object({
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  dob: z.string().date().nullable().optional(),
  gender: userAccountGenderSchema.nullable().optional(),
  version: z.number().int().positive(),
});
export type UpdateOwnProfileRequest = z.infer<typeof updateOwnProfileRequestSchema>;

export const resetUserPasswordRequestSchema = z.object({
  newPassword: z.string().min(8),
  /** Admin đặt lại mật khẩu kèm bắt đổi lại ở lần đăng nhập kế tiếp — mặc định giữ nguyên cờ cũ. */
  mustChangePassword: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;

/**
 * Không bao giờ chứa `passwordHash` — chỉ tên vai trò để hiển thị, không phải ma trận quyền.
 * `signatureUrl` là URL đã ký (cùng cơ chế `patient.photoUrl`) — không bao giờ lộ `signatureKey`
 * thô ra API.
 */
export const userAccountSummarySchema = z.object({
  id: z.string().uuid(),
  employeeCode: z.string().nullable(),
  username: z.string(),
  fullName: z.string(),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  dob: z.string().nullable(),
  gender: userAccountGenderSchema.nullable(),
  licenseNo: z.string().nullable(),
  licenseIssuedAt: z.string().nullable(),
  licenseIssuedPlace: z.string().nullable(),
  academicTitleCode: z.string().nullable(),
  positionCode: z.string().nullable(),
  employmentStatusCode: z.string().nullable(),
  employmentTypeCode: z.string().nullable(),
  canSignMedicalRecord: z.boolean(),
  mustChangePassword: z.boolean(),
  departmentId: z.string().uuid().nullable(),
  defaultRoomId: z.string().uuid().nullable(),
  signatureUrl: z.string().nullable(),
  isActive: z.boolean(),
  roleNames: z.array(z.string()),
  version: z.number().int(),
  /** "Lịch làm việc nhân viên" — chỉ hiện nhân viên đã tồn tại tại thời điểm tháng đang xem, tránh
   * hiện tên nhân viên mới tạo ở tháng trước ngày họ được tạo (2026-09-03, ngoài kế hoạch). */
  createdAt: z.string(),
  /** Cùng mục đích với `createdAt` — khi `isActive=false` (nghỉ việc), xấp xỉ thời điểm nghỉ bằng
   * lần sửa gần nhất (đủ dùng cho mục đích hiển thị lịch, không phải nguồn sự thật pháp lý). */
  updatedAt: z.string(),
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