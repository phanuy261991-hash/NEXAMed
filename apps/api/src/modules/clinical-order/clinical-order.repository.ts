import { Injectable } from '@nestjs/common';
import type { ClinicalOrder, ClinicalOrderItem, ClinicalOrderItemStatus, ClinicalOrderPackage, Prisma, TechnicalServiceKind } from '@prisma/client';

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
  items: (ClinicalOrderItem & {
    technicalService: { serviceKind: TechnicalServiceKind; department: { name: string } | null } | null;
    results: { signedAt: Date | null; supersedesId: string | null }[];
  })[];
  packages: ClinicalOrderPackage[];
}

const ORDER_INCLUDE = {
  items: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      // `serviceKind` để màn khám biết mở kết quả ở nhóm nào (xét nghiệm / CĐHA & thăm dò chức năng).
      technicalService: { select: { serviceKind: true, department: { select: { name: true } } } },
      // Kết quả còn hiệu lực (đúng 1 bản/dịch vụ — bản đính chính thay bản cũ): mốc "Trả lúc" và cờ "đang đính chính" cho màn khám.
      results: { where: { deletedAt: null }, select: { signedAt: true, supersedesId: true }, take: 1 },
    },
  },
  packages: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ClinicalOrderInclude;

const INVOICE_STATUS_SELECT = { where: { deletedAt: null }, select: { invoice: { select: { status: true } } } } as const;

/** Include dựng hàng đợi cận lâm sàng (GĐ4): phiếu → lượt khám → bệnh nhân, dịch vụ + Khoa/Phòng, và dòng hoá đơn (để biết đã thu tiền chưa). */
const QUEUE_ITEM_INCLUDE = {
  order: {
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      encounter: {
        select: {
          id: true,
          encounterNo: true,
          status: true,
          doctorId: true,
          patient: { select: { id: true, fullName: true, patientCode: true, dob: true, gender: true, phone: true } },
        },
      },
    },
  },
  technicalService: {
    select: { id: true, code: true, name: true, serviceKind: true, resultType: true, specimenTypeCode: true, categoryCode: true, departmentId: true, department: { select: { id: true, name: true } } },
  },
  invoiceLines: INVOICE_STATUS_SELECT,
  results: { where: { deletedAt: null }, select: { supersedesId: true, signedAt: true } },
  package: { select: { invoiceLines: INVOICE_STATUS_SELECT } },
  // Ống mẫu đang chứa xét nghiệm này (docs/DECISIONS.md #220) — hàng đợi hiện mã ống / màu nắp.
  specimenTube: { select: { id: true, sid: true, status: true, specimenName: true, capColor: true } },
} satisfies Prisma.ClinicalOrderItemInclude;

export type QueueItemRow = Prisma.ClinicalOrderItemGetPayload<{ include: typeof QUEUE_ITEM_INCLUDE }>;

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

  // ---- Cận lâm sàng GĐ4 — hàng đợi / thực hiện / kết quả ----

  /**
   * Mọi dòng chỉ định LÀM TẠI PHÒNG KHÁM của lượt khám còn hiệu lực, kèm đủ dữ liệu dựng hàng đợi: phiếu, bệnh nhân, Khoa/Phòng, tình trạng thu tiền
   * (dòng hoá đơn của chính dòng lẻ hoặc của gói chứa nó). Dòng chưa xong lấy hết mọi ngày (việc tồn đọng vẫn phải thấy); dòng `COMPLETED` chỉ lấy khi đã duyệt
   * trong khoảng `completedRange`.
   */
  listQueueItems(tx: Prisma.TransactionClient, tenantId: string, completedRange: { from: Date; to: Date }): Promise<QueueItemRow[]> {
    return tx.clinicalOrderItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        performance: 'IN_HOUSE',
        technicalServiceId: { not: null },
        status: { not: 'CANCELLED' },
        order: { deletedAt: null, encounter: { status: { not: 'CANCELLED' } } },
        OR: [
          { status: { not: 'COMPLETED' } },
          { status: 'COMPLETED', results: { some: { deletedAt: null, signedAt: { gte: completedRange.from, lt: completedRange.to } } } },
        ],
      },
      include: QUEUE_ITEM_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  findQueueItemsByIds(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<QueueItemRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.clinicalOrderItem.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: null, order: { deletedAt: null } },
      include: QUEUE_ITEM_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Các dòng chỉ định tại phòng khám CÙNG PHIẾU (dùng gom xét nghiệm cùng nhóm lúc mở màn nhập kết quả). */
  findQueueItemsByOrder(tx: Prisma.TransactionClient, tenantId: string, clinicalOrderId: string): Promise<QueueItemRow[]> {
    return tx.clinicalOrderItem.findMany({
      where: { tenantId, clinicalOrderId, deletedAt: null, performance: 'IN_HOUSE', technicalServiceId: { not: null }, status: { not: 'CANCELLED' } },
      include: QUEUE_ITEM_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** ORDERED → IN_PROGRESS (lấy mẫu / gọi vào phòng). `WHERE status='ORDERED'` — chống 2 người bấm cùng lúc; trả số dòng thật sự chuyển. */
  async markStarted(tx: Prisma.TransactionClient, tenantId: string, ids: string[], actorId: string, at: Date): Promise<number> {
    const r = await tx.clinicalOrderItem.updateMany({
      where: { tenantId, id: { in: ids }, deletedAt: null, status: 'ORDERED' },
      data: { status: 'IN_PROGRESS', collectedAt: at, collectedBy: actorId, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** Gán (hoặc gỡ, `tubeId = null`) ống mẫu cho các dòng xét nghiệm (docs/DECISIONS.md #220). */
  async setSpecimenTube(tx: Prisma.TransactionClient, tenantId: string, ids: string[], tubeId: string | null, actorId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const r = await tx.clinicalOrderItem.updateMany({
      where: { tenantId, id: { in: ids }, deletedAt: null },
      data: { specimenTubeId: tubeId, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** IN_PROGRESS → ORDERED (huỷ xác nhận đã lấy mẫu / huỷ ống & lấy lại): xoá giờ + người lấy mẫu. `WHERE status='IN_PROGRESS'` chống ghi chồng; trả số dòng thật sự chuyển. */
  async revertToOrdered(tx: Prisma.TransactionClient, tenantId: string, ids: string[], actorId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const r = await tx.clinicalOrderItem.updateMany({
      where: { tenantId, id: { in: ids }, deletedAt: null, status: 'IN_PROGRESS' },
      data: { status: 'ORDERED', collectedAt: null, collectedBy: null, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /**
   * Huỷ lượt khám: đóng các dòng chỉ định còn `ORDERED` (chưa bắt đầu) của lượt khám thành `CANCELLED`. Điều kiện `status = 'ORDERED'` nằm trong WHERE nên dòng đang làm dở/đã duyệt
   * không bao giờ bị chạm (chống ghi chồng với người vừa lấy mẫu). Trả số dòng đã đóng.
   */
  async cancelNotStartedForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, actorId: string): Promise<number> {
    const r = await tx.clinicalOrderItem.updateMany({
      where: { tenantId, deletedAt: null, status: 'ORDERED', order: { encounterId, deletedAt: null } },
      data: { status: 'CANCELLED', updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /**
   * Chuyển trạng thái có điều kiện `status = from` (chống ghi chồng); trả số dòng thật sự chuyển. Chuyển sang `COMPLETED` (duyệt lần đầu hoặc duyệt lại sau đính chính) đặt lại
   * `doctor_seen_at` về NULL để kết quả hiện lại là "mới" ở Hàng đợi khám của bác sĩ (#221).
   */
  async transitionStatus(tx: Prisma.TransactionClient, tenantId: string, ids: string[], from: ClinicalOrderItemStatus[], to: ClinicalOrderItemStatus, actorId: string): Promise<number> {
    const r = await tx.clinicalOrderItem.updateMany({
      where: { tenantId, id: { in: ids }, deletedAt: null, status: { in: from } },
      data: { status: to, updatedBy: actorId, version: { increment: 1 }, ...(to === 'COMPLETED' ? { doctorSeenAt: null } : {}) },
    });
    return r.count;
  }

  /** Mỗi lượt khám: số dịch vụ cận lâm sàng tại phòng khám chưa có kết quả được duyệt + số kết quả đã duyệt mà bác sĩ chưa xem. Lượt không có dịch vụ nào thì không có khoá (#221). */
  async progressByEncounterIds(tx: Prisma.TransactionClient, tenantId: string, encounterIds: string[]): Promise<Map<string, { pendingCount: number; unseenResultCount: number }>> {
    const result = new Map<string, { pendingCount: number; unseenResultCount: number }>();
    if (encounterIds.length === 0) return result;
    const rows = await tx.clinicalOrderItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        itemKind: 'TECHNICAL_SERVICE',
        performance: 'IN_HOUSE',
        status: { in: ['ORDERED', 'IN_PROGRESS', 'RESULTED', 'COMPLETED'] },
        order: { encounterId: { in: encounterIds }, deletedAt: null },
      },
      select: { status: true, doctorSeenAt: true, order: { select: { encounterId: true } } },
    });
    for (const r of rows) {
      const entry = result.get(r.order.encounterId) ?? { pendingCount: 0, unseenResultCount: 0 };
      if (r.status === 'COMPLETED') {
        if (r.doctorSeenAt === null) entry.unseenResultCount += 1;
      } else {
        entry.pendingCount += 1;
      }
      result.set(r.order.encounterId, entry);
    }
    return result;
  }

  /** Số lượt khám ĐANG KHÁM của bác sĩ có ít nhất 1 kết quả mới chưa xem. */
  async countEncountersWithUnseenResults(tx: Prisma.TransactionClient, tenantId: string, doctorId: string): Promise<number> {
    const rows = await tx.clinicalOrderItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        itemKind: 'TECHNICAL_SERVICE',
        performance: 'IN_HOUSE',
        status: 'COMPLETED',
        doctorSeenAt: null,
        order: { deletedAt: null, encounter: { doctorId, status: 'IN_CONSULTATION', deletedAt: null } },
      },
      select: { order: { select: { encounterId: true } } },
    });
    return new Set(rows.map((r) => r.order.encounterId)).size;
  }

  /** Bác sĩ phụ trách đã mở xem kết quả của lượt khám: đặt `doctor_seen_at` cho mọi kết quả đã duyệt chưa xem. Trả số dòng đã đánh dấu. */
  async markResultsSeen(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, actorId: string): Promise<number> {
    const r = await tx.clinicalOrderItem.updateMany({
      where: { tenantId, deletedAt: null, itemKind: 'TECHNICAL_SERVICE', performance: 'IN_HOUSE', status: 'COMPLETED', doctorSeenAt: null, order: { encounterId, deletedAt: null } },
      data: { doctorSeenAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }
}
