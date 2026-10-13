import { Injectable } from '@nestjs/common';
import type { Prescription, Prisma } from '@prisma/client';

export interface PrescriptionItemWithDrug {
  id: string;
  /** `null` = dòng "kê thuốc tự do, không qua danh mục" — xem `freeTextDrugName`. */
  drugId: string | null;
  drugName: string;
  /** Có giá trị CHỈ khi `drugId=null`. */
  freeTextDrugName: string | null;
  activeIngredient: string | null;
  /** Tên hoạt chất CHUẨN theo cấu trúc (`drug_ingredient` → catalog `ACTIVE_INGREDIENT`) — rỗng với thuốc chưa khai cấu trúc
   * và dòng tự do. Dùng cho PRE-02 (trùng hoạt chất), KHÔNG hiển thị ra DTO. */
  ingredientNames: string[];
  doseMorning: number;
  doseNoon: number;
  doseAfternoon: number;
  doseEvening: number;
  durationDays: number;
  quantity: number;
  /** Đơn vị nhỏ nhất của thuốc (`drug.baseUnitCode`) — CHỈ hiển thị, docs/DECISIONS.md #196. `null`
   * cho dòng tự do hoặc thuốc chưa khai đơn vị cơ sở. */
  unitCode: string | null;
  instruction: string | null;
}

export interface PrescriptionWithItems extends Prescription {
  items: PrescriptionItemWithDrug[];
}

interface RawItemWithDrug {
  id: string;
  drugId: string | null;
  freeTextDrugName: string | null;
  doseMorning: number;
  doseNoon: number;
  doseAfternoon: number;
  doseEvening: number;
  durationDays: number;
  quantity: number;
  instruction: string | null;
  drug: { name: string; activeIngredient: string | null; baseUnitCode: string | null; ingredients: { activeIngredientCode: string }[] } | null;
}

interface RawPrescriptionWithItems extends Prescription {
  items: RawItemWithDrug[];
}

function mapItems(rows: RawItemWithDrug[], nameByCode: Map<string, string>): PrescriptionItemWithDrug[] {
  return rows.map((row) => ({
    id: row.id,
    drugId: row.drugId,
    freeTextDrugName: row.freeTextDrugName,
    drugName: row.drug?.name ?? row.freeTextDrugName!,
    activeIngredient: row.drug?.activeIngredient ?? null,
    ingredientNames: (row.drug?.ingredients ?? []).map((i) => nameByCode.get(i.activeIngredientCode)).filter((n): n is string => n !== undefined),
    doseMorning: row.doseMorning,
    doseNoon: row.doseNoon,
    doseAfternoon: row.doseAfternoon,
    doseEvening: row.doseEvening,
    durationDays: row.durationDays,
    quantity: row.quantity,
    unitCode: row.drug?.baseUnitCode ?? null,
    instruction: row.instruction,
  }));
}

const ITEMS_INCLUDE = {
  where: { deletedAt: null as null },
  include: {
    drug: {
      select: {
        name: true,
        activeIngredient: true,
        baseUnitCode: true,
        ingredients: { where: { deletedAt: null as null }, select: { activeIngredientCode: true } },
      },
    },
  },
  orderBy: { createdAt: 'asc' as const },
};

/**
 * Tên hoạt chất chuẩn theo mã (`reference_catalog` category `ACTIVE_INGREDIENT`, danh mục dùng chung — không có
 * `tenant_id`) của MỌI dòng thuốc trong các đơn vừa đọc — 1 query cho cả lô.
 */
async function loadIngredientNames(tx: Prisma.TransactionClient, tenantId: string, rows: RawItemWithDrug[]): Promise<Map<string, string>> {
  const codes = [...new Set(rows.flatMap((r) => (r.drug?.ingredients ?? []).map((i) => i.activeIngredientCode)))];
  if (codes.length === 0) return new Map();
  const found = await tx.referenceCatalog.findMany({ where: { tenantId, category: 'ACTIVE_INGREDIENT', code: { in: codes } }, select: { code: true, name: true } });
  return new Map(found.map((c) => [c.code, c.name]));
}

export interface CreatePrescriptionItemData {
  drugId: string | null;
  freeTextDrugName: string | null;
  doseMorning: number;
  doseNoon: number;
  doseAfternoon: number;
  doseEvening: number;
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
      include: { items: ITEMS_INCLUDE },
    })) as RawPrescriptionWithItems | null;
    if (!row) return null;
    return { ...row, items: mapItems(row.items, await loadIngredientNames(tx, tenantId, row.items)) };
  }

  /** "Xuất bệnh án PDF" (S6-06) — đơn ĐANG HIỆU LỰC của NHIỀU lượt khám trong 1 query (partial
   * unique đảm bảo tối đa 1 dòng/lượt khám, đúng `findActiveForEncounter()`), nhóm theo `encounterId`. */
  async findActiveForEncounters(tx: Prisma.TransactionClient, tenantId: string, encounterIds: string[]): Promise<Map<string, PrescriptionWithItems>> {
    if (encounterIds.length === 0) return new Map();
    const rows = (await tx.prescription.findMany({
      where: { tenantId, encounterId: { in: encounterIds }, deletedAt: null },
      include: { items: ITEMS_INCLUDE },
    })) as RawPrescriptionWithItems[];
    const nameByCode = await loadIngredientNames(tx, tenantId, rows.flatMap((r) => r.items));
    const result = new Map<string, PrescriptionWithItems>();
    for (const row of rows) {
      result.set(row.encounterId, { ...row, items: mapItems(row.items, nameByCode) });
    }
    return result;
  }

  async findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PrescriptionWithItems | null> {
    const row = (await tx.prescription.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: { items: ITEMS_INCLUDE },
    })) as RawPrescriptionWithItems | null;
    if (!row) return null;
    return { ...row, items: mapItems(row.items, await loadIngredientNames(tx, tenantId, row.items)) };
  }

  /** "Sao chép đơn thuốc lần khám trước" (docs/DECISIONS.md #196, mockup đã duyệt) — đơn ĐÃ KÝ gần
   * nhất của CÙNG bệnh nhân, ở lượt khám KHÁC `excludeEncounterId`. Lọc qua quan hệ `encounter.
   * patientId` (không cần join thủ công) — `deletedAt: null` tự loại bản gốc đã bị đính chính. */
  async findMostRecentSignedForPatient(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    excludeEncounterId: string,
  ): Promise<PrescriptionWithItems | null> {
    const row = (await tx.prescription.findFirst({
      where: { tenantId, deletedAt: null, signedAt: { not: null }, encounterId: { not: excludeEncounterId }, encounter: { patientId } },
      orderBy: { signedAt: 'desc' },
      include: { items: ITEMS_INCLUDE },
    })) as RawPrescriptionWithItems | null;
    if (!row) return null;
    return { ...row, items: mapItems(row.items, await loadIngredientNames(tx, tenantId, row.items)) };
  }

  /**
   * "Bỏ qua cảnh báo này cho đơn hiện tại" (#228) — ghi danh sách cảnh báo đã bỏ qua của đơn NHÁP (optimistic lock qua
   * `version`; `signedAt: null` thêm một lớp chặn nữa phía ứng dụng, trigger DB là lớp cuối). Trả số dòng đã cập nhật.
   */
  async setAcknowledgedWarnings(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    version: number,
    acknowledged: unknown[],
    actorId: string,
  ): Promise<number> {
    const result = await tx.prescription.updateMany({
      where: { tenantId, id, version, signedAt: null, deletedAt: null },
      data: { acknowledgedWarnings: acknowledged as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: actorId },
    });
    return result.count;
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

  /** Ký đơn nháp — `WHERE signed_at IS NULL` chống ký trùng khi 2 request gần như đồng thời (cùng
   * tinh thần các `updateMany` có điều kiện khác trong dự án). `prescriptionNo` sinh lúc ký (#169),
   * không lúc tạo nháp — nháp có thể sửa/xoá nhiều lần, không cần mã. */
  async sign(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, signedAt: Date, signedBy: string, prescriptionNo: string): Promise<number> {
    const result = await tx.prescription.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, signedAt: null },
      data: { signedAt, signedBy, prescriptionNo, updatedBy: actorId, version: { increment: 1 } },
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

  /** Tạo đơn đính chính — ĐÃ KÝ NGAY lúc tạo (đính chính là một hành động xác nhận trọn vẹn, không
   * qua lại bước nháp). `prescriptionNo` GIỮ NGUYÊN mã của bản gốc bị đính chính (#169, chốt qua
   * AskUserQuestion) — đính chính là bản sửa của cùng 1 y lệnh, không phải đơn mới, không sinh mã mới. */
  createAmendment(
    tx: Prisma.TransactionClient,
    tenantId: string,
    encounterId: string,
    actorId: string,
    data: { supersedesId: string; amendmentReason: string; signedAt: Date; signedBy: string; prescriptionNo: string | null },
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
