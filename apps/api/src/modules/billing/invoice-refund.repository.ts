import { Injectable } from '@nestjs/common';
import type { InvoiceRefund, InvoiceRefundLine, Prisma } from '@prisma/client';

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `invoice_refund`/`invoice_refund_line` (hoàn tiền MỘT PHẦN theo dòng
 * thuốc, docs/DECISIONS.md #203) — module `billing` sở hữu. Lịch sử hoàn được ĐỌC cùng hoá đơn qua
 * `InvoiceRepository` (include `refunds`), file này chỉ GHI.
 */
@Injectable()
export class InvoiceRefundRepository {
  create(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { invoiceId: string; refundNo: string; reason: string; refundedAt: Date; totalAmount: bigint },
  ): Promise<InvoiceRefund> {
    return tx.invoiceRefund.create({
      data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId },
    });
  }

  createLine(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { refundId: string; invoiceLineId: string; quantity: number; amount: bigint; restocked: boolean; stockReceiptId: string | null },
  ): Promise<InvoiceRefundLine> {
    return tx.invoiceRefundLine.create({
      data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId },
    });
  }
}
