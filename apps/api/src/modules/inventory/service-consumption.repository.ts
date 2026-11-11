import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Chỗ DUY NHẤT gọi Prisma cho "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4): bảng `service_consumption_norm` + đọc dòng dịch vụ của lượt khám
 * (`clinical_order_item`, `encounter_service_item`) và các phiếu xuất `SERVICE_CONSUMPTION`. Đọc bảng của module khác trong CÙNG transaction, đúng tiền lệ
 * `LabPartnerDispatchRepository`.
 */
@Injectable()
export class ServiceConsumptionRepository {
  // ---------------- Định mức ----------------
  listNorms(tx: Prisma.TransactionClient, tenantId: string, kind: 'EXAM_TYPE' | 'TECHNICAL_SERVICE', ref: string) {
    return tx.serviceConsumptionNorm.findMany({
      where: { tenantId, deletedAt: null, serviceKind: kind, ...(kind === 'EXAM_TYPE' ? { examTypeCode: ref } : { technicalServiceId: ref }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Định mức của NHIỀU dịch vụ một lượt (màn khám/kết quả) — gom theo mã dịch vụ khám và id dịch vụ kỹ thuật. */
  listNormsForServices(tx: Prisma.TransactionClient, tenantId: string, examCodes: string[], technicalServiceIds: string[]) {
    if (examCodes.length === 0 && technicalServiceIds.length === 0) return Promise.resolve([]);
    return tx.serviceConsumptionNorm.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [...(examCodes.length > 0 ? [{ serviceKind: 'EXAM_TYPE', examTypeCode: { in: examCodes } }] : []), ...(technicalServiceIds.length > 0 ? [{ serviceKind: 'TECHNICAL_SERVICE', technicalServiceId: { in: technicalServiceIds } }] : [])],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Thay NGUYÊN định mức của một dịch vụ: xoá mềm dòng cũ, tạo dòng mới (cùng khuôn `replaceForDrug`). */
  async replaceNorms(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    kind: 'EXAM_TYPE' | 'TECHNICAL_SERVICE',
    ref: string,
    lines: { drugId: string; quantity: number }[],
  ): Promise<void> {
    await tx.serviceConsumptionNorm.updateMany({
      where: { tenantId, deletedAt: null, serviceKind: kind, ...(kind === 'EXAM_TYPE' ? { examTypeCode: ref } : { technicalServiceId: ref }) },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (lines.length === 0) return;
    await tx.serviceConsumptionNorm.createMany({
      data: lines.map((l) => ({
        tenantId,
        serviceKind: kind,
        examTypeCode: kind === 'EXAM_TYPE' ? ref : null,
        technicalServiceId: kind === 'TECHNICAL_SERVICE' ? ref : null,
        drugId: l.drugId,
        quantity: l.quantity,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
  }

  /** Dịch vụ có định mức phải tồn tại: dịch vụ kỹ thuật (id) hoặc mã danh mục dịch vụ khám còn trong công ty. */
  async serviceExists(tx: Prisma.TransactionClient, tenantId: string, kind: 'EXAM_TYPE' | 'TECHNICAL_SERVICE', ref: string): Promise<boolean> {
    if (kind === 'TECHNICAL_SERVICE') {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) return false;
      return (await tx.technicalService.findFirst({ where: { tenantId, id: ref, deletedAt: null }, select: { id: true } })) !== null;
    }
    return (await tx.referenceCatalog.findFirst({ where: { tenantId, category: 'EXAM_TYPE', code: ref, deletedAt: null }, select: { id: true } })) !== null;
  }

  // ---------------- Dịch vụ + phiếu của lượt khám ----------------
  findEncounter(tx: Prisma.TransactionClient, tenantId: string, branchId: string, encounterId: string) {
    return tx.encounter.findFirst({ where: { tenantId, id: encounterId, branchId, deletedAt: null }, select: { id: true, status: true, encounterNo: true } });
  }

  listServiceItems(tx: Prisma.TransactionClient, tenantId: string, encounterId: string) {
    return tx.encounterServiceItem.findMany({ where: { tenantId, encounterId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, examTypeCode: true, examTypeName: true } });
  }

  /** Dòng chỉ định cận lâm sàng TẠI PHÒNG KHÁM còn hiệu lực (không tính dòng đã huỷ, ra ngoài, hay gói chỉ là vỏ). */
  listOrderItems(tx: Prisma.TransactionClient, tenantId: string, encounterId: string) {
    return tx.clinicalOrderItem.findMany({
      where: { tenantId, deletedAt: null, status: { not: 'CANCELLED' }, performance: 'IN_HOUSE', technicalServiceId: { not: null }, order: { encounterId, deletedAt: null } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, technicalServiceId: true, code: true, name: true, status: true },
    });
  }

  findServiceItem(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, id: string) {
    return tx.encounterServiceItem.findFirst({ where: { tenantId, id, encounterId, deletedAt: null }, select: { id: true } });
  }

  findOrderItem(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, id: string) {
    return tx.clinicalOrderItem.findFirst({
      where: { tenantId, id, deletedAt: null, order: { encounterId, deletedAt: null } },
      select: { id: true, status: true, performance: true, technicalServiceId: true },
    });
  }

  /** Phiếu tiêu hao ĐANG HIỆU LỰC của lượt khám (POSTED), kèm dòng + lô. Phiếu đã đảo (VOIDED) không trả về. */
  listActiveIssues(tx: Prisma.TransactionClient, tenantId: string, branchId: string, encounterId: string) {
    return tx.stockIssue.findMany({
      where: { tenantId, encounterId, issueType: 'SERVICE_CONSUMPTION', status: 'POSTED', deletedAt: null, warehouse: { branchId } },
      orderBy: { occurredAt: 'asc' },
      include: {
        lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { drug: { select: { id: true, code: true, name: true, itemType: true, baseUnitCode: true } }, batch: { select: { batchNo: true, expiryDate: true } } } },
      },
    });
  }

  findActiveIssueForTarget(tx: Prisma.TransactionClient, tenantId: string, target: { kind: 'CLINICAL_ORDER_ITEM' | 'ENCOUNTER_SERVICE_ITEM'; id: string }) {
    return tx.stockIssue.findFirst({
      where: { tenantId, issueType: 'SERVICE_CONSUMPTION', status: 'POSTED', deletedAt: null, ...(target.kind === 'CLINICAL_ORDER_ITEM' ? { clinicalOrderItemId: target.id } : { encounterServiceItemId: target.id }) },
      select: { id: true },
    });
  }

  findIssueForReverse(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string) {
    return tx.stockIssue.findFirst({ where: { tenantId, id, issueType: 'SERVICE_CONSUMPTION', warehouse: { branchId } }, select: { id: true, status: true, version: true, encounterId: true } });
  }

  // ---------------- Tra cứu phụ ----------------
  findDrugs(tx: Prisma.TransactionClient, tenantId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.drug.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null }, select: { id: true, code: true, name: true, itemType: true, baseUnitCode: true, isBatchManaged: true, isActive: true } });
  }

  async findUserNames(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.userAccount.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}
