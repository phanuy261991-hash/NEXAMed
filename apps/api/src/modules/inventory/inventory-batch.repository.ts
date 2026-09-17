import { Injectable } from '@nestjs/common';
import type { InventoryBatch, Prisma } from '@prisma/client';

export interface CreateInventoryBatchData {
  drugId: string;
  warehouseId: string;
  batchNo: string;
  expiryDate: Date | null;
  unitCost: bigint;
}

export interface DrugBatchBalanceRow {
  batchId: string;
  batchNo: string;
  warehouseId: string;
  warehouseName: string;
  expiryDate: Date | null;
  unitCost: bigint;
  quantityOnHand: number;
}

export interface ExpiryWarningRow {
  batchId: string;
  batchNo: string;
  drugId: string;
  drugName: string;
  warehouseId: string;
  warehouseName: string;
  expiryDate: Date;
  quantityOnHand: number;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `inventory_batch` (Kho Thuốc GĐ2). */
@Injectable()
export class InventoryBatchRepository {
  /** Nhập lại đúng `batchNo` (+ cùng `expiryDate`) cho cùng `drugId`+`warehouseId` → reuse dòng cũ. */
  findByKey(tx: Prisma.TransactionClient, tenantId: string, drugId: string, warehouseId: string, batchNo: string): Promise<InventoryBatch | null> {
    return tx.inventoryBatch.findFirst({ where: { tenantId, drugId, warehouseId, batchNo, deletedAt: null } });
  }

  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateInventoryBatchData): Promise<InventoryBatch> {
    return tx.inventoryBatch.create({
      data: {
        tenantId,
        drugId: data.drugId,
        warehouseId: data.warehouseId,
        batchNo: data.batchNo,
        expiryDate: data.expiryDate,
        unitCost: data.unitCost,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /** Nhập bổ sung vào lô đã có — giá vốn ĐÍCH DANH tự cập nhật bình quân gia quyền NHƯNG chỉ trong
   * phạm vi lô đó (`newUnitCost` đã tính sẵn ở Service theo `computeWeightedAverage()`). */
  async updateCost(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, newUnitCost: bigint): Promise<void> {
    await tx.inventoryBatch.updateMany({ where: { tenantId, id, deletedAt: null }, data: { unitCost: newUnitCost, updatedBy: actorId, version: { increment: 1 } } });
  }

  /** "Tồn kho theo lô" (panel chi tiết thuốc) — mọi lô CÒN TỒN (`quantityOnHand > 0`) của 1 thuốc. */
  async listWithBalanceForDrug(tx: Prisma.TransactionClient, tenantId: string, drugId: string, warehouseId?: string): Promise<DrugBatchBalanceRow[]> {
    const balances = await tx.stockBalance.findMany({
      where: { tenantId, drugId, warehouseId, batchId: { not: null }, quantityOnHand: { gt: 0 }, deletedAt: null },
      select: { batchId: true, quantityOnHand: true },
    });
    if (balances.length === 0) return [];
    const qtyByBatch = new Map(balances.map((b) => [b.batchId as string, b.quantityOnHand]));
    const batches = await tx.inventoryBatch.findMany({
      where: { tenantId, id: { in: [...qtyByBatch.keys()] }, deletedAt: null },
      include: { warehouse: { select: { name: true } } },
      orderBy: [{ expiryDate: 'asc' }, { batchNo: 'asc' }],
    });
    return batches.map((b) => ({
      batchId: b.id,
      batchNo: b.batchNo,
      warehouseId: b.warehouseId,
      warehouseName: b.warehouse.name,
      expiryDate: b.expiryDate,
      unitCost: b.unitCost,
      quantityOnHand: qtyByBatch.get(b.id) ?? 0,
    }));
  }

  /** "Cảnh báo hạn dùng" — mọi lô CÒN TỒN, hạn dùng trước/đúng `threshold` (gồm đã hết hạn). */
  async listExpiryWarnings(tx: Prisma.TransactionClient, tenantId: string, threshold: Date, warehouseId?: string): Promise<ExpiryWarningRow[]> {
    const balances = await tx.stockBalance.findMany({
      where: { tenantId, warehouseId, batchId: { not: null }, quantityOnHand: { gt: 0 }, deletedAt: null },
      select: { batchId: true, quantityOnHand: true },
    });
    if (balances.length === 0) return [];
    const qtyByBatch = new Map(balances.map((b) => [b.batchId as string, b.quantityOnHand]));
    const batches = await tx.inventoryBatch.findMany({
      where: { tenantId, id: { in: [...qtyByBatch.keys()] }, deletedAt: null, expiryDate: { not: null, lte: threshold } },
      include: { warehouse: { select: { name: true } }, drug: { select: { name: true } } },
      orderBy: { expiryDate: 'asc' },
    });
    return batches.map((b) => ({
      batchId: b.id,
      batchNo: b.batchNo,
      drugId: b.drugId,
      drugName: b.drug.name,
      warehouseId: b.warehouseId,
      warehouseName: b.warehouse.name,
      expiryDate: b.expiryDate!,
      quantityOnHand: qtyByBatch.get(b.id) ?? 0,
    }));
  }
}
