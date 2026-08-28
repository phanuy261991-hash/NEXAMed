import { Injectable } from '@nestjs/common';
import { pairDiagnosisAmendment, type DiagnosisAmendmentNewItem } from '@nexamed/core';
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

  /**
   * Ký hồ sơ khám (Sprint 5, S5-02/03) — "Hoàn tất khám" gọi hàm này TRONG CÙNG transaction đổi
   * `encounter.status`. `WHERE signed_at IS NULL` chống ký trùng, cùng khuôn `PrescriptionRepository.sign()`.
   */
  async signAllForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, actorId: string, signedAt: Date, signedBy: string): Promise<void> {
    await tx.diagnosis.updateMany({
      where: { tenantId, encounterId, deletedAt: null, signedAt: null },
      data: { signedAt, signedBy, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /**
   * Đính chính (Sprint 5, S5-02/03) — soft-delete TOÀN BỘ dòng active cũ, tạo lại full list mới ĐÃ
   * KÝ NGAY (đính chính là một hành động xác nhận trọn vẹn, cùng triết lý `PrescriptionRepository.
   * createAmendment()`). `supersedesId` ghép theo `(icd10Code, type)` qua `pairDiagnosisAmendment`
   * (packages/core, thuần) — mã không đổi giữ chuỗi lịch sử, mã mới `supersedesId=null`.
   */
  async amendForEncounter(
    tx: Prisma.TransactionClient,
    tenantId: string,
    encounterId: string,
    actorId: string,
    newItems: DiagnosisAmendmentNewItem[],
    signedAt: Date,
    signedBy: string,
    amendmentReason: string,
  ): Promise<void> {
    const oldRows = await tx.diagnosis.findMany({ where: { tenantId, encounterId, deletedAt: null }, select: { id: true, icd10Code: true, type: true } });
    await tx.diagnosis.updateMany({
      where: { tenantId, encounterId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'amended', updatedBy: actorId },
    });
    const paired = pairDiagnosisAmendment(oldRows, newItems);
    await tx.diagnosis.createMany({
      data: paired.map((item) => ({
        tenantId,
        encounterId,
        icd10Code: item.icd10Code,
        type: item.type,
        note: item.note,
        signedAt,
        signedBy,
        supersedesId: item.supersedesId,
        amendmentReason,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
  }
}
