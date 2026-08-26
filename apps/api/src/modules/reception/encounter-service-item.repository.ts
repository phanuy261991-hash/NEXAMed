import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface CreateEncounterServiceItemData {
  examTypeCode: string;
  examTypeName: string;
  priceTypeCode: string | null;
  unitCode: string | null;
  examTypePrice: bigint | null;
  quantity: number;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `encounter_service_item` — module `reception` sở hữu hẳn bảng
 * này (khác `encounter`, chia sẻ qua `EncounterRepository`), cùng khuôn `VitalSignRepository`
 * (docs/DECISIONS.md #080).
 */
@Injectable()
export class EncounterServiceItemRepository {
  createMany(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    encounterId: string,
    items: CreateEncounterServiceItemData[],
  ): Promise<Prisma.BatchPayload> {
    return tx.encounterServiceItem.createMany({
      data: items.map((item) => ({
        tenantId,
        encounterId,
        examTypeCode: item.examTypeCode,
        examTypeName: item.examTypeName,
        priceTypeCode: item.priceTypeCode,
        unitCode: item.unitCode,
        examTypePrice: item.examTypePrice,
        quantity: item.quantity,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
  }
}
