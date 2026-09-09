import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  canRefundInvoice,
  CASHIER_SHIFT_READER_PORT,
  CLINIC_CONFIG_READER_PORT,
  computeDailyBillingTotals,
  computeDiscountAmount,
  computeInvoiceDiscount,
  ConcurrentModificationError,
  getVietnamDateString,
  InvoiceAlreadyPaidError,
  InvoiceClosedError,
  InvoiceDiscountNotAllowedError,
  InvoiceNotPaidError,
  InvoiceNotRefundableError,
  isInvoiceClosed,
  needsRefund as computeNeedsRefund,
  REFERENCE_CATALOG_READER_PORT,
  vietnamDayRange,
  WalletInsufficientBalanceError,
  type CashierShiftReaderPort,
  type ClinicConfigReaderPort,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import type {
  ApplyInvoiceDiscountRequest,
  Invoice as InvoiceDto,
  ListBillingInvoicesResponse,
  MarkInvoicePaidRequest,
  PayInvoiceWithWalletRequest,
  RefundInvoiceRequest,
  RevertInvoicePaymentRequest,
  SaveInvoiceDraftRequest,
  TopUpAndPayInvoiceWithWalletRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { InvoiceRepository, type BillingListRow, type InvoiceWithLines } from './invoice.repository';
import { PaymentRepository } from './payment.repository';
import { CashAccountRepository } from '../cash-book/cash-account.repository';
import { PatientWalletService } from '../patient-wallet/patient-wallet.service';

/**
 * Nguồn tính `dueAmount` (số tiền THẬT phải thu/đã thu) DUY NHẤT cho cả DTO trả về lẫn mọi thao tác
 * tiền bạc bên dưới (`markPaid`/`payWithWalletCore`/tổng kết ngày) — xem `computeInvoiceDiscount()`
 * ở `@nexamed/core`. KHÔNG đọc thẳng `row.totalAmount` làm số tiền phải thu ở bất kỳ đâu khác.
 */
function computeDue(row: { totalAmount: bigint; discountType: 'PERCENT' | 'AMOUNT' | null; discountValue: bigint | null; lines: { lineTotal: bigint; discountType: 'PERCENT' | 'AMOUNT' | null; discountValue: bigint | null }[] }) {
  return computeInvoiceDiscount({
    totalAmount: Number(row.totalAmount),
    discountType: row.discountType,
    discountValue: row.discountValue !== null ? Number(row.discountValue) : null,
    lines: row.lines.map((l) => ({
      lineTotal: Number(l.lineTotal),
      discountType: l.discountType,
      discountValue: l.discountValue !== null ? Number(l.discountValue) : null,
    })),
  });
}

function toInvoiceResponse(row: InvoiceWithLines): InvoiceDto {
  const encounterCancelled = row.encounter.status === 'CANCELLED';
  const discount = computeDue(row);
  return {
    id: row.id,
    encounterId: row.encounterId,
    invoiceNo: row.invoiceNo,
    status: row.status,
    totalAmount: Number(row.totalAmount),
    discountMode: discount.mode,
    discountType: row.discountType,
    discountValue: row.discountValue !== null ? Number(row.discountValue) : null,
    discountReason: row.discountReason,
    discountAmount: discount.discountAmount,
    dueAmount: discount.dueAmount,
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
      discountType: line.discountType,
      discountValue: line.discountValue !== null ? Number(line.discountValue) : null,
      discountAmount: computeDiscountAmount(Number(line.lineTotal), line.discountType, line.discountValue !== null ? Number(line.discountValue) : null),
    })),
    printedAt: row.printedAt?.toISOString() ?? null,
    pendingPaymentMethod: row.pendingPaymentMethod,
    pendingCashReceivedAmount: row.pendingCashReceivedAmount !== null ? Number(row.pendingCashReceivedAmount) : null,
    paymentMethod: row.activePayment?.method ?? null,
    paidAt: row.activePayment?.paidAt.toISOString() ?? null,
    payments: row.activePayments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
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
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly walletService: PatientWalletService,
    @Inject(CASHIER_SHIFT_READER_PORT) private readonly cashierShiftReader: CashierShiftReaderPort,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  /**
   * "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — quỹ nhận/xuất tiền của dòng thu/hoàn tiền khám.
   * CHỈ resolve khi hình thức thanh toán là TIỀN MẶT (`countsAsCash`) — với hình thức khác (chuyển
   * khoản/thẻ), không có tín hiệu đáng tin cậy để biết tiền vào ĐÚNG tài khoản ngân hàng nào nếu
   * tenant có nhiều tài khoản, nên để `null` (chấp nhận, xem plan).
   *
   * "Thủ quỹ riêng" (GĐ2) — nhận sẵn `drawerAccountId` đã resolve TRƯỚC transaction chính (port tự
   * mở transaction đọc riêng, không gọi port LỒNG bên trong `tx` đang mở — đúng khuôn mọi port đọc
   * khác trong dự án, xem `cashierShiftId` ở `markPaid()`/`refund()`). Có giá trị → dùng luôn (két
   * riêng của actor đang xử lý); `null` → FALLBACK về quỹ CASH mặc định như GĐ1 (tính năng tắt,
   * hoặc actor không có ca mở dùng két riêng). `null` cuối cùng nếu tenant chưa có quỹ tiền mặt mặc
   * định nào — KHÔNG chặn thu tiền.
   */
  private async resolveCashAccountId(tx: Prisma.TransactionClient, tenantId: string, method: string, drawerAccountId: string | null): Promise<string | null> {
    const meta = await this.referenceCatalogReader.listByCategory(tenantId, 'PAYMENT_METHOD');
    const isCash = meta.find((m) => m.code === method)?.countsAsCash ?? false;
    if (!isCash) {
      return null;
    }
    if (drawerAccountId) {
      return drawerAccountId;
    }
    const account = await this.cashAccountRepository.findDefault(tx, tenantId, 'CASH');
    return account?.id ?? null;
  }

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
    // Chiết khấu — dùng `dueAmount` (số tiền THẬT thu/hoàn), KHÔNG dùng `totalAmount` (gross) — nếu
    // không tổng kết cuối ngày sẽ sai ngay khi có phiếu chiết khấu đầu tiên.
    const totals = computeDailyBillingTotals(rows.map((row) => ({ status: row.status, dueAmount: computeDue(row).dueAmount })));

    return {
      items: rows.map((row) => this.toBillingListItem(row)),
      ...totals,
    };
  }

  private toBillingListItem(row: BillingListRow): ListBillingInvoicesResponse['items'][number] {
    const encounterCancelled = row.encounter.status === 'CANCELLED';
    const discount = computeDue(row);
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
      discountAmount: discount.discountAmount,
      dueAmount: discount.dueAmount,
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
    const [cashierShiftId, drawerAccountId] = await Promise.all([
      this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId),
      this.cashierShiftReader.getCashAccountIdForActor(tenantId, actorId),
    ]);
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
      // Chiết khấu — thu ĐÚNG `dueAmount` (sau chiết khấu), KHÔNG phải `invoice.totalAmount`.
      const dueAmount = BigInt(computeDue(invoice).dueAmount);
      const cashAccountId = await this.resolveCashAccountId(tx, tenantId, dto.method, drawerAccountId);
      await this.paymentRepository.create(tx, tenantId, actorId, invoice.id, dto.method, dueAmount, paidAt, cashierShiftId, cashAccountId);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'invoice.paid',
        entityType: 'invoice',
        entityId: invoice.id,
        afterJson: { method: dto.method, amount: dueAmount.toString() },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      return toInvoiceResponse(updated!);
    });
  }

  /**
   * Core "Trừ ví tạm ứng" (Ví tạm ứng) — dùng bởi `payWithWallet()` VÀ `topUpAndPayWithWallet()`
   * (sau khi đã nạp thêm, trong CÙNG transaction). Trừ ĐÚNG số dư hiện có (`covered`); nếu còn
   * thiếu (`remainder`) — thiếu mà tenant CHƯA bật "Cho phép thanh toán hỗn hợp" → 409
   * `WALLET_INSUFFICIENT_BALANCE` (FE hiện khối "Cần thu tối thiểu"); thiếu mà ĐÃ bật → bắt buộc
   * `remainderPaymentMethodCode`, tạo THÊM 1 dòng Payment cho phần còn lại (trả hỗn hợp, xem Bước 0
   * ở `invoice.repository.ts`/`refund()`/`revertPayment()`).
   */
  private async payWithWalletCore(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    encounterId: string,
    expectedVersion: number,
    remainderPaymentMethodCode: string | undefined,
    cashierShiftId: string | null,
    drawerAccountId: string | null,
    meta: RequestMeta,
  ): Promise<InvoiceDto> {
    const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
    if (!invoice) {
      throw new NotFoundException();
    }
    if (invoice.status === 'PAID') {
      throw new InvoiceAlreadyPaidError();
    }
    if (isInvoiceClosed(invoice.status)) {
      throw new InvoiceClosedError();
    }

    const patientId = invoice.encounter.patient.id;
    const wallet = await this.walletService.tryGetActiveWallet(tx, tenantId, patientId);
    const balance = wallet?.balance ?? 0n;
    // Chiết khấu — trừ ĐÚNG `dueAmount` (sau chiết khấu), KHÔNG phải `invoice.totalAmount`.
    const due = BigInt(computeDue(invoice).dueAmount);
    const covered = balance < due ? balance : due;
    const remainder = due - covered;

    if (remainder > 0n) {
      const mixedEnabled = await this.clinicConfigReader.getWalletMixedPaymentEnabled(tenantId);
      if (!mixedEnabled) {
        throw new WalletInsufficientBalanceError(Number(balance), Number(due), Number(remainder));
      }
      if (!remainderPaymentMethodCode) {
        throw new BadRequestException('Thiếu phương thức thanh toán cho phần còn lại.');
      }
    }

    const paidAt = new Date();
    const count = await this.invoiceRepository.markPaid(tx, tenantId, invoice.id, expectedVersion, actorId);
    if (count === 0) {
      const recheck = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (recheck?.status === 'PAID') {
        throw new InvoiceAlreadyPaidError();
      }
      if (recheck && isInvoiceClosed(recheck.status)) {
        throw new InvoiceClosedError();
      }
      throw new ConcurrentModificationError();
    }

    const rows: { method: string; amount: bigint; cashAccountId: string | null }[] = [];
    if (covered > 0n) {
      await this.walletService.deduct(tx, tenantId, actorId, patientId, covered, invoice.id, meta);
      rows.push({ method: 'WALLET', amount: covered, cashAccountId: null });
    }
    if (remainder > 0n) {
      const cashAccountId = await this.resolveCashAccountId(tx, tenantId, remainderPaymentMethodCode!, drawerAccountId);
      rows.push({ method: remainderPaymentMethodCode!, amount: remainder, cashAccountId });
    }
    await this.paymentRepository.createMany(tx, tenantId, actorId, invoice.id, rows, paidAt, cashierShiftId);

    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'invoice.paid',
      entityType: 'invoice',
      entityId: invoice.id,
      afterJson: { rows: rows.map((r) => ({ method: r.method, amount: r.amount.toString() })) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const updated = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
    return toInvoiceResponse(updated!);
  }

  /** `POST /billing/invoices/:encounterId/pay-with-wallet` — dùng số dư ví HIỆN CÓ, không nạp thêm. */
  async payWithWallet(tenantId: string, actorId: string, encounterId: string, dto: PayInvoiceWithWalletRequest, meta: RequestMeta): Promise<InvoiceDto> {
    const [cashierShiftId, drawerAccountId] = await Promise.all([
      this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId),
      this.cashierShiftReader.getCashAccountIdForActor(tenantId, actorId),
    ]);
    return this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.payWithWalletCore(tx, tenantId, actorId, encounterId, dto.version, dto.remainderPaymentMethodCode, cashierShiftId, drawerAccountId, meta),
    );
  }

  /**
   * `POST /billing/invoices/:encounterId/topup-and-pay-with-wallet` — nạp thêm vào ví TRƯỚC (Luồng
   * 2 PRD: "Nạp phần thiếu"/"Nạp mức chuẩn") rồi chạy lại đúng logic `payWithWalletCore()` trong
   * CÙNG transaction. Quyền riêng `patient_wallet.topup` (có hành động nạp tiền thật).
   */
  async topUpAndPayWithWallet(tenantId: string, actorId: string, encounterId: string, dto: TopUpAndPayInvoiceWithWalletRequest, meta: RequestMeta): Promise<InvoiceDto> {
    const [cashierShiftId, drawerAccountId] = await Promise.all([
      this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId),
      this.cashierShiftReader.getCashAccountIdForActor(tenantId, actorId),
    ]);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (!invoice) {
        throw new NotFoundException();
      }
      const patientId = invoice.encounter.patient.id;
      await this.walletService.credit(tx, tenantId, actorId, patientId, BigInt(dto.topUpAmount), dto.topUpPaymentMethodCode, dto.cashAccountId, undefined, meta);
      return this.payWithWalletCore(tx, tenantId, actorId, encounterId, dto.version, dto.remainderPaymentMethodCode, cashierShiftId, drawerAccountId, meta);
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
      // Ví tạm ứng — dòng nào đã trừ ví (`method='WALLET'`) thì cộng lại TRƯỚC khi soft-delete (đảo
      // ngược đúng số tiền của TỪNG dòng, không phải toàn bộ `invoice.totalAmount` — trả hỗn hợp có
      // thể chỉ 1 trong 2 dòng là WALLET).
      for (const p of invoice.activePayments) {
        if (p.method === 'WALLET') {
          await this.walletService.creditBack(tx, tenantId, actorId, invoice.encounter.patient.id, p.amount, invoice.id, 'Đánh dấu chưa thu', meta);
        }
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
   * Chỉ hoàn TOÀN PHẦN ở v1 — số tiền lấy đúng tổng `activePayments` đã thu (đã trừ chiết khấu nếu
   * có, xem `markPaid()`/`payWithWalletCore()`), không nhận từ client.
   */
  async refund(tenantId: string, actorId: string, encounterId: string, dto: RefundInvoiceRequest, meta: RequestMeta): Promise<InvoiceDto> {
    // "Đa thu ngân"/"Thủ quỹ riêng" — xem comment ở markPaid() phía trên.
    const [cashierShiftId, drawerAccountId] = await Promise.all([
      this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId),
      this.cashierShiftReader.getCashAccountIdForActor(tenantId, actorId),
    ]);
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
      // `activePayments` chắc chắn có ≥1 phần tử ở đây — `canRefundInvoice` đã xác nhận
      // `status='PAID'`. Thường 1 dòng; 2 dòng khi trả hỗn hợp (Ví tạm ứng) — lặp qua TỪNG dòng,
      // tạo đúng 1 dòng REFUND đối ứng mỗi dòng (cùng method/amount/cashAccountId). Tổng hoàn = tổng
      // các dòng = số tiền THẬT đã thu tại thời điểm markPaid()/payWithWalletCore() (đã trừ chiết
      // khấu nếu có — KHÔNG phải invoice.totalAmount gross). Dòng nào là `WALLET` thì CỘNG LẠI vào
      // ví đúng phần tiền của dòng đó (không phải toàn bộ).
      let refundedTotal = 0n;
      for (const p of invoice.activePayments) {
        const cashAccountId = await this.resolveCashAccountId(tx, tenantId, p.method, drawerAccountId);
        await this.paymentRepository.createRefund(tx, tenantId, actorId, invoice.id, p.method, p.amount, refundedAt, dto.reason, cashierShiftId, cashAccountId);
        refundedTotal += p.amount;
        if (p.method === 'WALLET') {
          await this.walletService.creditBack(tx, tenantId, actorId, invoice.encounter.patient.id, p.amount, invoice.id, 'Hoàn tiền do huỷ lượt khám', meta);
        }
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'invoice.refunded',
        entityType: 'invoice',
        entityId: invoice.id,
        beforeJson: { status: 'PAID' },
        afterJson: { status: 'REFUNDED', amount: refundedTotal.toString(), reason: dto.reason },
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

  /**
   * Chiết khấu (chốt qua `AskUserQuestion`) — CHỈ sửa được khi phiếu còn `UNPAID` (đã "Thu tiền"
   * thì phải "Đánh dấu chưa thu" trước, tránh phải tính lại chênh lệch thu thêm/hoàn lại — ngoài
   * phạm vi "Thu ngân cơ bản" v1). `mode='NONE'` = xoá chiết khấu hiện có, cũng bắt buộc `reason`
   * (đụng tiền cần ghi vết như mọi thao tác khác). Validate "Toàn hoá đơn"/"Từng dịch vụ" loại trừ
   * lẫn nhau đã ở tầng schema (`applyInvoiceDiscountRequestSchema`, discriminated union theo
   * `mode`) — service không cần kiểm tra lại.
   */
  async applyDiscount(tenantId: string, actorId: string, encounterId: string, dto: ApplyInvoiceDiscountRequest, meta: RequestMeta): Promise<InvoiceDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const invoice = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
      if (!invoice) {
        throw new NotFoundException();
      }
      const before = computeDue(invoice);

      const count = await this.invoiceRepository.applyDiscount(tx, tenantId, invoice.id, dto.version, actorId, dto);
      if (count === 0) {
        const recheck = await this.invoiceRepository.findByEncounterId(tx, tenantId, encounterId);
        if (recheck && recheck.status !== 'UNPAID') {
          throw new InvoiceDiscountNotAllowedError();
        }
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: dto.mode === 'NONE' ? 'invoice.discount_removed' : 'invoice.discount_applied',
        entityType: 'invoice',
        entityId: invoice.id,
        beforeJson: { discountMode: before.mode, discountAmount: before.discountAmount, discountReason: invoice.discountReason },
        afterJson: { mode: dto.mode, reason: dto.reason },
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
