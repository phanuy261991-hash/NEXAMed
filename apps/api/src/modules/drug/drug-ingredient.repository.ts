import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DrugIngredientInput } from '@nexamed/shared';

/** Chỗ DUY NHẤT gọi Prisma cho bảng `drug_ingredient` (docs/DECISIONS.md #146, GĐ1). */
@Injectable()
export class DrugIngredientRepository {
  /** Bulk-replace — đúng khuôn `DiagnosisRepository.replaceForEncounter()`: xoá mềm hết dòng cũ
   * rồi tạo lại toàn bộ, đơn giản hơn diff từng dòng vì số dòng nhỏ (vài hoạt chất/thuốc). */
  async replaceForDrug(tx: Prisma.TransactionClient, tenantId: string, drugId: string, actorId: string, items: DrugIngredientInput[]): Promise<void> {
    await tx.drugIngredient.updateMany({
      where: { tenantId, drugId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.drugIngredient.createMany({
        data: items.map((item) => ({
          tenantId,
          drugId,
          activeIngredientCode: item.activeIngredientCode,
          strengthValue: item.strengthValue,
          strengthUnitCode: item.strengthUnitCode,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
  }
}
