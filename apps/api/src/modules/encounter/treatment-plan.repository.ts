import { Injectable } from '@nestjs/common';
import type { EncounterTreatmentPlan, Prisma, TreatmentDirection } from '@prisma/client';

/** `YYYY-MM-DD` → `Date` 00:00 UTC (cột `DATE` không có giờ — Prisma đọc/ghi qua mốc UTC nửa đêm). */
export function dateStringToDbDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

/** `Date` đọc từ cột `DATE` → `YYYY-MM-DD`. */
export function dbDateToDateString(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `encounter_treatment_plan` ("Hướng điều trị + ngày hẹn tái khám", docs/DECISIONS.md #222) — đúng khuôn `ClinicalNoteRepository`: đúng 1 dòng hiệu lực
 * mỗi lượt khám, ký khi "Hoàn tất khám", sửa sau đó = bản mới `supersedes_id` + lý do.
 */
@Injectable()
export class TreatmentPlanRepository {
  findActive(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<EncounterTreatmentPlan | null> {
    return tx.encounterTreatmentPlan.findFirst({ where: { tenantId, encounterId, deletedAt: null } });
  }

  /** "Xuất bệnh án PDF" — kế hoạch điều trị của NHIỀU lượt khám trong 1 query. */
  async findActiveForEncounters(tx: Prisma.TransactionClient, tenantId: string, encounterIds: string[]): Promise<Map<string, EncounterTreatmentPlan>> {
    if (encounterIds.length === 0) return new Map();
    const rows = await tx.encounterTreatmentPlan.findMany({ where: { tenantId, encounterId: { in: encounterIds }, deletedAt: null } });
    return new Map(rows.map((r) => [r.encounterId, r]));
  }

  /**
   * Tìm-hoặc-tạo (một dòng hiệu lực mỗi lượt khám). `expectedVersion` vắng = client cho rằng chưa có dòng nào → tạo mới; có = `updateMany` kèm `WHERE version = ?` (optimistic lock).
   * Trả `'created'` hoặc số dòng đã sửa (0 = lệch version → service ném `ConcurrentModificationError`).
   */
  async upsert(
    tx: Prisma.TransactionClient,
    tenantId: string,
    encounterId: string,
    data: { directions: TreatmentDirection[]; followUpDate: string | null },
    expectedVersion: number | undefined,
    actorId: string,
  ): Promise<'created' | number> {
    const followUpDate = dateStringToDbDate(data.followUpDate);
    if (expectedVersion === undefined) {
      await tx.encounterTreatmentPlan.create({ data: { tenantId, encounterId, directions: data.directions, followUpDate, createdBy: actorId, updatedBy: actorId } });
      return 'created';
    }
    const result = await tx.encounterTreatmentPlan.updateMany({
      where: { tenantId, encounterId, version: expectedVersion, deletedAt: null },
      data: { directions: data.directions, followUpDate, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** "Hoàn tất khám" ký bản đang hiệu lực (`WHERE signed_at IS NULL` chống ký trùng), trong CÙNG transaction đổi trạng thái lượt khám. */
  async signAllForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, actorId: string, signedAt: Date, signedBy: string): Promise<void> {
    await tx.encounterTreatmentPlan.updateMany({
      where: { tenantId, encounterId, deletedAt: null, signedAt: null },
      data: { signedAt, signedBy, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /**
   * Đính chính (sau khi đã ký). Đã có bản đang hiệu lực → soft-delete bản cũ (`WHERE version = ?`) rồi tạo bản mới ĐÃ KÝ trỏ `supersedes_id` + lý do; trả `null` nếu lệch version.
   * Chưa có bản nào (lượt khám hoàn tất trước khi có tính năng, hoặc chưa từng nhập) → tạo bản mới đã ký, không có `supersedes_id`/lý do (CHECK DB: lý do chỉ đi kèm bản thay thế).
   */
  async amend(
    tx: Prisma.TransactionClient,
    tenantId: string,
    encounterId: string,
    data: { directions: TreatmentDirection[]; followUpDate: string | null },
    expectedVersion: number | undefined,
    actorId: string,
    signedAt: Date,
    signedBy: string,
    amendmentReason: string,
  ): Promise<EncounterTreatmentPlan | null> {
    const followUpDate = dateStringToDbDate(data.followUpDate);
    const old = await tx.encounterTreatmentPlan.findFirst({ where: { tenantId, encounterId, deletedAt: null } });
    if (!old) {
      if (expectedVersion !== undefined) return null;
      return tx.encounterTreatmentPlan.create({ data: { tenantId, encounterId, directions: data.directions, followUpDate, signedAt, signedBy, createdBy: actorId, updatedBy: actorId } });
    }
    if (expectedVersion === undefined || old.version !== expectedVersion) return null;
    const result = await tx.encounterTreatmentPlan.updateMany({
      where: { tenantId, id: old.id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'amended', updatedBy: actorId },
    });
    if (result.count === 0) return null;
    return tx.encounterTreatmentPlan.create({
      data: { tenantId, encounterId, directions: data.directions, followUpDate, signedAt, signedBy, supersedesId: old.id, amendmentReason, createdBy: actorId, updatedBy: actorId },
    });
  }
}
