import { Injectable } from '@nestjs/common';
import type { AllergenGroup, Prisma } from '@prisma/client';

export interface CreateAllergenGroupData {
  code: string;
  name: string;
}

export interface UpdateAllergenGroupData {
  name?: string;
  isActive?: boolean;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `allergen_group` — theo .claude/docs/coding-standards.md.
 * RIÊNG THEO TENANT từ docs/DECISIONS.md #230: mọi truy vấn lọc `tenantId` tường minh.
 */
@Injectable()
export class AllergenGroupRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateAllergenGroupData): Promise<AllergenGroup> {
    return tx.allergenGroup.create({ data: { ...data, tenantId, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<AllergenGroup | null> {
    return tx.allergenGroup.findFirst({ where: { tenantId, id } });
  }

  list(tx: Prisma.TransactionClient, tenantId: string, includeInactive: boolean): Promise<AllergenGroup[]> {
    return tx.allergenGroup.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async update(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, data: UpdateAllergenGroupData): Promise<number> {
    const result = await tx.allergenGroup.updateMany({ where: { tenantId, id }, data: { ...data, version: { increment: 1 }, updatedBy: actorId } });
    return result.count;
  }

  async setActive(tx: Prisma.TransactionClient, tenantId: string, id: string, isActive: boolean, actorId: string): Promise<number> {
    const result = await tx.allergenGroup.updateMany({ where: { tenantId, id }, data: { isActive, version: { increment: 1 }, updatedBy: actorId } });
    return result.count;
  }
}
