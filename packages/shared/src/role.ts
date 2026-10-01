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
  /**
   * Quyền ĐI KÈM gợi ý (khoá `<module>.<action>`) — trang cần các quyền ĐỌC này để hiển thị đủ ô chọn/bảng, xem
   * `PERMISSION_COMPANIONS` ở `packages/core`. Chỉ để hiển thị gợi ý ở màn "Vai trò & Phân quyền", không ép buộc.
   */
  companions: z.array(z.string()),
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
 * Ghi đè toàn bộ ma trận của một vai trò trong một lần gọi. `version` là version của VAI TRÒ lúc màn hình
 * tải ma trận — lệch với DB (người khác vừa sửa ma trận/đổi tên vai trò) → 409 `CONCURRENT_MODIFICATION`
 * thay vì ghi đè âm thầm (docs/DECISIONS.md #207). Mỗi lần lưu ma trận tăng `role.version` lên 1.
 */
export const updateRolePermissionsRequestSchema = z.object({
  version: z.number().int().positive(),
  entries: z.array(z.object({ permissionId: z.string().uuid(), dataScope: dataScopeSchema })),
});
export type UpdateRolePermissionsRequest = z.infer<typeof updateRolePermissionsRequestSchema>;