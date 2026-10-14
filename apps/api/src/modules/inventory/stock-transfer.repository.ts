import { Injectable } from '@nestjs/common';
import type { Prisma, StockTransfer, StockTransferStatus } from '@prisma/client';

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

/** Kho + chi nhánh của kho — đủ để dựng nhãn "Từ chi nhánh / kho → Đến chi nhánh / kho". */
type WarehouseBranchBrief = { name: string; branchId: string; branch: { name: string } };
const WAREHOUSE_BRIEF = { select: { name: true, branchId: true, branch: { select: { name: true } } } } as const;

export interface StockTransferListRow extends StockTransfer {
  fromWarehouse: WarehouseBranchBrief;
  toWarehouse: WarehouseBranchBrief;
  _count: { lines: number };
}

export type TransferViewerRole = 'sender' | 'receiver' | 'viewer';

/** Chi nhánh NHẬN thấy phiếu từ lúc nó đã rời khỏi chi nhánh gửi (Duyệt xuất) — không thấy Nháp / phiếu bị bên gửi từ chối lúc Nháp. */
const RECEIVER_VISIBLE_STATUSES: StockTransferStatus[] = ['IN_TRANSIT', 'COMPLETED', 'VARIANCE_PENDING', 'RETURNING', 'RETURNED'];

/** Phiếu của chi nhánh GỬI (kho nguồn thuộc chi nhánh) — gồm cả điều chuyển trong cùng chi nhánh. */
function senderWhere(branchId: string): Prisma.StockTransferWhereInput {
  return { fromWarehouse: { branchId } };
}

/** Phiếu mà chi nhánh là NƠI NHẬN: kho đích thuộc chi nhánh và (cùng chi nhánh với kho gửi HOẶC đã được Duyệt xuất). */
function receiverWhere(branchId: string): Prisma.StockTransferWhereInput {
  return { toWarehouse: { branchId }, OR: [{ fromWarehouse: { branchId } }, { status: { in: RECEIVER_VISIBLE_STATUSES } }] };
}

function roleWhere(branchId: string, role: TransferViewerRole): Prisma.StockTransferWhereInput {
  if (role === 'sender') return senderWhere(branchId);
  if (role === 'receiver') return receiverWhere(branchId);
  return { OR: [senderWhere(branchId), receiverWhere(branchId)] };
}

export interface ListStockTransfersFilter {
  /** Chi nhánh đang làm việc (Đợt 2, docs/DECISIONS.md #233). */
  branchId: string;
  /** `out` = phiếu có kho GỬI thuộc chi nhánh; `in` = phiếu từ chi nhánh KHÁC đã đến / đang đến chi nhánh này. */
  direction: 'out' | 'in';
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

/** Dòng hao hụt điều chuyển cho "Báo cáo hao hụt điều chuyển" — chỉ chi nhánh GỬI. */
export interface TransferShrinkageRow {
  transferId: string;
  transferNo: string;
  occurredAt: Date;
  status: StockTransferStatus;
  fromWarehouseName: string;
  toWarehouseName: string;
  drugCode: string;
  drugName: string;
  quantity: number;
  unitCost: bigint;
  cause: 'WRITE_OFF' | 'RETURN_SHORTAGE';
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

  /** Đợt 2 chi nhánh (#233): luôn kèm vai trò người xem — phiếu của chi nhánh khác không liên quan → null → 404. */
  findById(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string, role: TransferViewerRole): Promise<StockTransfer | null> {
    return tx.stockTransfer.findFirst({ where: { tenantId, id, deletedAt: null, ...roleWhere(branchId, role) } });
  }

  /** Dùng cho đường XEM (GET chi tiết) — KHÔNG lọc `deletedAt` (đúng khuôn `stock_count`/`stock_receipt`,
   * dù `stock_transfer` hiện chưa có đường huỷ mềm nào). */
  findByIdAnyWithLines(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string, role: TransferViewerRole): Promise<StockTransferWithLines | null> {
    return tx.stockTransfer.findFirst({
      where: { tenantId, id, ...roleWhere(branchId, role) },
      include: { lines: LINE_INCLUDE },
    }) as Promise<StockTransferWithLines | null>;
  }

  async list(tx: Prisma.TransactionClient, tenantId: string, filter: ListStockTransfersFilter): Promise<StockTransferListRow[]> {
    const and: Prisma.StockTransferWhereInput[] = [];
    if (filter.direction === 'in') {
      // Phiếu TỪ chi nhánh khác đang/đã đến chi nhánh này (cùng chi nhánh luôn nằm ở tab "Phiếu đi").
      and.push(receiverWhere(filter.branchId), { fromWarehouse: { branchId: { not: filter.branchId } } });
    } else {
      and.push(senderWhere(filter.branchId));
    }
    if (filter.departmentId) {
      and.push({ OR: [{ fromWarehouse: { departmentId: filter.departmentId } }, { toWarehouse: { departmentId: filter.departmentId } }] });
    }
    const where: Prisma.StockTransferWhereInput = {
      tenantId,
      fromWarehouseId: filter.fromWarehouseId,
      toWarehouseId: filter.toWarehouseId,
      status: filter.status,
      AND: and,
    };
    if (filter.q) {
      where.transferNo = { contains: filter.q, mode: 'insensitive' };
    }
    const rows = await tx.stockTransfer.findMany({
      where,
      include: {
        fromWarehouse: WAREHOUSE_BRIEF,
        toWarehouse: WAREHOUSE_BRIEF,
        _count: { select: { lines: { where: { deletedAt: null } } } },
      },
      orderBy: { id: 'desc' },
      take: filter.take,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    return rows as StockTransferListRow[];
  }

  /** Số phiếu cần xử lý ở chi nhánh: `incoming` = đang chờ NHẬN (kho đích thuộc chi nhánh, IN_TRANSIT); `toResolve` = chờ chi nhánh GỬI xử lý
   * (nhận thiếu chờ xử lý, hoặc đang hoàn trả chờ xác nhận nhận lại). */
  async countPending(tx: Prisma.TransactionClient, tenantId: string, branchId: string, departmentId?: string): Promise<{ incoming: number; toResolve: number }> {
    const dept = (side: 'fromWarehouse' | 'toWarehouse'): Prisma.StockTransferWhereInput => (departmentId ? { [side]: { departmentId } } : {});
    const [incoming, toResolve] = await Promise.all([
      tx.stockTransfer.count({ where: { tenantId, deletedAt: null, status: 'IN_TRANSIT', toWarehouse: { branchId }, ...dept('toWarehouse') } }),
      tx.stockTransfer.count({ where: { tenantId, deletedAt: null, status: { in: ['VARIANCE_PENDING', 'RETURNING'] }, fromWarehouse: { branchId }, ...dept('fromWarehouse') } }),
    ]);
    return { incoming, toResolve };
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

  /** Kiểm nhận xong — `WHERE status='IN_TRANSIT'` chặn xác nhận trùng/xác nhận phiếu chưa xuất. Đủ hàng → COMPLETED; có dòng nhận thiếu →
   * VARIANCE_PENDING (chờ chi nhánh GỬI xử lý, Đợt 2 chi nhánh #233). */
  async markReceived(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, withVariance: boolean): Promise<number> {
    const result = await tx.stockTransfer.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'IN_TRANSIT' },
      data: { status: withVariance ? 'VARIANCE_PENDING' : 'COMPLETED', receivedBy: actorId, receivedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Bên NHẬN từ chối nhận cả phiếu — IN_TRANSIT→RETURNING. */
  async markReceiveRejected(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reasonCode: string, note: string): Promise<number> {
    const result = await tx.stockTransfer.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'IN_TRANSIT' },
      data: {
        status: 'RETURNING',
        receiveRejectReasonCode: reasonCode,
        receiveRejectNote: note,
        receiveRejectedBy: actorId,
        receiveRejectedAt: new Date(),
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
    return result.count;
  }

  /** Bên GỬI xác nhận đã nhận lại hàng bị từ chối — RETURNING→RETURNED. */
  async markReturnConfirmed(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.stockTransfer.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'RETURNING' },
      data: { status: 'RETURNED', returnConfirmedBy: actorId, returnConfirmedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Bên GỬI xử lý xong phần nhận thiếu — VARIANCE_PENDING→COMPLETED. */
  async markVarianceResolved(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, note: string | null): Promise<number> {
    const result = await tx.stockTransfer.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'VARIANCE_PENDING' },
      data: { status: 'COMPLETED', varianceResolvedBy: actorId, varianceResolvedAt: new Date(), varianceResolutionNote: note, updatedBy: actorId, version: { increment: 1 } },
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

  /** Ghi `quantityReceived`/lý do/ghi chú vào từng dòng lúc kiểm nhận. */
  async updateLineReceived(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    updates: { lineId: string; quantityReceived: number; varianceReason: string | null; varianceNote: string | null }[],
  ): Promise<void> {
    for (const u of updates) {
      await tx.stockTransferLine.updateMany({
        where: { tenantId, id: u.lineId },
        data: { quantityReceived: u.quantityReceived, varianceReasonCode: u.varianceReason, varianceNote: u.varianceNote, updatedBy: actorId },
      });
    }
  }

  /** Cách chi nhánh GỬI xử lý từng dòng nhận thiếu. */
  async updateLineResolutions(tx: Prisma.TransactionClient, tenantId: string, actorId: string, updates: { lineId: string; resolution: string }[]): Promise<void> {
    for (const u of updates) {
      await tx.stockTransferLine.updateMany({ where: { tenantId, id: u.lineId }, data: { varianceResolution: u.resolution, updatedBy: actorId } });
    }
  }

  /** Số thực nhận LẠI ở kho gửi (sau khi bên nhận từ chối cả phiếu). */
  async updateLineReturnedBack(tx: Prisma.TransactionClient, tenantId: string, actorId: string, updates: { lineId: string; quantityReturnedBack: number; note: string | null }[]): Promise<void> {
    for (const u of updates) {
      await tx.stockTransferLine.updateMany({
        where: { tenantId, id: u.lineId },
        data: { quantityReturnedBack: u.quantityReturnedBack, returnVarianceNote: u.note, updatedBy: actorId },
      });
    }
  }

  /**
   * "Báo cáo hao hụt điều chuyển" (Đợt 2, #233) — mọi dòng bị coi là hao hụt của các chi nhánh GỬI trong `branchIds`:
   * (1) dòng nhận thiếu mà chi nhánh gửi chọn "Ghi hao hụt" (số = đã gửi − thực nhận);
   * (2) dòng của phiếu bị từ chối nhận mà nhận lại thiếu (số = đã gửi − nhận lại).
   */
  async listShrinkage(tx: Prisma.TransactionClient, tenantId: string, branchIds: string[], from: Date, to: Date, fromWarehouseId?: string): Promise<TransferShrinkageRow[]> {
    const lines = await tx.stockTransferLine.findMany({
      where: {
        tenantId,
        deletedAt: null,
        transfer: {
          deletedAt: null,
          fromWarehouse: { branchId: { in: branchIds } },
          ...(fromWarehouseId ? { fromWarehouseId } : {}),
          OR: [
            { status: 'COMPLETED', varianceResolvedAt: { gte: from, lte: to } },
            { status: 'RETURNED', returnConfirmedAt: { gte: from, lte: to } },
          ],
        },
        OR: [{ varianceResolution: 'WRITE_OFF' }, { quantityReturnedBack: { not: null } }],
      },
      include: {
        drug: { select: { code: true, name: true } },
        transfer: { select: { id: true, transferNo: true, occurredAt: true, status: true, fromWarehouse: { select: { name: true } }, toWarehouse: { select: { name: true } } } },
      },
      orderBy: { id: 'desc' },
    });
    const rows: TransferShrinkageRow[] = [];
    for (const line of lines) {
      let quantity = 0;
      let cause: TransferShrinkageRow['cause'] = 'WRITE_OFF';
      if (line.transfer.status === 'RETURNED') {
        quantity = line.quantityShipped - (line.quantityReturnedBack ?? line.quantityShipped);
        cause = 'RETURN_SHORTAGE';
      } else if (line.varianceResolution === 'WRITE_OFF') {
        quantity = line.quantityShipped - (line.quantityReceived ?? line.quantityShipped);
      }
      if (quantity <= 0) continue;
      rows.push({
        transferId: line.transfer.id,
        transferNo: line.transfer.transferNo,
        occurredAt: line.transfer.occurredAt,
        status: line.transfer.status,
        fromWarehouseName: line.transfer.fromWarehouse.name,
        toWarehouseName: line.transfer.toWarehouse.name,
        drugCode: line.drug.code,
        drugName: line.drug.name,
        quantity,
        unitCost: line.unitCost ?? 0n,
        cause,
      });
    }
    return rows;
  }
}
