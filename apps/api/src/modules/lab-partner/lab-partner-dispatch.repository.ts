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

const DONE_INCLUDE = { ...SENT_INCLUDE, resultFile: { select: { id: true, storageKey: true, fileName: true, receivedAt: true, receivedBy: true, sizeBytes: true } } } as const;
export type DoneItemRow = Prisma.LabPartnerDispatchItemGetPayload<{ include: typeof DONE_INCLUDE }>;

const STATEMENT_INCLUDE = {
  dispatch: { select: { id: true, dispatchNo: true, sentAt: true, branchId: true, branch: { select: { name: true } } } },
  orderItem: { select: { name: true, order: { select: { encounter: { select: { patient: { select: { fullName: true, patientCode: true } } } } } }, technicalService: { select: { name: true } } } },
  specimenTube: { select: { sid: true } },
} as const;

export type StatementItemRow = Prisma.LabPartnerDispatchItemGetPayload<{ include: typeof STATEMENT_INCLUDE }>;

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

  /** Mẫu đã nhận kết quả PDF mà bác sĩ chưa duyệt (dịch vụ còn ở trạng thái chờ duyệt). */
  countAwaitingApproval(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<number> {
    return tx.labPartnerDispatchItem.count({ where: { tenantId, deletedAt: null, status: 'RECEIVED', orderItem: { status: 'RESULTED', deletedAt: null }, dispatch: { branchId, deletedAt: null } } });
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

  /** "Đã có kết quả": dòng gửi đã nhận kết quả PDF (đã duyệt hoặc chưa), mới nhận trước. */
  listDoneItems(tx: Prisma.TransactionClient, tenantId: string, branchId: string, filter: { supplierId?: string; q?: string }): Promise<DoneItemRow[]> {
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
        status: 'RECEIVED',
        dispatch: { branchId, deletedAt: null, ...(filter.supplierId ? { supplierId: filter.supplierId } : {}) },
        ...(search.length > 0 ? { OR: search } : {}),
      },
      include: DONE_INCLUDE,
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  /**
   * Kết quả đối tác chờ bác sĩ duyệt: dòng gửi đã nhận PDF mà dịch vụ còn `RESULTED`. Lọc theo lượt khám (màn khám) và/hoặc bác sĩ của lượt khám (Tổng quan bác sĩ: lượt của chính họ);
   * nhận trước xếp trước (việc tồn lâu nhất lên đầu).
   */
  listAwaitingItems(tx: Prisma.TransactionClient, tenantId: string, branchId: string, filter: { encounterId?: string; doctorId?: string }): Promise<DoneItemRow[]> {
    return tx.labPartnerDispatchItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: 'RECEIVED',
        dispatch: { branchId, deletedAt: null },
        orderItem: {
          status: 'RESULTED',
          deletedAt: null,
          order: { deletedAt: null, encounter: { ...(filter.encounterId ? { id: filter.encounterId } : {}), ...(filter.doctorId ? { doctorId: filter.doctorId } : {}) } },
        },
      },
      include: DONE_INCLUDE,
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
  }

  /** Dòng gửi đang hiệu lực của các dòng chỉ định (theo `clinicalOrderItemId`) ở trạng thái đã cho, trong chi nhánh đang làm việc — kèm đợt gửi, tệp kết quả và dòng chỉ định. */
  findActiveDispatchItems(tx: Prisma.TransactionClient, tenantId: string, branchId: string, orderItemIds: string[], status: 'SENT' | 'RECEIVED'): Promise<DoneItemRow[]> {
    if (orderItemIds.length === 0) return Promise.resolve([]);
    return tx.labPartnerDispatchItem.findMany({
      where: { tenantId, clinicalOrderItemId: { in: orderItemIds }, status, deletedAt: null, dispatch: { branchId, deletedAt: null } },
      include: DONE_INCLUDE,
    });
  }

  createResultFile(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { branchId: string; supplierId: string; storageKey: string; fileName: string; contentType: string; sizeBytes: number; receivedAt: Date; note: string | null },
  ) {
    return tx.labPartnerResultFile.create({ data: { tenantId, ...data, receivedBy: actorId, createdBy: actorId, updatedBy: actorId } });
  }

  /** SENT → RECEIVED (chống ghi chồng: chỉ khi còn SENT). Trả số dòng đã chuyển. */
  async markReceived(tx: Prisma.TransactionClient, tenantId: string, actorId: string, id: string, data: { receivedAt: Date; resultFileId: string }): Promise<number> {
    const r = await tx.labPartnerDispatchItem.updateMany({
      where: { tenantId, id, status: 'SENT', deletedAt: null },
      data: { status: 'RECEIVED', receivedAt: data.receivedAt, receivedBy: actorId, resultFileId: data.resultFileId, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** SENT → REJECTED (đối tác không nhận): giữ lịch sử, mẫu tự về "Chờ gửi". */
  async markRejected(tx: Prisma.TransactionClient, tenantId: string, actorId: string, id: string, reason: string): Promise<number> {
    const r = await tx.labPartnerDispatchItem.updateMany({
      where: { tenantId, id, status: 'SENT', deletedAt: null },
      data: { status: 'REJECTED', rejectedAt: new Date(), rejectedBy: actorId, rejectReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** RECEIVED → SENT (trả lại kỹ thuật viên): bỏ thông tin nhận và tệp kết quả. */
  async markReturnedToSent(tx: Prisma.TransactionClient, tenantId: string, actorId: string, id: string): Promise<number> {
    const r = await tx.labPartnerDispatchItem.updateMany({
      where: { tenantId, id, status: 'RECEIVED', deletedAt: null },
      data: { status: 'SENT', receivedAt: null, receivedBy: null, resultFileId: null, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** Nhà cung cấp (đối tác) theo id — chỉ để kiểm tồn tại và lấy mã/tên cho đầu bảng kê. */
  findSupplierRef(tx: Prisma.TransactionClient, tenantId: string, supplierId: string): Promise<{ id: string; code: string; name: string } | null> {
    return tx.supplier.findFirst({ where: { tenantId, id: supplierId, deletedAt: null }, select: { id: true, code: true, name: true } });
  }

  /**
   * Bảng kê mẫu gửi của MỘT đối tác: MỌI chi nhánh (công nợ đối tác dùng chung cả công ty, như công nợ NCC), mọi trạng thái kể cả "Không nhận". Kỳ lọc ở CSDL: theo ngày gửi, hoặc theo ngày nhận
   * (dòng chưa có ngày nhận rơi theo ngày gửi). Lấy tối đa `take` dòng, sắp theo ngày gửi rồi mã ống.
   */
  listStatementItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplierId: string,
    period: { basis: 'RECEIVED' | 'SENT'; from: Date | null; to: Date | null },
    take: number,
  ): Promise<StatementItemRow[]> {
    const range: { gte?: Date; lte?: Date } = { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) };
    const hasRange = period.from !== null || period.to !== null;
    const periodFilter: Prisma.LabPartnerDispatchItemWhereInput[] = !hasRange
      ? []
      : period.basis === 'SENT'
        ? [{ dispatch: { sentAt: range } }]
        : [{ OR: [{ receivedAt: range }, { receivedAt: null, dispatch: { sentAt: range } }] }];
    return tx.labPartnerDispatchItem.findMany({
      where: { tenantId, deletedAt: null, dispatch: { supplierId, deletedAt: null }, AND: periodFilter },
      include: STATEMENT_INCLUDE,
      orderBy: [{ dispatch: { sentAt: 'asc' } }, { createdAt: 'asc' }],
      take,
    });
  }

  /** Mẫu đang chờ kết quả của một đối tác (mọi chi nhánh, mọi thời điểm): số mẫu và tổng giá trả dự kiến. */
  async sumWaitingForSupplier(tx: Prisma.TransactionClient, tenantId: string, supplierId: string): Promise<{ count: number; amount: bigint }> {
    const agg = await tx.labPartnerDispatchItem.aggregate({
      where: { tenantId, deletedAt: null, status: 'SENT', dispatch: { supplierId, deletedAt: null } },
      _count: { _all: true },
      _sum: { unitCost: true },
    });
    return { count: agg._count._all, amount: agg._sum.unitCost ?? 0n };
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
