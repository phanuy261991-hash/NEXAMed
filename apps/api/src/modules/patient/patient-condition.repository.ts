import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface PatientConditionRow {
  icd10Code: string;
  icd10Name: string;
}

/**
 * Bệnh lý nền + thói quen/lối sống của bệnh nhân, dữ liệu có cấu trúc (Sprint 5) — chỗ DUY NHẤT
 * gọi Prisma cho bảng `patient_condition` (.claude/docs/coding-standards.md). Thói quen (hút
 * thuốc/rượu bia/lười vận động) dùng CHUNG bảng này, mã hoá bằng ICD-10 Chương XXI (Z72.x) — không
 * tách bảng/cột riêng. Cùng khuôn `PatientAllergenRepository`.
 */
@Injectable()
export class PatientConditionRepository {
  listForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<PatientConditionRow[]> {
    return tx.patientCondition
      .findMany({
        where: { tenantId, patientId, deletedAt: null },
        include: { icd10: { select: { nameVi: true } } },
        orderBy: { createdAt: 'asc' },
      })
      .then((rows) => rows.map((row) => ({ icd10Code: row.icd10Code, icd10Name: row.icd10.nameVi })));
  }

  /** Thay thế TOÀN BỘ danh sách bệnh lý nền của bệnh nhân — cùng khuôn `PatientAllergenRepository.replaceForPatient()`. */
  async replaceForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string, actorId: string, icd10Codes: string[]): Promise<void> {
    await tx.patientCondition.updateMany({
      where: { tenantId, patientId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (icd10Codes.length > 0) {
      await tx.patientCondition.createMany({
        data: icd10Codes.map((icd10Code) => ({ tenantId, patientId, icd10Code, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }
}
