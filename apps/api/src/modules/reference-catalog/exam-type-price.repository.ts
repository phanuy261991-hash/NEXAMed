import { Injectable } from '@nestjs/common';
import type { ExamTypePrice, Prisma } from '@prisma/client';

export interface CreateExamTypePriceData {
  priceTypeCode: string;
  unitCode: string;
  amount: bigint;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `exam_type_price` (docs/DECISIONS.md #079) — theo
 * `.claude/docs/coding-standards.md`. Không có "sửa từng dòng" — chỉ bulk-replace theo
 * `examTypeCode`, đúng khuôn `DiagnosisRepository.replaceForEncounter()`.
 */
@Injectable()
export class ExamTypePriceRepository {
  /** Dùng cho cả GET 1 mục (mở modal Sửa) lẫn batch-fetch khi liệt kê nhiều EXAM_TYPE cùng lúc. */
  listByExamTypeCodes(tx: Prisma.TransactionClient, tenantId: string, examTypeCodes: string[]): Promise<ExamTypePrice[]> {
    if (examTypeCodes.length === 0) return Promise.resolve([]);
    return tx.examTypePrice.findMany({
      where: { tenantId, examTypeCode: { in: examTypeCodes }, deletedAt: null },
      orderBy: [{ effectiveFrom: 'desc' }],
    });
  }

  /**
   * Thay thế TOÀN BỘ đơn giá của 1 dịch vụ khám (theo tenant hiện tại) — xoá mềm dòng cũ rồi tạo
   * lại theo payload, cùng lý do đơn giản hoá như `DiagnosisRepository.replaceForEncounter()`
   * (khối lượng nhỏ vài dòng/dịch vụ, không cần diff từng dòng). C20 (exclusion constraint chặn
   * chồng lấn ngày hiệu lực cùng Loại giá dịch vụ) ném lỗi ngay tại `createMany` nếu vi phạm — bên
   * gọi (`ReferenceCatalogService`) bắt lỗi này để trả về mã lỗi nghiệp vụ rõ ràng.
   */
  async replaceForExamType(
    tx: Prisma.TransactionClient,
    tenantId: string,
    examTypeCode: string,
    actorId: string,
    items: CreateExamTypePriceData[],
  ): Promise<void> {
    await tx.examTypePrice.updateMany({
      where: { tenantId, examTypeCode, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.examTypePrice.createMany({
        data: items.map((item) => ({
          tenantId,
          examTypeCode,
          priceTypeCode: item.priceTypeCode,
          unitCode: item.unitCode,
          amount: item.amount,
          effectiveFrom: item.effectiveFrom,
          effectiveTo: item.effectiveTo,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
  }
}