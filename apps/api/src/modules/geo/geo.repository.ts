import { Injectable } from '@nestjs/common';
import type { Prisma, Province, Ward } from '@prisma/client';

/**
 * Chỗ DUY NHẤT gọi Prisma cho `province`/`ward` — theo .claude/docs/coding-standards.md. Không
 * tenant_id (bảng toàn hệ thống, xem .claude/docs/data-model.md) nên không lọc `tenantId`.
 */
@Injectable()
export class GeoRepository {
  listProvinces(tx: Prisma.TransactionClient): Promise<Province[]> {
    return tx.province.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** `provinceCode` bỏ trống → toàn bộ ward (dùng để dựng bảng tra code→tên hiển thị, xem geo.controller.ts). */
  listWards(tx: Prisma.TransactionClient, provinceCode: string | undefined): Promise<Ward[]> {
    return tx.ward.findMany({
      where: provinceCode ? { provinceCode } : undefined,
      orderBy: [{ provinceCode: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  /** "Xuất bệnh án PDF" (S6-06) — tra tên theo mã cho ĐÚNG vài mã cần (địa chỉ 1 bệnh nhân), tránh
   * tải toàn bộ danh mục như `listProvinces()`/`listWards()` (dựng cho bảng tra cứu toàn bộ). */
  findProvincesByCodes(tx: Prisma.TransactionClient, codes: string[]): Promise<Province[]> {
    if (codes.length === 0) return Promise.resolve([]);
    return tx.province.findMany({ where: { code: { in: codes } } });
  }

  findWardsByCodes(tx: Prisma.TransactionClient, codes: string[]): Promise<Ward[]> {
    if (codes.length === 0) return Promise.resolve([]);
    return tx.ward.findMany({ where: { code: { in: codes } } });
  }
}
