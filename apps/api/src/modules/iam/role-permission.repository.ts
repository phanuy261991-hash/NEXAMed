import { Injectable } from '@nestjs/common';
import type { Permission, Prisma, RolePermission } from '@prisma/client';
import type { DataScope } from '@nexamed/shared';

/**
 * Ma trận `role_permission` cho MỘT vai trò (ADM-07). Tách khỏi `RoleRepository` vì đọc/ghi bảng
 * khác (`role_permission` + `permission`), cùng tinh thần `PatientRepository` vs
 * `code-sequence.repository.ts` tách theo bảng — .claude/docs/coding-standards.md.
 */
@Injectable()
export class RolePermissionRepository {
  /** Toàn bộ danh mục `permission` — không `tenant_id` (toàn hệ thống, giống `icd10_catalog`). */
  listCatalog(tx: Prisma.TransactionClient): Promise<Permission[]> {
    return tx.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
  }

  listForRole(tx: Prisma.TransactionClient, tenantId: string, roleId: string): Promise<RolePermission[]> {
    return tx.rolePermission.findMany({ where: { tenantId, roleId, deletedAt: null } });
  }

  /**
   * Ghi đè toàn bộ ma trận của một vai trò trong MỘT transaction: `dataScope='none'` thì soft-delete dòng
   * đang hiệu lực (nếu có); ngược lại cấp/đổi scope. Unique `(tenant_id, role_id, permission_id)` KHÔNG
   * phải partial nên dòng đã thu hồi (soft-delete) vẫn chiếm khoá — cấp LẠI một quyền từng thu hồi phải
   * HỒI SINH dòng cũ (`deleted_at = NULL`) chứ không `create` dòng mới (trước đây vỡ unique → 500
   * INTERNAL_ERROR, phát hiện qua test quét toàn bộ ma trận, docs/DECISIONS.md #207). Không dùng optimistic
   * lock theo `version` từng dòng — khoá lạc quan nằm ở `role.version` (xem `RoleService.updateRoleMatrix`).
   */
  async replaceMatrix(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roleId: string,
    actorId: string,
    entries: readonly { permissionId: string; dataScope: DataScope }[],
  ): Promise<void> {
    // Lấy CẢ dòng đã soft-delete (khác `listForRole`) để biết dòng nào đang chiếm khoá unique.
    const existing = await tx.rolePermission.findMany({ where: { tenantId, roleId } });
    const existingByPermissionId = new Map(existing.map((rp) => [rp.permissionId, rp]));

    for (const entry of entries) {
      const current = existingByPermissionId.get(entry.permissionId);

      if (entry.dataScope === 'none') {
        if (current && current.deletedAt === null) {
          await tx.rolePermission.update({
            where: { id: current.id },
            data: { deletedAt: new Date(), deletedReason: 'matrix_updated', updatedBy: actorId, version: { increment: 1 } },
          });
        }
        continue;
      }

      if (current) {
        if (current.deletedAt !== null) {
          // Hồi sinh dòng đã thu hồi trước đó.
          await tx.rolePermission.update({
            where: { id: current.id },
            data: { dataScope: entry.dataScope, deletedAt: null, deletedReason: null, updatedBy: actorId, version: { increment: 1 } },
          });
        } else if (current.dataScope !== entry.dataScope) {
          await tx.rolePermission.update({
            where: { id: current.id },
            data: { dataScope: entry.dataScope, updatedBy: actorId, version: { increment: 1 } },
          });
        }
      } else {
        await tx.rolePermission.create({
          data: {
            tenantId,
            roleId,
            permissionId: entry.permissionId,
            dataScope: entry.dataScope,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
      }
    }
  }
}
