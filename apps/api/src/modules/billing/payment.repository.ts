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
    cashAccountId: string | null = null,
  ): Promise<Payment> {
    return tx.payment.create({
      data: { tenantId, invoiceId, method, amount, paidAt, type: 'PAYMENT', cashierShiftId, cashAccountId, createdBy: actorId, updatedBy: actorId },
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
    cashAccountId: string | null = null,
  ): Promise<Payment> {
    return tx.payment.create({
      data: { tenantId, invoiceId, method, amount, paidAt: refundedAt, type: 'REFUND', reason, cashierShiftId, cashAccountId, createdBy: actorId, updatedBy: actorId },
    });
  }

  /**
   * Ví tạm ứng — tạo NHIỀU dòng Payment cho CÙNG 1 lần thu (ví dụ 1 dòng `WALLET` + 1 dòng tiền
   * mặt/CK khi trả hỗn hợp), cùng `paidAt`/`cashierShiftId`. Vẫn dùng `create()` (số ít) cho luồng
   * bình thường 1 phương thức — không đổi hành vi cũ. Mỗi dòng tự có `cashAccountId` riêng (`WALLET`
   * luôn `null` — không phải tiền mặt vào két).
   */
  async createMany(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    invoiceId: string,
    rows: { method: string; amount: bigint; cashAccountId: string | null }[],
    paidAt: Date,
    cashierShiftId: string | null = null,
  ): Promise<void> {
    await tx.payment.createMany({
      data: rows.map((r) => ({
        tenantId,
        invoiceId,
        method: r.method,
        amount: r.amount,
        paidAt,
        type: 'PAYMENT' as const,
        cashierShiftId,
        cashAccountId: r.cashAccountId,
        createdBy: actorId,
        updatedBy: actorId,
      })),
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

  /**
   * "Sổ quỹ" (GĐ2) — mọi dòng thu/hoàn tiền khám ĐÃ GẮN quỹ `cashAccountId` này
   * (`payment.cashAccountId`, chỉ có giá trị từ GĐ1 trở đi — dòng cũ hơn NULL, tự loại khỏi kết
   * quả, đúng thiết kế "không backfill"). Sắp CŨ→MỚI, cùng lý do `CashVoucherRepository.
   * listForAccountLedger()`.
   */
  listForCashAccount(tx: Prisma.TransactionClient, tenantId: string, cashAccountId: string, from?: Date, to?: Date) {
    return tx.payment.findMany({
      where: { tenantId, deletedAt: null, cashAccountId, paidAt: { gte: from, lte: to } },
      select: { id: true, type: true, amount: true, paidAt: true, createdAt: true, invoice: { select: { invoiceNo: true } } },
      orderBy: { paidAt: 'asc' },
    });
  }

  /**
   * "Báo cáo dòng tiền" (GĐ2) — mọi dòng thu/hoàn tiền khám (MỌI quỹ) trong khoảng [from, to] —
   * dùng để gộp bucket "Thu tiền khám"/"Hoàn tiền khám" (`byType`) và phân bổ theo quỹ (`byAccount`).
   */
  listForReport(tx: Prisma.TransactionClient, tenantId: string, from: Date, to: Date) {
    return tx.payment.findMany({
      where: { tenantId, deletedAt: null, paidAt: { gte: from, lte: to } },
      select: { type: true, amount: true, cashAccountId: true },
    });
  }

  /** Tổng luỹ kế TRƯỚC mốc `before` cho quỹ `cashAccountId` — dùng tính "Số dư đầu kỳ" của Sổ quỹ
   * khi có `from`, cùng lý do `CashVoucherRepository.sumBeforeForAccount()`. */
  async sumBeforeForCashAccount(tx: Prisma.TransactionClient, tenantId: string, cashAccountId: string, before: Date): Promise<{ paymentAmount: bigint; refundAmount: bigint }> {
    const rows = await tx.payment.findMany({
      where: { tenantId, deletedAt: null, cashAccountId, paidAt: { lt: before } },
      select: { type: true, amount: true },
    });
    let paymentAmount = 0n;
    let refundAmount = 0n;
    for (const row of rows) {
      if (row.type === 'PAYMENT') paymentAmount += row.amount;
      else refundAmount += row.amount;
    }
    return { paymentAmount, refundAmount };
  }
}
