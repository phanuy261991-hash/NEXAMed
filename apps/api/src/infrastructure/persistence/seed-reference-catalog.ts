import type { PrismaClient } from '@prisma/client';
import { ETHNICITY_ITEMS, NATIONALITY_ITEMS } from '@nexamed/core';

/**
 * Seed danh mục `reference_catalog` toàn hệ thống (idempotent — upsert theo (category, code)).
 * Không đụng `isActive` khi cập nhật dòng đã tồn tại — tránh seed script "hồi sinh" mục
 * `clinic_admin` đã chủ động ẩn qua UI quản lý.
 */
export async function seedReferenceCatalog(prisma: PrismaClient): Promise<void> {
  for (const item of ETHNICITY_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'ETHNICITY', code: item.code } },
      create: { category: 'ETHNICITY', code: item.code, name: item.name, sortOrder: item.sortOrder },
      update: { name: item.name, sortOrder: item.sortOrder },
    });
  }

  for (const item of NATIONALITY_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'NATIONALITY', code: item.code } },
      create: { category: 'NATIONALITY', code: item.code, name: item.name, sortOrder: item.sortOrder },
      update: { name: item.name, sortOrder: item.sortOrder },
    });
  }
}
