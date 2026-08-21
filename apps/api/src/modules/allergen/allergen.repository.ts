import { Injectable } from '@nestjs/common';
import type { Allergen, Prisma } from '@prisma/client';

export interface CreateAllergenData {
  allergenGroupId: string;
  code: string;
  name: string;
}

export interface UpdateAllergenData {
  allergenGroupId?: string;
  name?: string;
  isActive?: boolean;
}

export interface AllergenWithGroupName extends Allergen {
  allergenGroup: { name: string };
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `allergen` — theo .claude/docs/coding-standards.md. Không
 * tenant_id/version (bảng toàn hệ thống), đúng khuôn `ReferenceCatalogRepository`.
 */
@Injectable()
export class AllergenRepository {
  create(tx: Prisma.TransactionClient, data: CreateAllergenData): Promise<AllergenWithGroupName> {
    return tx.allergen.create({ data, include: { allergenGroup: { select: { name: true } } } });
  }

  findById(tx: Prisma.TransactionClient, id: string): Promise<AllergenWithGroupName | null> {
    return tx.allergen.findUnique({ where: { id }, include: { allergenGroup: { select: { name: true } } } });
  }

  /** Danh sách TẤT CẢ dị nguyên (không phân trang, quy mô danh mục nhỏ) — web tự lọc theo nhóm đang chọn ở client, đúng khuôn `DepartmentRepository.list()`. */
  list(tx: Prisma.TransactionClient, includeInactive: boolean): Promise<AllergenWithGroupName[]> {
    return tx.allergen.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { allergenGroup: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async update(tx: Prisma.TransactionClient, id: string, data: UpdateAllergenData): Promise<number> {
    const result = await tx.allergen.updateMany({ where: { id }, data });
    return result.count;
  }

  async setActive(tx: Prisma.TransactionClient, id: string, isActive: boolean): Promise<number> {
    const result = await tx.allergen.updateMany({ where: { id }, data: { isActive } });
    return result.count;
  }
}
