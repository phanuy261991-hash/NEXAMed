import { Injectable, NotFoundException } from '@nestjs/common';
import { ConcurrentModificationError, getVietnamDateString, vietnamDayRange, InvoiceAlreadyPaidError, InvoiceNotPaidError } from '@nexamed/core';
import type {
  Invoice as InvoiceDto,
  ListBillingInvoicesResponse,
  MarkInvoicePaidRequest,
  RevertInvoicePaymentRequest,
  SaveInvoiceDraftRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { InvoiceRepository, type BillingListRow, type InvoiceWithLines } from './invoice.repository';
import { PaymentRepository } from './payment.repository';

function toInvoiceResponse(row: InvoiceWithLines): InvoiceDto {
  return {
    id: row.id,
    encounterId: row.encounterId,
    invoiceNo: row.invoiceNo,
    status: row.status,
    totalAmount: Number(row.totalAmount),
    encounterNo: row.encounter.encounterNo,
    checkedInAt: row.encounter.checkedInAt.toISOString(),
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
  ) {}

  async getByEncounterId(tenantId: string, encounterId: string): Promise<InvoiceDto | null> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId));
    return row ? toInvoiceResponse(row) : null;
  }

  async listForDay(tenantId: string, date?: string): Promise<ListBillingInvoicesResponse> {
    const targetDate = date ?? getVietnamDateString();
    const dayRange = vietnamDayRange(targetDate);
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.invoiceRepository.listForDay(tx, tenantId, dayRange.startUtc, dayRange.endUtc));

    let paidCount = 0;
    let paidTotalAmount = 0;
    let unpaidCount = 0;
    let unpaidTotalAmount = 0;
    for (const row of rows) {
      const amount = Number(row.totalAmount);
      if (row.status === 'PAID') {
        paidCount += 1;
        paidTotalAmount += amount;
      } else {
        unpaidCount += 1;
        unpaidTotalAmount += amount;
      }
    }

    return {
      items: rows.map((row) => this.toBillingListItem(row)),
      paidCount,
      paidTotalAmount,
      unpaidCount,
      unpaidTotalAmount,
    };
  }

  private toBillingListItem(row: BillingListRow): ListBillingInvoicesResponse['items'][number] {
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
    };
  }

  /** "Thu tiền" (BIL-03) — đánh dấu "Đã thu" + ghi nhận phương thức. */
  async markPaid(tenantId: string, actorId: string, encounterId: string, dto: MarkInvoicePaidRequest, meta: RequestMeta): Promise<InvoiceDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (!invoice) {
        throw new NotFoundException();
      }

      const paidAt = new Date();
      const count = await this.invoiceRepository.markPaid(tx, tenantId, invoice.id, dto.version, actorId);
      if (count === 0) {
        const recheck = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
        if (recheck && recheck.status === 'PAID') {
          throw new InvoiceAlreadyPaidError();
        }
        throw new ConcurrentModificationError();
      }
      await this.paymentRepository.create(tx, tenantId, actorId, invoice.id, dto.method, invoice.totalAmount, paidAt);

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
        if (recheck && recheck.status === 'UNPAID') {
          throw new InvoiceNotPaidError();
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
