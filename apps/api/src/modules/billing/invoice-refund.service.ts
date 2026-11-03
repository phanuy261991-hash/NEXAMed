import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  allocateInvoiceDueToLines,
  allocateRefundAcrossPayments,
  CASHIER_SHIFT_READER_PORT,
  computeInvoiceDiscount,
  computeLineRefundAmount,
  ConcurrentModificationError,
  InvoiceClosedError,
  InvoiceLineNotRefundableError,
  InvoiceNotRefundableError,
  InvoiceRefundQuantityExceededError,
  InvoiceRefundZeroAmountError,
  isInvoiceClosed,
  type CashierShiftReaderPort,
} from '@nexamed/core';
import type { Invoice as InvoiceDto, RefundInvoiceItemsRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { StockReceiptService } from '../inventory/stock-receipt.service';
import { PatientWalletService } from '../patient-wallet/patient-wallet.service';
import { InvoiceRefundRepository } from './invoice-refund.repository';
import { InvoiceRepository, type InvoiceWithLines } from './invoice.repository';
import { InvoiceService, toInvoiceResponse } from './invoice.service';
import { PaymentRepository } from './payment.repository';

/** Ngữ cảnh tiền của người đang thao tác — lấy TRƯỚC transaction (xem `resolveRefundContext`). */
export interface RefundContext {
  tenantId: string;
  branchId: string;
  actorId: string;
  cashierShiftId: string | null;
  drawerAccountId: string | null;
  paymentMethods: Awaited<ReturnType<InvoiceService['listPaymentMethods']>>;
}

/**
 * Hoàn tiền MỘT PHẦN theo từng dòng thuốc (docs/DECISIONS.md #203) — khách trả lại thuốc, lượt khám
 * vẫn bình thường. Quyền riêng `invoice.refund_drug` (ở controller). Toàn bộ trong 1 transaction:
 * dòng `payment` REFUND + phiếu hoàn `invoice_refund` + (nếu chọn) phiếu nhập kho `RETURN_FROM_USE` +
 * tiền trả ngược ví; hoặc tất cả cùng thành công, hoặc không gì được ghi.
 *
 * Khác `InvoiceService.refund()` (hoàn TOÀN PHẦN khi huỷ lượt khám, #085): số tiền hoàn KHÔNG nhận từ
 * client — tự tính từ số lượng × phần tiền thật (đã chia chiết khấu) của dòng.
 */
@Injectable()
export class InvoiceRefundService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly invoiceRefundRepository: InvoiceRefundRepository,
    private readonly invoiceService: InvoiceService,
    private readonly walletService: PatientWalletService,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(forwardRef(() => StockReceiptService)) private readonly stockReceiptService: StockReceiptService,
    @Inject(CASHIER_SHIFT_READER_PORT) private readonly cashierShiftReader: CashierShiftReaderPort,
  ) {}

  async refundItems(tenantId: string, branchId: string, actorId: string, encounterId: string, dto: RefundInvoiceItemsRequest, meta: RequestMeta): Promise<InvoiceDto> {
    // Cùng khuôn `InvoiceService.refund()` — resolve ca/két TRƯỚC transaction chính (port tự mở
    // transaction đọc riêng, không lồng vào `tx` đang mở).
    const { cashierShiftId, drawerAccountId, paymentMethods } = await this.resolveRefundContext(tenantId, branchId, actorId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // Xếp hàng các lần hoàn cùng một hoá đơn TRƯỚC khi đọc — xem docstring `lockForRefund`.
      await this.invoiceRepository.lockForRefund(tx, tenantId, dto.invoiceId);
      const invoice = await this.invoiceRepository.findByIdWithLines(tx, tenantId, branchId, dto.invoiceId);
      // Phải thuộc đúng lượt khám trên URL — không lộ hoá đơn của lượt khám/tenant khác (404).
      if (!invoice || invoice.encounterId !== encounterId) {
        throw new NotFoundException();
      }
      if (isInvoiceClosed(invoice.status)) {
        throw new InvoiceClosedError();
      }
      if (invoice.status !== 'PAID') {
        throw new InvoiceNotRefundableError();
      }
      // Phiên bản cũ → 409 ngay, TRƯỚC các kiểm tra số lượng/số tiền: request đến sau một lần hoàn khác luôn nhận cùng một mã lỗi (CONCURRENT_MODIFICATION),
      // không lúc 409 lúc 422 tuỳ thời điểm đọc. An toàn tiền vẫn do `WHERE version=?` ở bước ghi bên dưới bảo đảm.
      if (invoice.version !== dto.version) {
        throw new ConcurrentModificationError();
      }

      // ── Tiền hoàn từng dòng ──────────────────────────────────────────────────────────────────
      const lineNets = allocateInvoiceDueToLines({
        totalAmount: Number(invoice.totalAmount),
        discountType: invoice.discountType,
        discountValue: invoice.discountValue !== null ? Number(invoice.discountValue) : null,
        lines: invoice.lines.map((l) => ({
          lineTotal: Number(l.lineTotal),
          discountType: l.discountType,
          discountValue: l.discountValue !== null ? Number(l.discountValue) : null,
        })),
      });
      const alreadyRefundedQty = new Map<string, number>();
      for (const refund of invoice.refunds) {
        for (const rl of refund.lines) {
          alreadyRefundedQty.set(rl.invoiceLineId, (alreadyRefundedQty.get(rl.invoiceLineId) ?? 0) + rl.quantity);
        }
      }

      const planned: { invoiceLineId: string; quantity: number; amount: number; restock: boolean; stockIssueLineId: string }[] = [];
      for (const requested of dto.lines) {
        const index = invoice.lines.findIndex((l) => l.id === requested.invoiceLineId);
        const line = invoice.lines[index];
        // Dòng dịch vụ khám (không có phiếu xuất nguồn) hoặc dòng của hoá đơn khác → không hoàn được.
        if (!line || line.sourceStockIssueLineId === null) {
          throw new InvoiceLineNotRefundableError();
        }
        const already = alreadyRefundedQty.get(line.id) ?? 0;
        if (already + requested.quantity > line.quantity) {
          throw new InvoiceRefundQuantityExceededError();
        }
        const amount = computeLineRefundAmount(lineNets[index] ?? 0, line.quantity, already, requested.quantity);
        planned.push({
          invoiceLineId: line.id,
          quantity: requested.quantity,
          amount,
          restock: requested.restock,
          stockIssueLineId: line.sourceStockIssueLineId,
        });
      }
      const totalRefund = planned.reduce((sum, p) => sum + p.amount, 0);
      if (totalRefund <= 0) {
        throw new InvoiceRefundZeroAmountError();
      }

      // ── Chia về phương thức đã thu: VÍ trước, phần dư ra tiền mặt/CK ────────────────────────────
      const allocations = this.allocateAcrossPayments(invoice, totalRefund);

      // ── Khoá phiên bản: hoàn đủ toàn bộ → REFUNDED, ngược lại vẫn PAID ──────────────────────────
      const fullyRefunded = this.isFullyRefunded(invoice, totalRefund);
      const versionCount = fullyRefunded
        ? await this.invoiceRepository.markRefunded(tx, tenantId, invoice.id, dto.version, actorId)
        : await this.invoiceRepository.touchForPartialRefund(tx, tenantId, invoice.id, dto.version, actorId);
      if (versionCount === 0) {
        throw new ConcurrentModificationError();
      }

      // ── Phiếu hoàn + phiếu nhập lại kho ─────────────────────────────────────────────────────────
      const refundedAt = new Date();
      const refundNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'INVOICE_REFUND', refundedAt);
      const refundRow = await this.invoiceRefundRepository.create(tx, tenantId, actorId, {
        invoiceId: invoice.id,
        refundNo,
        reason: dto.reason,
        refundedAt,
        totalAmount: BigInt(totalRefund),
      });

      const restockLines = planned.filter((p) => p.restock);
      const receiptByIssueLine =
        restockLines.length > 0
          ? await this.stockReceiptService.createReturnFromUseReceipts(tx, tenantId, actorId, {
              occurredAt: refundedAt,
              refundNo,
              lines: restockLines.map((p) => ({ stockIssueLineId: p.stockIssueLineId, quantity: p.quantity })),
            })
          : new Map<string, string>();

      for (const p of planned) {
        await this.invoiceRefundRepository.createLine(tx, tenantId, actorId, {
          refundId: refundRow.id,
          invoiceLineId: p.invoiceLineId,
          quantity: p.quantity,
          amount: BigInt(p.amount),
          restocked: p.restock,
          stockReceiptId: p.restock ? (receiptByIssueLine.get(p.stockIssueLineId) ?? null) : null,
        });
      }

      // ── Dòng payment REFUND (gom theo `refundId`) + trả ngược ví ──────────────────────────────
      await this.writeRefundPayments(
        tx,
        { tenantId, branchId, actorId, cashierShiftId, drawerAccountId, paymentMethods },
        invoice,
        allocations,
        refundRow.id,
        refundedAt,
        dto.reason,
        `Hoàn tiền thuốc ${refundNo}`,
        meta,
      );

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'invoice.partial_refunded',
        entityType: 'invoice_refund',
        entityId: refundRow.id,
        beforeJson: { status: 'PAID' },
        afterJson: {
          invoiceId: invoice.id,
          refundNo,
          amount: String(totalRefund),
          reason: dto.reason,
          fullyRefunded,
          lines: planned.map((p) => ({ invoiceLineId: p.invoiceLineId, quantity: p.quantity, amount: p.amount, restocked: p.restock })),
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.invoiceRepository.findByIdWithLines(tx, tenantId, branchId, invoice.id);
      return toInvoiceResponse(updated!);
    });
  }

  /**
   * Ca thu ngân + két + danh mục phương thức thanh toán của người đang thao tác — các port này tự mở transaction đọc riêng nên PHẢI gọi TRƯỚC khi mở transaction chính
   * (CLAUDE.md "Một request = MỘT transaction", #264). Tách ra để luồng "Khách không làm dịch vụ" (#280, ở module clinical-order) lấy một lần rồi truyền vào bên trong.
   */
  async resolveRefundContext(tenantId: string, branchId: string, actorId: string): Promise<RefundContext> {
    const [cashierShiftId, drawerAccountId, paymentMethods] = await Promise.all([
      this.cashierShiftReader.getRelevantOpenShiftId(tenantId, branchId, actorId),
      this.cashierShiftReader.getCashAccountIdForActor(tenantId, branchId, actorId),
      this.invoiceService.listPaymentMethods(tenantId),
    ]);
    return { tenantId, branchId, actorId, cashierShiftId, drawerAccountId, paymentMethods };
  }

  /**
   * "Khách không làm dịch vụ" (docs/DECISIONS.md #280), nhánh phiếu ĐÃ THU: hoàn tiền các dòng DỊCH VỤ theo đúng khuôn #203 nhưng KHÔNG nhập lại kho (dịch vụ không có hàng).
   * Chạy trong transaction của NƠI GỌI (`tx`) — việc đặt dòng chỉ định sang CANCELLED và hoàn tiền phải là một khối nguyên tử. Nơi gọi đã khoá phiếu (`lockForRefund`), đọc
   * `invoice` và kiểm phiên bản; hàm này chỉ ghi. Số tiền KHÔNG nhận từ client: nơi gọi tính từ phần tiền thật (đã chia chiết khấu) còn lại của dòng.
   */
  async refundServiceLinesInTx(
    tx: Prisma.TransactionClient,
    ctx: RefundContext,
    invoice: InvoiceWithLines,
    lines: { invoiceLineId: string; quantity: number; amount: number }[],
    reason: string,
    meta: RequestMeta,
  ): Promise<{ refundId: string; refundNo: string; totalRefund: number; fullyRefunded: boolean }> {
    const totalRefund = lines.reduce((sum, l) => sum + l.amount, 0);
    if (totalRefund <= 0) {
      throw new InvoiceRefundZeroAmountError();
    }
    const allocations = this.allocateAcrossPayments(invoice, totalRefund);
    const fullyRefunded = this.isFullyRefunded(invoice, totalRefund);
    const versionCount = fullyRefunded
      ? await this.invoiceRepository.markRefunded(tx, ctx.tenantId, invoice.id, invoice.version, ctx.actorId)
      : await this.invoiceRepository.touchForPartialRefund(tx, ctx.tenantId, invoice.id, invoice.version, ctx.actorId);
    if (versionCount === 0) {
      throw new ConcurrentModificationError();
    }

    const refundedAt = new Date();
    const refundNo = await this.businessCodeService.generate(tx, ctx.tenantId, ctx.actorId, 'INVOICE_REFUND', refundedAt);
    const refundRow = await this.invoiceRefundRepository.create(tx, ctx.tenantId, ctx.actorId, {
      invoiceId: invoice.id,
      refundNo,
      reason,
      refundedAt,
      totalAmount: BigInt(totalRefund),
    });
    for (const l of lines) {
      await this.invoiceRefundRepository.createLine(tx, ctx.tenantId, ctx.actorId, {
        refundId: refundRow.id,
        invoiceLineId: l.invoiceLineId,
        quantity: l.quantity,
        amount: BigInt(l.amount),
        restocked: false,
        stockReceiptId: null,
      });
    }
    await this.writeRefundPayments(tx, ctx, invoice, allocations, refundRow.id, refundedAt, reason, `Hoàn tiền dịch vụ khách không làm ${refundNo}`, meta);

    await writeAuditLog(tx, ctx.tenantId, {
      actorId: ctx.actorId,
      action: 'invoice.service_declined_refunded',
      entityType: 'invoice_refund',
      entityId: refundRow.id,
      beforeJson: { status: invoice.status },
      afterJson: {
        invoiceId: invoice.id,
        refundNo,
        amount: String(totalRefund),
        reason,
        fullyRefunded,
        lines: lines.map((l) => ({ invoiceLineId: l.invoiceLineId, quantity: l.quantity, amount: l.amount })),
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { refundId: refundRow.id, refundNo, totalRefund, fullyRefunded };
  }

  /**
   * Chia số tiền hoàn về ĐÚNG phương thức đã thu: ví trước, phần dư ra tiền mặt/chuyển khoản; còn lại của một phương thức = tổng đã thu − tổng đã hoàn qua nó. Thiếu → 422
   * (hoàn nhiều hơn số đã thu). Dùng chung cho hoàn thuốc (#203) và hoàn dịch vụ khách không làm (#280).
   */
  allocateAcrossPayments(invoice: InvoiceWithLines, totalRefund: number): { method: string; amount: number }[] {
    const remainingByMethod = new Map<string, bigint>();
    for (const p of invoice.activePayments) {
      remainingByMethod.set(p.method, (remainingByMethod.get(p.method) ?? 0n) + p.amount);
    }
    for (const r of invoice.refundRows) {
      remainingByMethod.set(r.method, (remainingByMethod.get(r.method) ?? 0n) - r.amount);
    }
    const { allocations, shortfall } = allocateRefundAcrossPayments(
      totalRefund,
      [...remainingByMethod.entries()].map(([method, remaining]) => ({ method, remaining: Number(remaining) })),
    );
    if (shortfall > 0) {
      throw new InvoiceRefundQuantityExceededError();
    }
    return allocations;
  }

  /** Hoàn đủ toàn bộ số đã thu (sau chiết khấu) → phiếu chuyển REFUNDED; chưa đủ → vẫn PAID. */
  isFullyRefunded(invoice: InvoiceWithLines, totalRefund: number): boolean {
    const dueAmount = computeInvoiceDiscount({
      totalAmount: Number(invoice.totalAmount),
      discountType: invoice.discountType,
      discountValue: invoice.discountValue !== null ? Number(invoice.discountValue) : null,
      lines: invoice.lines.map((l) => ({
        lineTotal: Number(l.lineTotal),
        discountType: l.discountType,
        discountValue: l.discountValue !== null ? Number(l.discountValue) : null,
      })),
    }).dueAmount;
    return Number(invoice.refundedTotal) + totalRefund >= dueAmount;
  }

  /** Ghi dòng `payment` REFUND theo từng phương thức (gom theo `refundId`) + trả ngược ví khi phương thức là WALLET. */
  private async writeRefundPayments(
    tx: Prisma.TransactionClient,
    ctx: RefundContext,
    invoice: InvoiceWithLines,
    allocations: { method: string; amount: number }[],
    refundId: string,
    refundedAt: Date,
    reason: string,
    walletNote: string,
    meta: RequestMeta,
  ): Promise<void> {
    for (const allocation of allocations) {
      const cashAccountId = await this.invoiceService.resolveCashAccountId(tx, ctx.tenantId, ctx.branchId, allocation.method, ctx.drawerAccountId, ctx.paymentMethods);
      await this.paymentRepository.createRefund(
        tx,
        ctx.tenantId,
        ctx.actorId,
        invoice.id,
        allocation.method,
        BigInt(allocation.amount),
        refundedAt,
        reason,
        ctx.cashierShiftId,
        cashAccountId,
        refundId,
      );
      if (allocation.method === 'WALLET') {
        await this.walletService.creditBack(tx, ctx.tenantId, ctx.actorId, invoice.encounter.patient.id, BigInt(allocation.amount), invoice.id, walletNote, meta);
      }
    }
  }
}
