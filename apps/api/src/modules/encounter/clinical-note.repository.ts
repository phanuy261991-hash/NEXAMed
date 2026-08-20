import { Injectable } from '@nestjs/common';
import type { ClinicalNote, ClinicalNoteSection, Prisma } from '@prisma/client';

/** Chỗ DUY NHẤT gọi Prisma cho bảng `clinical_note` (S3-05→07) — theo `coding-standards.md`. */
@Injectable()
export class ClinicalNoteRepository {
  listForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<ClinicalNote[]> {
    return tx.clinicalNote.findMany({ where: { tenantId, encounterId, deletedAt: null } });
  }

  /**
   * Tìm-hoặc-tạo theo `(encounterId, section)` — đúng MỘT dòng hiệu lực/section (unique partial
   * index trong migration). `expectedVersion` vắng mặt (`undefined`) nghĩa là client cho rằng
   * section này chưa có dòng nào — tạo mới; có giá trị thì `updateMany` kèm `WHERE version=?`
   * (optimistic lock, đúng khuôn mọi UPDATE khác trong dự án). Trả `0` nếu update thất bại do lệch
   * version (gọi `ConcurrentModificationError` ở service, không tự ném ở đây).
   */
  async upsertSection(
    tx: Prisma.TransactionClient,
    tenantId: string,
    encounterId: string,
    section: ClinicalNoteSection,
    content: string,
    expectedVersion: number | undefined,
    actorId: string,
  ): Promise<'created' | number> {
    if (expectedVersion === undefined) {
      await tx.clinicalNote.create({
        data: { tenantId, encounterId, section, content, createdBy: actorId, updatedBy: actorId },
      });
      return 'created';
    }
    const result = await tx.clinicalNote.updateMany({
      where: { tenantId, encounterId, section, version: expectedVersion, deletedAt: null },
      data: { content, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
