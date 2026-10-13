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
 * Chỗ DUY NHẤT gọi Prisma cho bảng `allergen` — theo .claude/docs/coding-standards.md. RIÊNG THEO
 * TENANT từ docs/DECISIONS.md #230: mọi truy vấn lọc `tenantId` tường minh.
 */
@Injectable()
export class AllergenRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateAllergenData): Promise<AllergenWithGroupName> {
    return tx.allergen.create({ data: { ...data, tenantId, createdBy: actorId, updatedBy: actorId }, include: { allergenGroup: { select: { name: true } } } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<AllergenWithGroupName | null> {
    return tx.allergen.findFirst({ where: { tenantId, id }, include: { allergenGroup: { select: { name: true } } } });
  }

  /** Danh sách TẤT CẢ dị nguyên (không phân trang, quy mô danh mục nhỏ) — web tự lọc theo nhóm đang chọn ở client, đúng khuôn `DepartmentRepository.list()`. */
  list(tx: Prisma.TransactionClient, tenantId: string, includeInactive: boolean): Promise<AllergenWithGroupName[]> {
    return tx.allergen.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      include: { allergenGroup: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async update(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, data: UpdateAllergenData): Promise<number> {
    const result = await tx.allergen.updateMany({ where: { tenantId, id }, data: { ...data, version: { increment: 1 }, updatedBy: actorId } });
    return result.count;
  }

  async setActive(tx: Prisma.TransactionClient, tenantId: string, id: string, isActive: boolean, actorId: string): Promise<number> {
    const result = await tx.allergen.updateMany({ where: { tenantId, id }, data: { isActive, version: { increment: 1 }, updatedBy: actorId } });
    return result.count;
  }
}
