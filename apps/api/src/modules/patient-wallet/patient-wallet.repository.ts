import { Injectable } from '@nestjs/common';
import type { PatientWallet, PatientWalletStatus, Prisma, WalletTransaction, WalletTransactionType } from '@prisma/client';

export interface CreateWalletTransactionData {
  walletId: string;
  type: WalletTransactionType;
  amount: bigint;
  balanceAfter: bigint;
  invoiceId?: string | null;
  cashVoucherId?: string | null;
  note?: string | null;
}

export interface WalletTotals {
  totalToppedUp: bigint;
  totalUsed: bigint;
  topUpCount: number;
  deductCount: number;
}

export interface WalletTransactionRow extends WalletTransaction {
  invoice: { invoiceNo: string; encounterId: string } | null;
  cashVoucher: { voucherNo: string } | null;
}

export interface WalletListRow extends PatientWallet {
  patient: { patientCode: string; fullName: string; phone: string };
}

export interface WalletOverallStats {
  totalHeldBalance: bigint;
  activeWalletCount: number;
  toppedUpToday: bigint;
  deductedToday: bigint;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `patient_wallet`/`wallet_transaction` — module `patient-wallet`.
 * `wallet_transaction` là sổ ghi APPEND-ONLY (CLAUDE.md) — không có method sửa/xoá dòng nào ở đây.
 */
@Injectable()
export class PatientWalletRepository {
  findByPatientId(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<PatientWallet | null> {
    return tx.patientWallet.findFirst({ where: { tenantId, patientId, deletedAt: null } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PatientWallet | null> {
    return tx.patientWallet.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, patientId: string): Promise<PatientWallet> {
    return tx.patientWallet.create({
      data: { tenantId, patientId, balance: 0n, status: 'ACTIVE', createdBy: actorId, updatedBy: actorId },
    });
  }

  /** `updateMany` + kiểm `count` cho optimistic locking (.claude/docs/data-model.md). */
  async updateBalance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    newBalance: bigint,
    close?: { closedAt: Date },
  ): Promise<number> {
    const result = await tx.patientWallet.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: {
        balance: newBalance,
        ...(close ? { status: 'CLOSED' as PatientWalletStatus, closedAt: close.closedAt } : {}),
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
    return result.count;
  }

  createTransaction(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateWalletTransactionData): Promise<WalletTransaction> {
    return tx.walletTransaction.create({
      data: {
        tenantId,
        walletId: data.walletId,
        type: data.type,
        amount: data.amount,
        balanceAfter: data.balanceAfter,
        invoiceId: data.invoiceId ?? null,
        cashVoucherId: data.cashVoucherId ?? null,
        note: data.note ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /** SUM theo `type` của MỘT ví — TOPUP (đã nạp)/DEDUCT (đã dùng), phục vụ `GET /wallet` (2 ô tile). */
  async getTotals(tx: Prisma.TransactionClient, tenantId: string, walletId: string): Promise<WalletTotals> {
    const map = await this.getTotalsForWallets(tx, tenantId, [walletId]);
    return map.get(walletId) ?? { totalToppedUp: 0n, totalUsed: 0n, topUpCount: 0, deductCount: 0 };
  }

  /** Cùng `getTotals()` nhưng cho NHIỀU ví trong 1 câu truy vấn (`GET /wallet/list` — tránh N+1). */
  async getTotalsForWallets(tx: Prisma.TransactionClient, tenantId: string, walletIds: string[]): Promise<Map<string, WalletTotals>> {
    const map = new Map<string, WalletTotals>();
    for (const id of walletIds) map.set(id, { totalToppedUp: 0n, totalUsed: 0n, topUpCount: 0, deductCount: 0 });
    if (walletIds.length === 0) return map;
    const rows = await tx.walletTransaction.groupBy({
      by: ['walletId', 'type'],
      where: { tenantId, walletId: { in: walletIds }, deletedAt: null },
      _sum: { amount: true },
      _count: { _all: true },
    });
    for (const row of rows) {
      const entry = map.get(row.walletId);
      if (!entry) continue;
      const sum = row._sum.amount ?? 0n;
      if (row.type === 'TOPUP') {
        entry.totalToppedUp += sum;
        entry.topUpCount += row._count._all;
      } else if (row.type === 'DEDUCT') {
        entry.totalUsed += sum;
        entry.deductCount += row._count._all;
      }
    }
    return map;
  }

  /** `id` là UUIDv7 (time-ordered) — sắp `desc` = mới nhất trước, cùng khuôn `PatientRepository.list()`. */
  listTransactions(
    tx: Prisma.TransactionClient,
    tenantId: string,
    walletId: string,
    params: { cursor?: string; take: number },
  ): Promise<WalletTransactionRow[]> {
    return tx.walletTransaction.findMany({
      where: { tenantId, walletId },
      include: {
        invoice: { select: { invoiceNo: true, encounterId: true } },
        cashVoucher: { select: { voucherNo: true } },
      },
      orderBy: { id: 'desc' },
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }

  /** Trang "Ví tạm ứng" tổng hợp — `q` khớp `patientCode`/`phone` (startsWith, `qRaw`) hoặc tên đã
   * bỏ dấu (`qNormalized`, cùng cơ chế PAT-02). */
  listWallets(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { qRaw?: string; qNormalized?: string; status?: PatientWalletStatus; cursor?: string; take: number },
  ): Promise<WalletListRow[]> {
    const where: Prisma.PatientWalletWhereInput = { tenantId, deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.qRaw) {
      where.patient = {
        OR: [
          { patientCode: { startsWith: params.qRaw, mode: 'insensitive' } },
          { phone: { startsWith: params.qRaw } },
          { searchKey: { contains: params.qNormalized } },
        ],
      };
    }
    return tx.patientWallet.findMany({
      where,
      include: { patient: { select: { patientCode: true, fullName: true, phone: true } } },
      orderBy: { id: 'desc' },
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }

  /** KPI trang "Ví tạm ứng" — tính trên TOÀN BỘ dữ liệu, không phụ thuộc bộ lọc/phân trang của `listWallets()`. */
  async getOverallStats(tx: Prisma.TransactionClient, tenantId: string, todayStartUtc: Date, todayEndUtc: Date): Promise<WalletOverallStats> {
    const [balanceAgg, activeWalletCount, toppedUpAgg, deductedAgg] = await Promise.all([
      tx.patientWallet.aggregate({ where: { tenantId, deletedAt: null, status: 'ACTIVE' }, _sum: { balance: true } }),
      tx.patientWallet.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } }),
      tx.walletTransaction.aggregate({
        where: { tenantId, deletedAt: null, type: 'TOPUP', createdAt: { gte: todayStartUtc, lt: todayEndUtc } },
        _sum: { amount: true },
      }),
      tx.walletTransaction.aggregate({
        where: { tenantId, deletedAt: null, type: 'DEDUCT', createdAt: { gte: todayStartUtc, lt: todayEndUtc } },
        _sum: { amount: true },
      }),
    ]);
    return {
      totalHeldBalance: balanceAgg._sum.balance ?? 0n,
      activeWalletCount,
      toppedUpToday: toppedUpAgg._sum.amount ?? 0n,
      deductedToday: deductedAgg._sum.amount ?? 0n,
    };
  }
}
