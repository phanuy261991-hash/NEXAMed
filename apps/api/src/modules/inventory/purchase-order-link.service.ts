import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BranchPurchasingDisabledError,
  PurchaseOrderInvalidStateError,
  PurchaseOrderOverReceiptError,
  PurchaseOrderReceiptMismatchError,
  canPerformPurchaseOrderAction,
  derivePurchaseOrderStatusFromReceipts,
  isReceiptQtyWithinOrder,
  purchaseOrderRemainingQty,
} from '@nexamed/core';
import type { Prisma } from '@prisma/client';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { PurchaseOrderRepository } from './purchase-order.repository';

export interface ReceiptOrderLineInput {
  purchaseOrderLineId: string;
  drugId: string;
  unitCode: string;
  quantity: number;
}

/**
 * Cầu nối giữa Phiếu nhập kho và Đơn đặt hàng NCC (docs/DECISIONS.md #298 giai đoạn 2). `StockReceiptService` gọi trong CÙNG transaction của nó:
 *  - kiểm chi nhánh có được nhập mua hàng riêng không;
 *  - kiểm phiếu nhập theo đơn khớp đơn (NCC, kho, mặt hàng, đơn vị) và không nhận vượt số còn thiếu;
 *  - sau khi phiếu được Duyệt/Huỷ, tính lại trạng thái đơn từ số đã nhận.
 * Không đọc cấu hình ở đây (port tự mở transaction) — người gọi đọc `getPurchaseOrderSettings` TRƯỚC khi mở transaction rồi truyền vào (#264).
 */
@Injectable()
export class PurchaseOrderLinkService {
  constructor(private readonly purchaseOrderRepository: PurchaseOrderRepository) {}

  /** Chi nhánh phụ không được lập Phiếu nhập mua hàng khi công tắc "Cho phép chi nhánh đặt hàng NCC riêng" TẮT. */
  async assertBranchMayPurchase(tx: Prisma.TransactionClient, tenantId: string, branchId: string, branchPurchasingEnabled: boolean): Promise<void> {
    if (branchPurchasingEnabled) return;
    const branch = await this.purchaseOrderRepository.findBranch(tx, tenantId, branchId);
    if (!branch) throw new NotFoundException();
    if (!branch.isDefault) throw new BranchPurchasingDisabledError();
  }

  /**
   * Kiểm phiếu nhập (Nháp) gắn đơn. `excludeReceiptId` không cần: số đã nhận chỉ tính phiếu ĐÃ DUYỆT, phiếu đang lập/sửa còn Nháp nên không nằm trong đó.
   * Dòng nhận cùng một dòng đơn nhiều lần trong một phiếu được cộng dồn khi so với số còn thiếu.
   */
  async validateReceiptAgainstOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    input: { purchaseOrderId: string; supplierId: string | null; warehouseId: string; lines: ReceiptOrderLineInput[] },
    allowOverReceipt: boolean,
  ): Promise<void> {
    const order = await this.purchaseOrderRepository.findDetailById(tx, tenantId, input.purchaseOrderId);
    if (!order || order.warehouse.branchId !== branchId) throw new NotFoundException();
    if (!canPerformPurchaseOrderAction(order.status, 'receive')) {
      throw new PurchaseOrderInvalidStateError('Đơn đặt hàng chưa gửi nhà cung cấp hoặc đã đóng/huỷ nên không nhận hàng theo đơn được.');
    }
    if (input.supplierId !== order.supplierId) throw new PurchaseOrderReceiptMismatchError('Nhà cung cấp của phiếu nhập phải trùng nhà cung cấp trên đơn đặt hàng.');
    if (input.warehouseId !== order.warehouseId) throw new PurchaseOrderReceiptMismatchError('Kho nhận của phiếu nhập phải trùng kho nhận trên đơn đặt hàng.');

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const received = await this.purchaseOrderRepository.receivedByLine(tx, tenantId, order.id);
    const incoming = new Map<string, number>();
    for (const line of input.lines) {
      const orderLine = lineById.get(line.purchaseOrderLineId);
      if (!orderLine) throw new PurchaseOrderReceiptMismatchError('Có dòng nhận không thuộc đơn đặt hàng đã chọn.');
      if (orderLine.drugId !== line.drugId) throw new PurchaseOrderReceiptMismatchError(`Mặt hàng "${orderLine.drug.name}" ở phiếu nhập không khớp dòng của đơn.`);
      if (orderLine.unitCode !== line.unitCode) {
        throw new PurchaseOrderReceiptMismatchError(`Đơn vị của "${orderLine.drug.name}" phải là ${orderLine.unitCode} như trên đơn đặt hàng.`);
      }
      incoming.set(orderLine.id, (incoming.get(orderLine.id) ?? 0) + line.quantity);
    }
    for (const [lineId, qty] of incoming) {
      const orderLine = lineById.get(lineId)!;
      const receivedQty = received.get(lineId) ?? 0;
      if (!isReceiptQtyWithinOrder({ orderedQty: orderLine.quantity, receivedQty, receiveQty: qty }, allowOverReceipt)) {
        throw new PurchaseOrderOverReceiptError(orderLine.drug.name, purchaseOrderRemainingQty(orderLine.quantity, receivedQty));
      }
    }
  }

  /** Tính lại trạng thái đơn từ số đã nhận (gọi sau khi một phiếu nhập liên kết được Duyệt hoặc bị Huỷ). Đơn chưa đặt/đã đóng/đã huỷ giữ nguyên. */
  async syncStatus(tx: Prisma.TransactionClient, tenantId: string, actorId: string, orderId: string): Promise<void> {
    const order = await this.purchaseOrderRepository.findDetailById(tx, tenantId, orderId);
    if (!order) return;
    const received = await this.purchaseOrderRepository.receivedByLine(tx, tenantId, orderId);
    const next = derivePurchaseOrderStatusFromReceipts(order.status, order.lines.map((l) => ({ orderedQty: l.quantity, receivedQty: received.get(l.id) ?? 0 })));
    if (next === order.status) return;
    await this.purchaseOrderRepository.touch(tx, tenantId, orderId, actorId, { status: next });
    await writeAuditLog(tx, tenantId, { actorId, action: 'purchase_order.receipt_synced', entityType: 'purchase_order', entityId: orderId, beforeJson: { status: order.status }, afterJson: { status: next } });
  }
}
