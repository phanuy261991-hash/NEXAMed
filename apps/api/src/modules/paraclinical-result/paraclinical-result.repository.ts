import { Injectable } from '@nestjs/common';
import { Prisma, type ParaclinicalResult, type ParaclinicalResultImage, type ParaclinicalResultValue } from '@prisma/client';

export type ResultWithValues = ParaclinicalResult & { values: ParaclinicalResultValue[] };

export interface ResultValueData {
  labIndicatorId: string;
  indicatorCode: string;
  indicatorName: string;
  abbreviation: string | null;
  unit: string | null;
  valueType: 'NUMBER' | 'TEXT' | 'CHOICE';
  decimals: number | null;
  valueText: string | null;
  note: string | null;
  interpretationText: string | null;
  /** Dòng khoảng tham chiếu đã chọn cho bệnh nhân (chụp lại); `null` = chỉ số chưa khai khoảng nào. */
  referenceSnapshot: Prisma.InputJsonObject | null;
  sortOrder: number;
}

/** Chỗ DUY NHẤT gọi Prisma cho `paraclinical_result` + `paraclinical_result_value` (Cận lâm sàng GĐ4, docs/DECISIONS.md #212). */
@Injectable()
export class ParaclinicalResultRepository {
  /** Kết quả ĐANG hiệu lực (chưa bị đính chính thay thế) của các dòng chỉ định, kèm giá trị chỉ số. */
  findActiveByItemIds(tx: Prisma.TransactionClient, tenantId: string, itemIds: string[]): Promise<ResultWithValues[]> {
    if (itemIds.length === 0) return Promise.resolve([]);
    return tx.paraclinicalResult.findMany({
      where: { tenantId, clinicalOrderItemId: { in: itemIds }, deletedAt: null },
      include: { values: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
  }

  createResult(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { clinicalOrderItemId: string; descriptionText: string | null; conclusionText: string | null; performedBy: string; resultedAt: Date | null; approverId: string | null },
  ): Promise<ParaclinicalResult> {
    return tx.paraclinicalResult.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  /** Kết quả theo id, KỂ CẢ bản đã bị thay thế (soft-delete) — dùng để hiện thông tin bản gốc của bản đính chính. */
  findByIdIncludingDeleted(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ParaclinicalResult | null> {
    return tx.paraclinicalResult.findFirst({ where: { tenantId, id } });
  }

  /**
   * Đính chính: soft-delete bản ĐÃ KÝ (giữ nguyên nội dung — trigger DB chỉ chặn sửa nội dung) rồi tạo bản NHÁP thay thế trỏ về bản gốc (`supersedes_id` + lý do),
   * sao chép nội dung, các chỉ số (kèm khoảng tham chiếu đã chụp) và ảnh để người sửa chỉ việc chỉnh chỗ sai. Thứ tự soft-delete → tạo mới là bắt buộc vì
   * chỉ mục duy nhất cho phép đúng 1 kết quả hiệu lực mỗi dịch vụ. Trả `null` nếu bản gốc vừa bị người khác đính chính.
   */
  async createAmendmentDraft(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    original: ResultWithValues,
    images: ParaclinicalResultImage[],
    reason: string,
  ): Promise<ParaclinicalResult | null> {
    const retired = await tx.paraclinicalResult.updateMany({
      where: { tenantId, id: original.id, deletedAt: null, signedAt: { not: null } },
      data: { deletedAt: new Date(), deletedReason: `Đính chính: ${reason}`, updatedBy: actorId, version: { increment: 1 } },
    });
    if (retired.count !== 1) return null;
    const draft = await tx.paraclinicalResult.create({
      data: {
        tenantId,
        clinicalOrderItemId: original.clinicalOrderItemId,
        descriptionText: original.descriptionText,
        conclusionText: original.conclusionText,
        performedBy: actorId,
        resultedAt: original.resultedAt,
        approverId: null,
        supersedesId: original.id,
        amendmentReason: reason,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    if (original.values.length > 0) {
      await tx.paraclinicalResultValue.createMany({
        data: original.values.map((v) => ({
          tenantId,
          resultId: draft.id,
          labIndicatorId: v.labIndicatorId,
          indicatorCode: v.indicatorCode,
          indicatorName: v.indicatorName,
          abbreviation: v.abbreviation,
          unit: v.unit,
          valueType: v.valueType,
          decimals: v.decimals,
          valueText: v.valueText,
          note: v.note,
          interpretationText: v.interpretationText,
          referenceSnapshot: (v.referenceSnapshot as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
          sortOrder: v.sortOrder,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    if (images.length > 0) {
      await tx.paraclinicalResultImage.createMany({
        data: images.map((img) => ({
          tenantId,
          resultId: draft.id,
          storageKey: img.storageKey,
          fileName: img.fileName,
          contentType: img.contentType,
          sizeBytes: img.sizeBytes,
          sortOrder: img.sortOrder,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    return draft;
  }

  /**
   * Huỷ đính chính: soft-delete bản NHÁP đính chính rồi KHÔI PHỤC bản gốc đã ký (bỏ soft-delete). Thứ tự bắt buộc (chỉ mục duy nhất 1 kết quả hiệu lực/dịch vụ).
   * Trả `false` nếu bản nháp đã bị người khác duyệt/huỷ trước.
   */
  async restoreOriginal(tx: Prisma.TransactionClient, tenantId: string, actorId: string, draft: ParaclinicalResult): Promise<boolean> {
    if (draft.supersedesId === null) return false;
    const dropped = await tx.paraclinicalResult.updateMany({
      where: { tenantId, id: draft.id, deletedAt: null, signedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'Huỷ đính chính — khôi phục bản đã duyệt', updatedBy: actorId, version: { increment: 1 } },
    });
    if (dropped.count !== 1) return false;
    const restored = await tx.paraclinicalResult.updateMany({
      where: { tenantId, id: draft.supersedesId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedReason: null, updatedBy: actorId, version: { increment: 1 } },
    });
    return restored.count === 1;
  }

  /** Sửa NHÁP — `WHERE signed_at IS NULL` (DB còn trigger chặn lần nữa); trả số dòng cập nhật. */
  async updateDraft(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    actorId: string,
    data: { descriptionText: string | null; conclusionText: string | null; performedBy: string; resultedAt: Date | null; approverId: string | null },
  ): Promise<number> {
    const r = await tx.paraclinicalResult.updateMany({
      where: { tenantId, id, deletedAt: null, signedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** Ký (duyệt & trả kết quả): chỉ khi chưa ký; trả số dòng cập nhật (0 = đã có người ký trước). */
  async sign(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, at: Date): Promise<number> {
    const r = await tx.paraclinicalResult.updateMany({
      where: { tenantId, id, deletedAt: null, signedAt: null },
      data: { signedAt: at, signedBy: actorId, approverId: actorId, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** Lưu giá trị từng chỉ số: sửa dòng đã có theo `labIndicatorId`, thêm dòng mới nếu chưa có (không xoá). */
  async upsertValues(tx: Prisma.TransactionClient, tenantId: string, actorId: string, resultId: string, existing: ParaclinicalResultValue[], items: ResultValueData[]): Promise<void> {
    const byIndicator = new Map(existing.map((v) => [v.labIndicatorId, v]));
    for (const item of items) {
      const { referenceSnapshot, ...rest } = item;
      const snapshot = referenceSnapshot ?? Prisma.DbNull;
      const current = byIndicator.get(item.labIndicatorId);
      if (current) {
        await tx.paraclinicalResultValue.update({
          where: { id: current.id },
          data: { ...rest, referenceSnapshot: snapshot, updatedBy: actorId, version: { increment: 1 } },
        });
      } else {
        await tx.paraclinicalResultValue.create({
          data: { tenantId, resultId, ...rest, referenceSnapshot: snapshot, createdBy: actorId, updatedBy: actorId },
        });
      }
    }
  }

  // ---- ảnh đính kèm ----

  listImages(tx: Prisma.TransactionClient, tenantId: string, resultIds: string[]): Promise<ParaclinicalResultImage[]> {
    if (resultIds.length === 0) return Promise.resolve([]);
    return tx.paraclinicalResultImage.findMany({ where: { tenantId, resultId: { in: resultIds }, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  findImage(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<(ParaclinicalResultImage & { result: ParaclinicalResult }) | null> {
    return tx.paraclinicalResultImage.findFirst({ where: { tenantId, id, deletedAt: null }, include: { result: true } });
  }

  countImages(tx: Prisma.TransactionClient, tenantId: string, resultId: string): Promise<number> {
    return tx.paraclinicalResultImage.count({ where: { tenantId, resultId, deletedAt: null } });
  }

  createImage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { resultId: string; storageKey: string; fileName: string; contentType: string; sizeBytes: number; sortOrder: number },
  ): Promise<ParaclinicalResultImage> {
    return tx.paraclinicalResultImage.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  async softDeleteImage(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, reason: string): Promise<void> {
    await tx.paraclinicalResultImage.updateMany({
      where: { tenantId, id, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
  }
}
