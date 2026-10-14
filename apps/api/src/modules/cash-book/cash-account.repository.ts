import { Injectable } from '@nestjs/common';
import type { CashAccount, Prisma } from '@prisma/client';

export interface CreateCashAccountData {
  branchId: string;
  code: string;
  name: string;
  type: 'CASH' | 'BANK' | 'DRAWER';
  bankName?: string | null;
  bankAccountNo?: string | null;
  openingBalance: bigint;
  openingBalanceAt: Date;
  isDefault?: boolean;
  /** "Thủ quỹ riêng" (GĐ2) — CHỈ có ý nghĩa với `type='DRAWER'`. */
  ownerUserId?: string | null;
}

export interface UpdateCashAccountData {
  name?: string;
  bankName?: string | null;
  bankAccountNo?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

/** Kèm tên chi nhánh (Đợt 2 chi nhánh, #233) — `CashAccountService` map sang DTO. */
export type CashAccountWithBranch = CashAccount & { branch: { name: string } };
const BRANCH_INCLUDE = { branch: { select: { name: true } } } as const;

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `cash_account` — theo .claude/docs/coding-standards.md.
 *
 * Đợt 2 chi nhánh (#233): quỹ thuộc ĐÚNG MỘT chi nhánh. Mọi tra cứu để THU/CHI/CHỐT CA (`findById`, `findDefault`, `findDrawerForUser`) BẮT BUỘC
 * `branchId` (quỹ chi nhánh khác → null → 404). Chỉ `findByIdAnyBranch` (màn quản trị quỹ, đọc tên) bỏ lọc chi nhánh.
 */
@Injectable()
export class CashAccountRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateCashAccountData): Promise<CashAccount> {
    return tx.cashAccount.create({
      data: {
        tenantId,
        branchId: data.branchId,
        code: data.code,
        name: data.name,
        type: data.type,
        bankName: data.bankName ?? null,
        bankAccountNo: data.bankAccountNo ?? null,
        openingBalance: data.openingBalance,
        openingBalanceAt: data.openingBalanceAt,
        isDefault: data.isDefault ?? false,
        ownerUserId: data.ownerUserId ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string): Promise<CashAccount | null> {
    return tx.cashAccount.findFirst({ where: { tenantId, branchId, id, deletedAt: null } });
  }

  /** CHỈ cho màn quản trị quỹ và đọc tên để hiển thị — mọi nghiệp vụ thu/chi dùng `findById` có `branchId`. */
  findByIdAnyBranch(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<CashAccountWithBranch | null> {
    return tx.cashAccount.findFirst({ where: { tenantId, id, deletedAt: null }, include: BRANCH_INCLUDE });
  }

  /** "Thủ quỹ riêng" (GĐ2) — két `DRAWER` CỦA CHÍNH `ownerUserId`, nếu đã từng cấp. */
  findDrawerForUser(tx: Prisma.TransactionClient, tenantId: string, branchId: string, ownerUserId: string): Promise<CashAccount | null> {
    return tx.cashAccount.findFirst({ where: { tenantId, branchId, ownerUserId, type: 'DRAWER', deletedAt: null } });
  }

  /** `branchIds` = chi nhánh được phép đọc (xem `resolveBranchScope`). */
  list(tx: Prisma.TransactionClient, tenantId: string, branchIds: string[]): Promise<CashAccountWithBranch[]> {
    return tx.cashAccount.findMany({
      where: { tenantId, branchId: { in: branchIds }, deletedAt: null },
      include: BRANCH_INCLUDE,
      orderBy: [{ branch: { name: 'asc' } }, { type: 'asc' }, { name: 'asc' }],
    });
  }

  /** Quỹ MẶC ĐỊNH theo loại — dùng để gắn `payment.cashAccountId` lúc thu/hoàn tiền khám (chỉ gọi
   * cho `type='CASH'` ở GĐ1, xem `InvoiceService`). `null` nếu tenant chưa có quỹ mặc định loại này. */
  findDefault(tx: Prisma.TransactionClient, tenantId: string, branchId: string, type: 'CASH' | 'BANK' | 'DRAWER'): Promise<CashAccount | null> {
    return tx.cashAccount.findFirst({ where: { tenantId, branchId, type, isDefault: true, deletedAt: null } });
  }

  /** Đang có quỹ mặc định khác của cùng loại chưa (để bỏ cờ `isDefault` cũ khi đổi quỹ mặc định mới) — chỉ gọi khi `data.isDefault === true`. */
  findOtherDefault(tx: Prisma.TransactionClient, tenantId: string, branchId: string, type: 'CASH' | 'BANK' | 'DRAWER', excludeId: string): Promise<CashAccount | null> {
    return tx.cashAccount.findFirst({ where: { tenantId, branchId, type, isDefault: true, deletedAt: null, id: { not: excludeId } } });
  }

  clearDefaultFlag(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string): Promise<Prisma.BatchPayload> {
    return tx.cashAccount.updateMany({ where: { tenantId, id }, data: { isDefault: false, updatedBy: actorId, version: { increment: 1 } } });
  }

  /** `updateMany` + kiểm `count` — cùng lý do `PatientRepository.updateIfVersionMatches`. */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateCashAccountData,
  ): Promise<number> {
    const result = await tx.cashAccount.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
