import { Injectable } from '@nestjs/common';
import type { Diagnosis, Prisma } from '@prisma/client';

export interface DiagnosisWithIcd10Name extends Diagnosis {
  icd10: { nameVi: string };
}

export interface CreateDiagnosisData {
  icd10Code: string;
  type: 'PRIMARY' | 'SECONDARY';
  note: string | null;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `diagnosis` (S3-05→07) — theo `coding-standards.md`. */
@Injectable()
export class DiagnosisRepository {
  listForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<DiagnosisWithIcd10Name[]> {
    return tx.diagnosis.findMany({
      where: { tenantId, encounterId, deletedAt: null },
      include: { icd10: { select: { nameVi: true } } },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    }) as Promise<DiagnosisWithIcd10Name[]>;
  }

  async countPrimary(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<number> {
    return tx.diagnosis.count({ where: { tenantId, encounterId, type: 'PRIMARY', deletedAt: null } });
  }

  /**
   * Thay thế TOÀN BỘ danh sách chẩn đoán của 1 encounter — xoá mềm dòng cũ rồi tạo lại theo payload
   * (đơn giản hơn diff từng dòng, khối lượng nhỏ vài dòng/encounter, xem `EncounterService.saveDiagnoses()`).
   */
  async replaceForEncounter(
    tx: Prisma.TransactionClient,
    tenantId: string,
    encounterId: string,
    actorId: string,
    items: CreateDiagnosisData[],
  ): Promise<void> {
    await tx.diagnosis.updateMany({
      where: { tenantId, encounterId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.diagnosis.createMany({
        data: items.map((item) => ({
          tenantId,
          encounterId,
          icd10Code: item.icd10Code,
          type: item.type,
          note: item.note,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
  }
}
