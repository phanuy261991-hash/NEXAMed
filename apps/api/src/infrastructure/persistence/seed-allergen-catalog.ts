import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ALLERGEN_CATALOG_SEED,
  ALLERGEN_CODE_PREFIX,
  ALLERGEN_GROUP_CODE_PREFIX,
  CATALOG_SEQUENCE_PREFIX,
  formatShortSequentialCode,
} from '@nexamed/core';
import { CodeSequenceRepository } from './code-sequence.repository';

const codeSequenceRepository = new CodeSequenceRepository();

/**
 * Seed danh mục "Dị nguyên" (docs/DECISIONS.md #069/#070) từ `ALLERGEN_CATALOG_SEED`
 * (`packages/core/src/allergen/data.ts`, nguồn `docs/data/allergen-catalog.md` chủ dự án cung
 * cấp) cho MỘT tenant (danh mục riêng theo tenant từ #230). Idempotent theo TÊN (không theo `code` —
 * nguồn dữ liệu này không có mã chính thức, `code` luôn tự sinh đúng quyết định #069): đã có
 * `AllergenGroup`/`Allergen` cùng tên (trong đúng nhóm) thì bỏ qua, không tạo trùng, không ghi đè
 * (clinic_admin có thể đã tự sửa tên/ẩn qua UI trước khi seed chạy lại). Mã ngắn tuần tự
 * (docs/DECISIONS.md #113) cấp atomic qua `code_sequence` của tenant, không cần retry trùng mã.
 */
export async function seedAllergenCatalogForTenant(client: Prisma.TransactionClient | PrismaClient, tenantId: string, actorId: string): Promise<void> {
  const tx = client as Prisma.TransactionClient;
  for (const group of ALLERGEN_CATALOG_SEED) {
    let groupRow = await tx.allergenGroup.findFirst({ where: { tenantId, name: group.groupName } });
    if (!groupRow) {
      const seq = await codeSequenceRepository.next(tx, tenantId, CATALOG_SEQUENCE_PREFIX + ALLERGEN_GROUP_CODE_PREFIX, actorId);
      groupRow = await tx.allergenGroup.create({
        data: { tenantId, code: formatShortSequentialCode(ALLERGEN_GROUP_CODE_PREFIX, seq), name: group.groupName, createdBy: actorId, updatedBy: actorId },
      });
    }
    const groupId = groupRow.id;

    const existingNames = new Set((await tx.allergen.findMany({ where: { tenantId, allergenGroupId: groupId }, select: { name: true } })).map((a) => a.name));
    for (const itemName of group.items) {
      if (existingNames.has(itemName)) continue;
      const seq = await codeSequenceRepository.next(tx, tenantId, CATALOG_SEQUENCE_PREFIX + ALLERGEN_CODE_PREFIX, actorId);
      await tx.allergen.create({
        data: {
          tenantId,
          allergenGroupId: groupId,
          code: formatShortSequentialCode(ALLERGEN_CODE_PREFIX, seq),
          name: itemName,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    }
  }
}
