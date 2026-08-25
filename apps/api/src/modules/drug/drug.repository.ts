import { Injectable } from '@nestjs/common';
import type { Drug, Prisma } from '@prisma/client';

export interface CreateDrugData {
  code: string;
  name: string;
  activeIngredient: string | null;
  unit: string | null;
  concentration: string | null;
}

export interface UpdateDrugData {
  code?: string;
  name?: string;
  activeIngredient?: string | null;
  unit?: string | null;
  concentration?: string | null;
  isActive?: boolean;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `drug` (Sprint 4, S4-03) — theo .claude/docs/coding-standards.md. */
@Injectable()
export class DrugRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateDrugData): Promise<Drug> {
    return tx.drug.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Drug | null> {
    return tx.drug.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  findByIds(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<Drug[]> {
    return tx.drug.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null } });
  }

  /** `q` — tìm theo tên/mã/hoạt chất (contains, không phân biệt hoa thường) — dùng lúc kê đơn. */
  list(tx: Prisma.TransactionClient, tenantId: string, params: { q?: string; includeInactive: boolean }): Promise<Drug[]> {
    const where: Prisma.DrugWhereInput = { tenantId, deletedAt: null, ...(params.includeInactive ? {} : { isActive: true }) };
    if (params.q) {
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { code: { contains: params.q, mode: 'insensitive' } },
        { activeIngredient: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    return tx.drug.findMany({ where, orderBy: { name: 'asc' } });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateDrugData,
  ): Promise<number> {
    const result = await tx.drug.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
