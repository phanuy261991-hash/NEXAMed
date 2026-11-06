import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

const ITEM_INCLUDE = {
  order: {
    select: {
      id: true,
      orderNo: true,
      encounter: { select: { id: true, branchId: true, patient: { select: { id: true, fullName: true, patientCode: true } } } },
    },
  },
  technicalService: { select: { id: true, code: true, name: true, specimenTypeCode: true, turnaroundMinutes: true, sentToPartner: true, isPerformedInHouse: true } },
  specimenTube: { select: { id: true, sid: true, status: true, specimenName: true, collectedAt: true, collectedBy: true } },
} as const;

export type DispatchableItemRow = Prisma.ClinicalOrderItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

const SENT_INCLUDE = {
  dispatch: { select: { id: true, dispatchNo: true, supplierId: true, sentAt: true, sentBy: true, supplier: { select: { id: true, name: true } } } },
  orderItem: { include: ITEM_INCLUDE },
} as const;

export type SentItemRow = Prisma.LabPartnerDispatchItemGetPayload<{ include: typeof SENT_INCLUDE }>;

export interface PartnerPriceOptionRow {
  technicalServiceId: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  isDefault: boolean;
  amount: bigint;
}

/** Chỗ DUY NHẤT gọi Prisma cho `lab_partner_dispatch` + `lab_partner_dispatch_item` (docs/DECISIONS.md #291). Đọc dòng chỉ định/ống mẫu/giá trả của module khác chỉ ĐỌC. */
@Injectable()
export class LabPartnerDispatchRepository {
  /**
   * Mẫu "Chờ gửi": dòng chỉ định xét nghiệm tự làm của dịch vụ "Gửi đối tác", đã lấy mẫu (đang thực hiện, ống đã xác nhận), thuộc chi nhánh đang làm việc và CHƯA có lần gửi
   * đang hiệu lực (đã gửi hoặc đã nhận kết quả). Lần gửi bị từ chối không chặn: mẫu quay về đây để chọn đối tác khác.
   */
  listPendingItems(tx: Prisma.TransactionClient, tenantId: string, branchId: string, q: string | undefined): Promise<DispatchableItemRow[]> {
    const search: Prisma.ClinicalOrderItemWhereInput[] = q
      ? [
          { name: { contains: q, mode: 'insensitive' } },
          { order: { orderNo: { contains: q, mode: 'insensitive' } } },
          { order: { encounter: { patient: { fullName: { contains: q, mode: 'insensitive' } } } } },
          { order: { encounter: { patient: { patientCode: { contains: q, mode: 'insensitive' } } } } },
          { specimenTube: { sid: { contains: q, mode: 'insensitive' } } },
        ]
      : [];
    return tx.clinicalOrderItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        performance: 'IN_HOUSE',
        status: 'IN_PROGRESS',
        technicalService: { sentToPartner: true, isPerformedInHouse: true },
        specimenTube: { status: 'COLLECTED', deletedAt: null },
        order: { deletedAt: null, encounter: { status: { not: 'CANCELLED' }, branchId } },
        partnerDispatchItems: { none: { status: { in: ['SENT', 'RECEIVED'] }, deletedAt: null } },
        ...(search.length > 0 ? { OR: search } : {}),
      },
      include: ITEM_INCLUDE,
      orderBy: [{ collectedAt: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
  }

  countPending(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<number> {
    return tx.clinicalOrderItem.count({
      where: {
        tenantId,
        deletedAt: null,
        performance: 'IN_HOUSE',
        status: 'IN_PROGRESS',
        technicalService: { sentToPartner: true, isPerformedInHouse: true },
        specimenTube: { status: 'COLLECTED', deletedAt: null },
        order: { deletedAt: null, encounter: { status: { not: 'CANCELLED' }, branchId } },
        partnerDispatchItems: { none: { status: { in: ['SENT', 'RECEIVED'] }, deletedAt: null } },
      },
    });
  }

  countByStatus(tx: Prisma.TransactionClient, tenantId: string, branchId: string, status: 'SENT' | 'RECEIVED'): Promise<number> {
    return tx.labPartnerDispatchItem.count({ where: { tenantId, deletedAt: null, status, dispatch: { branchId, deletedAt: null } } });
  }

  listSentItems(tx: Prisma.TransactionClient, tenantId: string, branchId: string, filter: { supplierId?: string; q?: string }): Promise<SentItemRow[]> {
    const q = filter.q;
    const search: Prisma.LabPartnerDispatchItemWhereInput[] = q
      ? [
          { dispatch: { dispatchNo: { contains: q, mode: 'insensitive' } } },
          { orderItem: { name: { contains: q, mode: 'insensitive' } } },
          { orderItem: { order: { orderNo: { contains: q, mode: 'insensitive' } } } },
          { orderItem: { order: { encounter: { patient: { fullName: { contains: q, mode: 'insensitive' } } } } } },
          { orderItem: { order: { encounter: { patient: { patientCode: { contains: q, mode: 'insensitive' } } } } } },
          { specimenTube: { sid: { contains: q, mode: 'insensitive' } } },
        ]
      : [];
    return tx.labPartnerDispatchItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: 'SENT',
        dispatch: { branchId, deletedAt: null, ...(filter.supplierId ? { supplierId: filter.supplierId } : {}) },
        ...(search.length > 0 ? { OR: search } : {}),
      },
      include: SENT_INCLUDE,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: 500,
    });
  }

  /** Dòng chỉ định theo id, KÈM ống mẫu/dịch vụ/bệnh nhân — chỉ trong chi nhánh đang làm việc (id chi nhánh khác coi như không tồn tại). */
  findItemsByIds(tx: Prisma.TransactionClient, tenantId: string, branchId: string, ids: string[]): Promise<DispatchableItemRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.clinicalOrderItem.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: null, order: { deletedAt: null, encounter: { branchId } } },
      include: ITEM_INCLUDE,
    });
  }

  /** Các dòng chỉ định đã có lần gửi đang hiệu lực (đã gửi hoặc đã nhận kết quả) trong tập đã cho. */
  async findActivelyDispatchedItemIds(tx: Prisma.TransactionClient, tenantId: string, itemIds: string[]): Promise<Set<string>> {
    const rows = await tx.labPartnerDispatchItem.findMany({
      where: { tenantId, clinicalOrderItemId: { in: itemIds }, status: { in: ['SENT', 'RECEIVED'] }, deletedAt: null },
      select: { clinicalOrderItemId: true },
    });
    return new Set(rows.map((r) => r.clinicalOrderItemId));
  }

  // ---- giá trả theo cặp (bảng của module technical-service; chỉ ĐỌC) ----

  async listPriceOptions(tx: Prisma.TransactionClient, tenantId: string, serviceIds: string[]): Promise<PartnerPriceOptionRow[]> {
    if (serviceIds.length === 0) return [];
    const rows = await tx.labPartnerServicePrice.findMany({
      where: { tenantId, technicalServiceId: { in: serviceIds }, deletedAt: null, supplier: { isActive: true, isLabPartner: true, deletedAt: null } },
      include: { supplier: { select: { code: true, name: true } } },
      orderBy: [{ isDefault: 'desc' }, { supplier: { name: 'asc' } }],
    });
    return rows.map((r) => ({ technicalServiceId: r.technicalServiceId, supplierId: r.supplierId, supplierCode: r.supplier.code, supplierName: r.supplier.name, isDefault: r.isDefault, amount: r.amount }));
  }

  /** Giá trả của MỘT cặp (dịch vụ × đối tác) còn hiệu lực. */
  findPrice(tx: Prisma.TransactionClient, tenantId: string, serviceId: string, supplierId: string): Promise<{ amount: bigint } | null> {
    return tx.labPartnerServicePrice.findFirst({ where: { tenantId, technicalServiceId: serviceId, supplierId, deletedAt: null }, select: { amount: true } });
  }

  /** Nhà cung cấp phải còn dùng và được đánh dấu "Đối tác XN". */
  findActivePartner(tx: Prisma.TransactionClient, tenantId: string, supplierId: string): Promise<{ id: string; name: string } | null> {
    return tx.supplier.findFirst({ where: { tenantId, id: supplierId, deletedAt: null, isActive: true, isLabPartner: true }, select: { id: true, name: true } });
  }

  // ---- ghi ----

  createDispatch(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { branchId: string; dispatchNo: string; supplierId: string; sentAt: Date; note: string | null },
  ) {
    return tx.labPartnerDispatch.create({ data: { tenantId, ...data, sentBy: actorId, createdBy: actorId, updatedBy: actorId } });
  }

  createDispatchItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    dispatchId: string,
    items: { clinicalOrderItemId: string; specimenTubeId: string | null; unitCost: bigint; dueAt: Date | null }[],
  ) {
    return tx.labPartnerDispatchItem.createMany({ data: items.map((i) => ({ tenantId, dispatchId, ...i, createdBy: actorId, updatedBy: actorId })) });
  }
}
