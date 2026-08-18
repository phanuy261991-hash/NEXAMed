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
   * Ghi đè toàn bộ ma trận của một vai trò trong MỘT transaction: `dataScope='none'` thì
   * soft-delete dòng đang có (nếu có); ngược lại upsert (tạo mới nếu chưa có, cập nhật scope nếu
   * đã có và khác giá trị cũ). Không dùng optimistic lock theo `version` từng dòng — xem
   * `updateRolePermissionsRequestSchema` (packages/shared/src/role.ts) về lý do đơn giản hoá này.
   */
  async replaceMatrix(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roleId: string,
    actorId: string,
    entries: readonly { permissionId: string; dataScope: DataScope }[],
  ): Promise<void> {
    const existing = await this.listForRole(tx, tenantId, roleId);
    const existingByPermissionId = new Map(existing.map((rp) => [rp.permissionId, rp]));

    for (const entry of entries) {
      const current = existingByPermissionId.get(entry.permissionId);

      if (entry.dataScope === 'none') {
        if (current) {
          await tx.rolePermission.update({
            where: { id: current.id },
            data: { deletedAt: new Date(), deletedReason: 'matrix_updated', updatedBy: actorId, version: { increment: 1 } },
          });
        }
        continue;
      }

      if (current) {
        if (current.dataScope !== entry.dataScope) {
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