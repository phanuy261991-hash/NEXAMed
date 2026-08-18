import { Injectable } from '@nestjs/common';
import type { Icd10Catalog, Prisma } from '@prisma/client';

/**
 * Chỗ DUY NHẤT gọi Prisma cho `icd10_catalog` — theo .claude/docs/coding-standards.md. Không
 * tenant_id (bảng toàn hệ thống, xem .claude/docs/data-model.md) nên không lọc `tenantId`.
 */
@Injectable()
export class Icd10Repository {
  /**
   * Danh sách Chương duy nhất (v1 seed dần theo từng đợt, không hard-code số lượng). `orderBy` ở
   * đây chỉ để Prisma `distinct` có kết quả xác định (deterministic) — thứ tự Chương ĐÚNG theo
   * số La Mã được `Icd10Service.listChapters` sắp lại (`orderBy: chapterCode:'asc'` là sắp chuỗi,
   * sai thứ tự thật vì "IX" < "V" theo alphabet).
   */
  listChapters(tx: Prisma.TransactionClient): Promise<Pick<Icd10Catalog, 'chapterCode' | 'chapterName'>[]> {
    return tx.icd10Catalog.findMany({
      distinct: ['chapterCode'],
      select: { chapterCode: true, chapterName: true },
      orderBy: { chapterCode: 'asc' },
    });
  }

  /**
   * Danh sách Nhóm duy nhất thuộc 1 Chương, kèm `blockCode`/`blockName` (mọi dòng cùng `groupCode`
   * luôn cùng 1 Khối — dữ liệu nguồn đảm bảo, xem `packages/core/src/icd10/data.ts`).
   */
  listGroups(
    tx: Prisma.TransactionClient,
    chapterCode: string,
  ): Promise<Pick<Icd10Catalog, 'groupCode' | 'groupName' | 'blockCode' | 'blockName'>[]> {
    return tx.icd10Catalog.findMany({
      where: { chapterCode },
      distinct: ['groupCode'],
      select: { groupCode: true, groupName: true, blockCode: true, blockName: true },
      orderBy: { groupCode: 'asc' },
    });
  }

  /** Mọi dòng thuộc 1 Nhóm — gồm cả dòng cấp Nhóm (3 ký tự) lẫn mã chi tiết (4-5 ký tự). */
  listCodes(tx: Prisma.TransactionClient, groupCode: string): Promise<Icd10Catalog[]> {
    return tx.icd10Catalog.findMany({ where: { groupCode }, orderBy: { code: 'asc' } });
  }

  /**
   * Tìm theo mã (prefix) hoặc tên đã chuẩn hoá (`normalized` — bỏ dấu + viết thường qua
   * `stripVietnameseDiacritics`, tính ở service) khớp `searchKey`, đúng khuôn `patient.repository.ts`.
   */
  search(tx: Prisma.TransactionClient, params: { raw: string; normalized: string }): Promise<Icd10Catalog[]> {
    return tx.icd10Catalog.findMany({
      where: {
        OR: [
          { code: { startsWith: params.raw, mode: 'insensitive' } },
          { searchKey: { contains: params.normalized } },
        ],
      },
      orderBy: { code: 'asc' },
      take: 30,
    });
  }
}