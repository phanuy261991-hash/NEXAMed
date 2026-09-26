import { Injectable } from '@nestjs/common';
import type { Prisma, SupplierDebtReconciliation } from '@prisma/client';

export interface CreateSupplierDebtReconciliationData {
  supplierId: string;
  reconciliationNo: string;
  asOfDate: Date;
  systemBalance: bigint;
  confirmedBalance: bigint;
  differenceAmount: bigint;
  resultingAdjustmentId: string | null;
  note: string | null;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `supplier_debt_reconciliation` (Phần E, docs/DECISIONS.md #182
 * câu 3). KHÔNG có method sửa nội dung — chỉ chuyển trạng thái `DRAFT` → `FINALIZED`/`CANCELLED` qua
 * optimistic lock, đúng nguyên tắc "bản ghi bất biến" (CLAUDE.md). */
@Injectable()
export class SupplierDebtReconciliationRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateSupplierDebtReconciliationData): Promise<SupplierDebtReconciliation> {
    return tx.supplierDebtReconciliation.create({
      data: {
        tenantId,
        supplierId: data.supplierId,
        reconciliationNo: data.reconciliationNo,
        asOfDate: data.asOfDate,
        systemBalance: data.systemBalance,
        confirmedBalance: data.confirmedBalance,
        differenceAmount: data.differenceAmount,
        resultingAdjustmentId: data.resultingAdjustmentId,
        note: data.note,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<SupplierDebtReconciliation | null> {
    return tx.supplierDebtReconciliation.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Mốc `asOfDate` của biên bản `FINALIZED` gần nhất của 1 NCC — validate ngày đối chiếu mới PHẢI
   * sau mốc này (không lùi). `null` nếu NCC chưa từng chốt biên bản nào. */
  async findLatestFinalizedAsOfDate(tx: Prisma.TransactionClient, tenantId: string, supplierId: string): Promise<Date | null> {
    const row = await tx.supplierDebtReconciliation.findFirst({
      where: { tenantId, supplierId, status: 'FINALIZED', deletedAt: null },
      orderBy: { asOfDate: 'desc' },
      select: { asOfDate: true },
    });
    return row?.asOfDate ?? null;
  }

  /** `rejectAdjustment()` — tra biên bản nào đã tự sinh ra phiếu điều chỉnh vừa bị Từ chối, để tự
   * chuyển biên bản đó sang `CANCELLED` (quyết định chốt qua AskUserQuestion — không cho sửa lại,
   * phải lập biên bản mới). Tối đa 1 dòng trong thực tế (mỗi phiếu điều chỉnh do biên bản tự sinh chỉ
   * gắn đúng 1 biên bản), nhưng Prisma không biểu diễn được ràng buộc unique xuyên bảng ở migration. */
  findByResultingAdjustmentId(tx: Prisma.TransactionClient, tenantId: string, adjustmentId: string): Promise<SupplierDebtReconciliation | null> {
    return tx.supplierDebtReconciliation.findFirst({ where: { tenantId, resultingAdjustmentId: adjustmentId, deletedAt: null } });
  }

  list(tx: Prisma.TransactionClient, tenantId: string, supplierId: string): Promise<SupplierDebtReconciliation[]> {
    return tx.supplierDebtReconciliation.findMany({
      where: { tenantId, supplierId, deletedAt: null },
      orderBy: [{ asOfDate: 'desc' }, { id: 'desc' }],
    });
  }

  /** optimistic lock — chỉ chuyển được từ `DRAFT`. */
  async markFinalized(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, finalizedAt: Date): Promise<number> {
    const result = await tx.supplierDebtReconciliation.updateMany({
      where: { tenantId, id, version: expectedVersion, status: 'DRAFT', deletedAt: null },
      data: { status: 'FINALIZED', finalizedBy: actorId, finalizedAt, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** `rejectAdjustment()` hook — không kiểm `expectedVersion` (hệ thống tự chuyển thay, không phải
   * người dùng thao tác trực tiếp trên biên bản), nhưng vẫn chỉ áp dụng cho `DRAFT` (phòng thủ, biên
   * bản không thể đã `FINALIZED` trong khi phiếu điều chỉnh của nó còn `PENDING_APPROVAL`). */
  async markCancelled(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string): Promise<number> {
    const result = await tx.supplierDebtReconciliation.updateMany({
      where: { tenantId, id, status: 'DRAFT', deletedAt: null },
      data: { status: 'CANCELLED', updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
