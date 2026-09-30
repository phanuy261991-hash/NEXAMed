import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
import { InvoiceRepository } from './invoice.repository';
import { InvoiceService, toInvoiceResponse } from './invoice.service';
import { PaymentRepository } from './payment.repository';

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

  async refundItems(tenantId: string, actorId: string, encounterId: string, dto: RefundInvoiceItemsRequest, meta: RequestMeta): Promise<InvoiceDto> {
    // Cùng khuôn `InvoiceService.refund()` — resolve ca/két TRƯỚC transaction chính (port tự mở
    // transaction đọc riêng, không lồng vào `tx` đang mở).
    const [cashierShiftId, drawerAccountId] = await Promise.all([
      this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId),
      this.cashierShiftReader.getCashAccountIdForActor(tenantId, actorId),
    ]);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByIdWithLines(tx, tenantId, dto.invoiceId);
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

      // ── Khoá phiên bản: hoàn đủ toàn bộ → REFUNDED, ngược lại vẫn PAID ──────────────────────────
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
      const fullyRefunded = Number(invoice.refundedTotal) + totalRefund >= dueAmount;
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
      for (const allocation of allocations) {
        const cashAccountId = await this.invoiceService.resolveCashAccountId(tx, tenantId, allocation.method, drawerAccountId);
        await this.paymentRepository.createRefund(
          tx,
          tenantId,
          actorId,
          invoice.id,
          allocation.method,
          BigInt(allocation.amount),
          refundedAt,
          dto.reason,
          cashierShiftId,
          cashAccountId,
          refundRow.id,
        );
        if (allocation.method === 'WALLET') {
          await this.walletService.creditBack(tx, tenantId, actorId, invoice.encounter.patient.id, BigInt(allocation.amount), invoice.id, `Hoàn tiền thuốc ${refundNo}`, meta);
        }
      }

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

      const updated = await this.invoiceRepository.findByIdWithLines(tx, tenantId, invoice.id);
      return toInvoiceResponse(updated!);
    });
  }
}
