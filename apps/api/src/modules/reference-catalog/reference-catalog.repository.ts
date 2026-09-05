import { Injectable } from '@nestjs/common';
import type { Prisma, ReferenceCatalog, ReferenceCatalogCategory, ReferenceCatalogDirection } from '@prisma/client';

export interface CreateReferenceCatalogData {
  category: ReferenceCatalogCategory;
  code: string;
  name: string;
  sortOrder: number;
  /** Giá tham khảo (đồng) — chỉ có ý nghĩa với category EXAM_TYPE, `undefined`/`null` với category khác. */
  price?: bigint | null;
  /** Đơn vị (ví dụ "Lượt") — cùng bản chất `price`, chỉ có ý nghĩa với category EXAM_TYPE. */
  unit?: string | null;
  /** Chỉ có ý nghĩa với category EMPLOYMENT_STATUS — mở rộng ADM-01, xem schema.prisma. */
  deactivatesAccount?: boolean;
  /** Chỉ có ý nghĩa với category PAYMENT_METHOD ("Chốt ca", 2026-09-03) — xem schema.prisma. */
  countsAsCash?: boolean;
  /** Chỉ có ý nghĩa với category UNIT (Đơn vị tính) — xem schema.prisma. */
  description?: string | null;
  /** Chỉ có ý nghĩa với category INCOME_EXPENSE_TYPE ("Loại thu chi", 2026-09-05) — xem schema.prisma. */
  direction?: ReferenceCatalogDirection | null;
  /** Chỉ ItemFormModal category UNIT gửi — category khác luôn tạo mới ở trạng thái hoạt động
   * (mặc định Prisma `true`), quản lý qua action Xoá/Khôi phục riêng như trước. */
  isActive?: boolean;
}

export interface UpdateReferenceCatalogData {
  code?: string;
  name?: string;
  sortOrder?: number;
  price?: bigint | null;
  unit?: string | null;
  deactivatesAccount?: boolean;
  countsAsCash?: boolean;
  description?: string | null;
  direction?: ReferenceCatalogDirection | null;
  isActive?: boolean;
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

  /** Dùng bởi `ReferenceCatalogReaderAdapter` (mở rộng ADM-01) — tra 1 mục theo (category, code). */
  findByCategoryAndCode(
    tx: Prisma.TransactionClient,
    category: ReferenceCatalogCategory,
    code: string,
  ): Promise<ReferenceCatalog | null> {
    return tx.referenceCatalog.findUnique({ where: { category_code: { category, code } } });
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
