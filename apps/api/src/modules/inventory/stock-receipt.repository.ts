import { Injectable } from '@nestjs/common';
import type { Prisma, StockReceipt, StockReceiptType } from '@prisma/client';

export interface StockReceiptLineData {
  drugId: string;
  unitCode: string;
  quantity: number;
  unitCost: bigint;
  batchNo: string | null;
  expiryDate: Date | null;
  lineAmount: bigint;
}

export interface CreateStockReceiptData {
  receiptNo: string;
  warehouseId: string;
  supplierId: string | null;
  receiptType: StockReceiptType;
  occurredAt: Date;
  note: string | null;
  supplierInvoiceNo: string | null;
  totalAmount: bigint;
  lines: StockReceiptLineData[];
  /** Kho Thuốc GĐ4 (#170) — trỏ về `stock_count` khi phiếu này TỰ SINH từ Duyệt phiếu kiểm kê
   * (`receiptType='COUNT_SURPLUS'`). `null` cho mọi phiếu nhập lập tay bình thường. */
  countId: string | null;
}

export interface UpdateStockReceiptData {
  warehouseId: string;
  supplierId: string | null;
  receiptType: StockReceiptType;
  occurredAt: Date;
  note: string | null;
  supplierInvoiceNo: string | null;
  totalAmount: bigint;
  lines: StockReceiptLineData[];
}

const LINE_INCLUDE = {
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' as const },
  include: { drug: { select: { code: true, name: true } } },
} satisfies Prisma.StockReceipt$linesArgs;

export type StockReceiptWithLines = StockReceipt & {
  lines: (Prisma.StockReceiptLineGetPayload<{ include: { drug: { select: { code: true; name: true } } } }>)[];
};

export interface StockReceiptListRow extends StockReceipt {
  warehouse: { name: string };
  supplier: { name: string } | null;
  _count: { lines: number };
}

export interface ListStockReceiptsFilter {
  warehouseId?: string;
  receiptType?: StockReceiptType;
  status?: StockReceipt['status'];
  from?: Date;
  to?: Date;
  q?: string;
  cursor?: string;
  take: number;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `stock_receipt`/`stock_receipt_line` (Kho Thuốc GĐ2). */
@Injectable()
export class StockReceiptRepository {
  /** Tạo header rồi `createMany` dòng hàng RIÊNG (2 lệnh, không dùng Prisma nested `lines: {create}`)
   * — `stock_receipt_line` có 2 composite FK cùng chia sẻ `tenantId` (`(tenantId,receiptId)`→
   * `stock_receipt`, `(tenantId,drugId)`→`drug`), Prisma loại hẳn `tenantId` khỏi kiểu nested-create
   * trong trường hợp này ("Unknown argument tenantId") — đúng lý do `DrugRepository`/
   * `DrugUnitRepository` cũng tách 2 lệnh riêng thay vì nested create cho `drug_unit`/`drug_ingredient`. */
  async create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateStockReceiptData): Promise<StockReceiptWithLines> {
    const header = await tx.stockReceipt.create({
      data: {
        tenantId,
        receiptNo: data.receiptNo,
        warehouseId: data.warehouseId,
        supplierId: data.supplierId,
        receiptType: data.receiptType,
        occurredAt: data.occurredAt,
        note: data.note,
        supplierInvoiceNo: data.supplierInvoiceNo,
        totalAmount: data.totalAmount,
        countId: data.countId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    if (data.lines.length > 0) {
      await tx.stockReceiptLine.createMany({
        data: data.lines.map((line) => ({
          tenantId,
          receiptId: header.id,
          drugId: line.drugId,
          unitCode: line.unitCode,
          quantity: line.quantity,
          unitCost: line.unitCost,
          batchNo: line.batchNo,
          expiryDate: line.expiryDate,
          lineAmount: line.lineAmount,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    const created = await tx.stockReceipt.findFirst({ where: { tenantId, id: header.id }, include: { lines: LINE_INCLUDE } });
    return created as StockReceiptWithLines;
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng hàng (soft-delete dòng cũ + tạo dòng mới), đúng khuôn
   * `DrugUnitRepository.replaceForDrug()`. Chỉ gọi khi Service đã xác nhận `status='DRAFT'`. */
  async updateDraft(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, data: UpdateStockReceiptData): Promise<number> {
    const result = await tx.stockReceipt.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: {
        warehouseId: data.warehouseId,
        supplierId: data.supplierId,
        receiptType: data.receiptType,
        occurredAt: data.occurredAt,
        note: data.note,
        supplierInvoiceNo: data.supplierInvoiceNo,
        totalAmount: data.totalAmount,
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) return 0;

    await tx.stockReceiptLine.updateMany({
      where: { tenantId, receiptId: id, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (data.lines.length > 0) {
      await tx.stockReceiptLine.createMany({
        data: data.lines.map((line) => ({
          tenantId,
          receiptId: id,
          drugId: line.drugId,
          unitCode: line.unitCode,
          quantity: line.quantity,
          unitCost: line.unitCost,
          batchNo: line.batchNo,
          expiryDate: line.expiryDate,
          lineAmount: line.lineAmount,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    return result.count;
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockReceipt | null> {
    return tx.stockReceipt.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Dùng cho đường XEM (GET chi tiết) — KHÔNG lọc `deletedAt`, phiếu đã huỷ vẫn xem được (chỉ đọc). */
  findByIdAnyWithLines(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockReceiptWithLines | null> {
    return tx.stockReceipt.findFirst({ where: { tenantId, id }, include: { lines: LINE_INCLUDE } }) as Promise<StockReceiptWithLines | null>;
  }

  async list(tx: Prisma.TransactionClient, tenantId: string, filter: ListStockReceiptsFilter): Promise<StockReceiptListRow[]> {
    const where: Prisma.StockReceiptWhereInput = {
      tenantId,
      warehouseId: filter.warehouseId,
      receiptType: filter.receiptType,
      status: filter.status,
      occurredAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
    if (filter.q) {
      where.OR = [{ receiptNo: { contains: filter.q, mode: 'insensitive' } }, { supplier: { name: { contains: filter.q, mode: 'insensitive' } } }];
    }
    const rows = await tx.stockReceipt.findMany({
      where,
      include: { warehouse: { select: { name: true } }, supplier: { select: { name: true } }, _count: { select: { lines: { where: { deletedAt: null } } } } },
      orderBy: { id: 'desc' },
      take: filter.take,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    return rows as StockReceiptListRow[];
  }

  /** Duyệt — `WHERE status='DRAFT'` chặn race duyệt trùng, cùng kỹ thuật `CashVoucherRepository.approve()`. */
  async approve(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.stockReceipt.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: { status: 'POSTED', approvedBy: actorId, approvedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async reject(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reason: string): Promise<number> {
    const result = await tx.stockReceipt.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: { status: 'REJECTED', rejectionReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Xoá thẳng (soft-delete thường, KHÔNG cần đảo ledger) — chỉ dùng cho phiếu `DRAFT`/`REJECTED`,
   * chưa từng đụng tồn kho. */
  async removeDraftOrRejected(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reason: string): Promise<number> {
    const result = await tx.stockReceipt.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: { in: ['DRAFT', 'REJECTED'] } },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Huỷ phiếu ĐÃ Duyệt — `WHERE status='POSTED'`, ghi dòng ledger đảo chiều làm ở Service (cần
   * `InventoryBatchRepository`/`StockLedgerRepository`/`StockBalanceRepository`, không thuộc bảng
   * `stock_receipt`). */
  async voidPosted(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reason: string): Promise<number> {
    const result = await tx.stockReceipt.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'POSTED' },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
