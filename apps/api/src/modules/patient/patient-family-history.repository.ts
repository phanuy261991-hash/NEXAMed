import { Injectable } from '@nestjs/common';
import type { FamilyRelation, Prisma } from '@prisma/client';

export interface PatientFamilyHistoryRow {
  id: string;
  relation: FamilyRelation;
  icd10Code: string;
  icd10Name: string;
  ageOfOnsetYears: number | null;
}

export interface FamilyHistoryRowInput {
  relation: FamilyRelation;
  icd10Code: string;
  ageOfOnsetYears?: number;
}

/**
 * Tiền sử gia đình có cấu trúc (Sprint 5) — chỗ DUY NHẤT gọi Prisma cho bảng
 * `patient_family_history` (.claude/docs/coding-standards.md). Khác `PatientAllergenRepository`/
 * `PatientConditionRepository` (mảng id đơn thuần) — mỗi dòng mang nguyên object (quan hệ + bệnh lý
 * + tuổi phát hiện), không phải mảng id, vì KHÔNG có unique trên (patient, relation, icd10Code):
 * nhiều người thân cùng quan hệ có thể cùng mắc 1 bệnh (vd 2 anh/chị/em ruột).
 */
@Injectable()
export class PatientFamilyHistoryRepository {
  listForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<PatientFamilyHistoryRow[]> {
    return tx.patientFamilyHistory
      .findMany({
        where: { tenantId, patientId, deletedAt: null },
        include: { icd10: { select: { nameVi: true } } },
        orderBy: { createdAt: 'asc' },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          relation: row.relation,
          icd10Code: row.icd10Code,
          icd10Name: row.icd10.nameVi,
          ageOfOnsetYears: row.ageOfOnsetYears,
        })),
      );
  }

  /** Thay thế TOÀN BỘ tiền sử gia đình của bệnh nhân — cùng khuôn `PatientAllergenRepository.replaceForPatient()`. */
  async replaceForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string, actorId: string, rows: FamilyHistoryRowInput[]): Promise<void> {
    await tx.patientFamilyHistory.updateMany({
      where: { tenantId, patientId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (rows.length > 0) {
      await tx.patientFamilyHistory.createMany({
        data: rows.map((row) => ({
          tenantId,
          patientId,
          relation: row.relation,
          icd10Code: row.icd10Code,
          ageOfOnsetYears: row.ageOfOnsetYears ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
  }
}
