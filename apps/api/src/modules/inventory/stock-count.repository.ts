import { Injectable } from '@nestjs/common';
import type { Prisma, StockCount } from '@prisma/client';

export interface StockCountLineData {
  drugId: string;
  batchId: string | null;
  newBatchNo: string | null;
  newBatchExpiryDate: Date | null;
  systemQuantitySnapshot: number;
  countedQuantity: number;
}

export interface CreateStockCountData {
  countNo: string;
  warehouseId: string;
  occurredAt: Date;
  note: string | null;
  lines: StockCountLineData[];
}

export interface UpdateStockCountData {
  warehouseId: string;
  occurredAt: Date;
  note: string | null;
  lines: StockCountLineData[];
}

const LINE_INCLUDE = {
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' as const },
  include: {
    drug: { select: { code: true, name: true, isBatchManaged: true } },
    batch: { select: { batchNo: true, expiryDate: true } },
  },
} satisfies Prisma.StockCount$linesArgs;

export type StockCountWithLines = StockCount & {
  lines: (Prisma.StockCountLineGetPayload<{
    include: { drug: { select: { code: true; name: true; isBatchManaged: true } }; batch: { select: { batchNo: true; expiryDate: true } } };
  }>)[];
};

export interface StockCountListRow extends StockCount {
  warehouse: { name: string };
  _count: { lines: number };
}

export interface ListStockCountsFilter {
  warehouseId?: string;
  status?: StockCount['status'];
  q?: string;
  cursor?: string;
  take: number;
  /** Phân quyền theo Khoa/Phòng (docs/DECISIONS.md #170) — chỉ set khi actor giữ `stock_count.read`
   * ở scope `department`, lọc CHỈ phiếu thuộc kho do đúng Khoa này quản lý (`warehouse.departmentId`).
   * `undefined` (scope `global`) = không lọc gì thêm. */
  departmentId?: string;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `stock_count`/`stock_count_line` (Kho Thuốc GĐ4, #170). */
@Injectable()
export class StockCountRepository {
  /** 2 lệnh riêng (không nested create) — cùng lý do `StockReceiptRepository.create()` (composite
   * FK chia sẻ `tenantId`, Prisma loại `tenantId` khỏi kiểu nested-create trong trường hợp này). */
  async create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateStockCountData): Promise<StockCountWithLines> {
    const header = await tx.stockCount.create({
      data: {
        tenantId,
        countNo: data.countNo,
        warehouseId: data.warehouseId,
        occurredAt: data.occurredAt,
        note: data.note,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    if (data.lines.length > 0) {
      await tx.stockCountLine.createMany({
        data: data.lines.map((line) => ({
          tenantId,
          countId: header.id,
          drugId: line.drugId,
          batchId: line.batchId,
          newBatchNo: line.newBatchNo,
          newBatchExpiryDate: line.newBatchExpiryDate,
          systemQuantitySnapshot: line.systemQuantitySnapshot,
          countedQuantity: line.countedQuantity,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    const created = await tx.stockCount.findFirst({ where: { tenantId, id: header.id }, include: { lines: LINE_INCLUDE } });
    return created as StockCountWithLines;
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng đếm (soft-delete dòng cũ + tạo dòng mới), đúng khuôn
   * `StockReceiptRepository.updateDraft()`. Chỉ gọi khi Service đã xác nhận `status='DRAFT'`. */
  async updateDraft(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, data: UpdateStockCountData): Promise<number> {
    const result = await tx.stockCount.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: {
        warehouseId: data.warehouseId,
        occurredAt: data.occurredAt,
        note: data.note,
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) return 0;

    await tx.stockCountLine.updateMany({
      where: { tenantId, countId: id, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (data.lines.length > 0) {
      await tx.stockCountLine.createMany({
        data: data.lines.map((line) => ({
          tenantId,
          countId: id,
          drugId: line.drugId,
          batchId: line.batchId,
          newBatchNo: line.newBatchNo,
          newBatchExpiryDate: line.newBatchExpiryDate,
          systemQuantitySnapshot: line.systemQuantitySnapshot,
          countedQuantity: line.countedQuantity,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    return result.count;
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockCount | null> {
    return tx.stockCount.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Dùng cho đường XEM (GET chi tiết) — KHÔNG lọc `deletedAt` (thuần theo khuôn `stock_receipt`,
   * dù `stock_count` hiện chưa có đường huỷ mềm nào). */
  findByIdAnyWithLines(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockCountWithLines | null> {
    return tx.stockCount.findFirst({ where: { tenantId, id }, include: { lines: LINE_INCLUDE } }) as Promise<StockCountWithLines | null>;
  }

  async list(tx: Prisma.TransactionClient, tenantId: string, filter: ListStockCountsFilter): Promise<StockCountListRow[]> {
    const where: Prisma.StockCountWhereInput = {
      tenantId,
      warehouseId: filter.warehouseId,
      status: filter.status,
    };
    if (filter.q) {
      where.countNo = { contains: filter.q, mode: 'insensitive' };
    }
    if (filter.departmentId) {
      where.warehouse = { departmentId: filter.departmentId };
    }
    const rows = await tx.stockCount.findMany({
      where,
      include: { warehouse: { select: { name: true } }, _count: { select: { lines: { where: { deletedAt: null } } } } },
      orderBy: { id: 'desc' },
      take: filter.take,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    return rows as StockCountListRow[];
  }

  /** Duyệt — `WHERE status='DRAFT'` chặn race duyệt trùng, cùng kỹ thuật `StockReceiptRepository.approve()`.
   * `approvalReason` — lý do giải trình chênh lệch (Service bắt buộc khi có dòng dư/thiếu, `null`
   * hợp lệ khi phiếu khớp hoàn toàn — xem `StockCountApprovalReasonRequiredError`). */
  async approve(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, approvalReason: string | null): Promise<number> {
    const result = await tx.stockCount.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: { status: 'POSTED', approvedBy: actorId, approvedAt: new Date(), approvalReason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async reject(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reason: string): Promise<number> {
    const result = await tx.stockCount.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: { status: 'REJECTED', rejectionReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Ghi lại `difference` đã tính SỐNG lúc Duyệt cho từng dòng — để xem lại phiếu đã Duyệt không bị
   * lệch so với tồn kho đã đổi sau đó (đúng số đã dùng để sinh dư/thiếu, không phải tính lại). */
  async updateLineDifferences(tx: Prisma.TransactionClient, tenantId: string, actorId: string, updates: { lineId: string; difference: number }[]): Promise<void> {
    for (const u of updates) {
      await tx.stockCountLine.updateMany({ where: { tenantId, id: u.lineId }, data: { difference: u.difference, updatedBy: actorId } });
    }
  }
}
