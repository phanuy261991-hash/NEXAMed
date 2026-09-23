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
   * phiếu (đảo ngược chính xác). `RECEIPT_RETURN_FROM_USE` thêm cho "Phiếu nhập kho mở rộng" (Kho
   * Thuốc GĐ4, docs/DECISIONS.md #170) — thiếu reason này thì huỷ phiếu RETURN_FROM_USE sẽ ÂM THẦM
   * không đảo ngược gì (`originalEntries` rỗng), phát hiện lúc mở khoá loại phiếu này lập tay.
   * KHÔNG thêm `RECEIPT_TRANSFER_IN`/`RECEIPT_COUNT_SURPLUS` — 2 phiếu tự sinh đó không lập tay/huỷ
   * độc lập qua endpoint này (ngoài phạm vi "Phiếu nhập kho mở rộng"). */
  listForSourceReceipt(tx: Prisma.TransactionClient, tenantId: string, sourceReceiptId: string): Promise<SourceReceiptLedgerRow[]> {
    return tx.stockLedger.findMany({
      where: { tenantId, sourceReceiptId, reason: { in: ['RECEIPT_PURCHASE', 'RECEIPT_OPENING_BALANCE', 'RECEIPT_RETURN_FROM_USE'] } },
      select: { drugId: true, warehouseId: true, batchId: true, quantityChange: true, unitCost: true },
    });
  }

  /** Mọi dòng thẻ kho GỐC do đúng phiếu `sourceIssueId` sinh ra — dùng để huỷ phiếu xuất (đảo
   * ngược chính xác). 3 reason `ISSUE_INTERNAL_ALLOCATION`/`ISSUE_RETURN_TO_SUPPLIER`/`ISSUE_WRITE_OFF`
   * thêm cho "Phiếu xuất kho mở rộng" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — cùng lý do
   * `listForSourceReceipt()` ở trên, thiếu thì huỷ phiếu loại này sẽ âm thầm không đảo ngược gì.
   * KHÔNG thêm `ISSUE_TRANSFER_OUT`/`ISSUE_COUNT_SHORTAGE` — 2 phiếu tự sinh đó không huỷ độc lập
   * qua endpoint này. */
  listForSourceIssue(tx: Prisma.TransactionClient, tenantId: string, sourceIssueId: string): Promise<SourceIssueLedgerRow[]> {
    return tx.stockLedger.findMany({
      where: { tenantId, sourceIssueId, reason: { in: ['ISSUE_RETAIL_SALE', 'ISSUE_INTERNAL_ALLOCATION', 'ISSUE_RETURN_TO_SUPPLIER', 'ISSUE_WRITE_OFF'] } },
      select: { drugId: true, warehouseId: true, batchId: true, quantityChange: true, unitCost: true },
    });
  }

  /**
   * "Báo cáo Nhập-Xuất-Tồn" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — tổng biến động `quantityChange`
   * gộp theo (drugId, warehouseId), lọc theo mốc thời gian + dấu (`quantitySign`). Dùng LẶP LẠI 3 lần
   * với tham số khác nhau (trước mốc `from` → Đầu kỳ; trong khoảng dương → Nhập; trong khoảng âm →
   * Xuất) — mirror `sumBeforeForAccount()` ở `cash-book-report.service.ts`, KHÔNG viết 3 hàm riêng.
   */
  async sumQuantityGrouped(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { before?: Date; from?: Date; to?: Date; quantitySign?: 'positive' | 'negative'; warehouseId?: string; drugId?: string },
  ): Promise<{ drugId: string; warehouseId: string; sum: number }[]> {
    const rows = await tx.stockLedger.groupBy({
      by: ['drugId', 'warehouseId'],
      where: {
        tenantId,
        warehouseId: params.warehouseId,
        drugId: params.drugId,
        occurredAt: params.before ? { lt: params.before } : params.from || params.to ? { gte: params.from, lte: params.to } : undefined,
        quantityChange: params.quantitySign === 'positive' ? { gt: 0 } : params.quantitySign === 'negative' ? { lt: 0 } : undefined,
      },
      _sum: { quantityChange: true },
    });
    return rows.map((r) => ({ drugId: r.drugId, warehouseId: r.warehouseId, sum: r._sum.quantityChange ?? 0 }));
  }
}
