import { Injectable } from '@nestjs/common';
import type { EncounterServiceItem, Invoice, InvoiceLine, Prisma } from '@prisma/client';
import { computeInvoiceFromServiceItems, formatDisplayCode, type ServiceItemForInvoice } from '@nexamed/core';
import { INVOICE_NO_PREFIX } from '@nexamed/shared';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';

interface EncounterContext {
  id: string;
  encounterNo: string;
  checkedInAt: Date;
  departmentId: string;
  department: { name: string };
  patient: { id: string; patientCode: string; fullName: string };
}

export interface InvoiceWithLines extends Invoice {
  lines: InvoiceLine[];
  encounter: EncounterContext;
  activePayment: { method: string; paidAt: Date } | null;
}

export interface BillingListRow {
  id: string;
  invoiceNo: string;
  status: Invoice['status'];
  totalAmount: bigint;
  printedAt: Date | null;
  encounter: EncounterContext;
  activePayment: { method: string; paidAt: Date } | null;
}

const ACTIVE_PAYMENT_INCLUDE = {
  payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' as const }, take: 1 },
} satisfies Prisma.InvoiceInclude;

/** Bối cảnh lượt khám/bệnh nhân — dùng chung cho cả chi tiết 1 phiếu thu lẫn danh sách trong ngày. */
const ENCOUNTER_CONTEXT_INCLUDE = {
  encounter: {
    select: {
      id: true,
      encounterNo: true,
      checkedInAt: true,
      departmentId: true,
      department: { select: { name: true } },
      patient: { select: { id: true, patientCode: true, fullName: true } },
    },
  },
} satisfies Prisma.InvoiceInclude;

function toActivePayment(payments: { method: string; paidAt: Date }[]): { method: string; paidAt: Date } | null {
  return payments[0] ?? null;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `invoice`/`invoice_line` (Thu ngân cơ bản, Sprint 5/6,
 * BIL-01→04) — module `billing` sở hữu. Export qua `BillingModule` để `ReceptionModule` dùng
 * chung trong CÙNG transaction check-in/tiếp nhận trực tiếp (đúng "chia sẻ Repository giữa module
 * trong 1 transaction", `docs/DECISIONS.md` #042).
 */
@Injectable()
export class InvoiceRepository {
  constructor(private readonly codeSequenceRepository: CodeSequenceRepository) {}

  /**
   * Tạo phiếu thu (BIL-01) từ danh sách `encounter_service_item` VỪA tạo trong CÙNG transaction —
   * chỉ tính dòng có giá (`docs/DECISIONS.md` #080, xem `computeInvoiceFromServiceItems`). Trả
   * `null` (KHÔNG tạo gì) nếu không có dòng nào có giá — không có gì để thu, không cần phiếu thu.
   */
  async createFromServiceItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    encounterId: string,
    serviceItems: EncounterServiceItem[],
  ): Promise<Invoice | null> {
    const items: ServiceItemForInvoice[] = serviceItems.map((item) => ({
      id: item.id,
      examTypeCode: item.examTypeCode,
      examTypeName: item.examTypeName,
      priceTypeCode: item.priceTypeCode,
      unitCode: item.unitCode,
      unitPrice: item.examTypePrice !== null ? Number(item.examTypePrice) : null,
      quantity: item.quantity,
    }));
    const computed = computeInvoiceFromServiceItems(items);
    if (computed.totalAmount === 0) {
      return null;
    }

    const seq = await this.codeSequenceRepository.next(tx, tenantId, INVOICE_NO_PREFIX, actorId);
    const invoiceNo = formatDisplayCode(INVOICE_NO_PREFIX, new Date(), seq);

    // 2 lệnh riêng (không nested `create`) — cùng khuôn `EncounterServiceItemRepository.createMany()`:
    // nested write qua quan hệ composite FK (tenant_id, x_id) không nhận field scalar `tenantId`
    // tường minh trong input "checked" mà Prisma sinh cho nested create, chỉ createMany top-level
    // (Unchecked input) mới nhận đủ.
    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        encounterId,
        invoiceNo,
        totalAmount: BigInt(computed.totalAmount),
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await tx.invoiceLine.createMany({
      data: computed.lines.map((line) => ({
        tenantId,
        invoiceId: invoice.id,
        sourceServiceItemId: line.sourceServiceItemId,
        examTypeCode: line.examTypeCode,
        examTypeName: line.examTypeName,
        priceTypeCode: line.priceTypeCode,
        unitCode: line.unitCode,
        unitPrice: BigInt(line.unitPrice),
        quantity: line.quantity,
        lineTotal: BigInt(line.lineTotal),
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
    return invoice;
  }

  findByEncounterId(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<InvoiceWithLines | null> {
    return tx.invoice
      .findFirst({
        where: { tenantId, encounterId, deletedAt: null },
        include: {
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
          ...ENCOUNTER_CONTEXT_INCLUDE,
          ...ACTIVE_PAYMENT_INCLUDE,
        },
      })
      .then((row) => (row ? { ...row, activePayment: toActivePayment(row.payments) } : null));
  }

  /** BIL-04 — theo `encounter.checkedInAt` trong biên ngày (giờ Việt Nam, `vietnamDayRange()` ở service). */
  listForDay(tx: Prisma.TransactionClient, tenantId: string, dayStart: Date, dayEnd: Date): Promise<BillingListRow[]> {
    return tx.invoice
      .findMany({
        where: { tenantId, deletedAt: null, encounter: { checkedInAt: { gte: dayStart, lt: dayEnd } } },
        include: { ...ENCOUNTER_CONTEXT_INCLUDE, ...ACTIVE_PAYMENT_INCLUDE },
        orderBy: { encounter: { checkedInAt: 'asc' } },
      })
      .then((rows) => rows.map((row) => ({ ...row, activePayment: toActivePayment(row.payments) })));
  }

  /** `WHERE version=? AND status='UNPAID'` — chống double-submit/race khi 2 request "Thu tiền" gần như đồng thời. */
  markPaid(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    return tx.invoice
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'UNPAID' },
        data: {
          status: 'PAID',
          pendingPaymentMethod: null,
          pendingCashReceivedAmount: null,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      })
      .then((r) => r.count);
  }

  /** "Đánh dấu chưa thu" (huỷ nhầm) — `WHERE version=? AND status='PAID'`. */
  revertPayment(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    return tx.invoice
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'PAID' },
        data: { status: 'UNPAID', updatedBy: actorId, version: { increment: 1 } },
      })
      .then((r) => r.count);
  }

  /** "Lưu tạm" (F8) — chỉ khi còn `UNPAID` (đã thu thì không còn gì để lưu tạm). */
  saveDraft(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    pendingPaymentMethod: string | null,
    pendingCashReceivedAmount: number | null,
  ): Promise<number> {
    return tx.invoice
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'UNPAID' },
        data: {
          pendingPaymentMethod,
          pendingCashReceivedAmount: pendingCashReceivedAmount !== null ? BigInt(pendingCashReceivedAmount) : null,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      })
      .then((r) => r.count);
  }

  /** Idempotent — chỉ set lần đầu (`WHERE printed_at IS NULL`), cùng khuôn `PrescriptionRepository.markPrintedIfNotYet()`. */
  markPrintedIfNotYet(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string): Promise<number> {
    return tx.invoice
      .updateMany({
        where: { tenantId, id, deletedAt: null, printedAt: null },
        data: { printedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
      })
      .then((r) => r.count);
  }
}
