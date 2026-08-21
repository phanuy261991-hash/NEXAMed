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
 * Không tenant_id/version (bảng toàn hệ thống, xem .claude/docs/data-model.md) nên thao tác
 * "sửa theo điều kiện" chỉ khoá bằng `id`, đúng khuôn `ReferenceCatalogRepository`.
 */
@Injectable()
export class AllergenGroupRepository {
  create(tx: Prisma.TransactionClient, data: CreateAllergenGroupData): Promise<AllergenGroup> {
    return tx.allergenGroup.create({ data });
  }

  findById(tx: Prisma.TransactionClient, id: string): Promise<AllergenGroup | null> {
    return tx.allergenGroup.findUnique({ where: { id } });
  }

  list(tx: Prisma.TransactionClient, includeInactive: boolean): Promise<AllergenGroup[]> {
    return tx.allergenGroup.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async update(tx: Prisma.TransactionClient, id: string, data: UpdateAllergenGroupData): Promise<number> {
    const result = await tx.allergenGroup.updateMany({ where: { id }, data });
    return result.count;
  }

  async setActive(tx: Prisma.TransactionClient, id: string, isActive: boolean): Promise<number> {
    const result = await tx.allergenGroup.updateMany({ where: { id }, data: { isActive } });
    return result.count;
  }
}
