import { Injectable } from '@nestjs/common';
import type { EncounterServiceItem, EncounterStatus, Invoice, InvoiceLine, Payment, Prisma } from '@prisma/client';
import { computeInvoiceFromServiceItems, type ServiceItemForInvoice } from '@nexamed/core';
import type { ApplyInvoiceDiscountRequest } from '@nexamed/shared';
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
  /** Dòng ĐẦU TIÊN (đủ cho hiển thị đơn giản khi chỉ có 1 dòng — trường hợp phổ biến). */
  activePayment: { method: string; paidAt: Date } | null;
  /** MỌI dòng PAYMENT hiệu lực — thường 1 phần tử, 2 phần tử khi "trả hỗn hợp" (Ví tạm ứng: 1 dòng
   * `WALLET` + 1 dòng tiền mặt/CK). `refund()`/`revertPayment()` (invoice.service.ts) lặp qua mảng
   * này thay vì giả định đúng 1 dòng. */
  activePayments: { id: string; method: string; amount: bigint; paidAt: Date; cashAccountId: string | null }[];
  refundPayment: { paidAt: Date; reason: string | null } | null;
}

/** Kho Thuốc GĐ3 (#163) — mỗi dòng hoá đơn kèm theo `issueNo` của Phiếu xuất kho nguồn (chỉ có ý
 * nghĩa khi `sourceStockIssueLineId != null`), phục vụ nhóm hiển thị "Tiền thuốc — Phiếu xuất
 * PXK-...". `prescription` KHÔNG có mã hiển thị riêng (chỉ có `id`) nên không nhóm theo đơn thuốc
 * được — chỉ nhóm theo phiếu xuất, khác nhãn mockup ban đầu ("Đơn ... · Phiếu xuất ..."). */
interface InvoiceLineWithIssue extends InvoiceLine {
  sourceStockIssueLine: { issue: { issueNo: string } } | null;
}

export interface InvoiceWithLines extends Invoice, PaymentSides {
  lines: InvoiceLineWithIssue[];
  encounter: EncounterContext;
}

/** Tóm tắt hoá đơn KHÁC của CÙNG lượt khám — cho khối tham chiếu chéo khi 1 lượt khám có >1 hoá
 * đơn (hoá đơn khám đã đóng + hoá đơn thuốc riêng, Kho Thuốc GĐ3 #163). */
export interface OtherInvoiceRow {
  id: string;
  invoiceNo: string;
  invoiceType: Invoice['invoiceType'];
  status: Invoice['status'];
  totalAmount: bigint;
  discountType: Invoice['discountType'];
  discountValue: bigint | null;
  lines: LineDiscountFields[];
}

/** Field tối thiểu để tính `dueAmount` (chiết khấu "Từng dịch vụ") — không cần đủ `InvoiceLine`. */
interface LineDiscountFields {
  lineTotal: bigint;
  discountType: Invoice['discountType'];
  discountValue: bigint | null;
}

export interface BillingListRow extends PaymentSides {
  id: string;
  invoiceNo: string;
  invoiceType: Invoice['invoiceType'];
  status: Invoice['status'];
  totalAmount: bigint;
  discountType: Invoice['discountType'];
  discountValue: bigint | null;
  lines: LineDiscountFields[];
  printedAt: Date | null;
  encounter: EncounterContext;
}

/**
 * Lấy MỌI dòng payment còn hiệu lực (không `take: 1` như trước #085) — từ khi có hoàn tiền, một
 * phiếu có thể có đồng thời 1 dòng `PAYMENT` (tiền đã thu) và 1 dòng `REFUND` (tiền đã trả lại),
 * cả hai đều sống. Tách chiều ở `toPaymentSides()` bên dưới.
 */
const ACTIVE_PAYMENT_INCLUDE = {
  // Tie-break `createdAt asc` — trả hỗn hợp (Ví tạm ứng) tạo 2 dòng CÙNG `paidAt` (cùng 1 lệnh
  // `createMany`), cần thứ tự ổn định (dòng WALLET trước, dòng còn lại sau) để hiển thị nhất quán.
  payments: { where: { deletedAt: null }, orderBy: [{ paidAt: 'desc' as const }, { createdAt: 'asc' as const }] },
} satisfies Prisma.InvoiceInclude;

/** Chỉ đủ field tính `dueAmount` (chiết khấu "Từng dịch vụ") cho danh sách/tổng kết ngày — không
 * cần đủ `InvoiceLine` như `findByEncounterId()` (tránh tải dư dữ liệu cho N phiếu/ngày). */
const LINE_DISCOUNT_INCLUDE = {
  lines: { where: { deletedAt: null }, select: { lineTotal: true, discountType: true, discountValue: true } },
} satisfies Prisma.InvoiceInclude;

/** Kho Thuốc GĐ3 (#163) — dòng hoá đơn đầy đủ + `issueNo` của Phiếu xuất kho nguồn (chỉ có dữ liệu
 * khi dòng đó xuất phát từ Phiếu xuất, `sourceStockIssueLineId != null`). Dùng chung cho
 * `findByEncounterId()`/`findByIdWithLines()` — cả 2 nơi web cần nhóm 2 phần "Dịch vụ khám"/"Tiền
 * thuốc" trên CÙNG 1 hoá đơn (điểm 10, #163). */
const LINE_WITH_ISSUE_INCLUDE = {
  lines: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: { sourceStockIssueLine: { select: { issue: { select: { issueNo: true } } } } },
  },
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

function toPaymentSides(payments: Payment[]): PaymentSides {
  const paymentRows = payments.filter((p) => p.type === 'PAYMENT');
  const refund = payments.find((p) => p.type === 'REFUND') ?? null;
  return {
    activePayment: paymentRows[0] ? { method: paymentRows[0].method, paidAt: paymentRows[0].paidAt } : null,
    activePayments: paymentRows.map((p) => ({ id: p.id, method: p.method, amount: p.amount, paidAt: p.paidAt, cashAccountId: p.cashAccountId })),
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

  /** Hoá đơn DỊCH VỤ KHÁM của lượt khám — lọc tường minh `invoiceType='SERVICE'` (Kho Thuốc GĐ3,
   * #163: nay `encounterId` có thể ứng nhiều hoá đơn khi có thêm hoá đơn `DRUG` riêng). Đây vẫn là
   * hoá đơn MẶC ĐỊNH mà `GET /billing/invoices/:encounterId` trả về khi không truyền `invoiceId` —
   * đúng hành vi cũ, không phá vỡ mọi nơi gọi hiện có. */
  findByEncounterId(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<InvoiceWithLines | null> {
    return tx.invoice
      .findFirst({
        where: { tenantId, encounterId, invoiceType: 'SERVICE', deletedAt: null },
        include: { ...LINE_WITH_ISSUE_INCLUDE, ...ENCOUNTER_CONTEXT_INCLUDE, ...ACTIVE_PAYMENT_INCLUDE },
      })
      .then((row) => (row ? { ...row, ...toPaymentSides(row.payments) } : null));
  }

  /** Kho Thuốc GĐ3 (#163, mở rộng #165) — hoá đơn CỤ THỂ theo `id`, bất kể loại (SERVICE/DRUG) —
   * dùng khi web truyền `?invoiceId=` (xem hoá đơn thuốc riêng, hoặc đúng ý bấm từ "Danh sách Thu
   * ngân"). Không lọc `invoiceType` — service tự kiểm `encounterId` khớp trước khi trả về. */
  findByIdWithLines(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<InvoiceWithLines | null> {
    return tx.invoice
      .findFirst({
        where: { tenantId, id, deletedAt: null },
        include: { ...LINE_WITH_ISSUE_INCLUDE, ...ENCOUNTER_CONTEXT_INCLUDE, ...ACTIVE_PAYMENT_INCLUDE },
      })
      .then((row) => (row ? { ...row, ...toPaymentSides(row.payments) } : null));
  }

  /** Kho Thuốc GĐ3 (#165) — tóm tắt mọi hoá đơn KHÁC của CÙNG lượt khám (không phải `excludeId`) —
   * khối tham chiếu chéo khi 1 lượt khám có >1 hoá đơn (hoá đơn khám đã đóng + hoá đơn thuốc riêng). */
  findOtherInvoicesSummary(tx: Prisma.TransactionClient, tenantId: string, encounterId: string, excludeId: string): Promise<OtherInvoiceRow[]> {
    return tx.invoice.findMany({
      where: { tenantId, encounterId, id: { not: excludeId }, deletedAt: null },
      select: {
        id: true,
        invoiceNo: true,
        invoiceType: true,
        status: true,
        totalAmount: true,
        discountType: true,
        discountValue: true,
        lines: { where: { deletedAt: null }, select: { lineTotal: true, discountType: true, discountValue: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Kho Thuốc GĐ3 (#163) — hoá đơn `DRUG` `UNPAID` GẦN NHẤT của lượt khám (khách quay lại lấy nốt
   * thuốc trong đơn, hoá đơn thuốc trước đó chưa thu thì cộng tiếp vào đó thay vì tạo mới). */
  findOpenDrugInvoiceForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<Invoice | null> {
    return tx.invoice.findFirst({
      where: { tenantId, encounterId, invoiceType: 'DRUG', status: 'UNPAID', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Kho Thuốc GĐ3 (#163) — hoá đơn `id` bất kỳ (SERVICE hoặc DRUG), dùng cho `StockIssueService`
   * đọc lại `totalAmount`/`version` hiện tại trước khi cộng dòng hoặc huỷ phiếu xuất. */
  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Invoice | null> {
    return tx.invoice.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Kho Thuốc GĐ3 (#163) — hoá đơn ĐANG CHỨA (ít nhất 1 trong) các dòng của một phiếu xuất, dùng
   * lúc huỷ phiếu xuất để biết hoá đơn liên quan còn `UNPAID` hay đã thu (chặn huỷ nếu đã thu). Mọi
   * dòng của CÙNG 1 phiếu xuất luôn nằm trên ĐÚNG 1 hoá đơn (append cùng lúc trong `create()`), nên
   * `findFirst` là đủ, không cần gộp nhiều hoá đơn. */
  async findByStockIssueLineIds(tx: Prisma.TransactionClient, tenantId: string, stockIssueLineIds: string[]): Promise<Invoice | null> {
    if (stockIssueLineIds.length === 0) return null;
    const line = await tx.invoiceLine.findFirst({
      where: { tenantId, sourceStockIssueLineId: { in: stockIssueLineIds }, deletedAt: null },
      include: { invoice: true },
    });
    return line?.invoice ?? null;
  }

  /** Kho Thuốc GĐ3 (#163) — tạo hoá đơn `DRUG` mới (mirror `createFromServiceItems`, nhưng KHÔNG
   * cần `computeInvoiceFromServiceItems` — dòng đã tính sẵn ở `StockIssueService`). */
  async createDrugInvoice(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    encounterId: string,
    lines: { sourceStockIssueLineId: string; examTypeCode: string; examTypeName: string; unitPrice: bigint; quantity: number; lineTotal: bigint }[],
  ): Promise<Invoice> {
    const totalAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0n);
    const invoiceNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'INVOICE', new Date());
    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        encounterId,
        invoiceNo,
        invoiceType: 'DRUG',
        totalAmount,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await tx.invoiceLine.createMany({
      data: lines.map((line) => ({
        tenantId,
        invoiceId: invoice.id,
        sourceStockIssueLineId: line.sourceStockIssueLineId,
        examTypeCode: line.examTypeCode,
        examTypeName: line.examTypeName,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
    return invoice;
  }

  /**
   * Kho Thuốc GĐ3 (#163) — cộng THÊM dòng vào hoá đơn ĐANG UNPAID (SERVICE đang mở hoặc DRUG đang
   * mở), cập nhật lại `totalAmount`. `WHERE version=? AND status='UNPAID'` chống race 2 phiếu xuất
   * cộng vào cùng 1 hoá đơn gần như đồng thời — trả `0` thì Service tự đọc lại/thử lại (hiếm, cùng
   * mức chấp nhận rủi ro với `StockReceiptService` GĐ2).
   */
  async appendLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
    expectedVersion: number,
    actorId: string,
    lines: { sourceStockIssueLineId: string; examTypeCode: string; examTypeName: string; unitPrice: bigint; quantity: number; lineTotal: bigint }[],
  ): Promise<number> {
    const additionalAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0n);
    const result = await tx.invoice.updateMany({
      where: { tenantId, id: invoiceId, version: expectedVersion, status: 'UNPAID', deletedAt: null },
      data: { totalAmount: { increment: additionalAmount }, updatedBy: actorId, version: { increment: 1 } },
    });
    if (result.count === 0) {
      return 0;
    }
    await tx.invoiceLine.createMany({
      data: lines.map((line) => ({
        tenantId,
        invoiceId,
        sourceStockIssueLineId: line.sourceStockIssueLineId,
        examTypeCode: line.examTypeCode,
        examTypeName: line.examTypeName,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
    return result.count;
  }

  /** Kho Thuốc GĐ3 (#163) — huỷ phiếu xuất: xoá (soft) ĐÚNG các dòng invoice_line do CHÍNH phiếu đó
   * sinh ra (`stockIssueLineIds` — không xoá lan sang dòng của phiếu xuất KHÁC cộng chung 1 hoá đơn
   * SERVICE, ví dụ 2 lượt phát thuốc khác nhau trong cùng ngày) + trừ lại `totalAmount`. Gọi khi đã
   * biết chắc hoá đơn còn `UNPAID` (Service đã kiểm). */
  async removeStockIssueLines(tx: Prisma.TransactionClient, tenantId: string, invoiceId: string, stockIssueLineIds: string[], actorId: string, removedAmount: bigint): Promise<void> {
    await tx.invoiceLine.updateMany({
      where: { tenantId, invoiceId, sourceStockIssueLineId: { in: stockIssueLineIds }, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'stock_issue_voided', updatedBy: actorId },
    });
    await tx.invoice.updateMany({
      where: { tenantId, id: invoiceId, deletedAt: null },
      data: { totalAmount: { decrement: removedAmount }, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /** BIL-04 — theo `encounter.checkedInAt` trong biên ngày (giờ Việt Nam, `vietnamDayRange()` ở service). */
  listForDay(tx: Prisma.TransactionClient, tenantId: string, dayStart: Date, dayEnd: Date): Promise<BillingListRow[]> {
    return tx.invoice
      .findMany({
        where: { tenantId, deletedAt: null, encounter: { checkedInAt: { gte: dayStart, lt: dayEnd } } },
        include: { ...ENCOUNTER_CONTEXT_INCLUDE, ...ACTIVE_PAYMENT_INCLUDE, ...LINE_DISCOUNT_INCLUDE },
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

  /**
   * Chiết khấu (chốt qua `AskUserQuestion`) — `WHERE version=? AND status='UNPAID'` (đúng khuôn
   * `saveDraft`, chỉ sửa được khi phiếu chưa thu). 2 cách "Toàn hoá đơn"/"Từng dịch vụ" loại trừ
   * lẫn nhau — LUÔN xoá sạch phía không dùng ở cả invoice lẫn MỌI dòng, tránh dữ liệu chiết khấu cũ
   * còn sót lại từ lần áp trước theo cách khác (ví dụ đổi từ PER_LINE sang TOTAL).
   */
  async applyDiscount(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, dto: ApplyInvoiceDiscountRequest): Promise<number> {
    const invoiceDiscount =
      dto.mode === 'TOTAL' ? { discountType: dto.discountType, discountValue: BigInt(dto.discountValue) } : { discountType: null, discountValue: null };

    const count = await tx.invoice
      .updateMany({
        where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'UNPAID' },
        data: { ...invoiceDiscount, discountReason: dto.reason, updatedBy: actorId, version: { increment: 1 } },
      })
      .then((r) => r.count);
    if (count === 0) {
      return 0;
    }

    // Luôn xoá sạch chiết khấu MỌI dòng trước — mode NONE/TOTAL không dùng dòng nào; mode PER_LINE
    // xoá rồi set lại đúng những dòng client gửi (dòng không gửi hoặc discountType=null giữ null).
    await tx.invoiceLine.updateMany({
      where: { tenantId, invoiceId: id, deletedAt: null },
      data: { discountType: null, discountValue: null, updatedBy: actorId, version: { increment: 1 } },
    });

    if (dto.mode === 'PER_LINE') {
      // Phòng vệ: `discountValue` vẫn nullable ở schema kể cả khi `discountType` đã chọn (client có
      // thể gửi dòng "đang chọn kiểu nhưng chưa gõ số" — trạng thái dở dang, không phải lỗi input).
      // Coi dòng đó như KHÔNG chiết khấu (giữ `discountType: null` đã xoá sạch ở trên) thay vì
      // `BigInt(null)` — ném `TypeError` không bắt được, sập 500 (bug thật gặp lúc kiểm tay).
      for (const line of dto.lines) {
        if (line.discountType === null || line.discountValue === null) continue;
        await tx.invoiceLine.updateMany({
          where: { tenantId, invoiceId: id, id: line.lineId, deletedAt: null },
          data: { discountType: line.discountType, discountValue: BigInt(line.discountValue), updatedBy: actorId, version: { increment: 1 } },
        });
      }
    }

    return count;
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
