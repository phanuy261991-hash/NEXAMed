import { Injectable } from '@nestjs/common';
import type { Prisma, StockLedgerReason } from '@prisma/client';

export interface CreateStockLedgerData {
  drugId: string;
  warehouseId: string;
  batchId: string | null;
  quantityChange: number;
  unitCost: bigint;
  reason: StockLedgerReason;
  sourceReceiptId: string | null;
  /** Kho Thuốc GĐ3 (#163) — song song `sourceReceiptId`, `undefined`/`null` cho dòng nhập. */
  sourceIssueId?: string | null;
  occurredAt: Date;
  note: string | null;
}

export interface StockLedgerRow {
  id: string;
  occurredAt: Date;
  createdAt: Date;
  quantityChange: number;
  reason: StockLedgerReason;
  warehouseId: string;
  warehouseName: string;
  sourceReceiptId: string | null;
  sourceReceiptNo: string | null;
  // Kho Thuốc GĐ3 (#163).
  sourceIssueId: string | null;
  sourceIssueNo: string | null;
  createdBy: string;
}

/** 1 dòng gốc do 1 phiếu nhập kho sinh ra — dùng để đảo NGƯỢC chính xác lúc huỷ phiếu
 * (`StockReceiptService.voidReceipt()`), không tính lại từ `stock_receipt_line`. */
export interface SourceReceiptLedgerRow {
  drugId: string;
  warehouseId: string;
  batchId: string | null;
  quantityChange: number;
  unitCost: bigint;
}

/** 1 dòng gốc do 1 phiếu xuất kho sinh ra — dùng để đảo NGƯỢC chính xác lúc huỷ phiếu
 * (`StockIssueService.voidIssue()`), không tính lại từ `stock_issue_line` (Kho Thuốc GĐ3, #163). */
export interface SourceIssueLedgerRow {
  drugId: string;
  warehouseId: string;
  batchId: string | null;
  quantityChange: number;
  unitCost: bigint;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `stock_ledger` — thẻ kho, append-only (Kho Thuốc GĐ2). */
@Injectable()
export class StockLedgerRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateStockLedgerData) {
    return tx.stockLedger.create({
      data: {
        tenantId,
        drugId: data.drugId,
        warehouseId: data.warehouseId,
        batchId: data.batchId,
        quantityChange: data.quantityChange,
        unitCost: data.unitCost,
        reason: data.reason,
        sourceReceiptId: data.sourceReceiptId,
        sourceIssueId: data.sourceIssueId ?? null,
        occurredAt: data.occurredAt,
        note: data.note,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /** Toàn bộ lịch sử của 1 thuốc (gộp mọi lô/kho nếu không lọc `warehouseId`), sắp CŨ→MỚI để
   * `InventoryService` tính "Tồn sau" luỹ kế rồi tự đảo MỚI→CŨ cho response (đúng quy ước hiển thị
   * List Screen chung của app). */
  async listForDrug(tx: Prisma.TransactionClient, tenantId: string, drugId: string, warehouseId?: string): Promise<StockLedgerRow[]> {
    const rows = await tx.stockLedger.findMany({
      where: { tenantId, drugId, warehouseId },
      include: {
        warehouse: { select: { name: true } },
        sourceReceipt: { select: { receiptNo: true } },
        sourceIssue: { select: { issueNo: true } },
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      createdAt: r.createdAt,
      quantityChange: r.quantityChange,
      reason: r.reason,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouse.name,
      sourceReceiptId: r.sourceReceiptId,
      sourceReceiptNo: r.sourceReceipt?.receiptNo ?? null,
      sourceIssueId: r.sourceIssueId,
      sourceIssueNo: r.sourceIssue?.issueNo ?? null,
      createdBy: r.createdBy,
    }));
  }

  /** Mọi dòng thẻ kho GỐC (chưa từng bị đảo) do đúng phiếu `sourceReceiptId` sinh ra — dùng để huỷ
   * phiếu (đảo ngược chính xác), chỉ 2 reason nhập có thật ở GĐ2. */
  listForSourceReceipt(tx: Prisma.TransactionClient, tenantId: string, sourceReceiptId: string): Promise<SourceReceiptLedgerRow[]> {
    return tx.stockLedger.findMany({
      where: { tenantId, sourceReceiptId, reason: { in: ['RECEIPT_PURCHASE', 'RECEIPT_OPENING_BALANCE'] } },
      select: { drugId: true, warehouseId: true, batchId: true, quantityChange: true, unitCost: true },
    });
  }

  /** Mọi dòng thẻ kho GỐC do đúng phiếu `sourceIssueId` sinh ra — dùng để huỷ phiếu xuất (đảo
   * ngược chính xác), Kho Thuốc GĐ3 (#163), chỉ reason `ISSUE_RETAIL_SALE` có thật ở GĐ3. */
  listForSourceIssue(tx: Prisma.TransactionClient, tenantId: string, sourceIssueId: string): Promise<SourceIssueLedgerRow[]> {
    return tx.stockLedger.findMany({
      where: { tenantId, sourceIssueId, reason: 'ISSUE_RETAIL_SALE' },
      select: { drugId: true, warehouseId: true, batchId: true, quantityChange: true, unitCost: true },
    });
  }
}
