import { Injectable } from '@nestjs/common';
import type { CashAccount, Prisma } from '@prisma/client';

export interface CreateCashAccountData {
  code: string;
  name: string;
  type: 'CASH' | 'BANK' | 'DRAWER';
  bankName?: string | null;
  bankAccountNo?: string | null;
  openingBalance: bigint;
  openingBalanceAt: Date;
  isDefault?: boolean;
}

export interface UpdateCashAccountData {
  name?: string;
  bankName?: string | null;
  bankAccountNo?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `cash_account` — theo .claude/docs/coding-standards.md. */
@Injectable()
export class CashAccountRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateCashAccountData): Promise<CashAccount> {
    return tx.cashAccount.create({
      data: {
        tenantId,
        code: data.code,
        name: data.name,
        type: data.type,
        bankName: data.bankName ?? null,
        bankAccountNo: data.bankAccountNo ?? null,
        openingBalance: data.openingBalance,
        openingBalanceAt: data.openingBalanceAt,
        isDefault: data.isDefault ?? false,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<CashAccount | null> {
    return tx.cashAccount.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  list(tx: Prisma.TransactionClient, tenantId: string): Promise<CashAccount[]> {
    return tx.cashAccount.findMany({ where: { tenantId, deletedAt: null }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }

  /** Quỹ MẶC ĐỊNH theo loại — dùng để gắn `payment.cashAccountId` lúc thu/hoàn tiền khám (chỉ gọi
   * cho `type='CASH'` ở GĐ1, xem `InvoiceService`). `null` nếu tenant chưa có quỹ mặc định loại này. */
  findDefault(tx: Prisma.TransactionClient, tenantId: string, type: 'CASH' | 'BANK' | 'DRAWER'): Promise<CashAccount | null> {
    return tx.cashAccount.findFirst({ where: { tenantId, type, isDefault: true, deletedAt: null } });
  }

  /** Đang có quỹ mặc định khác của cùng loại chưa (để bỏ cờ `isDefault` cũ khi đổi quỹ mặc định mới) — chỉ gọi khi `data.isDefault === true`. */
  findOtherDefault(tx: Prisma.TransactionClient, tenantId: string, type: 'CASH' | 'BANK' | 'DRAWER', excludeId: string): Promise<CashAccount | null> {
    return tx.cashAccount.findFirst({ where: { tenantId, type, isDefault: true, deletedAt: null, id: { not: excludeId } } });
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
