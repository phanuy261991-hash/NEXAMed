import { Injectable } from '@nestjs/common';
import type { CashVoucher, Prisma } from '@prisma/client';

export interface CreateCashVoucherData {
  voucherNo: string;
  direction: 'EXPENSE' | 'INCOME';
  incomeExpenseTypeCode: string;
  cashAccountId: string;
  paymentMethodCode: string;
  amount: bigint;
  occurredAt: Date;
  partnerName?: string | null;
  description: string;
  note?: string | null;
  status: 'POSTED' | 'PENDING_APPROVAL';
  cashierShiftId: string | null;
}

export interface UpdateCashVoucherData {
  incomeExpenseTypeCode?: string;
  cashAccountId?: string;
  paymentMethodCode?: string;
  amount?: bigint;
  occurredAt?: Date;
  partnerName?: string | null;
  description?: string;
  note?: string | null;
}

export interface ListCashVouchersFilter {
  from?: Date;
  to?: Date;
  direction?: 'EXPENSE' | 'INCOME';
  status?: 'POSTED' | 'PENDING_APPROVAL' | 'REJECTED';
  cashierShiftId?: string;
}

/** 1 dòng đủ để nạp vào `computeCashierShiftTotals()` (@nexamed/core) — xem `CashierShiftService`. */
export interface CashVoucherCashierShiftRow {
  paymentMethodCode: string;
  direction: 'EXPENSE' | 'INCOME';
  amount: bigint;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `cash_voucher` — theo .claude/docs/coding-standards.md. */
@Injectable()
export class CashVoucherRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateCashVoucherData): Promise<CashVoucher> {
    return tx.cashVoucher.create({
      data: {
        tenantId,
        voucherNo: data.voucherNo,
        direction: data.direction,
        incomeExpenseTypeCode: data.incomeExpenseTypeCode,
        cashAccountId: data.cashAccountId,
        paymentMethodCode: data.paymentMethodCode,
        amount: data.amount,
        occurredAt: data.occurredAt,
        partnerName: data.partnerName ?? null,
        description: data.description,
        note: data.note ?? null,
        status: data.status,
        cashierShiftId: data.cashierShiftId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /** Dùng cho các đường EDIT (sửa/huỷ/duyệt/từ chối/in) — phiếu đã huỷ (soft-delete) trả `null`,
   * chặn thao tác lặp lại trên phiếu đã huỷ (đúng khuôn mọi repository khác trong dự án). */
  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<CashVoucher | null> {
    return tx.cashVoucher.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Dùng cho đường XEM (GET chi tiết) — KHÔNG lọc `deletedAt`, phiếu đã huỷ vẫn xem được (chỉ
   * đọc), tránh "biến mất" khó hiểu. Web tự ẩn mọi nút thao tác khi `voided=true`. */
  findByIdAny(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<CashVoucher | null> {
    return tx.cashVoucher.findFirst({ where: { tenantId, id } });
  }

  /** Danh sách — cùng lý do `findByIdAny`, KHÔNG lọc `deletedAt` để phiếu đã huỷ vẫn hiện (kèm badge). */
  list(tx: Prisma.TransactionClient, tenantId: string, filter: ListCashVouchersFilter): Promise<CashVoucher[]> {
    return tx.cashVoucher.findMany({
      where: {
        tenantId,
        occurredAt: { gte: filter.from, lte: filter.to },
        direction: filter.direction,
        status: filter.status,
        cashierShiftId: filter.cashierShiftId,
      },
      orderBy: { occurredAt: 'desc' },
    });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateCashVoucherData,
  ): Promise<number> {
    const result = await tx.cashVoucher.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** "Huỷ phiếu" — soft-delete, lý do bắt buộc (CLAUDE.md: không xoá cứng). `status` giữ nguyên
   * (KHÔNG thêm giá trị VOIDED) — mọi truy vấn khác đã lọc `deletedAt: null` nên tự loại trừ. */
  async voidById(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reason: string): Promise<number> {
    const result = await tx.cashVoucher.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Duyệt — chỉ áp dụng đúng phiếu đang `PENDING_APPROVAL` (điều kiện `WHERE` chặn race 2 người
   * duyệt/từ chối cùng lúc, cùng kỹ thuật `InvoiceRepository.markPaid()`). */
  async approve(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.cashVoucher.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'PENDING_APPROVAL' },
      data: { status: 'POSTED', approvedBy: actorId, approvedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async reject(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reason: string): Promise<number> {
    const result = await tx.cashVoucher.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED', rejectionReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  markPrintedIfNotYet(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string): Promise<Prisma.BatchPayload> {
    return tx.cashVoucher.updateMany({ where: { tenantId, id, printedAt: null }, data: { printedAt: new Date(), updatedBy: actorId } });
  }

  /**
   * "Chốt ca" — mọi phiếu ĐÃ DUYỆT (`status='POSTED'`) trong khoảng [startAt, endAt), lọc theo
   * `createdAt` (thời điểm tiền THẬT SỰ đổi tay) — KHÔNG phải `occurredAt` (ngày phát sinh do
   * người dùng tự khai, có thể lùi ngày để ghi sổ trễ, không phản ánh đúng lúc tiền rời/vào két).
   * Cùng khuôn `PaymentRepository.listForWindow()`.
   */
  listPostedForWindow(tx: Prisma.TransactionClient, tenantId: string, startAt: Date, endAt: Date): Promise<CashVoucherCashierShiftRow[]> {
    return tx.cashVoucher.findMany({
      where: { tenantId, deletedAt: null, status: 'POSTED', createdAt: { gte: startAt, lt: endAt } },
      select: { paymentMethodCode: true, direction: true, amount: true },
    });
  }

  /** "Đa thu ngân" — mọi phiếu ĐÃ DUYỆT gắn ĐÚNG ca này, cùng khuôn `PaymentRepository.listForShift()`. */
  listPostedForShift(tx: Prisma.TransactionClient, tenantId: string, cashierShiftId: string): Promise<CashVoucherCashierShiftRow[]> {
    return tx.cashVoucher.findMany({
      where: { tenantId, deletedAt: null, status: 'POSTED', cashierShiftId },
      select: { paymentMethodCode: true, direction: true, amount: true },
    });
  }
}
