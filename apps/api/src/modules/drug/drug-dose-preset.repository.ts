import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DrugDosePresetInput } from '@nexamed/shared';

/** Chỗ DUY NHẤT gọi Prisma cho bảng `drug_dose_preset` ("Liều mẫu" của thuốc, docs/DECISIONS.md #267). */
@Injectable()
export class DrugDosePresetRepository {
  /** Bulk-replace — cùng khuôn `DrugUnitRepository.replaceForDrug()`: xoá mềm các dòng cũ rồi ghi lại theo thứ tự gửi lên. */
  async replaceForDrug(tx: Prisma.TransactionClient, tenantId: string, drugId: string, actorId: string, items: DrugDosePresetInput[]): Promise<void> {
    await tx.drugDosePreset.updateMany({
      where: { tenantId, drugId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.drugDosePreset.createMany({
        data: items.map((item, index) => ({
          tenantId,
          drugId,
          name: item.name.trim(),
          sortOrder: index,
          doseMorning: item.doseMorning,
          doseNoon: item.doseNoon,
          doseAfternoon: item.doseAfternoon,
          doseEvening: item.doseEvening,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
  }
}
