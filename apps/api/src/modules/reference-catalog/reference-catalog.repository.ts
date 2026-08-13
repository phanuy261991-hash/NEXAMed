import { Injectable } from '@nestjs/common';
import type { Prisma, ReferenceCatalog, ReferenceCatalogCategory } from '@prisma/client';

export interface CreateReferenceCatalogData {
  category: ReferenceCatalogCategory;
  code: string;
  name: string;
  sortOrder: number;
  /** Giá tham khảo (đồng) — chỉ có ý nghĩa với category EXAM_TYPE, `undefined`/`null` với category khác. */
  price?: bigint | null;
}

export interface UpdateReferenceCatalogData {
  code?: string;
  name?: string;
  sortOrder?: number;
  price?: bigint | null;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `reference_catalog` — theo .claude/docs/coding-standards.md.
 * Không tenant_id/version (bảng toàn hệ thống, xem .claude/docs/data-model.md) nên các thao tác
 * "sửa theo điều kiện" chỉ khoá bằng `id`, không có `WHERE version = ?` như bảng nghiệp vụ khác.
 */
@Injectable()
export class ReferenceCatalogRepository {
  create(tx: Prisma.TransactionClient, data: CreateReferenceCatalogData): Promise<ReferenceCatalog> {
    return tx.referenceCatalog.create({ data });
  }

  findById(tx: Prisma.TransactionClient, id: string): Promise<ReferenceCatalog | null> {
    return tx.referenceCatalog.findUnique({ where: { id } });
  }

  listByCategory(
    tx: Prisma.TransactionClient,
    category: ReferenceCatalogCategory,
    includeInactive: boolean,
  ): Promise<ReferenceCatalog[]> {
    return tx.referenceCatalog.findMany({
      where: includeInactive ? { category } : { category, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async update(tx: Prisma.TransactionClient, id: string, data: UpdateReferenceCatalogData): Promise<number> {
    const result = await tx.referenceCatalog.updateMany({ where: { id }, data });
    return result.count;
  }

  async setActive(tx: Prisma.TransactionClient, id: string, isActive: boolean): Promise<number> {
    const result = await tx.referenceCatalog.updateMany({ where: { id }, data: { isActive } });
    return result.count;
  }
}
