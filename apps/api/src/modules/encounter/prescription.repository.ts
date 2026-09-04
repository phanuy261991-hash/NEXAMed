import { Injectable } from '@nestjs/common';
import type { Prescription, Prisma } from '@prisma/client';

export interface PrescriptionItemWithDrug {
  id: string;
  drugId: string;
  drugName: string;
  activeIngredient: string | null;
  dose: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instruction: string | null;
}

export interface PrescriptionWithItems extends Prescription {
  items: PrescriptionItemWithDrug[];
}

interface RawItemWithDrug {
  id: string;
  drugId: string;
  dose: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instruction: string | null;
  drug: { name: string; activeIngredient: string | null };
}

interface RawPrescriptionWithItems extends Prescription {
  items: RawItemWithDrug[];
}

function mapItems(rows: RawItemWithDrug[]): PrescriptionItemWithDrug[] {
  return rows.map((row) => ({
    id: row.id,
    drugId: row.drugId,
    drugName: row.drug.name,
    activeIngredient: row.drug.activeIngredient,
    dose: row.dose,
    frequency: row.frequency,
    durationDays: row.durationDays,
    quantity: row.quantity,
    instruction: row.instruction,
  }));
}

export interface CreatePrescriptionItemData {
  drugId: string;
  dose: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instruction: string | null;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `prescription`/`prescription_item` (Sprint 4, S4-01/02/04) — theo .claude/docs/coding-standards.md. */
@Injectable()
export class PrescriptionRepository {
  /** Đơn ĐANG HIỆU LỰC (nháp hoặc đã ký, chưa bị đính chính/xoá) của một lượt khám — tối đa 1 dòng (partial unique). */
  async findActiveForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<PrescriptionWithItems | null> {
    const row = (await tx.prescription.findFirst({
      where: { tenantId, encounterId, deletedAt: null },
      include: { items: { where: { deletedAt: null }, include: { drug: { select: { name: true, activeIngredient: true } } }, orderBy: { createdAt: 'asc' } } },
    })) as RawPrescriptionWithItems | null;
    if (!row) return null;
    return { ...row, items: mapItems(row.items) };
  }

  async findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PrescriptionWithItems | null> {
    const row = (await tx.prescription.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: { items: { where: { deletedAt: null }, include: { drug: { select: { name: true, activeIngredient: true } } }, orderBy: { createdAt: 'asc' } } },
    })) as RawPrescriptionWithItems | null;
    if (!row) return null;
    return { ...row, items: mapItems(row.items) };
  }

  createDraft(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, actorId: string): Promise<Prescription> {
    return tx.prescription.create({
      data: { tenantId, encounterId, createdBy: actorId, updatedBy: actorId },
    });
  }

  /** Thay thế TOÀN BỘ dòng thuốc của đơn NHÁP — chỉ gọi khi `signedAt IS NULL` (kiểm ở service), cùng khuôn `DiagnosisRepository.replaceForEncounter()`. */
  async replaceItems(tx: Prisma.TransactionClient, tenantId: string, prescriptionId: string, actorId: string, items: CreatePrescriptionItemData[]): Promise<void> {
    await tx.prescriptionItem.updateMany({
      where: { tenantId, prescriptionId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.prescriptionItem.createMany({
        data: items.map((item) => ({ tenantId, prescriptionId, ...item, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }

  /** Tạo dòng thuốc cho đơn MỚI (đính chính) — khác `replaceItems()`: không có gì để xoá mềm trước, đơn vừa mới tạo. */
  async createItems(tx: Prisma.TransactionClient, tenantId: string, prescriptionId: string, actorId: string, items: CreatePrescriptionItemData[]): Promise<void> {
    if (items.length === 0) return;
    await tx.prescriptionItem.createMany({
      data: items.map((item) => ({ tenantId, prescriptionId, ...item, createdBy: actorId, updatedBy: actorId })),
    });
  }

  /** Ký đơn nháp — `WHERE signed_at IS NULL` chống ký trùng khi 2 request gần như đồng thời (cùng tinh thần các `updateMany` có điều kiện khác trong dự án). */
  async sign(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, signedAt: Date, signedBy: string): Promise<number> {
    const result = await tx.prescription.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, signedAt: null },
      data: { signedAt, signedBy, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Idempotent — chỉ set lần đầu (`WHERE printed_at IS NULL`); gọi lại sau khi đã in không lỗi, không ghi đè thời điểm in đầu tiên. */
  async markPrintedIfNotYet(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string): Promise<number> {
    const result = await tx.prescription.updateMany({
      where: { tenantId, id, deletedAt: null, printedAt: null },
      data: { printedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Soft-delete đơn ĐÃ KÝ khi bị thay thế bởi bản đính chính — `WHERE version = ?` chống đính chính trùng. */
  async supersede(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.prescription.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'amended', updatedBy: actorId },
    });
    return result.count;
  }

  /** Tạo đơn đính chính — ĐÃ KÝ NGAY lúc tạo (đính chính là một hành động xác nhận trọn vẹn, không qua lại bước nháp). */
  createAmendment(
    tx: Prisma.TransactionClient,
    tenantId: string,
    encounterId: string,
    actorId: string,
    data: { supersedesId: string; amendmentReason: string; signedAt: Date; signedBy: string },
  ): Promise<Prescription> {
    return tx.prescription.create({
      data: { tenantId, encounterId, createdBy: actorId, updatedBy: actorId, ...data },
    });
  }

  /** "Đóng ca hôm nay" — popup tổng hợp (`DoctorAvailabilityService.getShiftSummary()`). Đếm "sự
   * kiện ký" trong ngày (đơn nháp ký lần đầu VÀ đính chính đều tính — đính chính là bản mới ĐÃ KÝ
   * NGAY, xem `createAmendment()`), lọc theo bác sĩ của LƯỢT KHÁM chứa đơn đó qua quan hệ Prisma. */
  async countSignedForDoctorToday(
    tx: Prisma.TransactionClient,
    tenantId: string,
    doctorId: string,
    range: { startUtc: Date; endUtc: Date },
  ): Promise<number> {
    return tx.prescription.count({
      where: { tenantId, deletedAt: null, signedAt: { gte: range.startUtc, lt: range.endUtc }, encounter: { doctorId } },
    });
  }
}
