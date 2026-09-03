import { Injectable } from '@nestjs/common';
import type { EncounterServiceItem, EncounterStatus, Invoice, InvoiceLine, PaymentType, Prisma } from '@prisma/client';
import { computeInvoiceFromServiceItems, type ServiceItemForInvoice } from '@nexamed/core';
import { BusinessCodeService } from '../clinic/business-code.service';

interface EncounterContext {
  id: string;
  encounterNo: string;
  checkedInAt: Date;
  departmentId: string;
  /** #085 — nguồn cho `encounterCancelled`/`needsRefund` (cảnh báo "Cần hoàn tiền"). */
  status: EncounterStatus;
  /** #085 — version RIÊNG của `encounter` (khác `version` của `Invoice`) — cần cho web gọi thẳng
   * `POST /encounters/:id/cancel` ("Khách bỏ về/Huỷ lượt khám") ngay từ màn Chi tiết thanh toán. */
  version: number;
  department: { name: string };
  patient: { id: string; patientCode: string; fullName: string };
}

/** #085 — dòng `payment` hiệu lực tách theo chiều tiền: thu vào (`PAYMENT`) và trả ra (`REFUND`). */
interface PaymentSides {
  activePayment: { method: string; paidAt: Date } | null;
  refundPayment: { paidAt: Date; reason: string | null } | null;
}

export interface InvoiceWithLines extends Invoice, PaymentSides {
  lines: InvoiceLine[];
  encounter: EncounterContext;
}

export interface BillingListRow extends PaymentSides {
  id: string;
  invoiceNo: string;
  status: Invoice['status'];
  totalAmount: bigint;
  printedAt: Date | null;
  encounter: EncounterContext;
}

/**
 * Lấy MỌI dòng payment còn hiệu lực (không `take: 1` như trước #085) — từ khi có hoàn tiền, một
 * phiếu có thể có đồng thời 1 dòng `PAYMENT` (tiền đã thu) và 1 dòng `REFUND` (tiền đã trả lại),
 * cả hai đều sống. Tách chiều ở `toPaymentSides()` bên dưới.
 */
const ACTIVE_PAYMENT_INCLUDE = {
  payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' as const } },
} satisfies Prisma.InvoiceInclude;

/** Bối cảnh lượt khám/bệnh nhân — dùng chung cho cả chi tiết 1 phiếu thu lẫn danh sách trong ngày. */
const ENCOUNTER_CONTEXT_INCLUDE = {
  encounter: {
    select: {
      id: true,
      encounterNo: true,
      checkedInAt: true,
      departmentId: true,
      status: true,
      version: true,
      department: { select: { name: true } },
      patient: { select: { id: true, patientCode: true, fullName: true } },
    },
  },
} satisfies Prisma.InvoiceInclude;

function toPaymentSides(payments: { method: string; paidAt: Date; type: PaymentType; reason: string | null }[]): PaymentSides {
  const payment = payments.find((p) => p.type === 'PAYMENT') ?? null;
  const refund = payments.find((p) => p.type === 'REFUND') ?? null;
  return {
    activePayment: payment ? { method: payment.method, paidAt: payment.paidAt } : null,
    refundPayment: refund ? { paidAt: refund.paidAt, reason: refund.reason } : null,
  };
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `invoice`/`invoice_line` (Thu ngân cơ bản, Sprint 5/6,
 * BIL-01→04) — module `billing` sở hữu. Export qua `BillingModule` để `ReceptionModule` dùng
 * chung trong CÙNG transaction check-in/tiếp nhận trực tiếp (đúng "chia sẻ Repository giữa module
 * trong 1 transaction", `docs/DECISIONS.md` #042).
 */
@Injectable()
export class InvoiceRepository {
  constructor(private readonly businessCodeService: BusinessCodeService) {}

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

    const invoiceNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'INVOICE', new Date());

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
      .then((row) => (row ? { ...row, ...toPaymentSides(row.payments) } : null));
  }

  /** BIL-04 — theo `encounter.checkedInAt` trong biên ngày (giờ Việt Nam, `vietnamDayRange()` ở service). */
  listForDay(tx: Prisma.TransactionClient, tenantId: string, dayStart: Date, dayEnd: Date): Promise<BillingListRow[]> {
    return tx.invoice
      .findMany({
        where: { tenantId, deletedAt: null, encounter: { checkedInAt: { gte: dayStart, lt: dayEnd } } },
        include: { ...ENCOUNTER_CONTEXT_INCLUDE, ...ACTIVE_PAYMENT_INCLUDE },
        orderBy: { encounter: { checkedInAt: 'asc' } },
      })
      .then((rows) => rows.map((row) => ({ ...row, ...toPaymentSides(row.payments) })));
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

  /**
   * #085 — đóng phiếu thu CHƯA THU khi lượt khám bị huỷ. `WHERE status='UNPAID'` (KHÔNG kèm
   * `version`): gọi từ `EncounterService.cancelEncounter()` trong cùng transaction — actor ở đó
   * cầm version của `encounter`, không phải của `invoice`, và đã có optimistic lock trên chính
   * `encounter` rồi nên không cần khoá lần hai. Trả `count=0` là bình thường (phiếu đã PAID → chờ
   * hoàn tiền riêng, hoặc lượt khám không có phiếu thu nào), KHÔNG phải lỗi.
   *
   * Lý do huỷ KHÔNG lưu lại trên `invoice`: phiếu thu bị huỷ LUÔN vì lượt khám bị huỷ (không có
   * đường huỷ phiếu độc lập), nên `encounter.cancel_reason` đã là nguồn sự thật — thêm cột ở đây
   * chỉ nhân bản dữ liệu. Service ghi `audit_log` riêng cho vết thao tác.
   */
  cancelUnpaidForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, actorId: string): Promise<number> {
    return tx.invoice
      .updateMany({
        where: { tenantId, encounterId, deletedAt: null, status: 'UNPAID' },
        data: {
          status: 'CANCELLED',
          // Dọn luôn "Lưu tạm" đang treo — phiếu đã đóng sổ thì phương thức/tiền khách đưa nhập dở
          // không còn ý nghĩa, để lại chỉ gây nhiễu khi tra cứu lại.
          pendingPaymentMethod: null,
          pendingCashReceivedAmount: null,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      })
      .then((r) => r.count);
  }

  /**
   * #085 — đánh dấu đã hoàn tiền xong. `WHERE version=? AND status='PAID'` — có optimistic lock
   * thật vì đây là thao tác do người dùng chủ động bấm trên màn Thu ngân (khác
   * `cancelUnpaidForEncounter` ở trên đi kèm transaction huỷ lượt khám).
   */
  markRefunded(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    return tx.invoice
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'PAID' },
        data: { status: 'REFUNDED', updatedBy: actorId, version: { increment: 1 } },
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
