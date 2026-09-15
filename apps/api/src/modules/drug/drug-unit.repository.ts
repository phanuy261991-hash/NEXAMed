import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DrugUnitInput } from '@nexamed/shared';

/** Chỗ DUY NHẤT gọi Prisma cho bảng `drug_unit` (docs/DECISIONS.md #146, GĐ1). */
@Injectable()
export class DrugUnitRepository {
  /** Bulk-replace — cùng khuôn `DrugIngredientRepository.replaceForDrug()`. */
  async replaceForDrug(tx: Prisma.TransactionClient, tenantId: string, drugId: string, actorId: string, items: DrugUnitInput[]): Promise<void> {
    await tx.drugUnit.updateMany({
      where: { tenantId, drugId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.drugUnit.createMany({
        data: items.map((item) => ({
          tenantId,
          drugId,
          unitCode: item.unitCode,
          sortOrder: item.sortOrder,
          factorToUnitBelow: item.factorToUnitBelow,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
  }
}
