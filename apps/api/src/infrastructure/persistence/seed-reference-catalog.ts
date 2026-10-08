import type { PrismaClient } from '@prisma/client';
import {
  DOSAGE_FORM_ITEMS,
  DRUG_GROUP_ITEMS,
  DRUG_ROUTE_ITEMS,
  EMPLOYMENT_STATUS_ITEMS,
  EMPLOYMENT_TYPE_ITEMS,
  ETHNICITY_ITEMS,
  formatShortSequentialCode,
  NATIONALITY_ITEMS,
  OCCUPATION_ITEMS,
  DRUG_USAGE_TIMING_ITEMS,
  REFERENCE_CATALOG_SHORT_CODE_PREFIXES,
  STORAGE_CONDITION_ITEMS,
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

  // Kho Thuốc GĐ1 (docs/DECISIONS.md #152) — 3 danh mục có nguồn dữ liệu chính thức, nạp ĐẦY ĐỦ
  // mọi cột của file gốc (mã UI/mã BYT/tên đầy đủ/mô tả), khác ACTIVE_INGREDIENT/STORAGE_
  // CONDITION/... (không seed cứng). `bytCode`/`fullName`/`description` không phải field admin
  // sửa được qua UI (khác `name`/`sortOrder`) nên seed luôn ghi đè lại theo nguồn, cùng khuôn
  // ETHNICITY/NATIONALITY/OCCUPATION ở trên.
  for (const item of DRUG_GROUP_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'DRUG_GROUP', code: item.code } },
      create: {
        category: 'DRUG_GROUP',
        code: item.code,
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
      },
      update: { name: item.name, sortOrder: item.sortOrder, bytCode: item.bytCode, fullName: item.fullName },
    });
  }

  for (const item of DRUG_ROUTE_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'DRUG_ROUTE', code: item.code } },
      create: {
        category: 'DRUG_ROUTE',
        code: item.code,
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
        description: item.description,
      },
      update: {
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
        description: item.description,
      },
    });
  }

  for (const item of DOSAGE_FORM_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'DOSAGE_FORM', code: item.code } },
      create: {
        category: 'DOSAGE_FORM',
        code: item.code,
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
        description: item.description,
      },
      update: {
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
        description: item.description,
      },
    });
  }

  // "Điều kiện bảo quản" (docs/DECISIONS.md #153) — cùng khuôn DRUG_ROUTE/DOSAGE_FORM ở trên (có
  // cột description).
  for (const item of STORAGE_CONDITION_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'STORAGE_CONDITION', code: item.code } },
      create: {
        category: 'STORAGE_CONDITION',
        code: item.code,
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
        description: item.description,
      },
      update: {
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
        description: item.description,
      },
    });
  }

  // "Thời điểm dùng thuốc" (docs/DECISIONS.md #155) — cùng khuôn DRUG_ROUTE/DOSAGE_FORM/
  // STORAGE_CONDITION ở trên (có cột description).
  for (const item of DRUG_USAGE_TIMING_ITEMS) {
    await prisma.referenceCatalog.upsert({
      where: { category_code: { category: 'DRUG_USAGE_TIMING', code: item.code } },
      create: {
        category: 'DRUG_USAGE_TIMING',
        code: item.code,
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
        description: item.description,
      },
      update: {
        name: item.name,
        sortOrder: item.sortOrder,
        bytCode: item.bytCode,
        fullName: item.fullName,
        description: item.description,
      },
    });
  }

  await seedUnits(prisma);
  await seedLabResultUnits(prisma);
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

/**
 * "Đơn vị kết quả xét nghiệm" (Cận lâm sàng GĐ2, docs/DECISIONS.md #212) — đơn vị phổ biến nạp sẵn để chọn thay vì gõ tay (tránh
 * "g/L"/"g/l"/"G/L" thành nhiều đơn vị). Idempotent THEO TÊN, đúng khuôn `seedUnits()`: mục đã tồn tại (kể cả do clinic_admin tự thêm
 * trùng tên) được BỎ QUA, không ghi đè — tôn trọng chỉnh sửa/ẩn qua UI.
 */
const LAB_RESULT_UNIT_SEED_NAMES = [
  'g/L', 'g/dL', 'mg/dL', 'mg/L', 'ng/mL', 'pg/mL', 'µg/dL', 'mmol/L', 'µmol/L', 'mEq/L',
  'U/L', 'IU/L', 'IU/mL', '%', '10^9/L', '10^12/L', 'fL', 'pg', 'mm/giờ', 'giây',
];

async function seedLabResultUnits(prisma: PrismaClient): Promise<void> {
  const prefix = REFERENCE_CATALOG_SHORT_CODE_PREFIXES.LAB_RESULT_UNIT;
  if (!prefix) {
    throw new Error('REFERENCE_CATALOG_SHORT_CODE_PREFIXES.LAB_RESULT_UNIT không được cấu hình.');
  }
  let sortOrder = 1;
  for (const name of LAB_RESULT_UNIT_SEED_NAMES) {
    const existing = await prisma.referenceCatalog.findFirst({ where: { category: 'LAB_RESULT_UNIT', name } });
    if (!existing) {
      const seq = await globalCodeSequenceRepository.next(prisma, prefix);
      await prisma.referenceCatalog.create({ data: { category: 'LAB_RESULT_UNIT', code: formatShortSequentialCode(prefix, seq), name, sortOrder } });
    }
    sortOrder += 1;
  }
}
