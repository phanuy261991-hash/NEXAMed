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

  /**
   * Ký hồ sơ khám (Sprint 5, S5-02/03) — "Hoàn tất khám" gọi hàm này TRONG CÙNG transaction đổi
   * `encounter.status`, ký TẤT CẢ section đang hiệu lực cùng lúc (`WHERE signed_at IS NULL` chống
   * ký trùng, cùng khuôn `DiagnosisRepository.signAllForEncounter()`).
   */
  async signAllForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, actorId: string, signedAt: Date, signedBy: string): Promise<void> {
    await tx.clinicalNote.updateMany({
      where: { tenantId, encounterId, deletedAt: null, signedAt: null },
      data: { signedAt, signedBy, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /**
   * Đính chính MỘT section (Sprint 5, S5-02/03) — khác `diagnosis` (danh sách không "slot" cố
   * định), mỗi section là 1 slot cố định nên `supersedesId` ghép 1-1 trực tiếp: soft-delete đúng
   * dòng cũ (`WHERE version=?` — optimistic lock, đọc lại `id` TRƯỚC để gắn `supersedesId`), tạo
   * dòng mới ĐÃ KÝ NGAY trỏ về dòng cũ. Trả `null` nếu version lệch hoặc dòng không còn tồn tại
   * (service tự ném `ConcurrentModificationError`, đúng khuôn `PrescriptionRepository.supersede()`).
   */
  async amendSection(
    tx: Prisma.TransactionClient,
    tenantId: string,
    encounterId: string,
    section: ClinicalNoteSection,
    content: string,
    expectedVersion: number,
    actorId: string,
    signedAt: Date,
    signedBy: string,
    amendmentReason: string,
  ): Promise<ClinicalNote | null> {
    const old = await tx.clinicalNote.findFirst({ where: { tenantId, encounterId, section, version: expectedVersion, deletedAt: null } });
    if (!old) return null;
    const result = await tx.clinicalNote.updateMany({
      where: { tenantId, id: old.id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'amended', updatedBy: actorId },
    });
    if (result.count === 0) return null;
    return tx.clinicalNote.create({
      data: { tenantId, encounterId, section, content, signedAt, signedBy, supersedesId: old.id, amendmentReason, createdBy: actorId, updatedBy: actorId },
    });
  }
}
