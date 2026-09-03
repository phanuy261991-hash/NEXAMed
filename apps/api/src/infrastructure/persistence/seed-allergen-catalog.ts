import type { AllergenGroup, PrismaClient } from '@prisma/client';
import { ALLERGEN_CATALOG_SEED, ALLERGEN_CODE_PREFIX, ALLERGEN_GROUP_CODE_PREFIX, formatShortSequentialCode } from '@nexamed/core';
import { GlobalCodeSequenceRepository } from './global-code-sequence.repository';

const globalCodeSequenceRepository = new GlobalCodeSequenceRepository();

/**
 * Seed danh mục "Dị nguyên" (docs/DECISIONS.md #069/#070) từ `ALLERGEN_CATALOG_SEED`
 * (`packages/core/src/allergen/data.ts`, nguồn `docs/data/allergen-catalog.md` chủ dự án cung
 * cấp). Idempotent theo TÊN (không theo `code` — khác `seedReferenceCatalog`/`seedIcd10Catalog`
 * vì nguồn dữ liệu này không có mã chính thức, `code` luôn tự sinh đúng quyết định #069): đã có
 * `AllergenGroup`/`Allergen` cùng tên (trong đúng nhóm) thì bỏ qua, không tạo trùng, không ghi đè
 * (clinic_admin có thể đã tự sửa tên/ẩn qua UI trước khi seed script chạy lại). Mã ngắn tuần tự
 * (docs/DECISIONS.md #113) cấp atomic qua `global_code_sequence`, không còn cần retry trùng mã.
 */
export async function seedAllergenCatalog(prisma: PrismaClient): Promise<void> {
  for (const group of ALLERGEN_CATALOG_SEED) {
    let groupRow: AllergenGroup | null = await prisma.allergenGroup.findFirst({ where: { name: group.groupName } });
    if (!groupRow) {
      const seq = await globalCodeSequenceRepository.next(prisma, ALLERGEN_GROUP_CODE_PREFIX);
      groupRow = await prisma.allergenGroup.create({
        data: { code: formatShortSequentialCode(ALLERGEN_GROUP_CODE_PREFIX, seq), name: group.groupName },
      });
    }
    const groupId = groupRow.id;

    for (const itemName of group.items) {
      const existing = await prisma.allergen.findFirst({ where: { allergenGroupId: groupId, name: itemName } });
      if (existing) continue;

      const seq = await globalCodeSequenceRepository.next(prisma, ALLERGEN_CODE_PREFIX);
      await prisma.allergen.create({
        data: { allergenGroupId: groupId, code: formatShortSequentialCode(ALLERGEN_CODE_PREFIX, seq), name: itemName },
      });
    }
  }
}
