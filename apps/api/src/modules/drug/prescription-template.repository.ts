import { Injectable } from '@nestjs/common';
import type { Prisma, PrescriptionTemplate } from '@prisma/client';

export interface PrescriptionTemplateItemWithDrug {
  id: string;
  drugId: string;
  drugName: string;
  dose: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instruction: string | null;
}

export interface PrescriptionTemplateWithItems extends PrescriptionTemplate {
  items: PrescriptionTemplateItemWithDrug[];
}

interface RawItemWithDrug {
  id: string;
  drugId: string;
  dose: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instruction: string | null;
  drug: { name: string };
}

interface RawTemplateWithItems extends PrescriptionTemplate {
  items: RawItemWithDrug[];
}

function mapItems(rows: RawItemWithDrug[]): PrescriptionTemplateItemWithDrug[] {
  return rows.map((row) => ({
    id: row.id,
    drugId: row.drugId,
    drugName: row.drug.name,
    dose: row.dose,
    frequency: row.frequency,
    durationDays: row.durationDays,
    quantity: row.quantity,
    instruction: row.instruction,
  }));
}

const ITEMS_INCLUDE = {
  where: { deletedAt: null as null },
  include: { drug: { select: { name: true } } },
  orderBy: { createdAt: 'asc' as const },
};

export interface CreatePrescriptionTemplateItemData {
  drugId: string;
  dose: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instruction: string | null;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `prescription_template`/`prescription_template_item` (Kho
 * Thuốc GĐ5) — đúng khuôn `PrescriptionRepository` (module `encounter`), CHỈ khác không có khái
 * niệm ký/bất biến (mẫu sửa tự do, không soft-delete lịch sử phiên bản). */
@Injectable()
export class PrescriptionTemplateRepository {
  async list(tx: Prisma.TransactionClient, tenantId: string): Promise<PrescriptionTemplateWithItems[]> {
    const rows = (await tx.prescriptionTemplate.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      include: { items: ITEMS_INCLUDE },
      orderBy: { name: 'asc' },
    })) as RawTemplateWithItems[];
    return rows.map((row) => ({ ...row, items: mapItems(row.items) }));
  }

  async findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PrescriptionTemplateWithItems | null> {
    const row = (await tx.prescriptionTemplate.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: { items: ITEMS_INCLUDE },
    })) as RawTemplateWithItems | null;
    if (!row) return null;
    return { ...row, items: mapItems(row.items) };
  }

  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, name: string): Promise<PrescriptionTemplate> {
    return tx.prescriptionTemplate.create({ data: { tenantId, name, createdBy: actorId, updatedBy: actorId } });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: { name?: string; isActive?: boolean },
  ): Promise<number> {
    const result = await tx.prescriptionTemplate.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Thay thế TOÀN BỘ dòng thuốc của mẫu — cùng khuôn `PrescriptionRepository.replaceItems()`. */
  async replaceItems(tx: Prisma.TransactionClient, tenantId: string, templateId: string, actorId: string, items: CreatePrescriptionTemplateItemData[]): Promise<void> {
    await tx.prescriptionTemplateItem.updateMany({
      where: { tenantId, templateId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.prescriptionTemplateItem.createMany({
        data: items.map((item) => ({ tenantId, templateId, ...item, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }
}
