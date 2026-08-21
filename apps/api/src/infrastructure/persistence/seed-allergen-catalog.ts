import type { AllergenGroup, PrismaClient } from '@prisma/client';
import { ALLERGEN_CATALOG_SEED, generateAllergenCode, generateAllergenGroupCode } from '@nexamed/core';

/** Random UUID nên xác suất trùng cực nhỏ — vài lần thử là đủ, không cần vòng lặp lớn. */
const AUTO_CODE_MAX_ATTEMPTS = 5;

function isDuplicateCodeViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
}

/**
 * Seed danh mục "Dị nguyên" (docs/DECISIONS.md #069/#070) từ `ALLERGEN_CATALOG_SEED`
 * (`packages/core/src/allergen/data.ts`, nguồn `docs/data/allergen-catalog.md` chủ dự án cung
 * cấp). Idempotent theo TÊN (không theo `code` — khác `seedReferenceCatalog`/`seedIcd10Catalog`
 * vì nguồn dữ liệu này không có mã chính thức, `code` luôn tự sinh đúng quyết định #069): đã có
 * `AllergenGroup`/`Allergen` cùng tên (trong đúng nhóm) thì bỏ qua, không tạo trùng, không ghi đè
 * (clinic_admin có thể đã tự sửa tên/ẩn qua UI trước khi seed script chạy lại).
 */
export async function seedAllergenCatalog(prisma: PrismaClient): Promise<void> {
  for (const group of ALLERGEN_CATALOG_SEED) {
    let groupRow: AllergenGroup | null = await prisma.allergenGroup.findFirst({ where: { name: group.groupName } });
    if (!groupRow) {
      groupRow = await createWithRetry(() =>
        prisma.allergenGroup.create({ data: { code: generateAllergenGroupCode(), name: group.groupName } }),
      );
    }
    const groupId = groupRow.id;

    for (const itemName of group.items) {
      const existing = await prisma.allergen.findFirst({ where: { allergenGroupId: groupId, name: itemName } });
      if (existing) continue;

      await createWithRetry(() =>
        prisma.allergen.create({ data: { allergenGroupId: groupId, code: generateAllergenCode(), name: itemName } }),
      );
    }
  }
}

/** Retry khi mã tự sinh trùng (P2002) — cùng cơ chế `AllergenGroupService`/`AllergenService`. */
async function createWithRetry<T>(create: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= AUTO_CODE_MAX_ATTEMPTS; attempt++) {
    try {
      return await create();
    } catch (err) {
      if (!isDuplicateCodeViolation(err) || attempt === AUTO_CODE_MAX_ATTEMPTS) throw err;
    }
  }
  throw new Error('Không thể tạo bản ghi sau nhiều lần thử — mã tự sinh liên tục trùng.');
}
