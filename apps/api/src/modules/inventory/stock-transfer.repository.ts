import { Injectable } from '@nestjs/common';
import type { Prisma, StockTransfer } from '@prisma/client';

export interface StockTransferLineData {
  drugId: string;
  batchId: string | null;
  quantityShipped: number;
}

export interface CreateStockTransferData {
  transferNo: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  occurredAt: Date;
  note: string | null;
  lines: StockTransferLineData[];
}

export interface UpdateStockTransferData {
  fromWarehouseId: string;
  toWarehouseId: string;
  occurredAt: Date;
  note: string | null;
  lines: StockTransferLineData[];
}

const LINE_INCLUDE = {
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' as const },
  include: {
    // `baseUnitCode` cần cho `unitCode` của dòng Phiếu nhập TRANSFER_IN tự sinh lúc Xác nhận nhận
    // hàng (luôn ở đơn vị CƠ SỞ, không quy đổi) — tránh phải tra riêng `DrugRepository.findByIds()`.
    drug: { select: { code: true, name: true, isBatchManaged: true, baseUnitCode: true } },
    batch: { select: { batchNo: true, expiryDate: true } },
  },
} satisfies Prisma.StockTransfer$linesArgs;

export type StockTransferWithLines = StockTransfer & {
  lines: (Prisma.StockTransferLineGetPayload<{
    include: {
      drug: { select: { code: true; name: true; isBatchManaged: true; baseUnitCode: true } };
      batch: { select: { batchNo: true; expiryDate: true } };
    };
  }>)[];
};

export interface StockTransferListRow extends StockTransfer {
  fromWarehouse: { name: string };
  toWarehouse: { name: string };
  _count: { lines: number };
}

export interface ListStockTransfersFilter {
  fromWarehouseId?: string;
  toWarehouseId?: string;
  status?: StockTransfer['status'];
  q?: string;
  cursor?: string;
  take: number;
  /** Phân quyền theo Khoa/Phòng (docs/DECISIONS.md #170 mục 0) — chỉ set khi actor giữ
   * `stock_transfer.read` ở scope `department`, lọc phiếu có KHO NGUỒN **HOẶC** kho đích thuộc đúng
   * Khoa này (actor có thể là người ở đầu nguồn hoặc đầu đích của cùng 1 phiếu). `undefined` (scope
   * `global`) = không lọc gì thêm. */
  departmentId?: string;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `stock_transfer`/`stock_transfer_line` (Kho Thuốc GĐ4, #170). */
@Injectable()
export class StockTransferRepository {
  /** 2 lệnh riêng (không nested create) — cùng lý do `StockReceiptRepository.create()`. */
  async create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateStockTransferData): Promise<StockTransferWithLines> {
    const header = await tx.stockTransfer.create({
      data: {
        tenantId,
        transferNo: data.transferNo,
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        occurredAt: data.occurredAt,
        note: data.note,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    if (data.lines.length > 0) {
      await tx.stockTransferLine.createMany({
        data: data.lines.map((line) => ({
          tenantId,
          transferId: header.id,
          drugId: line.drugId,
          batchId: line.batchId,
          quantityShipped: line.quantityShipped,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    const created = await tx.stockTransfer.findFirst({ where: { tenantId, id: header.id }, include: { lines: LINE_INCLUDE } });
    return created as StockTransferWithLines;
  }

  /** Sửa Nháp — bulk-replace toàn bộ dòng hàng + header, chỉ khi `status='DRAFT'`. */
  async updateDraft(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, data: UpdateStockTransferData): Promise<number> {
    const result = await tx.stockTransfer.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: {
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        occurredAt: data.occurredAt,
        note: data.note,
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) return 0;

    await tx.stockTransferLine.updateMany({
      where: { tenantId, transferId: id, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (data.lines.length > 0) {
      await tx.stockTransferLine.createMany({
        data: data.lines.map((line) => ({
          tenantId,
          transferId: id,
          drugId: line.drugId,
          batchId: line.batchId,
          quantityShipped: line.quantityShipped,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    return result.count;
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockTransfer | null> {
    return tx.stockTransfer.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Dùng cho đường XEM (GET chi tiết) — KHÔNG lọc `deletedAt` (đúng khuôn `stock_count`/`stock_receipt`,
   * dù `stock_transfer` hiện chưa có đường huỷ mềm nào). */
  findByIdAnyWithLines(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockTransferWithLines | null> {
    return tx.stockTransfer.findFirst({ where: { tenantId, id }, include: { lines: LINE_INCLUDE } }) as Promise<StockTransferWithLines | null>;
  }

  async list(tx: Prisma.TransactionClient, tenantId: string, filter: ListStockTransfersFilter): Promise<StockTransferListRow[]> {
    const where: Prisma.StockTransferWhereInput = {
      tenantId,
      fromWarehouseId: filter.fromWarehouseId,
      toWarehouseId: filter.toWarehouseId,
      status: filter.status,
    };
    if (filter.q) {
      where.transferNo = { contains: filter.q, mode: 'insensitive' };
    }
    if (filter.departmentId) {
      where.OR = [{ fromWarehouse: { departmentId: filter.departmentId } }, { toWarehouse: { departmentId: filter.departmentId } }];
    }
    const rows = await tx.stockTransfer.findMany({
      where,
      include: {
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        _count: { select: { lines: { where: { deletedAt: null } } } },
      },
      orderBy: { id: 'desc' },
      take: filter.take,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    return rows as StockTransferListRow[];
  }

  /** Duyệt (xuất) — `WHERE status='DRAFT'` chặn race duyệt trùng, cùng kỹ thuật `stock_receipt`/`stock_count`. */
  async markShipped(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.stockTransfer.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: { status: 'IN_TRANSIT', shippedBy: actorId, shippedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async reject(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reason: string): Promise<number> {
    const result = await tx.stockTransfer.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'DRAFT' },
      data: { status: 'REJECTED', rejectionReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Xác nhận nhận hàng — `WHERE status='IN_TRANSIT'` chặn xác nhận trùng/xác nhận phiếu chưa xuất. */
  async markReceived(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.stockTransfer.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'IN_TRANSIT' },
      data: { status: 'COMPLETED', receivedBy: actorId, receivedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Ghi `unitCost` SNAPSHOT vào từng dòng lúc Duyệt xuất — dùng lại số này khi tạo Phiếu nhập
   * TRANSFER_IN tại kho đích lúc Xác nhận nhận hàng, không tính lại. */
  async updateLineUnitCosts(tx: Prisma.TransactionClient, tenantId: string, actorId: string, updates: { lineId: string; unitCost: bigint }[]): Promise<void> {
    for (const u of updates) {
      await tx.stockTransferLine.updateMany({ where: { tenantId, id: u.lineId }, data: { unitCost: u.unitCost, updatedBy: actorId } });
    }
  }

  /** Ghi `quantityReceived`/`varianceNote` vào từng dòng lúc Xác nhận nhận hàng. */
  async updateLineReceived(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    updates: { lineId: string; quantityReceived: number; varianceNote: string | null }[],
  ): Promise<void> {
    for (const u of updates) {
      await tx.stockTransferLine.updateMany({
        where: { tenantId, id: u.lineId },
        data: { quantityReceived: u.quantityReceived, varianceNote: u.varianceNote, updatedBy: actorId },
      });
    }
  }
}
