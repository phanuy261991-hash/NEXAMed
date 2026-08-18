import { Injectable } from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';

/**
 * CRUD `role` (ADM-07 — vai trò tuỳ biến, cùng module `iam` sở hữu "tài khoản, vai trò" theo
 * .claude/docs/architecture.md). Chỗ DUY NHẤT gọi Prisma cho bảng `role` ngoài
 * `seed-tenant-roles.ts`/`sync-role-permissions.ts` (hạ tầng, không phải request thật).
 */
@Injectable()
export class RoleRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, name: string): Promise<Role> {
    return tx.role.create({
      data: { tenantId, name, isSystemDefault: false, createdBy: actorId, updatedBy: actorId },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Role | null> {
    return tx.role.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  list(tx: Prisma.TransactionClient, tenantId: string): Promise<Role[]> {
    return tx.role.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ isSystemDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /** Xác nhận toàn bộ `roleIds` thuộc đúng tenant và còn hiệu lực — dùng khi gán vai trò cho tài khoản (ADM-01). */
  async findValidIds(tx: Prisma.TransactionClient, tenantId: string, roleIds: readonly string[]): Promise<string[]> {
    const rows = await tx.role.findMany({
      where: { tenantId, id: { in: [...roleIds] }, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** `updateMany` + kiểm `count` — cùng lý do `PatientRepository.updateIfVersionMatches`. */
  async renameIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    name: string,
  ): Promise<number> {
    const result = await tx.role.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { name, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async hideIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<number> {
    const result = await tx.role.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'hidden_by_admin', updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Số tài khoản đang gán vai trò này (chỉ đếm gán còn hiệu lực) — chặn ẩn vai trò còn dùng. */
  countActiveAssignments(tx: Prisma.TransactionClient, tenantId: string, roleId: string): Promise<number> {
    return tx.userRole.count({ where: { tenantId, roleId, deletedAt: null } });
  }
}