import { Injectable } from '@nestjs/common';
import type { Prisma, SupplierDebtEntry, SupplierDebtEntryType } from '@prisma/client';

export interface CreateSupplierDebtEntryData {
  accountId: string;
  entryType: SupplierDebtEntryType;
  /** Có dấu — đồng. */
  amountChange: bigint;
  balanceAfter: bigint;
  occurredAt: Date;
  stockReceiptId: string | null;
  cashVoucherId: string | null;
  reversalOfId: string | null;
  note: string | null;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `supplier_debt_entry` — sổ APPEND-ONLY (CLAUDE.md), không có
 * method sửa/xoá dòng nào ở đây, đúng khuôn `PatientWalletRepository`/`WalletTransaction`. */
@Injectable()
export class SupplierDebtEntryRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateSupplierDebtEntryData): Promise<SupplierDebtEntry> {
    return tx.supplierDebtEntry.create({
      data: {
        tenantId,
        accountId: data.accountId,
        entryType: data.entryType,
        amountChange: data.amountChange,
        balanceAfter: data.balanceAfter,
        occurredAt: data.occurredAt,
        stockReceiptId: data.stockReceiptId,
        cashVoucherId: data.cashVoucherId,
        reversalOfId: data.reversalOfId,
        note: data.note,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /** Toàn bộ sổ của 1 NCC, ĐÚNG THỨ TỰ GHI SỔ (`createdAt asc, id asc`) — dùng cho cả hiển thị tab
   * "Sổ công nợ" lẫn `allocateSupplierDebt()` (@nexamed/core, tab "Phiếu nhập"). KHÔNG lọc theo
   * `occurredAt` ở đây — bộ lọc ngày (nếu có) chỉ áp dụng ở tầng hiển thị Sổ công nợ, KHÔNG được áp
   * cho input của `allocateSupplierDebt()` (thuật toán cần TOÀN BỘ lịch sử mới tính đúng). */
  listByAccountId(tx: Prisma.TransactionClient, tenantId: string, accountId: string): Promise<SupplierDebtEntry[]> {
    return tx.supplierDebtEntry.findMany({
      where: { tenantId, accountId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  findByCashVoucherId(tx: Prisma.TransactionClient, tenantId: string, cashVoucherId: string): Promise<SupplierDebtEntry | null> {
    return tx.supplierDebtEntry.findFirst({ where: { tenantId, cashVoucherId } });
  }

  /** Toàn bộ sổ của NHIỀU NCC trong 1 câu truy vấn (tránh N+1 ở trang danh sách "Công nợ nhà cung
   * cấp"/"Nhà cung cấp") — cùng dữ liệu thô như `listByAccountId()`, Service tự tính tổng theo
   * `entryType` SAU KHI loại cặp gốc+REVERSAL (đúng `allocateSupplierDebt()`), không tính ở tầng
   * SQL (groupBy không loại trừ được cặp đã đảo). */
  listByAccountIds(tx: Prisma.TransactionClient, tenantId: string, accountIds: string[]): Promise<SupplierDebtEntry[]> {
    if (accountIds.length === 0) return Promise.resolve([]);
    return tx.supplierDebtEntry.findMany({ where: { tenantId, accountId: { in: accountIds } } });
  }
}
