import type { PrismaClient } from '@prisma/client';
import { EMPLOYMENT_STATUS_ITEMS, EMPLOYMENT_TYPE_ITEMS, ETHNICITY_ITEMS, NATIONALITY_ITEMS } from '@nexamed/core';

/**
 * Seed danh mục `reference_catalog` toàn hệ thống (idempotent — upsert theo (category, code)).
 * Không đụng `isActive` khi cập nhật dòng đã tồn tại — tránh seed script "hồi sinh" mục
 * `clinic_admin` đã chủ động ẩn qua UI quản lý. Cùng lý do, `deactivatesAccount` (chỉ
 * EMPLOYMENT_STATUS) chỉ set lúc TẠO — không ghi đè nếu clinic_admin đã tự đổi cờ này qua UI.
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

  for (const item of EMPLOYMENT_STATUS_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'EMPLOYMENT_STATUS', code: item.code } },
      create: {
        category: 'EMPLOYMENT_STATUS',
        code: item.code,
        name: item.name,
        sortOrder: item.sortOrder,
        deactivatesAccount: item.deactivatesAccount ?? false,
      },
      update: { name: item.name, sortOrder: item.sortOrder },
    });
  }

  for (const item of EMPLOYMENT_TYPE_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'EMPLOYMENT_TYPE', code: item.code } },
      create: { category: 'EMPLOYMENT_TYPE', code: item.code, name: item.name, sortOrder: item.sortOrder },
      update: { name: item.name, sortOrder: item.sortOrder },
    });
  }
}
