import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface PatientAllergenRow {
  id: string;
  allergenId: string;
  allergenName: string;
  allergenGroupName: string;
}

/**
 * Dị nguyên đã biết của bệnh nhân (Sprint 4, chốt 2026-08-25) — chỗ DUY NHẤT gọi Prisma cho bảng
 * `patient_allergen` (.claude/docs/coding-standards.md). Export qua `PatientModule` để
 * `EncounterModule` (kê đơn, PRE-03) đọc trong cùng transaction — cùng tinh thần
 * `EncounterRepository` được `ReceptionModule` dùng chung.
 */
@Injectable()
export class PatientAllergenRepository {
  listForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<PatientAllergenRow[]> {
    return tx.patientAllergen
      .findMany({
        where: { tenantId, patientId, deletedAt: null },
        include: { allergen: { select: { name: true, allergenGroup: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          allergenId: row.allergenId,
          allergenName: row.allergen.name,
          allergenGroupName: row.allergen.allergenGroup.name,
        })),
      );
  }

  /** Thay thế TOÀN BỘ danh sách dị nguyên của bệnh nhân — cùng khuôn `DiagnosisRepository.replaceForEncounter()`. */
  async replaceForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string, actorId: string, allergenIds: string[]): Promise<void> {
    await tx.patientAllergen.updateMany({
      where: { tenantId, patientId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (allergenIds.length > 0) {
      await tx.patientAllergen.createMany({
        data: allergenIds.map((allergenId) => ({ tenantId, patientId, allergenId, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }
}
