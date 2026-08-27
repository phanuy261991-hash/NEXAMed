import { Injectable } from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `payment` (Thu ngân cơ bản, Sprint 5/6) — lịch sử thu tiền của
 * 1 phiếu thu, v1 luôn tối đa 1 dòng HIỆU LỰC/invoice (đủ cho BIL-03 "đã thu/chưa thu" nhị phân).
 */
@Injectable()
export class PaymentRepository {
  create(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    invoiceId: string,
    method: string,
    amount: bigint,
    paidAt: Date,
  ): Promise<Payment> {
    return tx.payment.create({
      data: { tenantId, invoiceId, method, amount, paidAt, createdBy: actorId, updatedBy: actorId },
    });
  }

  /** "Đánh dấu chưa thu" (huỷ nhầm) — soft-delete dòng payment hiệu lực, `reason` bắt buộc (CLAUDE.md: không xoá cứng). */
  voidActive(tx: Prisma.TransactionClient, tenantId: string, invoiceId: string, actorId: string, reason: string): Promise<Prisma.BatchPayload> {
    return tx.payment.updateMany({
      where: { tenantId, invoiceId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId },
    });
  }
}
