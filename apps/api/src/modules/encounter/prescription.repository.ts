import { Injectable } from '@nestjs/common';
import type { Prescription, PrescriptionDocument, Prisma } from '@prisma/client';
import type { DoseMode, DrugControlType } from '@nexamed/shared';

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
  /** `null` khi dòng kiểu "Khi cần" (#267). */
  durationDays: number | null;
  doseMode: DoseMode;
  singleDose: number | null;
  /** Đơn vị liều + dung tích CHỤP lúc lưu (#267) — `null` = liều tính theo chính đơn vị nhỏ nhất. */
  doseUnitName: string | null;
  dosePerBaseUnit: number | null;
  quantity: number;
  /** Đơn vị nhỏ nhất của thuốc (`drug.baseUnitCode`) — CHỈ hiển thị, docs/DECISIONS.md #196. `null`
   * cho dòng tự do hoặc thuốc chưa khai đơn vị cơ sở. */
  unitCode: string | null;
  instruction: string | null;
  /** `drug.is_splittable` (#241) — `true` cho dòng tự do (không có khái niệm chia nhỏ). */
  isSplittable: boolean;
  /** Phân loại kiểm soát + cờ Đông y của thuốc — đầu vào của `resolvePrescriptionKind()` (#242). `null`/`false` cho dòng tự do. */
  controlType: DrugControlType | null;
  isTraditional: boolean;
  /** Mã thuốc quốc gia 20 ký tự (`drug.national_code`) — cần khi gửi đơn lên cổng liên thông (#242 GĐ3); `null` = chưa khai hoặc dòng tự do. */
  nationalCode: string | null;
  /** Đơn pháp lý chứa dòng này (#242) — `null` khi còn nháp hoặc đơn ký trước ngày bật chế độ chuẩn. */
  documentId: string | null;
}

/** Đơn thuốc pháp lý đang hiệu lực (mã chuẩn Bộ Y tế, #242) — thứ tự C, N, H, Y theo thời điểm tạo. */
export interface PrescriptionDocumentRow {
  id: string;
  kind: 'C' | 'N' | 'H' | 'Y';
  nationalCode: string;
}

export interface PrescriptionWithItems extends Prescription {
  items: PrescriptionItemWithDrug[];
  documents: PrescriptionDocumentRow[];
}

interface RawItemWithDrug {
  id: string;
  drugId: string | null;
  freeTextDrugName: string | null;
  // Cột NUMERIC(5,2) (#241) — Prisma trả Decimal, `mapItems()` đổi sang number.
  doseMorning: Prisma.Decimal;
  doseNoon: Prisma.Decimal;
  doseAfternoon: Prisma.Decimal;
  doseEvening: Prisma.Decimal;
  durationDays: number | null;
  doseMode: DoseMode;
  singleDose: Prisma.Decimal | null;
  doseUnitName: string | null;
  dosePerBaseUnit: Prisma.Decimal | null;
  quantity: number;
  instruction: string | null;
  documentId: string | null;
  drug: {
    name: string;
    activeIngredient: string | null;
    baseUnitCode: string | null;
    isSplittable: boolean;
    controlType: DrugControlType;
    isTraditional: boolean;
    nationalCode: string | null;
    ingredients: { activeIngredientCode: string }[];
  } | null;
}

interface RawPrescriptionWithItems extends Prescription {
  items: RawItemWithDrug[];
  documents: PrescriptionDocument[];
}

function mapDocuments(rows: PrescriptionDocument[]): PrescriptionDocumentRow[] {
  return rows.map((d) => ({ id: d.id, kind: d.kind as PrescriptionDocumentRow['kind'], nationalCode: d.nationalCode }));
}

/** Dựng `PrescriptionWithItems` từ dòng thô (items + documents) — dùng chung mọi hàm đọc. */
function toPrescriptionWithItems(row: RawPrescriptionWithItems, nameByCode: Map<string, string>): PrescriptionWithItems {
  return { ...row, items: mapItems(row.items, nameByCode), documents: mapDocuments(row.documents) };
}

function mapItems(rows: RawItemWithDrug[], nameByCode: Map<string, string>): PrescriptionItemWithDrug[] {
  return rows.map((row) => ({
    id: row.id,
    drugId: row.drugId,
    freeTextDrugName: row.freeTextDrugName,
    drugName: row.drug?.name ?? row.freeTextDrugName!,
    activeIngredient: row.drug?.activeIngredient ?? null,
    ingredientNames: (row.drug?.ingredients ?? []).map((i) => nameByCode.get(i.activeIngredientCode)).filter((n): n is string => n !== undefined),
    doseMorning: Number(row.doseMorning),
    doseNoon: Number(row.doseNoon),
    doseAfternoon: Number(row.doseAfternoon),
    doseEvening: Number(row.doseEvening),
    durationDays: row.durationDays,
    doseMode: row.doseMode,
    singleDose: row.singleDose === null ? null : Number(row.singleDose),
    doseUnitName: row.doseUnitName,
    dosePerBaseUnit: row.dosePerBaseUnit === null ? null : Number(row.dosePerBaseUnit),
    quantity: row.quantity,
    unitCode: row.drug?.baseUnitCode ?? null,
    instruction: row.instruction,
    isSplittable: row.drug?.isSplittable ?? true,
    controlType: row.drug?.controlType ?? null,
    isTraditional: row.drug?.isTraditional ?? false,
    nationalCode: row.drug?.nationalCode ?? null,
    documentId: row.documentId,
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
        isSplittable: true,
        controlType: true,
        isTraditional: true,
        nationalCode: true,
        ingredients: { where: { deletedAt: null as null }, select: { activeIngredientCode: true } },
      },
    },
  },
  orderBy: { createdAt: 'asc' as const },
};

/** Đơn pháp lý đang hiệu lực kèm đơn thuốc (#242). */
const DOCUMENTS_INCLUDE = { where: { deletedAt: null as null }, orderBy: { createdAt: 'asc' as const } };

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
  durationDays: number | null;
  doseMode: DoseMode;
  singleDose: number | null;
  doseUnitName: string | null;
  dosePerBaseUnit: number | null;
  quantity: number;
  instruction: string | null;
}

/** Cấu hình "Cách kê liều" của một thuốc (#267) — nguồn để máy chủ quyết kiểu kê, chụp đơn vị liều và tính số lượng lúc lưu dòng đơn. */
export interface DrugDoseConfig {
  doseMode: DoseMode;
  doseUnitName: string | null;
  dosePerBaseUnit: number | null;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `prescription`/`prescription_item` (Sprint 4, S4-01/02/04) — theo .claude/docs/coding-standards.md. */
@Injectable()
export class PrescriptionRepository {
  /** Cấu hình "Cách kê liều" của các thuốc trong danh mục (#267) — 1 truy vấn cho cả đơn. Thuốc không có trong kết quả = không tồn tại/đã xoá. */
  async findDrugDoseConfigs(tx: Prisma.TransactionClient, tenantId: string, drugIds: string[]): Promise<Map<string, DrugDoseConfig>> {
    if (drugIds.length === 0) return new Map();
    const rows = await tx.drug.findMany({
      where: { tenantId, id: { in: drugIds }, deletedAt: null },
      select: { id: true, doseMode: true, doseUnitCode: true, dosePerBaseUnit: true },
    });
    // Đơn vị liều của thuốc lưu bằng MÃ danh mục "Đơn vị tính" — chụp vào dòng đơn bằng TÊN hiển thị (mã không còn nghĩa khi in). Không tìm thấy tên thì giữ mã.
    const unitCodes = [...new Set(rows.map((r) => r.doseUnitCode).filter((c): c is string => c !== null))];
    const unitNames = unitCodes.length > 0 ? await tx.referenceCatalog.findMany({ where: { tenantId, category: 'UNIT', code: { in: unitCodes } }, select: { code: true, name: true } }) : [];
    const nameByCode = new Map(unitNames.map((u) => [u.code, u.name]));
    return new Map(
      rows.map((r) => [
        r.id,
        { doseMode: r.doseMode, doseUnitName: r.doseUnitCode === null ? null : (nameByCode.get(r.doseUnitCode) ?? r.doseUnitCode), dosePerBaseUnit: r.dosePerBaseUnit === null ? null : Number(r.dosePerBaseUnit) },
      ]),
    );
  }

  /** Đơn ĐANG HIỆU LỰC (nháp hoặc đã ký, chưa bị đính chính/xoá) của một lượt khám — tối đa 1 dòng (partial unique). */
  async findActiveForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<PrescriptionWithItems | null> {
    const row = (await tx.prescription.findFirst({
      where: { tenantId, encounterId, deletedAt: null },
      include: { items: ITEMS_INCLUDE, documents: DOCUMENTS_INCLUDE },
    })) as RawPrescriptionWithItems | null;
    if (!row) return null;
    return toPrescriptionWithItems(row, await loadIngredientNames(tx, tenantId, row.items));
  }

  /** "Xuất bệnh án PDF" (S6-06) — đơn ĐANG HIỆU LỰC của NHIỀU lượt khám trong 1 query (partial
   * unique đảm bảo tối đa 1 dòng/lượt khám, đúng `findActiveForEncounter()`), nhóm theo `encounterId`. */
  async findActiveForEncounters(tx: Prisma.TransactionClient, tenantId: string, encounterIds: string[]): Promise<Map<string, PrescriptionWithItems>> {
    if (encounterIds.length === 0) return new Map();
    const rows = (await tx.prescription.findMany({
      where: { tenantId, encounterId: { in: encounterIds }, deletedAt: null },
      include: { items: ITEMS_INCLUDE, documents: DOCUMENTS_INCLUDE },
    })) as RawPrescriptionWithItems[];
    const nameByCode = await loadIngredientNames(tx, tenantId, rows.flatMap((r) => r.items));
    const result = new Map<string, PrescriptionWithItems>();
    for (const row of rows) {
      result.set(row.encounterId, toPrescriptionWithItems(row, nameByCode));
    }
    return result;
  }

  async findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PrescriptionWithItems | null> {
    const row = (await tx.prescription.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: { items: ITEMS_INCLUDE, documents: DOCUMENTS_INCLUDE },
    })) as RawPrescriptionWithItems | null;
    if (!row) return null;
    return toPrescriptionWithItems(row, await loadIngredientNames(tx, tenantId, row.items));
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
      include: { items: ITEMS_INCLUDE, documents: DOCUMENTS_INCLUDE },
    })) as RawPrescriptionWithItems | null;
    if (!row) return null;
    return toPrescriptionWithItems(row, await loadIngredientNames(tx, tenantId, row.items));
  }

  /**
   * "Lời dặn của bác sĩ" riêng của đơn NHÁP (#241) — `null` = xoá. `signedAt: null` chặn ghi vào đơn đã ký (trigger DB là lớp cuối).
   * Tăng `version` như mọi UPDATE khác; không kèm điều kiện `version` vì lưu nháp vốn là "ghi đè toàn bộ" (cùng `replaceItems`).
   */
  async setDoctorAdvice(tx: Prisma.TransactionClient, tenantId: string, id: string, advice: string | null, actorId: string): Promise<number> {
    const result = await tx.prescription.updateMany({
      where: { tenantId, id, signedAt: null, deletedAt: null },
      data: { doctorAdvice: advice, version: { increment: 1 }, updatedBy: actorId },
    });
    return result.count;
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

  // ----- Đơn thuốc pháp lý (mã chuẩn Bộ Y tế, #242) -----

  /** Tạo một đơn pháp lý (một loại C/N/H/Y) của đơn thuốc — chỉ gọi lúc ký/đính chính, trong cùng transaction. */
  createDocument(
    tx: Prisma.TransactionClient,
    tenantId: string,
    prescriptionId: string,
    actorId: string,
    data: { kind: PrescriptionDocumentRow['kind']; nationalCode: string },
  ): Promise<PrescriptionDocument> {
    return tx.prescriptionDocument.create({ data: { tenantId, prescriptionId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  /** Gán các dòng thuốc vào một đơn pháp lý. Dòng của đơn nháp chưa ký chưa bị trigger chặn (trigger chỉ ở bảng `prescription`). */
  async assignItemsToDocument(tx: Prisma.TransactionClient, tenantId: string, itemIds: string[], documentId: string, actorId: string): Promise<void> {
    if (itemIds.length === 0) return;
    await tx.prescriptionItem.updateMany({
      where: { tenantId, id: { in: itemIds }, deletedAt: null },
      data: { documentId, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /** Soft-delete các đơn pháp lý của đơn bị đính chính — PHẢI chạy TRƯỚC khi tạo đơn pháp lý mới giữ cùng mã (partial unique theo mã chỉ tính bản đang hiệu lực). */
  async supersedeDocuments(tx: Prisma.TransactionClient, tenantId: string, prescriptionId: string, actorId: string): Promise<void> {
    await tx.prescriptionDocument.updateMany({
      where: { tenantId, prescriptionId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'amended', updatedBy: actorId, version: { increment: 1 } },
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
    data: { supersedesId: string; amendmentReason: string; signedAt: Date; signedBy: string; prescriptionNo: string | null; doctorAdvice: string | null },
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
