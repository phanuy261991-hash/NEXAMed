import { Injectable } from '@nestjs/common';
import type { Drug, DrugControlType, DrugItemType, Prisma } from '@prisma/client';

export interface CreateDrugData {
  code: string;
  name: string;
  itemType: DrugItemType;
  isBatchManaged: boolean;
  baseUnitCode: string | null;
  defaultSellPrice: bigint | null;
  unitPricingEnabled: boolean;
  drugGroupCode: string | null;
  routeCode: string | null;
  nationalCode: string | null;
  manufacturer: string | null;
  minStockAlert: number | null;
  maxStockAlert: number | null;
  controlType: DrugControlType;
  isPrescriptionOnly: boolean;
  manufacturerCode: string;
  registrationNumber: string | null;
  dosageForm: string | null;
  countryOfOrigin: string | null;
  defaultDosage: string | null;
  usageInstruction: string | null;
  contraindications: string | null;
  storageConditions: string | null;
  storageLocation: string | null;
  barcode: string | null;
  packagingSpec: string | null;
  activeIngredient: string | null;
  unit: string | null;
  concentration: string | null;
}

export interface UpdateDrugData {
  code?: string;
  name?: string;
  itemType?: DrugItemType;
  isBatchManaged?: boolean;
  baseUnitCode?: string | null;
  defaultSellPrice?: bigint | null;
  unitPricingEnabled?: boolean;
  drugGroupCode?: string | null;
  routeCode?: string | null;
  nationalCode?: string | null;
  manufacturer?: string | null;
  minStockAlert?: number | null;
  maxStockAlert?: number | null;
  controlType?: DrugControlType;
  isPrescriptionOnly?: boolean;
  manufacturerCode?: string | null;
  registrationNumber?: string | null;
  dosageForm?: string | null;
  countryOfOrigin?: string | null;
  defaultDosage?: string | null;
  usageInstruction?: string | null;
  contraindications?: string | null;
  storageConditions?: string | null;
  storageLocation?: string | null;
  barcode?: string | null;
  packagingSpec?: string | null;
  activeIngredient?: string | null;
  unit?: string | null;
  concentration?: string | null;
  isActive?: boolean;
}

/** Kèm hoạt chất/đơn vị quy đổi (GĐ1) — `DrugService` map sang `DrugSummary.ingredients/units`. */
export type DrugWithDetails = Drug & {
  ingredients: { id: string; activeIngredientCode: string; strengthValue: number; strengthUnitCode: string }[];
  units: { id: string; unitCode: string; sortOrder: number; factorToUnitBelow: number; sellPrice: bigint | null }[];
};

const DETAIL_INCLUDE = {
  ingredients: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, activeIngredientCode: true, strengthValue: true, strengthUnitCode: true },
  },
  units: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' as const },
    select: { id: true, unitCode: true, sortOrder: true, factorToUnitBelow: true, sellPrice: true },
  },
} satisfies Prisma.DrugInclude;

/** Chỗ DUY NHẤT gọi Prisma cho bảng `drug` (Sprint 4, S4-03; mở rộng GĐ1, docs/DECISIONS.md #146). */
@Injectable()
export class DrugRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateDrugData): Promise<Drug> {
    return tx.drug.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Drug | null> {
    return tx.drug.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  findByIdWithDetails(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<DrugWithDetails | null> {
    return tx.drug.findFirst({ where: { tenantId, id, deletedAt: null }, include: DETAIL_INCLUDE });
  }

  findByIds(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<Drug[]> {
    return tx.drug.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null } });
  }

  /** `q` — tìm theo tên/mã/hoạt chất/mã vạch (contains, không phân biệt hoa thường) — dùng lúc kê
   * đơn, chọn hàng nhập/xuất/kiểm kê/điều chuyển kho. Mã vạch (docs/DECISIONS.md #151) hay được quét
   * bằng máy đọc mã vạch (gõ nhanh, khớp chính xác gần như tuyệt đối) nên `contains` vẫn đúng, không
   * cần so khớp riêng. `prescriptionOnly` (Kho Thuốc GĐ3, #163) — lọc CHỈ hàng OTC (`false`) cho khu
   * vực "+ Thêm hàng không theo đơn" ở `DispensePrescriptionDialog.tsx`; `undefined` = không lọc theo cột này. */
  list(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { q?: string; itemType?: DrugItemType; includeInactive: boolean; prescriptionOnly?: boolean },
  ): Promise<DrugWithDetails[]> {
    const where: Prisma.DrugWhereInput = {
      tenantId,
      deletedAt: null,
      ...(params.itemType ? { itemType: params.itemType } : {}),
      ...(params.includeInactive ? {} : { isActive: true }),
      ...(params.prescriptionOnly !== undefined ? { isPrescriptionOnly: params.prescriptionOnly } : {}),
    };
    if (params.q) {
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { code: { contains: params.q, mode: 'insensitive' } },
        { activeIngredient: { contains: params.q, mode: 'insensitive' } },
        { barcode: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    return tx.drug.findMany({ where, include: DETAIL_INCLUDE, orderBy: { name: 'asc' } });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateDrugData,
  ): Promise<number> {
    const result = await tx.drug.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Kho Thuốc GĐ2 — cache "giá nhập gần nhất", cập nhật lúc `approve()` một phiếu nhập
   * `receiptType=PURCHASE` (`InventoryService`). KHÔNG kiểm/tăng `version` — cùng khuôn
   * `CashVoucherRepository.markPrintedIfNotYet()` (cập nhật hệ thống phụ, không phải sửa nội dung
   * người dùng chỉnh qua form "Sửa thuốc"). */
  async updateLastPurchase(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, unitCost: bigint, at: Date): Promise<void> {
    await tx.drug.updateMany({ where: { tenantId, id, deletedAt: null }, data: { lastPurchaseUnitCost: unitCost, lastPurchaseAt: at, updatedBy: actorId } });
  }
}
