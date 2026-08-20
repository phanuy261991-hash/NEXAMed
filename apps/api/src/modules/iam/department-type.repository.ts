import { Injectable } from '@nestjs/common';
import type { DepartmentType, Prisma } from '@prisma/client';

export interface UpdateDepartmentTypeData {
  name?: string;
  isActive?: boolean;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `department_type` (mở rộng ADM-01, yêu cầu chủ dự án
 * 2026-08-20) — .claude/docs/coding-standards.md. Cấp cha tùy chọn của `department`, cùng khuôn
 * `FloorRepository` (cấp cha tùy chọn của `room`).
 */
@Injectable()
export class DepartmentTypeRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, name: string): Promise<DepartmentType> {
    return tx.departmentType.create({
      data: { tenantId, name, createdBy: actorId, updatedBy: actorId },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<DepartmentType | null> {
    return tx.departmentType.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  list(tx: Prisma.TransactionClient, tenantId: string): Promise<DepartmentType[]> {
    return tx.departmentType.findMany({ where: { tenantId, deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateDepartmentTypeData,
  ): Promise<number> {
    const result = await tx.departmentType.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}