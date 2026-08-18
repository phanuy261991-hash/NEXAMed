import type { PrismaClient } from '@prisma/client';
import { ICD10_ITEMS } from '@nexamed/core';

/**
 * Seed danh mục `icd10_catalog` toàn hệ thống (S3-01, mở khoá một phần — chỉ Chương I) — read-only
 * lúc chạy. `createMany({skipDuplicates:true})` — đúng khuôn `ward` (S2-02): bulk, idempotent,
 * phù hợp vì các chương khác sẽ bổ sung dần sau qua cùng script (chạy lại không tạo trùng, không
 * cập nhật tại chỗ dòng đã tồn tại — khác `province` vì danh mục Bộ Y tế hiếm khi cần sửa tên sau
 * khi soạn seed).
 */
export async function seedIcd10Catalog(prisma: PrismaClient): Promise<void> {
  await prisma.icd10Catalog.createMany({
    data: ICD10_ITEMS.map((item) => ({
      code: item.code,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      chapterCode: item.chapterCode,
      chapterName: item.chapterName,
      blockCode: item.blockCode,
      blockName: item.blockName,
      groupCode: item.groupCode,
      groupName: item.groupName,
      isBillable: item.isBillable,
      genderRestriction: item.genderRestriction,
      usageRestriction: item.usageRestriction,
      whoNote: item.whoNote,
    })),
    skipDuplicates: true,
  });
}