import { Injectable } from '@nestjs/common';
import type { Prisma, SupplierDebtAccount } from '@prisma/client';

/** Chỗ DUY NHẤT gọi Prisma cho bảng `supplier_debt_account` (docs/DECISIONS.md #180/#182). */
@Injectable()
export class SupplierDebtAccountRepository {
  findBySupplierId(tx: Prisma.TransactionClient, tenantId: string, supplierId: string): Promise<SupplierDebtAccount | null> {
    return tx.supplierDebtAccount.findFirst({ where: { tenantId, supplierId, deletedAt: null } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<SupplierDebtAccount | null> {
    return tx.supplierDebtAccount.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, supplierId: string): Promise<SupplierDebtAccount> {
    return tx.supplierDebtAccount.create({ data: { tenantId, supplierId, balance: 0n, createdBy: actorId, updatedBy: actorId } });
  }

  /** `updateMany` + kiểm `count` cho optimistic locking (.claude/docs/data-model.md) — tuần tự hoá
   * mọi bút toán của CÙNG 1 NCC, đúng khuôn `PatientWalletRepository.updateBalance()`. */
  async updateBalance(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, newBalance: bigint): Promise<number> {
    const result = await tx.supplierDebtAccount.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { balance: newBalance, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Trang "Nhà cung cấp"/"Công nợ nhà cung cấp" — tránh N+1 khi liệt kê nhiều NCC cùng lúc. NCC
   * chưa từng phát sinh bút toán nào sẽ KHÔNG có dòng nào trả về (chưa có account) — Service tự
   * coi `balance=0` cho các supplierId thiếu trong kết quả. */
  listBySupplierIds(tx: Prisma.TransactionClient, tenantId: string, supplierIds: string[]): Promise<SupplierDebtAccount[]> {
    if (supplierIds.length === 0) return Promise.resolve([]);
    return tx.supplierDebtAccount.findMany({ where: { tenantId, supplierId: { in: supplierIds }, deletedAt: null } });
  }

  /** Phần E — nâng mốc `lockedAsOfDate` lúc "Chốt" biên bản đối chiếu, optimistic lock qua `version`
   * (đúng khuôn `updateBalance()`). Caller (`finalizeReconciliationCore()`) đã tự tính `newLockedAsOfDate
   * = max(hiện tại, asOfDate)` trước khi gọi — method này chỉ ghi, không tự so sánh. */
  async updateLockedAsOfDate(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, newLockedAsOfDate: Date): Promise<number> {
    const result = await tx.supplierDebtAccount.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { lockedAsOfDate: newLockedAsOfDate, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
