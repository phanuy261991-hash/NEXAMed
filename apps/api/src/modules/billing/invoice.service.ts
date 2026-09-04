import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  canRefundInvoice,
  CASHIER_SHIFT_READER_PORT,
  computeDailyBillingTotals,
  ConcurrentModificationError,
  getVietnamDateString,
  InvoiceAlreadyPaidError,
  InvoiceClosedError,
  InvoiceNotPaidError,
  InvoiceNotRefundableError,
  isInvoiceClosed,
  needsRefund as computeNeedsRefund,
  vietnamDayRange,
  type CashierShiftReaderPort,
} from '@nexamed/core';
import type {
  Invoice as InvoiceDto,
  ListBillingInvoicesResponse,
  MarkInvoicePaidRequest,
  RefundInvoiceRequest,
  RevertInvoicePaymentRequest,
  SaveInvoiceDraftRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { InvoiceRepository, type BillingListRow, type InvoiceWithLines } from './invoice.repository';
import { PaymentRepository } from './payment.repository';

function toInvoiceResponse(row: InvoiceWithLines): InvoiceDto {
  const encounterCancelled = row.encounter.status === 'CANCELLED';
  return {
    id: row.id,
    encounterId: row.encounterId,
    invoiceNo: row.invoiceNo,
    status: row.status,
    totalAmount: Number(row.totalAmount),
    encounterNo: row.encounter.encounterNo,
    checkedInAt: row.encounter.checkedInAt.toISOString(),
    encounterVersion: row.encounter.version,
    patientId: row.encounter.patient.id,
    patientCode: row.encounter.patient.patientCode,
    fullName: row.encounter.patient.fullName,
    departmentName: row.encounter.department.name,
    lines: row.lines.map((line) => ({
      id: line.id,
      examTypeCode: line.examTypeCode,
      examTypeName: line.examTypeName,
      priceTypeCode: line.priceTypeCode,
      unitCode: line.unitCode,
      unitPrice: Number(line.unitPrice),
      quantity: line.quantity,
      lineTotal: Number(line.lineTotal),
    })),
    printedAt: row.printedAt?.toISOString() ?? null,
    pendingPaymentMethod: row.pendingPaymentMethod,
    pendingCashReceivedAmount: row.pendingCashReceivedAmount !== null ? Number(row.pendingCashReceivedAmount) : null,
    paymentMethod: row.activePayment?.method ?? null,
    paidAt: row.activePayment?.paidAt.toISOString() ?? null,
    // #085 — cảnh báo hoàn tiền + vết hoàn tiền, xem `needsRefund()`/`invoice-lifecycle.ts` ở `@nexamed/core`.
    encounterCancelled,
    needsRefund: computeNeedsRefund({ invoiceStatus: row.status, encounterCancelled }),
    refundedAt: row.refundPayment?.paidAt.toISOString() ?? null,
    refundReason: row.refundPayment?.reason ?? null,
    version: row.version,
  };
}

/**
 * Điều phối use case Thu ngân cơ bản (Sprint 5/6, BIL-01→04) — phiếu thu tự động tạo lúc tiếp
 * nhận (`ReceptionService`, dùng chung `InvoiceRepository` — không đi qua service này, đúng "chia
 * sẻ Repository giữa module trong 1 transaction"). Service này chỉ phục vụ các thao tác SAU khi
 * phiếu thu đã tồn tại: xem/đánh dấu đã thu/huỷ đánh dấu/lưu tạm/in — không có `create()`.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly paymentRepository: PaymentRepository,
    @Inject(CASHIER_SHIFT_READER_PORT) private readonly cashierShiftReader: CashierShiftReaderPort,
  ) {}

  async getByEncounterId(tenantId: string, encounterId: string): Promise<InvoiceDto | null> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId));
    return row ? toInvoiceResponse(row) : null;
  }

  async listForDay(tenantId: string, date?: string): Promise<ListBillingInvoicesResponse> {
    const targetDate = date ?? getVietnamDateString();
    const dayRange = vietnamDayRange(targetDate);
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.invoiceRepository.listForDay(tx, tenantId, dayRange.startUtc, dayRange.endUtc));

    // #085 — nguồn tính duy nhất `computeDailyBillingTotals()` ở `@nexamed/core`, không cộng tay ở
    // đây nữa (giữ đúng quy ước "REFUNDED vẫn tính vào paidTotalAmount rồi trừ ra ở netTotalAmount").
    const totals = computeDailyBillingTotals(rows.map((row) => ({ status: row.status, totalAmount: Number(row.totalAmount) })));

    return {
      items: rows.map((row) => this.toBillingListItem(row)),
      ...totals,
    };
  }

  private toBillingListItem(row: BillingListRow): ListBillingInvoicesResponse['items'][number] {
    const encounterCancelled = row.encounter.status === 'CANCELLED';
    return {
      invoiceId: row.id,
      invoiceNo: row.invoiceNo,
      encounterId: row.encounter.id,
      encounterNo: row.encounter.encounterNo,
      checkedInAt: row.encounter.checkedInAt.toISOString(),
      patientId: row.encounter.patient.id,
      patientCode: row.encounter.patient.patientCode,
      fullName: row.encounter.patient.fullName,
      departmentId: row.encounter.departmentId,
      departmentName: row.encounter.department.name,
      totalAmount: Number(row.totalAmount),
      status: row.status,
      paymentMethod: row.activePayment?.method ?? null,
      paidAt: row.activePayment?.paidAt.toISOString() ?? null,
      needsRefund: computeNeedsRefund({ invoiceStatus: row.status, encounterCancelled }),
    };
  }

  /** "Thu tiền" (BIL-03) — đánh dấu "Đã thu" + ghi nhận phương thức. */
  async markPaid(tenantId: string, actorId: string, encounterId: string, dto: MarkInvoicePaidRequest, meta: RequestMeta): Promise<InvoiceDto> {
    // "Đa thu ngân" (2026-09-04) — resolve TRƯỚC transaction chính (port tự mở transaction đọc
    // riêng, không lồng `runInTenantScope`, đúng khuôn mọi port đọc khác trong dự án). `null` khi
    // không có ca nào đang mở — KHÔNG chặn thu tiền, độc lập với "Yêu cầu mở ca trước khi thu tiền".
    const cashierShiftId = await this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (!invoice) {
        throw new NotFoundException();
      }

      const paidAt = new Date();
      const count = await this.invoiceRepository.markPaid(tx, tenantId, invoice.id, dto.version, actorId);
      if (count === 0) {
        const recheck = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
        if (recheck?.status === 'PAID') {
          throw new InvoiceAlreadyPaidError();
        }
        // #085 — phiếu CANCELLED (lượt khám bị huỷ khi chưa thu) hoặc REFUNDED (đã hoàn) không còn
        // thu được nữa — khác lệch `version` thường (đó mới là ConcurrentModificationError).
        if (recheck && isInvoiceClosed(recheck.status)) {
          throw new InvoiceClosedError();
        }
        throw new ConcurrentModificationError();
      }
      await this.paymentRepository.create(tx, tenantId, actorId, invoice.id, dto.method, invoice.totalAmount, paidAt, cashierShiftId);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'invoice.paid',
        entityType: 'invoice',
        entityId: invoice.id,
        afterJson: { method: dto.method, amount: invoice.totalAmount.toString() },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      return toInvoiceResponse(updated!);
    });
  }

  /** "Đánh dấu chưa thu" (huỷ nhầm) — lý do bắt buộc, ghi audit trước/sau. */
  async revertPayment(tenantId: string, actorId: string, encounterId: string, dto: RevertInvoicePaymentRequest, meta: RequestMeta): Promise<InvoiceDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (!invoice) {
        throw new NotFoundException();
      }

      const count = await this.invoiceRepository.revertPayment(tx, tenantId, invoice.id, dto.version, actorId);
      if (count === 0) {
        const recheck = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
        if (recheck?.status === 'UNPAID') {
          throw new InvoiceNotPaidError();
        }
        // #085 — REFUNDED (đã hoàn tiền thật) không "đánh dấu chưa thu" lại được: đó là sửa thao
        // tác BẤM NHẦM, không phải cách đảo ngược một khoản đã hoàn — phải xử lý qua sổ sách khác.
        if (recheck && isInvoiceClosed(recheck.status)) {
          throw new InvoiceClosedError();
        }
        throw new ConcurrentModificationError();
      }
      await this.paymentRepository.voidActive(tx, tenantId, invoice.id, actorId, dto.reason);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'invoice.payment_reverted',
        entityType: 'invoice',
        entityId: invoice.id,
        beforeJson: { status: 'PAID' },
        afterJson: { status: 'UNPAID', reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      return toInvoiceResponse(updated!);
    });
  }

  /**
   * #085 — "Hoàn tiền" thật cho lượt khám đã huỷ, quyền riêng `invoice.refund`. KHÁC hẳn
   * `revertPayment()` ở trên: đây là tiền đã vào két nay trả ra — tạo dòng `payment` type `REFUND`
   * ĐỐI ỨNG dòng đã thu (không xoá/sửa dòng cũ), giữ đủ vết 2 chiều để đối soát két cuối ngày.
   * Chỉ hoàn TOÀN PHẦN ở v1 — số tiền lấy đúng `invoice.totalAmount` đã thu, không nhận từ client.
   */
  async refund(tenantId: string, actorId: string, encounterId: string, dto: RefundInvoiceRequest, meta: RequestMeta): Promise<InvoiceDto> {
    // "Đa thu ngân" — xem comment ở markPaid() phía trên.
    const cashierShiftId = await this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (!invoice) {
        throw new NotFoundException();
      }
      const encounterCancelled = invoice.encounter.status === 'CANCELLED';
      if (!canRefundInvoice({ invoiceStatus: invoice.status, encounterCancelled })) {
        // Chặn ĐỒNG THỜI 2 điều kiện: phiếu phải đang PAID (chưa hoàn lần nào) VÀ lượt khám phải
        // đã thực sự bị huỷ — tránh hoàn nhầm cho ca vẫn đang khám bình thường.
        throw new InvoiceNotRefundableError();
      }

      const refundedAt = new Date();
      const count = await this.invoiceRepository.markRefunded(tx, tenantId, invoice.id, dto.version, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      // `activePayment` chắc chắn tồn tại ở đây — `canRefundInvoice` đã xác nhận `status='PAID'`,
      // mà phiếu PAID luôn có đúng 1 dòng payment type PAYMENT hiệu lực (xem markPaid()).
      await this.paymentRepository.createRefund(
        tx,
        tenantId,
        actorId,
        invoice.id,
        invoice.activePayment!.method,
        invoice.totalAmount,
        refundedAt,
        dto.reason,
        cashierShiftId,
      );

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'invoice.refunded',
        entityType: 'invoice',
        entityId: invoice.id,
        beforeJson: { status: 'PAID' },
        afterJson: { status: 'REFUNDED', amount: invoice.totalAmount.toString(), reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      return toInvoiceResponse(updated!);
    });
  }

  /** "Lưu tạm" (F8) — lễ tân đang nhập dở phương thức/tiền khách đưa, chưa "Thu tiền". */
  async saveDraft(tenantId: string, actorId: string, encounterId: string, dto: SaveInvoiceDraftRequest, meta: RequestMeta): Promise<InvoiceDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (!invoice) {
        throw new NotFoundException();
      }
      const count = await this.invoiceRepository.saveDraft(
        tx,
        tenantId,
        invoice.id,
        dto.version,
        actorId,
        dto.pendingPaymentMethod,
        dto.pendingCashReceivedAmount,
      );
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'invoice.draft_saved',
        entityType: 'invoice',
        entityId: invoice.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const updated = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      return toInvoiceResponse(updated!);
    });
  }

  /** In phiếu thu (BIL-02, dùng chung hạ tầng in với PRE-04) — idempotent, ghi audit lần in. */
  async markPrinted(tenantId: string, actorId: string, encounterId: string, meta: RequestMeta): Promise<InvoiceDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (!invoice) {
        throw new NotFoundException();
      }
      await this.invoiceRepository.markPrintedIfNotYet(tx, tenantId, invoice.id, actorId);
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'invoice.printed',
        entityType: 'invoice',
        entityId: invoice.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const updated = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      return toInvoiceResponse(updated!);
    });
  }
}
