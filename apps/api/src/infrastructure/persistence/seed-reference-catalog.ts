import type { PrismaClient } from '@prisma/client';
import {
  EMPLOYMENT_STATUS_ITEMS,
  EMPLOYMENT_TYPE_ITEMS,
  ETHNICITY_ITEMS,
  formatShortSequentialCode,
  NATIONALITY_ITEMS,
  OCCUPATION_ITEMS,
  REFERENCE_CATALOG_SHORT_CODE_PREFIXES,
  UNIT_SEED_ITEMS,
} from '@nexamed/core';
import { GlobalCodeSequenceRepository } from './global-code-sequence.repository';

const globalCodeSequenceRepository = new GlobalCodeSequenceRepository();

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

  for (const item of OCCUPATION_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'OCCUPATION', code: item.code } },
      create: { category: 'OCCUPATION', code: item.code, name: item.name, sortOrder: item.sortOrder },
      update: { name: item.name, sortOrder: item.sortOrder },
    });
  }

  await seedUnits(prisma);
}

/**
 * "Đơn vị tính" (docs/DECISIONS.md, chủ dự án cung cấp `docs/data/don-vi-tinh.md`) — khác 4 vòng
 * lặp ở trên: category UNIT không có mã chính thức trong nguồn dữ liệu (dùng mã NGẮN, TUẦN TỰ tự
 * sinh, #113) nên idempotent THEO TÊN thay vì theo `code` — đúng khuôn `seedAllergenCatalog()`.
 * Mục đã tồn tại (kể cả do clinic_admin tự tạo trùng tên trước khi seed chạy) được BỎ QUA, không
 * ghi đè `description`/`sortOrder` — tôn trọng chỉnh sửa thủ công qua UI.
 */
async function seedUnits(prisma: PrismaClient): Promise<void> {
  const prefix = REFERENCE_CATALOG_SHORT_CODE_PREFIXES.UNIT;
  if (!prefix) {
    throw new Error('REFERENCE_CATALOG_SHORT_CODE_PREFIXES.UNIT không được cấu hình.');
  }
  let sortOrder = 1;
  for (const item of UNIT_SEED_ITEMS) {
    const existing = await prisma.referenceCatalog.findFirst({ where: { category: 'UNIT', name: item.name } });
    if (!existing) {
      const seq = await globalCodeSequenceRepository.next(prisma, prefix);
      await prisma.referenceCatalog.create({
        data: {
          category: 'UNIT',
          code: formatShortSequentialCode(prefix, seq),
          name: item.name,
          description: item.description,
          sortOrder,
        },
      });
    }
    sortOrder += 1;
  }
}
