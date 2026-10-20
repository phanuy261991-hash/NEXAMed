import { Injectable } from '@nestjs/common';
import type { Branch, Prisma } from '@prisma/client';

export interface CreateBranchData {
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  facilityCode: string | null;
  isDefault: boolean;
}

export interface UpdateBranchData {
  name?: string;
  address?: string | null;
  phone?: string | null;
  facilityCode?: string | null;
  isActive?: boolean;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `branch` và `user_branch` (docs/DECISIONS.md #231) — theo .claude/docs/coding-standards.md.
 * Mọi truy vấn lọc `tenantId` tường minh (RLS là lớp thứ hai). `user_branch` có partial unique `WHERE deleted_at IS NULL` nên gỡ = soft-delete.
 */
@Injectable()
export class BranchRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateBranchData): Promise<Branch> {
    return tx.branch.create({ data: { ...data, tenantId, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Branch | null> {
    return tx.branch.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  findDefault(tx: Prisma.TransactionClient, tenantId: string): Promise<Branch | null> {
    return tx.branch.findFirst({ where: { tenantId, isDefault: true, deletedAt: null } });
  }

  /** Mặc định đứng đầu, sau đó theo tên — thứ tự hiển thị ở mọi nơi (danh sách, bộ chuyển, form). */
  list(tx: Prisma.TransactionClient, tenantId: string, includeInactive: boolean): Promise<Branch[]> {
    return tx.branch.findMany({
      where: includeInactive ? { tenantId, deletedAt: null } : { tenantId, deletedAt: null, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  countActive(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    return tx.branch.count({ where: { tenantId, deletedAt: null, isActive: true } });
  }

  /** Trùng tên (không phân biệt hoa/thường) với chi nhánh KHÁC đang hoạt động. */
  async existsActiveByName(tx: Prisma.TransactionClient, tenantId: string, name: string, excludeId?: string): Promise<boolean> {
    const found = await tx.branch.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  /** Khoá lạc quan `WHERE tenant_id AND id AND version` rồi tăng 1; `count=0` = lệch version (service đã kiểm tồn tại trước). */
  async update(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateBranchData,
  ): Promise<number> {
    const result = await tx.branch.updateMany({
      where: { tenantId, id, deletedAt: null, version: expectedVersion },
      data: { ...data, version: { increment: 1 }, updatedBy: actorId },
    });
    return result.count;
  }

  // ----- user_branch -----

  /** Chi nhánh được gán rõ ràng cho 1 tài khoản (chỉ chi nhánh còn hoạt động). */
  async listAssignedBranches(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<Branch[]> {
    const rows = await tx.userBranch.findMany({
      where: { tenantId, userId, deletedAt: null, branch: { deletedAt: null, isActive: true } },
      include: { branch: true },
    });
    return rows.map((r) => r.branch).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, 'vi'));
  }

  /** `userId → branchId[]` cho nhiều tài khoản trong 1 query (danh sách tài khoản, không N+1). */
  async mapAssignedBranchIds(tx: Prisma.TransactionClient, tenantId: string, userIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (userIds.length === 0) return result;
    const rows = await tx.userBranch.findMany({
      where: { tenantId, userId: { in: userIds }, deletedAt: null, branch: { deletedAt: null, isActive: true } },
      select: { userId: true, branchId: true },
    });
    for (const row of rows) {
      const list = result.get(row.userId) ?? [];
      list.push(row.branchId);
      result.set(row.userId, list);
    }
    return result;
  }

  /** Số tài khoản đang hoạt động được gán từng chi nhánh (`branchId → số`). */
  async countStaffByBranch(tx: Prisma.TransactionClient, tenantId: string): Promise<Map<string, number>> {
    const rows = await tx.userBranch.groupBy({
      by: ['branchId'],
      where: { tenantId, deletedAt: null, user: { deletedAt: null, isActive: true } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.branchId, r._count._all]));
  }

  countActiveUsers(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    return tx.userAccount.count({ where: { tenantId, deletedAt: null, isActive: true } });
  }

  /**
   * Đặt lại danh sách chi nhánh của 1 tài khoản: thêm chi nhánh mới, gỡ (soft-delete) chi nhánh không còn. Trả `true` nếu có thay đổi
   * (nơi gọi dùng để thu hồi phiên và ghi audit).
   */
  async replaceAssignments(tx: Prisma.TransactionClient, tenantId: string, actorId: string, userId: string, branchIds: string[]): Promise<boolean> {
    const existing = await tx.userBranch.findMany({ where: { tenantId, userId, deletedAt: null }, select: { id: true, branchId: true } });
    const wanted = new Set(branchIds);
    const have = new Set(existing.map((r) => r.branchId));
    const toRemove = existing.filter((r) => !wanted.has(r.branchId));
    const toAdd = [...wanted].filter((id) => !have.has(id));
    if (toRemove.length > 0) {
      await tx.userBranch.updateMany({
        where: { tenantId, id: { in: toRemove.map((r) => r.id) } },
        data: { deletedAt: new Date(), deletedReason: 'Gỡ chi nhánh làm việc', updatedBy: actorId, version: { increment: 1 } },
      });
    }
    if (toAdd.length > 0) {
      await tx.userBranch.createMany({
        data: toAdd.map((branchId) => ({ tenantId, userId, branchId, createdBy: actorId, updatedBy: actorId })),
        skipDuplicates: true,
      });
    }
    return toRemove.length > 0 || toAdd.length > 0;
  }

  /**
   * Khi công ty thêm chi nhánh thứ 2: tài khoản chưa có dòng `user_branch` nào (tạo trực tiếp ở DB, hoặc nhờ quy tắc "công ty 1 chi nhánh thì ai cũng
   * thuộc chi nhánh đó") được gán vào chi nhánh mặc định, để không mất quyền vào chi nhánh cũ.
   */
  async assignUnassignedUsersToBranch(tx: Prisma.TransactionClient, tenantId: string, actorId: string, branchId: string): Promise<number> {
    const users = await tx.userAccount.findMany({
      where: { tenantId, deletedAt: null, branches: { none: { deletedAt: null } } },
      select: { id: true },
    });
    if (users.length === 0) return 0;
    await tx.userBranch.createMany({
      data: users.map((u) => ({ tenantId, userId: u.id, branchId, createdBy: actorId, updatedBy: actorId })),
      skipDuplicates: true,
    });
    return users.length;
  }
}
