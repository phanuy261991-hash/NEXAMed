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
  /** CHỈ nhập được lúc tạo mới, cho 5 category chuẩn BYT (đảo ngược một phần #152/#153, chốt
   * 17/09/2026) — mục `clinic_admin` tự thêm ngoài file nguồn BYT. */
  bytCode?: string | null;
  fullName?: string | null;
  /** Màu nắp ống (SPECIMEN_TYPE) và viết tắt in trên tem (TECH_SERVICE_CATEGORY) — docs/DECISIONS.md #220. */
  capColor?: string | null;
  abbreviation?: string | null;
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
  /** Sửa được sau khi tạo CHỈ cho category không có nguồn seed cần bảo vệ (ACTIVE_INGREDIENT) —
   * xem chú thích ở `updateReferenceCatalogRequestSchema` (packages/shared). */
  bytCode?: string | null;
  fullName?: string | null;
  capColor?: string | null;
  abbreviation?: string | null;
  direction?: ReferenceCatalogDirection | null;
  isActive?: boolean;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `reference_catalog` — theo .claude/docs/coding-standards.md.
 * RIÊNG THEO TENANT từ docs/DECISIONS.md #230 (trước đó dùng chung mọi tenant): mọi truy vấn lọc `tenant_id` tường minh (RLS là
 * lớp phòng thủ thứ hai). Có `version` từ #207 — sửa/ẩn/khôi phục khoá lạc quan bằng `WHERE tenant_id = ? AND id = ? AND version = ?` rồi tăng 1;
 * trả `count` (0 = lệch version hoặc không còn bản ghi — service phân biệt qua `findById`).
 */
@Injectable()
export class ReferenceCatalogRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateReferenceCatalogData): Promise<ReferenceCatalog> {
    return tx.referenceCatalog.create({ data: { ...data, tenantId, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ReferenceCatalog | null> {
    return tx.referenceCatalog.findFirst({ where: { tenantId, id } });
  }

  /** Dùng bởi `ReferenceCatalogReaderAdapter` (mở rộng ADM-01) — tra 1 mục theo (category, code). */
  findByCategoryAndCode(
    tx: Prisma.TransactionClient,
    tenantId: string,
    category: ReferenceCatalogCategory,
    code: string,
  ): Promise<ReferenceCatalog | null> {
    return tx.referenceCatalog.findUnique({ where: { tenantId_category_code: { tenantId, category, code } } });
  }

  listByCategory(
    tx: Prisma.TransactionClient,
    tenantId: string,
    category: ReferenceCatalogCategory,
    includeInactive: boolean,
  ): Promise<ReferenceCatalog[]> {
    return tx.referenceCatalog.findMany({
      where: includeInactive ? { tenantId, category } : { tenantId, category, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Nhập Excel Thuốc & Vật tư (#210) — đọc MỘT lần mọi mục (kể cả đã ẩn) của nhiều category để dựng chỉ mục tên → mã. */
  listByCategories(tx: Prisma.TransactionClient, tenantId: string, categories: ReferenceCatalogCategory[]): Promise<ReferenceCatalog[]> {
    return tx.referenceCatalog.findMany({ where: { tenantId, category: { in: categories } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  /** `data` có thể rỗng (PATCH chỉ đổi đơn giá bảng con) — vẫn tăng `version` để khoá lạc quan có hiệu lực. */
  async update(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateReferenceCatalogData,
  ): Promise<number> {
    const result = await tx.referenceCatalog.updateMany({
      where: { tenantId, id, version: expectedVersion },
      data: { ...data, version: { increment: 1 }, updatedBy: actorId },
    });
    return result.count;
  }

  async setActive(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, isActive: boolean, actorId: string): Promise<number> {
    const result = await tx.referenceCatalog.updateMany({
      where: { tenantId, id, version: expectedVersion },
      data: { isActive, version: { increment: 1 }, updatedBy: actorId },
    });
    return result.count;
  }
}
