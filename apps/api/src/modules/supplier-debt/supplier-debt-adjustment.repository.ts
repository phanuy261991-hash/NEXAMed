import { Injectable } from '@nestjs/common';
import type { Prisma, SupplierDebtAdjustment, SupplierDebtAdjustmentKind } from '@prisma/client';

export interface CreateSupplierDebtAdjustmentData {
  supplierId: string;
  adjustmentNo: string;
  kind: SupplierDebtAdjustmentKind;
  amount: bigint | null;
  targetReceiptId: string | null;
  targetIssueId: string | null;
  targetVoucherId: string | null;
  reason: string;
  evidenceRef: string | null;
}

export interface ListSupplierDebtAdjustmentsFilter {
  supplierId?: string;
  status?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  targetReceiptId?: string;
  targetIssueId?: string;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `supplier_debt_adjustment` (Phần D, docs/DECISIONS.md #180/#182).
 * KHÔNG có method sửa nội dung (chỉ chuyển trạng thái PENDING_APPROVAL→APPROVED/REJECTED qua
 * optimistic lock) — đúng nguyên tắc "không có nút Sửa trên chứng từ đã duyệt", và ở đây còn CHƯA
 * duyệt cũng không sửa được (đơn giản hoá có chủ đích — sai thì Từ chối rồi lập lại). */
@Injectable()
export class SupplierDebtAdjustmentRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateSupplierDebtAdjustmentData): Promise<SupplierDebtAdjustment> {
    return tx.supplierDebtAdjustment.create({
      data: {
        tenantId,
        supplierId: data.supplierId,
        adjustmentNo: data.adjustmentNo,
        kind: data.kind,
        amount: data.amount,
        targetReceiptId: data.targetReceiptId,
        targetIssueId: data.targetIssueId,
        targetVoucherId: data.targetVoucherId,
        reason: data.reason,
        evidenceRef: data.evidenceRef,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<SupplierDebtAdjustment | null> {
    return tx.supplierDebtAdjustment.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Phần E — tra trạng thái NHIỀU phiếu điều chỉnh cùng lúc (tab "Đối chiếu & Chốt kỳ" cần biết
   * `resultingAdjustmentStatus` của mỗi biên bản, tránh N+1). */
  findByIds(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<SupplierDebtAdjustment[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.supplierDebtAdjustment.findMany({ where: { tenantId, id: { in: ids } } });
  }

  /** `updateMany` + kiểm `count` — optimistic lock, chỉ chuyển được từ `PENDING_APPROVAL`. */
  async markApproved(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, approvedAt: Date): Promise<number> {
    const result = await tx.supplierDebtAdjustment.updateMany({
      where: { tenantId, id, version: expectedVersion, status: 'PENDING_APPROVAL', deletedAt: null },
      data: { status: 'APPROVED', approvedBy: actorId, approvedAt, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async markRejected(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, rejectionReason: string): Promise<number> {
    const result = await tx.supplierDebtAdjustment.updateMany({
      where: { tenantId, id, version: expectedVersion, status: 'PENDING_APPROVAL', deletedAt: null },
      data: { status: 'REJECTED', rejectionReason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  list(tx: Prisma.TransactionClient, tenantId: string, filter: ListSupplierDebtAdjustmentsFilter): Promise<SupplierDebtAdjustment[]> {
    return tx.supplierDebtAdjustment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        supplierId: filter.supplierId,
        status: filter.status,
        targetReceiptId: filter.targetReceiptId,
        targetIssueId: filter.targetIssueId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** Trang "Công nợ nhà cung cấp" — badge sidebar/tổng hợp: đếm số `PENDING_APPROVAL` theo NHIỀU NCC
   * trong 1 câu truy vấn (tránh N+1), đúng khuôn `sumPendingApprovalBySupplierIds` (cash_voucher). */
  async countPendingBySupplierIds(tx: Prisma.TransactionClient, tenantId: string, supplierIds: string[]): Promise<Map<string, number>> {
    if (supplierIds.length === 0) return new Map();
    const rows = await tx.supplierDebtAdjustment.groupBy({
      by: ['supplierId'],
      where: { tenantId, status: 'PENDING_APPROVAL', supplierId: { in: supplierIds }, deletedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.supplierId, r._count._all]));
  }
}
