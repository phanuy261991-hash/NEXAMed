import { Injectable } from '@nestjs/common';
import type { Prisma, PurchaseOrder, PurchaseOrderStatus } from '@prisma/client';

/** Chỗ DUY NHẤT gọi Prisma cho `purchase_order`/`purchase_order_line` (docs/DECISIONS.md #298 giai đoạn 2). Chi nhánh kế thừa qua kho nhận. */

const WAREHOUSE_BRIEF = { select: { id: true, name: true, branchId: true, departmentId: true, isDefault: true, branch: { select: { name: true, isDefault: true } } } } as const;

export const PURCHASE_ORDER_DETAIL_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  warehouse: WAREHOUSE_BRIEF,
  lines: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: { drug: { select: { code: true, name: true } } },
  },
  receipts: {
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, receiptNo: true, status: true, occurredAt: true, deletedAt: true, _count: { select: { lines: { where: { deletedAt: null } } } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

export type PurchaseOrderDetailRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PURCHASE_ORDER_DETAIL_INCLUDE }>;

const LIST_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  warehouse: WAREHOUSE_BRIEF,
  lines: { where: { deletedAt: null }, select: { id: true, quantity: true } },
} satisfies Prisma.PurchaseOrderInclude;

export type PurchaseOrderListRow = Prisma.PurchaseOrderGetPayload<{ include: typeof LIST_INCLUDE }>;

export interface PurchaseOrderLineData {
  drugId: string;
  unitCode: string;
  quantity: number;
  expectedUnitCost: bigint | null;
  lineNote: string | null;
}

export interface PurchaseOrderHeaderData {
  supplierId: string;
  warehouseId: string;
  expectedDate: Date | null;
  note: string | null;
  totalAmount: bigint;
}

export interface ListPurchaseOrdersFilter {
  /** Chi nhánh người xem. */
  branchId: string;
  view: 'mine' | 'approval';
  /** Chỉ dùng khi view='approval': xem đơn CHỜ DUYỆT của chính chi nhánh mình / của chi nhánh khác (chi nhánh chính duyệt). */
  approvalOwn: boolean;
  approvalCross: boolean;
  status?: PurchaseOrderStatus;
  supplierId?: string;
  warehouseId?: string;
  from?: Date;
  to?: Date;
  q?: string;
  cursor?: string;
  take: number;
  /** Phân quyền theo Khoa/Phòng — lọc theo kho nhận (chỉ view='mine'). */
  departmentId?: string;
}

function listWhere(tenantId: string, f: ListPurchaseOrdersFilter, withStatus: boolean): Prisma.PurchaseOrderWhereInput {
  const and: Prisma.PurchaseOrderWhereInput[] = [];
  if (f.view === 'mine') {
    and.push({ warehouse: { branchId: f.branchId } });
    if (f.departmentId) and.push({ warehouse: { departmentId: f.departmentId } });
  } else {
    const or: Prisma.PurchaseOrderWhereInput[] = [];
    if (f.approvalOwn) or.push({ warehouse: { branchId: f.branchId } });
    if (f.approvalCross) or.push({ warehouse: { branchId: { not: f.branchId } } });
    // Không bên nào đủ điều kiện → điều kiện luôn sai (không trả gì).
    and.push(or.length > 0 ? { OR: or } : { id: { in: [] } });
    and.push({ status: 'PENDING_APPROVAL' });
  }
  const where: Prisma.PurchaseOrderWhereInput = { tenantId, deletedAt: null, supplierId: f.supplierId, warehouseId: f.warehouseId, AND: and };
  if (withStatus && f.status && f.view === 'mine') where.status = f.status;
  if (f.from || f.to) where.createdAt = { gte: f.from, lte: f.to };
  if (f.q) where.OR = [{ orderNo: { contains: f.q, mode: 'insensitive' } }, { supplier: { name: { contains: f.q, mode: 'insensitive' } } }];
  return where;
}

@Injectable()
export class PurchaseOrderRepository {
  findBranch(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<{ id: string; name: string; isDefault: boolean } | null> {
    return tx.branch.findFirst({ where: { tenantId, id: branchId, deletedAt: null }, select: { id: true, name: true, isDefault: true } });
  }

  /** 2 lệnh riêng (không nested create) — cùng lý do `StockRequestRepository.create()`. */
  async create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, orderNo: string, header: PurchaseOrderHeaderData, lines: PurchaseOrderLineData[]): Promise<PurchaseOrder> {
    const row = await tx.purchaseOrder.create({
      data: { tenantId, orderNo, ...header, createdBy: actorId, updatedBy: actorId },
    });
    await this.createLines(tx, tenantId, actorId, row.id, lines);
    return row;
  }

  async createLines(tx: Prisma.TransactionClient, tenantId: string, actorId: string, orderId: string, lines: PurchaseOrderLineData[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.purchaseOrderLine.createMany({
      data: lines.map((l) => ({ tenantId, orderId, drugId: l.drugId, unitCode: l.unitCode, quantity: l.quantity, expectedUnitCost: l.expectedUnitCost, lineNote: l.lineNote, createdBy: actorId, updatedBy: actorId })),
    });
  }

  /** Sửa Nháp/Từ chối — thay toàn bộ dòng; đơn Từ chối sửa xong quay về Nháp (xoá dấu vết từ chối để thoả CHECK). */
  async replaceDraft(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, header: PurchaseOrderHeaderData, lines: PurchaseOrderLineData[]): Promise<number> {
    const result = await tx.purchaseOrder.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: { in: ['DRAFT', 'REJECTED'] } },
      data: { ...header, status: 'DRAFT', rejectionReason: null, rejectedAt: null, rejectedBy: null, updatedBy: actorId, version: { increment: 1 } },
    });
    if (result.count === 0) return 0;
    await tx.purchaseOrderLine.updateMany({ where: { tenantId, orderId: id, deletedAt: null }, data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId } });
    await this.createLines(tx, tenantId, actorId, id, lines);
    return result.count;
  }

  findDetailById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PurchaseOrderDetailRow | null> {
    return tx.purchaseOrder.findFirst({ where: { tenantId, id, deletedAt: null }, include: PURCHASE_ORDER_DETAIL_INCLUDE });
  }

  async list(tx: Prisma.TransactionClient, tenantId: string, filter: ListPurchaseOrdersFilter): Promise<PurchaseOrderListRow[]> {
    return tx.purchaseOrder.findMany({
      where: listWhere(tenantId, filter, true),
      include: LIST_INCLUDE,
      orderBy: { id: 'desc' },
      take: filter.take,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
  }

  async countByStatus(tx: Prisma.TransactionClient, tenantId: string, filter: ListPurchaseOrdersFilter): Promise<Partial<Record<PurchaseOrderStatus, number>>> {
    const groups = await tx.purchaseOrder.groupBy({ by: ['status'], where: listWhere(tenantId, filter, false), _count: { _all: true } });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  }

  /** Số đơn chờ duyệt người xem được duyệt (chấm số trên menu). */
  countPendingApproval(tx: Prisma.TransactionClient, tenantId: string, filter: { branchId: string; own: boolean; cross: boolean }): Promise<number> {
    const or: Prisma.PurchaseOrderWhereInput[] = [];
    if (filter.own) or.push({ warehouse: { branchId: filter.branchId } });
    if (filter.cross) or.push({ warehouse: { branchId: { not: filter.branchId } } });
    if (or.length === 0) return Promise.resolve(0);
    return tx.purchaseOrder.count({ where: { tenantId, deletedAt: null, status: 'PENDING_APPROVAL', OR: or } });
  }

  /** Đổi trạng thái có điều kiện (optimistic lock + trạng thái hiện tại) — trả số dòng khớp. */
  async transition(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    from: PurchaseOrderStatus[],
    actorId: string,
    data: Prisma.PurchaseOrderUncheckedUpdateManyInput,
  ): Promise<number> {
    const result = await tx.purchaseOrder.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: { in: from } },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Cập nhật trạng thái KHÔNG kiểm version (đồng bộ nội bộ khi phiếu nhập liên kết đổi) — vẫn tăng version. */
  async touch(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, data: Prisma.PurchaseOrderUncheckedUpdateManyInput): Promise<void> {
    await tx.purchaseOrder.updateMany({ where: { tenantId, id, deletedAt: null }, data: { ...data, updatedBy: actorId, version: { increment: 1 } } });
  }

  /** Tổng đã nhận theo dòng đơn = số lượng các dòng phiếu nhập ĐÃ DUYỆT (chưa bị huỷ) gắn dòng đó. */
  async receivedByLine(tx: Prisma.TransactionClient, tenantId: string, orderId: string): Promise<Map<string, number>> {
    const groups = await tx.stockReceiptLine.groupBy({
      by: ['purchaseOrderLineId'],
      where: { tenantId, deletedAt: null, purchaseOrderLineId: { not: null }, receipt: { purchaseOrderId: orderId, status: 'POSTED', deletedAt: null } },
      _sum: { quantity: true },
    });
    return new Map(groups.filter((g) => g.purchaseOrderLineId !== null).map((g) => [g.purchaseOrderLineId as string, g._sum.quantity ?? 0]));
  }

  /** Số phiếu nhập Nháp (đang soạn) của các đơn. */
  async draftReceiptCounts(tx: Prisma.TransactionClient, tenantId: string, orderIds: string[]): Promise<Map<string, number>> {
    if (orderIds.length === 0) return new Map();
    const groups = await tx.stockReceipt.groupBy({ by: ['purchaseOrderId'], where: { tenantId, purchaseOrderId: { in: orderIds }, status: 'DRAFT', deletedAt: null }, _count: { _all: true } });
    return new Map(groups.filter((g) => g.purchaseOrderId !== null).map((g) => [g.purchaseOrderId as string, g._count._all]));
  }

  /** Tổng đã nhận của nhiều đơn cùng lúc — cho cột "Tiến độ nhận" ở danh sách. */
  async receivedLineCounts(tx: Prisma.TransactionClient, tenantId: string, rows: PurchaseOrderListRow[]): Promise<Map<string, number>> {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return new Map();
    const groups = await tx.stockReceiptLine.groupBy({
      by: ['purchaseOrderLineId'],
      where: { tenantId, deletedAt: null, purchaseOrderLineId: { not: null }, receipt: { purchaseOrderId: { in: ids }, status: 'POSTED', deletedAt: null } },
      _sum: { quantity: true },
    });
    const receivedByLine = new Map(groups.filter((g) => g.purchaseOrderLineId !== null).map((g) => [g.purchaseOrderLineId as string, g._sum.quantity ?? 0]));
    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(row.id, row.lines.filter((l) => (receivedByLine.get(l.id) ?? 0) >= l.quantity).length);
    }
    return result;
  }

  /** Dòng yêu cầu cấp hàng đang chờ hàng của các đơn (nhãn "Nguồn" + theo dõi). */
  listWaitingRequestLines(tx: Prisma.TransactionClient, tenantId: string, orderId: string) {
    return tx.stockRequestLine.findMany({
      where: { tenantId, waitPurchaseOrderId: orderId, deletedAt: null, fulfilStatus: 'WAITING_STOCK' },
      select: { id: true, drugId: true, request: { select: { id: true, requestNo: true } } },
    });
  }

  /**
   * Gắn dòng yêu cầu cấp hàng (đang chờ hàng về) vào đơn. Chỉ dòng WAITING_STOCK của phiếu có kho cấp = kho nhận của đơn; trả số dòng đã gắn.
   * Dòng ngoài điều kiện bị bỏ qua (service báo lỗi nếu số dòng gắn được khác số dòng yêu cầu).
   */
  async linkRequestLines(tx: Prisma.TransactionClient, tenantId: string, actorId: string, orderId: string, warehouseId: string, requestLineIds: string[]): Promise<number> {
    if (requestLineIds.length === 0) return 0;
    const result = await tx.stockRequestLine.updateMany({
      where: { tenantId, id: { in: requestLineIds }, deletedAt: null, fulfilStatus: 'WAITING_STOCK', request: { supplyingWarehouseId: warehouseId, deletedAt: null } },
      data: { waitPurchaseOrderId: orderId, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Gỡ liên kết dòng chờ khi đơn bị huỷ. */
  async unlinkRequestLines(tx: Prisma.TransactionClient, tenantId: string, actorId: string, orderId: string): Promise<void> {
    await tx.stockRequestLine.updateMany({ where: { tenantId, waitPurchaseOrderId: orderId, deletedAt: null }, data: { waitPurchaseOrderId: null, updatedBy: actorId, version: { increment: 1 } } });
  }
}
