import { Injectable } from '@nestjs/common';
import type { ClinicalOrder, ClinicalOrderItem, ClinicalOrderPackage, Prisma } from '@prisma/client';

export interface CreateOrderItemData {
  itemKind: 'TECHNICAL_SERVICE' | 'EXAM_TYPE' | 'FREE_TEXT';
  technicalServiceId: string | null;
  examTypeCode: string | null;
  freeTextName: string | null;
  code: string | null;
  name: string;
  performance: 'IN_HOUSE' | 'EXTERNAL';
  quantity: number;
  unitPrice: bigint | null;
  priceTypeCode: string | null;
  unitCode: string | null;
  clinicalOrderPackageId: string | null;
  note: string | null;
  sortOrder: number;
}

export interface CreateOrderPackageData {
  servicePackageId: string;
  packageCode: string;
  packageName: string;
  unitPrice: bigint;
}

/** Phiếu kèm dòng/gói còn hiệu lực + Khoa/Phòng thực hiện của từng dịch vụ kỹ thuật (cột "Nơi thực hiện"). */
export interface ClinicalOrderWithLines extends ClinicalOrder {
  items: (ClinicalOrderItem & { technicalService: { department: { name: string } | null } | null })[];
  packages: ClinicalOrderPackage[];
}

const ORDER_INCLUDE = {
  items: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    include: { technicalService: { select: { department: { select: { name: true } } } } },
  },
  packages: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ClinicalOrderInclude;

/** Chỗ DUY NHẤT gọi Prisma cho `clinical_order` + `clinical_order_item` + `clinical_order_package` (Cận lâm sàng GĐ3, docs/DECISIONS.md #212). */
@Injectable()
export class ClinicalOrderRepository {
  findActiveByEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<ClinicalOrderWithLines | null> {
    return tx.clinicalOrder.findFirst({ where: { tenantId, encounterId, deletedAt: null }, include: ORDER_INCLUDE });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ClinicalOrderWithLines | null> {
    return tx.clinicalOrder.findFirst({ where: { tenantId, id, deletedAt: null }, include: ORDER_INCLUDE });
  }

  createOrder(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: { orderNo: string; encounterId: string }): Promise<ClinicalOrder> {
    return tx.clinicalOrder.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  /** Tăng `version` phiếu mỗi lần lưu — các request lưu gần như đồng thời cho cùng 1 lượt khám không ghi chồng im lặng (xem service). */
  bumpVersion(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    return tx.clinicalOrder
      .updateMany({ where: { tenantId, id, version: expectedVersion, deletedAt: null }, data: { updatedBy: actorId, version: { increment: 1 } } })
      .then((r) => r.count);
  }

  createPackage(tx: Prisma.TransactionClient, tenantId: string, actorId: string, orderId: string, data: CreateOrderPackageData): Promise<ClinicalOrderPackage> {
    return tx.clinicalOrderPackage.create({ data: { tenantId, clinicalOrderId: orderId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  createItem(tx: Prisma.TransactionClient, tenantId: string, actorId: string, orderId: string, data: CreateOrderItemData): Promise<ClinicalOrderItem> {
    return tx.clinicalOrderItem.create({ data: { tenantId, clinicalOrderId: orderId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  async softDeleteItems(tx: Prisma.TransactionClient, tenantId: string, ids: string[], actorId: string, reason: string): Promise<void> {
    if (ids.length === 0) return;
    await tx.clinicalOrderItem.updateMany({ where: { tenantId, id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId } });
  }

  async softDeletePackages(tx: Prisma.TransactionClient, tenantId: string, ids: string[], actorId: string, reason: string): Promise<void> {
    if (ids.length === 0) return;
    await tx.clinicalOrderPackage.updateMany({ where: { tenantId, id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId } });
  }

  /** Đổi "Lưu ý cho người bệnh" tại chỗ (không ảnh hưởng tiền) — `version` của dòng tăng để vết thay đổi nhất quán với mọi bảng khác. */
  async updateItemNote(tx: Prisma.TransactionClient, tenantId: string, id: string, note: string | null, actorId: string): Promise<void> {
    await tx.clinicalOrderItem.updateMany({ where: { tenantId, id, deletedAt: null }, data: { note, updatedBy: actorId, version: { increment: 1 } } });
  }
}
