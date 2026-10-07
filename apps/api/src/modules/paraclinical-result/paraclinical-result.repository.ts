import { Injectable } from '@nestjs/common';
import { Prisma, type ParaclinicalResult, type ParaclinicalResultValue } from '@prisma/client';

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
}
