import { z } from 'zod';
import { dataScopeSchema } from './data-scope';

/**
 * Vai trò + ma trận phân quyền tuỳ biến (ADM-07) — module `iam` sở hữu, cùng nhóm với
 * `user-account.ts`. 5 vai trò hệ thống (`USER_ROLES`, `roles.ts`) vẫn seed sẵn mỗi tenant
 * (`isSystemDefault=true`, không đổi tên/ẩn được — chỉ sửa ma trận); `clinic_admin` tạo thêm
 * được vai trò tuỳ biến (`isSystemDefault=false`), đổi tên/ẩn được.
 */
export const roleSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isSystemDefault: z.boolean(),
  version: z.number().int(),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const listRolesResponseSchema = z.object({
  items: z.array(roleSummarySchema),
});
export type ListRolesResponse = z.infer<typeof listRolesResponseSchema>;

export const createRoleRequestSchema = z.object({
  name: z.string().min(1).max(100),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const renameRoleRequestSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.number().int().positive(),
});
export type RenameRoleRequest = z.infer<typeof renameRoleRequestSchema>;

export const hideRoleRequestSchema = z.object({
  version: z.number().int().positive(),
});
export type HideRoleRequest = z.infer<typeof hideRoleRequestSchema>;

/** Một dòng trong ma trận: mô tả quyền + phạm vi dữ liệu hiện tại của MỘT vai trò cho quyền đó. */
export const rolePermissionEntrySchema = z.object({
  permissionId: z.string().uuid(),
  module: z.string(),
  action: z.string(),
  description: z.string(),
  dataScope: dataScopeSchema,
});
export type RolePermissionEntry = z.infer<typeof rolePermissionEntrySchema>;

/**
 * Ma trận ĐẦY ĐỦ của một vai trò — luôn đủ toàn bộ danh mục `permission` (kể cả quyền vai trò
 * chưa được cấp, trả về `dataScope: 'none'`) để màn hình hiển thị đúng mọi hàng ngay cả khi
 * `role_permission` chưa có dòng nào cho quyền đó.
 */
export const roleWithMatrixResponseSchema = z.object({
  role: roleSummarySchema,
  permissions: z.array(rolePermissionEntrySchema),
});
export type RoleWithMatrixResponse = z.infer<typeof roleWithMatrixResponseSchema>;

/**
 * Ghi đè toàn bộ ma trận của một vai trò trong một lần gọi — không có `version` optimistic lock
 * ở mức từng dòng `role_permission` (chỉ một `clinic_admin` chỉnh màn hình này tại một thời điểm
 * trong thực tế vận hành v1, đơn giản hoá có chủ đích thay vì khoá lạc quan từng ô).
 */
export const updateRolePermissionsRequestSchema = z.object({
  entries: z.array(z.object({ permissionId: z.string().uuid(), dataScope: dataScopeSchema })),
});
export type UpdateRolePermissionsRequest = z.infer<typeof updateRolePermissionsRequestSchema>;