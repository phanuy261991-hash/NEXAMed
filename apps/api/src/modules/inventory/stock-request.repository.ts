import { Injectable } from '@nestjs/common';
import type { Prisma, StockRequest, StockRequestLine, StockRequestLineStatus, StockRequestStatus } from '@prisma/client';

/** Chỗ DUY NHẤT gọi Prisma cho `stock_request`/`stock_request_line`/`stock_request_event` (docs/DECISIONS.md #298). */

const WAREHOUSE_BRIEF = { select: { id: true, name: true, branchId: true, departmentId: true, isDefault: true, branch: { select: { name: true, isDefault: true } } } } as const;

const LINE_INCLUDE = {
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' as const },
  include: {
    drug: { select: { code: true, name: true, baseUnitCode: true, isBatchManaged: true } },
    waitChildRequest: { select: { requestNo: true } },
    transferLines: {
      where: { deletedAt: null },
      select: { quantityShipped: true, quantityReceived: true, transfer: { select: { id: true, transferNo: true, status: true } } },
    },
  },
} satisfies Prisma.StockRequest$linesArgs;

export const STOCK_REQUEST_DETAIL_INCLUDE = {
  requestingWarehouse: WAREHOUSE_BRIEF,
  supplyingWarehouse: WAREHOUSE_BRIEF,
  parentRequest: { select: { requestNo: true } },
  lines: LINE_INCLUDE,
  events: { where: { deletedAt: null }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
  transfers: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      transferNo: true,
      status: true,
      fromWarehouse: { select: { name: true, branchId: true, branch: { select: { name: true } } } },
      toWarehouse: { select: { name: true, branchId: true, branch: { select: { name: true } } } },
      _count: { select: { lines: { where: { deletedAt: null } } } },
    },
  },
} satisfies Prisma.StockRequestInclude;

export type StockRequestDetailRow = Prisma.StockRequestGetPayload<{ include: typeof STOCK_REQUEST_DETAIL_INCLUDE }>;

const LIST_INCLUDE = {
  requestingWarehouse: WAREHOUSE_BRIEF,
  supplyingWarehouse: WAREHOUSE_BRIEF,
  parentRequest: { select: { requestNo: true } },
  _count: { select: { lines: { where: { deletedAt: null } } } },
} satisfies Prisma.StockRequestInclude;

export type StockRequestListRow = Prisma.StockRequestGetPayload<{ include: typeof LIST_INCLUDE }>;

export type StockRequestViewerRole = 'requester' | 'supplier' | 'viewer';

/** Bên XIN thấy phiếu của kho xin thuộc chi nhánh (kể cả Nháp). */
function requesterWhere(branchId: string): Prisma.StockRequestWhereInput {
  return { requestingWarehouse: { branchId } };
}

/** Bên CẤP chỉ thấy từ lúc phiếu đã được gửi (không thấy Nháp, kể cả Nháp đã huỷ). */
function supplierWhere(branchId: string): Prisma.StockRequestWhereInput {
  return { supplyingWarehouse: { branchId }, submittedAt: { not: null } };
}

function roleWhere(branchId: string, role: StockRequestViewerRole): Prisma.StockRequestWhereInput {
  if (role === 'requester') return requesterWhere(branchId);
  if (role === 'supplier') return supplierWhere(branchId);
  return { OR: [requesterWhere(branchId), supplierWhere(branchId)] };
}

export interface StockRequestLineData {
  drugId: string;
  requestedQty: number;
  lineNote: string | null;
  requesterStockSnapshot: number | null;
  addedAfterAccept?: boolean;
}

export interface CreateStockRequestData {
  requestNo: string;
  requestingWarehouseId: string;
  supplyingWarehouseId: string;
  priority: 'NORMAL' | 'URGENT';
  neededBy: Date | null;
  note: string | null;
  parentRequestId: string | null;
  submitted: boolean;
  lines: StockRequestLineData[];
}

export interface ListStockRequestsFilter {
  branchId: string;
  view: 'mine' | 'incoming';
  status?: StockRequestStatus;
  priority?: 'NORMAL' | 'URGENT';
  warehouseId?: string;
  from?: Date;
  to?: Date;
  q?: string;
  cursor?: string;
  take: number;
  /** Phân quyền theo Khoa/Phòng — lọc theo kho của PHÍA mà view đang xem. */
  departmentId?: string;
}

function listWhere(tenantId: string, filter: ListStockRequestsFilter, withStatus: boolean): Prisma.StockRequestWhereInput {
  const and: Prisma.StockRequestWhereInput[] = [];
  if (filter.view === 'incoming') {
    and.push(supplierWhere(filter.branchId));
    if (filter.departmentId) and.push({ supplyingWarehouse: { departmentId: filter.departmentId } });
  } else {
    and.push(requesterWhere(filter.branchId));
    if (filter.departmentId) and.push({ requestingWarehouse: { departmentId: filter.departmentId } });
  }
  const where: Prisma.StockRequestWhereInput = { tenantId, deletedAt: null, priority: filter.priority, AND: and };
  if (withStatus && filter.status) where.status = filter.status;
  if (filter.warehouseId) {
    if (filter.view === 'incoming') where.requestingWarehouseId = filter.warehouseId;
    else where.supplyingWarehouseId = filter.warehouseId;
  }
  if (filter.from || filter.to) where.createdAt = { gte: filter.from, lte: filter.to };
  if (filter.q) where.requestNo = { contains: filter.q, mode: 'insensitive' };
  return where;
}

@Injectable()
export class StockRequestRepository {
  /** 2 lệnh riêng (không nested create) — cùng lý do `StockTransferRepository.create()`. */
  async create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateStockRequestData): Promise<StockRequest> {
    const now = new Date();
    const header = await tx.stockRequest.create({
      data: {
        tenantId,
        requestNo: data.requestNo,
        requestingWarehouseId: data.requestingWarehouseId,
        supplyingWarehouseId: data.supplyingWarehouseId,
        status: data.submitted ? 'SUBMITTED' : 'DRAFT',
        priority: data.priority,
        neededBy: data.neededBy,
        note: data.note,
        parentRequestId: data.parentRequestId,
        submittedAt: data.submitted ? now : null,
        submittedBy: data.submitted ? actorId : null,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await this.createLines(tx, tenantId, actorId, header.id, data.lines);
    return header;
  }

  async createLines(tx: Prisma.TransactionClient, tenantId: string, actorId: string, requestId: string, lines: StockRequestLineData[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.stockRequestLine.createMany({
      data: lines.map((l) => ({
        tenantId,
        requestId,
        drugId: l.drugId,
        requestedQty: l.requestedQty,
        lineNote: l.lineNote,
        requesterStockSnapshot: l.requesterStockSnapshot,
        addedAfterAccept: l.addedAfterAccept ?? false,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
  }

  /** Sửa tự do khi còn Nháp/Đã gửi — thay toàn bộ dòng. `status` điều kiện chặn race với bước Tiếp nhận của kho cấp. */
  async replaceDraft(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    header: { requestingWarehouseId: string; supplyingWarehouseId: string; priority: 'NORMAL' | 'URGENT'; neededBy: Date | null; note: string | null },
    lines: StockRequestLineData[],
  ): Promise<number> {
    const result = await tx.stockRequest.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: { in: ['DRAFT', 'SUBMITTED'] } },
      data: { ...header, updatedBy: actorId, version: { increment: 1 } },
    });
    if (result.count === 0) return 0;
    await tx.stockRequestLine.updateMany({ where: { tenantId, requestId: id, deletedAt: null }, data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId } });
    await this.createLines(tx, tenantId, actorId, id, lines);
    return result.count;
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string, role: StockRequestViewerRole): Promise<StockRequest | null> {
    return tx.stockRequest.findFirst({ where: { tenantId, id, deletedAt: null, ...roleWhere(branchId, role) } });
  }

  findDetailById(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string, role: StockRequestViewerRole): Promise<StockRequestDetailRow | null> {
    return tx.stockRequest.findFirst({ where: { tenantId, id, deletedAt: null, ...roleWhere(branchId, role) }, include: STOCK_REQUEST_DETAIL_INCLUDE });
  }

  /** Dùng nội bộ (đồng bộ trạng thái từ phiếu điều chuyển) — KHÔNG lọc theo chi nhánh, chỉ theo tenant. */
  findDetailByIdInternal(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockRequestDetailRow | null> {
    return tx.stockRequest.findFirst({ where: { tenantId, id, deletedAt: null }, include: STOCK_REQUEST_DETAIL_INCLUDE });
  }

  async list(tx: Prisma.TransactionClient, tenantId: string, filter: ListStockRequestsFilter): Promise<StockRequestListRow[]> {
    return tx.stockRequest.findMany({
      where: listWhere(tenantId, filter, true),
      include: LIST_INCLUDE,
      orderBy: { id: 'desc' },
      take: filter.take,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
  }

  /** Dải đếm theo trạng thái — áp mọi bộ lọc TRỪ trạng thái. */
  async countByStatus(tx: Prisma.TransactionClient, tenantId: string, filter: ListStockRequestsFilter): Promise<Partial<Record<StockRequestStatus, number>>> {
    const groups = await tx.stockRequest.groupBy({ by: ['status'], where: listWhere(tenantId, filter, false), _count: { _all: true } });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  }

  /** Chấm số trên menu: `toAccept` = phiếu chờ kho thuộc chi nhánh này tiếp nhận; `updated` = phiếu đã tiếp nhận mà bên xin vừa cập nhật. */
  async countPending(tx: Prisma.TransactionClient, tenantId: string, branchId: string, departmentId?: string): Promise<{ toAccept: number; updated: number }> {
    const dept: Prisma.StockRequestWhereInput = departmentId ? { supplyingWarehouse: { departmentId } } : {};
    const base: Prisma.StockRequestWhereInput = { tenantId, deletedAt: null, ...supplierWhere(branchId), ...dept };
    const [toAccept, updated] = await Promise.all([
      tx.stockRequest.count({ where: { ...base, status: 'SUBMITTED' } }),
      tx.stockRequest.count({ where: { ...base, status: { in: ['ACCEPTED', 'IN_PROGRESS'] }, supplierUpdatePending: true } }),
    ]);
    return { toAccept, updated };
  }

  /** Đổi trạng thái có điều kiện (optimistic lock + trạng thái hiện tại) — trả số dòng khớp. */
  async transition(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    from: StockRequestStatus[],
    actorId: string,
    data: Prisma.StockRequestUncheckedUpdateManyInput,
  ): Promise<number> {
    const result = await tx.stockRequest.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: { in: from } },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Cập nhật cột phiếu KHÔNG kiểm version (đồng bộ nội bộ sau khi chính transaction này đã giữ khoá logic) — vẫn tăng version. */
  async touch(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, data: Prisma.StockRequestUncheckedUpdateManyInput): Promise<void> {
    await tx.stockRequest.updateMany({ where: { tenantId, id, deletedAt: null }, data: { ...data, updatedBy: actorId, version: { increment: 1 } } });
  }

  findLinesByIds(tx: Prisma.TransactionClient, tenantId: string, requestId: string, lineIds: string[]): Promise<StockRequestLine[]> {
    return tx.stockRequestLine.findMany({ where: { tenantId, requestId, id: { in: lineIds }, deletedAt: null } });
  }

  async updateLine(tx: Prisma.TransactionClient, tenantId: string, lineId: string, actorId: string, data: Prisma.StockRequestLineUncheckedUpdateManyInput): Promise<void> {
    await tx.stockRequestLine.updateMany({ where: { tenantId, id: lineId, deletedAt: null }, data: { ...data, updatedBy: actorId, version: { increment: 1 } } });
  }

  async setLineStatus(tx: Prisma.TransactionClient, tenantId: string, lineId: string, actorId: string, status: StockRequestLineStatus, extra: { decisionReason?: string | null; waitExpectedDate?: Date | null; waitChildRequestId?: string | null } = {}): Promise<void> {
    await this.updateLine(tx, tenantId, lineId, actorId, {
      fulfilStatus: status,
      decisionReason: extra.decisionReason ?? null,
      waitExpectedDate: extra.waitExpectedDate ?? null,
      waitChildRequestId: extra.waitChildRequestId ?? null,
    });
  }

  async addEvent(tx: Prisma.TransactionClient, tenantId: string, requestId: string, actorId: string, eventType: string, message: string | null, meta: Prisma.InputJsonValue = {}): Promise<void> {
    await tx.stockRequestEvent.create({ data: { tenantId, requestId, eventType, actorId, message, meta, createdBy: actorId, updatedBy: actorId } });
  }

  /** Dòng đang chờ hàng về của các phiếu — để dựng nhãn "Hàng đã về" ở danh sách (kho cấp đã đủ tồn chưa). */
  listWaitingLines(tx: Prisma.TransactionClient, tenantId: string, requestIds: string[]) {
    return tx.stockRequestLine.findMany({
      where: { tenantId, requestId: { in: requestIds }, deletedAt: null, fulfilStatus: 'WAITING_STOCK' },
      select: {
        requestId: true,
        drugId: true,
        requestedQty: true,
        transferLines: { where: { deletedAt: null }, select: { quantityShipped: true, transfer: { select: { status: true } } } },
      },
    });
  }

  /** Mặt hàng dưới mức tồn tối thiểu của MỘT kho (`drug.min_stock_alert`): tồn gộp mọi lô của kho đó < mức tối thiểu. */
  async listLowStock(tx: Prisma.TransactionClient, tenantId: string, warehouseId: string): Promise<{ drugId: string; code: string; name: string; unitCode: string | null; onHand: number; minStock: number }[]> {
    const drugs = await tx.drug.findMany({
      where: { tenantId, deletedAt: null, isActive: true, minStockAlert: { not: null } },
      select: { id: true, code: true, name: true, baseUnitCode: true, minStockAlert: true },
      orderBy: { name: 'asc' },
    });
    if (drugs.length === 0) return [];
    const balances = await tx.stockBalance.groupBy({ by: ['drugId'], where: { tenantId, warehouseId, deletedAt: null, drugId: { in: drugs.map((d) => d.id) } }, _sum: { quantityOnHand: true } });
    const onHandById = new Map(balances.map((b) => [b.drugId, b._sum.quantityOnHand ?? 0]));
    return drugs
      .map((d) => ({ drugId: d.id, code: d.code, name: d.name, unitCode: d.baseUnitCode, onHand: onHandById.get(d.id) ?? 0, minStock: d.minStockAlert as number }))
      .filter((d) => d.onHand < d.minStock);
  }

  /** Phiếu điều chuyển liên kết với yêu cầu — dùng để đồng bộ trạng thái. */
  findTransferIdsByRequest(tx: Prisma.TransactionClient, tenantId: string, requestId: string): Promise<{ id: string }[]> {
    return tx.stockTransfer.findMany({ where: { tenantId, requestId, deletedAt: null }, select: { id: true } });
  }
}
