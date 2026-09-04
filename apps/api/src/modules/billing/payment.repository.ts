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
    cashierShiftId: string | null = null,
  ): Promise<Payment> {
    return tx.payment.create({
      data: { tenantId, invoiceId, method, amount, paidAt, type: 'PAYMENT', cashierShiftId, createdBy: actorId, updatedBy: actorId },
    });
  }

  /**
   * #085 — dòng tiền TRẢ RA khi hoàn tiền, đối ứng dòng `create()` ở trên (đã thu). Là dòng SỐNG
   * (không soft-delete gì) — cùng tồn tại song song với dòng `PAYMENT` gốc để giữ đủ vết 2 chiều.
   * `method` mặc định lấy đúng phương thức đã thu (trả lại đúng kênh nhận vào), `reason` bắt buộc.
   */
  createRefund(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    invoiceId: string,
    method: string,
    amount: bigint,
    refundedAt: Date,
    reason: string,
    cashierShiftId: string | null = null,
  ): Promise<Payment> {
    return tx.payment.create({
      data: { tenantId, invoiceId, method, amount, paidAt: refundedAt, type: 'REFUND', reason, cashierShiftId, createdBy: actorId, updatedBy: actorId },
    });
  }

  /** "Đánh dấu chưa thu" (huỷ nhầm) — soft-delete dòng payment hiệu lực, `reason` bắt buộc (CLAUDE.md: không xoá cứng). */
  voidActive(tx: Prisma.TransactionClient, tenantId: string, invoiceId: string, actorId: string, reason: string): Promise<Prisma.BatchPayload> {
    return tx.payment.updateMany({
      where: { tenantId, invoiceId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId },
    });
  }

  /**
   * "Chốt ca" (2026-09-03) — mọi dòng thu/hoàn tiền (mọi hình thức, không riêng tiền mặt) trong
   * khoảng [startAt, endAt) — dùng cho `computeCashierShiftTotals()` ở `@nexamed/core`. Lọc theo
   * THỜI GIAN (`paidAt`), KHÔNG theo `createdBy` — v1 chỉ 1 két dùng chung, bất kỳ ai xử lý thu
   * ngân trong khung giờ ca đang mở đều tính vào ca đó (đúng bản chất tiền vào CÙNG 1 két vật lý).
   */
  listForWindow(tx: Prisma.TransactionClient, tenantId: string, startAt: Date, endAt: Date): Promise<Array<Pick<Payment, 'method' | 'type' | 'amount'>>> {
    return tx.payment.findMany({
      where: { tenantId, deletedAt: null, paidAt: { gte: startAt, lt: endAt } },
      select: { method: true, type: true, amount: true },
    });
  }

  /**
   * "Đa thu ngân" (2026-09-04) — mọi dòng thu/hoàn tiền gắn ĐÚNG `cashierShiftId` này (không lọc
   * theo thời gian nữa — có thể nhiều ca mở song song nên khoảng thời gian không phân biệt được ca
   * nào). Chỉ dùng khi `cashier_shift_multi_cashier_enabled=true`, xem `CashierShiftService.
   * computeTotals()`.
   */
  listForShift(tx: Prisma.TransactionClient, tenantId: string, cashierShiftId: string): Promise<Array<Pick<Payment, 'method' | 'type' | 'amount'>>> {
    return tx.payment.findMany({
      where: { tenantId, deletedAt: null, cashierShiftId },
      select: { method: true, type: true, amount: true },
    });
  }
}
