import { forwardRef, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  allocateSupplierDebt,
  CASHIER_SHIFT_READER_PORT,
  CLINIC_CONFIG_READER_PORT,
  computeSupplierDebtReconciliationOutcome,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  resolveRecentDateRange,
  SupplierDebtAdjustmentNotPendingError,
  SupplierDebtIntegrityMismatchError,
  SupplierDebtOpeningBalanceAlreadyExistsError,
  SupplierDebtReconciliationAsOfDateTooEarlyError,
  SupplierDebtReconciliationNotReadyError,
  type CashierShiftReaderPort,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
  type SupplierDebtEntryInput,
} from '@nexamed/core';
import type {
  CreateSupplierDebtAdjustmentRequest,
  ApproveSupplierDebtAdjustmentRequest,
  CreateSupplierDebtReconciliationRequest,
  FinalizeSupplierDebtReconciliationRequest,
  ListSupplierDebtAdjustmentsQuery,
  ListSupplierDebtAdjustmentsResponse,
  ListSupplierDebtLedgerQuery,
  ListSupplierDebtLedgerResponse,
  ListSupplierDebtPaymentsQuery,
  ListSupplierDebtPaymentsResponse,
  ListSupplierDebtReceiptsResponse,
  ListSupplierDebtReconciliationsResponse,
  ListSupplierDebtSummariesResponse,
  PreviewSupplierDebtReconciliationResponse,
  RecordSupplierDebtOpeningBalanceRequest,
  RecordSupplierDebtPaymentRequest,
  RecordSupplierDebtRefundRequest,
  RejectSupplierDebtAdjustmentRequest,
  SupplierDebtAdjustment as SupplierDebtAdjustmentDto,
  SupplierDebtReconciliation as SupplierDebtReconciliationDto,
  SupplierDebtSummary,
} from '@nexamed/shared';
import type {
  CashVoucher,
  Prisma,
  SupplierDebtAccount,
  SupplierDebtAdjustment as SupplierDebtAdjustmentRow,
  SupplierDebtEntry,
  SupplierDebtEntryType,
  SupplierDebtReconciliation as SupplierDebtReconciliationRow,
} from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { CashAccountRepository } from '../cash-book/cash-account.repository';
import { CashVoucherRepository } from '../cash-book/cash-voucher.repository';
import { SupplierRepository } from '../drug/supplier.repository';
import { StockReceiptService } from '../inventory/stock-receipt.service';
import { StockIssueService } from '../inventory/stock-issue.service';
import { SupplierDebtAccountRepository } from './supplier-debt-account.repository';
import { SupplierDebtEntryRepository } from './supplier-debt-entry.repository';
import { SupplierDebtAdjustmentRepository } from './supplier-debt-adjustment.repository';
import { SupplierDebtReconciliationRepository } from './supplier-debt-reconciliation.repository';
import { assertSupplierDebtWritable } from './supplier-debt-lock.guard';

/**
 * "Công nợ nhà cung cấp" — Phần A "Nền sổ công nợ" (docs/DECISIONS.md #180/#182, kế hoạch kỹ thuật
 * C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md). Chỉ ghi PURCHASE (lúc Duyệt
 * phiếu nhập)/PAYMENT (từ "Trả ngay" hoặc phiếu chi POSTED)/OPENING_BALANCE (Khai nợ đầu kỳ) —
 * RETURN/REFUND_RECEIVED/ADJUSTMENT_INCREASE/ADJUSTMENT_DECREASE/REVERSAL khai sẵn enum, chưa có
 * đường ghi (Phần C/D).
 *
 * **Đơn giản hoá có chủ đích (ghi rõ để không nhầm là thiếu sót)**: khi phiếu chi "Trả ngay" còn
 * `PENDING_APPROVAL` (tenant bật `cashVoucherApprovalEnabled`) rồi mới được Duyệt SAU, bút toán
 * PAYMENT lúc đó (`recordVoucherPosted()`) dùng FIFO THUẦN (không target đúng phiếu nhập gốc) —
 * hook duyệt phiếu chi (ở `cash-book`) không có ngữ cảnh "đây là Trả ngay của phiếu nhập nào" mà
 * không phải phụ thuộc ngược `inventory` chỉ để tra 1 chỗ hiếm khi xảy ra (kết hợp "Trả ngay" +
 * "Phiếu chi phải được duyệt"). Chỉ ảnh hưởng phần hiển thị "phiếu nào đã trả" ở tab "Phiếu nhập" —
 * TỔNG công nợ của NCC luôn đúng tuyệt đối trong mọi trường hợp (không phụ thuộc cách phân bổ FIFO).
 * Chỉ `recordPurchaseApproval()` (voucher POSTED NGAY, không cần duyệt — trường hợp phổ biến hơn)
 * mới target đúng phiếu nhập.
 */
@Injectable()
export class SupplierDebtService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly accountRepository: SupplierDebtAccountRepository,
    private readonly entryRepository: SupplierDebtEntryRepository,
    private readonly cashVoucherRepository: CashVoucherRepository,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly businessCodeService: BusinessCodeService,
    private readonly adjustmentRepository: SupplierDebtAdjustmentRepository,
    private readonly reconciliationRepository: SupplierDebtReconciliationRepository,
    // Phần D — vòng phụ thuộc THẬT ở mức Service (approveAdjustment() gọi ngược StockReceiptService/
    // StockIssueService để thực thi "Huỷ chứng từ" hộ lúc duyệt VOID_REQUEST), bọc forwardRef() đúng
    // khuyến nghị NestJS, đối xứng với 2 đầu injection ở `stock-receipt.service.ts`/`stock-issue.service.ts`.
    @Inject(forwardRef(() => StockReceiptService)) private readonly stockReceiptService: StockReceiptService,
    @Inject(forwardRef(() => StockIssueService)) private readonly stockIssueService: StockIssueService,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
    @Inject(CASHIER_SHIFT_READER_PORT) private readonly cashierShiftReader: CashierShiftReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  private async getOrCreateAccount(tx: Prisma.TransactionClient, tenantId: string, actorId: string, supplierId: string): Promise<SupplierDebtAccount> {
    const existing = await this.accountRepository.findBySupplierId(tx, tenantId, supplierId);
    if (existing) return existing;
    return this.accountRepository.create(tx, tenantId, actorId, supplierId);
  }

  /** Phần D, mục 4.2 điểm 6 — chặn Thanh toán/Thu tiền NCC hoàn lại nếu sổ đã lệch (lỗi hệ thống,
   * không do người dùng). Dùng ở nơi CHƯA tải `entries` đầy đủ (khác `rawEntrySum()` ở `buildSummary`
   * — tính từ `entries` đã có sẵn, không round-trip DB thêm). */
  private async assertBalanceIntegrity(tx: Prisma.TransactionClient, tenantId: string, account: SupplierDebtAccount): Promise<void> {
    const rawSum = await this.entryRepository.sumAmountChange(tx, tenantId, account.id);
    if (rawSum !== account.balance) throw new SupplierDebtIntegrityMismatchError();
  }

  /** Ghi 1 bút toán + cập nhật snapshot `balance`, tuần tự hoá qua `version` (đúng khuôn
   * `PatientWalletRepository.updateBalance()`). `account` PHẢI là bản mới nhất đọc trong CÙNG
   * transaction ngay trước lệnh gọi (không cache qua nhiều bút toán liên tiếp — mỗi lần ghi làm
   * `version` tăng lên 1). */
  private async applyEntry(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    account: SupplierDebtAccount,
    params: {
      entryType: SupplierDebtEntryType;
      amountChange: bigint;
      occurredAt: Date;
      stockReceiptId: string | null;
      stockIssueId: string | null;
      cashVoucherId: string | null;
      reversalOfId: string | null;
      adjustmentId: string | null;
      note: string | null;
    },
  ): Promise<{ entry: SupplierDebtEntry; account: SupplierDebtAccount }> {
    const newBalance = account.balance + params.amountChange;
    const count = await this.accountRepository.updateBalance(tx, tenantId, account.id, account.version, actorId, newBalance);
    if (count === 0) throw new ConcurrentModificationError();
    const entry = await this.entryRepository.create(tx, tenantId, actorId, {
      accountId: account.id,
      entryType: params.entryType,
      amountChange: params.amountChange,
      balanceAfter: newBalance,
      occurredAt: params.occurredAt,
      stockReceiptId: params.stockReceiptId,
      stockIssueId: params.stockIssueId,
      cashVoucherId: params.cashVoucherId,
      reversalOfId: params.reversalOfId,
      adjustmentId: params.adjustmentId,
      note: params.note,
    });
    return { entry, account: { ...account, balance: newBalance, version: account.version + 1 } };
  }

  /**
   * `StockReceiptService.approve()` (receiptType='PURCHASE') gọi TRONG CÙNG transaction ngay sau
   * khi phiếu chuyển POSTED — ghi PURCHASE luôn ĐÚNG `netAmount` (tiền sau chiết khấu, không phải
   * `totalAmount` gross). Nếu có "Trả ngay" > 0: tạo `cash_voucher` (mã CASH_PAYMENT, đúng dữ liệu
   * mẫu mockup — "PC..."), và nếu KHÔNG cần duyệt thì ghi PAYMENT ngay, target đúng phiếu nhập này.
   */
  async recordPurchaseApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: {
      supplierId: string;
      supplierName: string;
      netAmount: bigint;
      stockReceiptId: string;
      receiptNo: string;
      occurredAt: Date;
      prepaidAmount: bigint;
      prepaidPaymentMethodCode: string | null;
      prepaidCashAccountId: string | null;
      meta: RequestMeta;
    },
  ): Promise<{ prepaidVoucherId: string | null }> {
    const account0 = await this.getOrCreateAccount(tx, tenantId, actorId, params.supplierId);
    const { entry: purchaseEntry, account: account1 } = await this.applyEntry(tx, tenantId, actorId, account0, {
      entryType: 'PURCHASE',
      amountChange: params.netAmount,
      occurredAt: params.occurredAt,
      stockReceiptId: params.stockReceiptId,
      stockIssueId: null,
      cashVoucherId: null,
      reversalOfId: null,
      adjustmentId: null,
      note: null,
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'supplier_debt.purchase_recorded',
      entityType: 'supplier_debt_account',
      entityId: account1.id,
      afterJson: { supplierId: params.supplierId, stockReceiptId: params.stockReceiptId, entryId: purchaseEntry.id, amount: params.netAmount.toString() },
      ip: params.meta.ip,
      userAgent: params.meta.userAgent,
    });

    if (params.prepaidAmount <= 0n) return { prepaidVoucherId: null };
    if (params.prepaidAmount > params.netAmount) {
      throw new UnprocessableEntityException('Số tiền "Trả ngay" không được vượt quá tiền hàng phải trả.');
    }
    const cashAccount = await this.cashAccountRepository.findById(tx, tenantId, params.prepaidCashAccountId!);
    if (!cashAccount) throw new NotFoundException();

    const approvalEnabled = await this.clinicConfigReader.getCashVoucherApprovalEnabled(tenantId);
    const cashierShiftId = await this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId);
    const status: 'POSTED' | 'PENDING_APPROVAL' = approvalEnabled ? 'PENDING_APPROVAL' : 'POSTED';
    const voucherNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'CASH_PAYMENT', params.occurredAt);

    const voucher = await this.cashVoucherRepository.create(tx, tenantId, actorId, {
      voucherNo,
      direction: 'EXPENSE',
      incomeExpenseTypeCode: 'SUPPLIER_DEBT_PAYMENT',
      cashAccountId: params.prepaidCashAccountId!,
      paymentMethodCode: params.prepaidPaymentMethodCode!,
      amount: params.prepaidAmount,
      occurredAt: params.occurredAt,
      partnerName: params.supplierName,
      description: `Trả ngay lúc nhập — ${params.supplierName} (${params.receiptNo})`,
      status,
      cashierShiftId,
      supplierId: params.supplierId,
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'cash_voucher.created',
      entityType: 'cash_voucher',
      entityId: voucher.id,
      afterJson: { voucherNo, direction: 'EXPENSE', amount: params.prepaidAmount.toString(), status, supplierId: params.supplierId },
      ip: params.meta.ip,
      userAgent: params.meta.userAgent,
    });

    if (status === 'POSTED') {
      await this.applyVoucherEntry(tx, tenantId, actorId, account1, voucher, params.stockReceiptId, params.meta);
    }

    return { prepaidVoucherId: voucher.id };
  }

  /**
   * Phần C — `StockIssueService.approveManual()` (issueType='RETURN_TO_SUPPLIER') gọi TRONG CÙNG
   * transaction ngay sau khi phiếu chuyển POSTED — ghi RETURN −giá trị trả. `targetStockReceiptId`
   * (nếu chọn "Phiếu nhập gốc", Q3) trừ vào đúng phiếu đó trước (`allocateSupplierDebt()` FIFO).
   * Không sinh `cash_voucher` nào (trả hàng không phải tiền thật, chỉ giảm công nợ) — khác
   * `recordPurchaseApproval()`. Phòng thủ `totalAmount<=0n` (Service đã validate ≥1 dòng có SL>0
   * nên không nên xảy ra, nhưng tránh ghi bút toán amount_change=0 — CHECK DB sẽ chặn).
   */
  async recordReturnApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: { supplierId: string; totalAmount: bigint; stockIssueId: string; occurredAt: Date; targetStockReceiptId: string | null; meta: RequestMeta },
  ): Promise<void> {
    if (params.totalAmount <= 0n) return;
    const account0 = await this.getOrCreateAccount(tx, tenantId, actorId, params.supplierId);
    const { entry } = await this.applyEntry(tx, tenantId, actorId, account0, {
      entryType: 'RETURN',
      amountChange: -params.totalAmount,
      occurredAt: params.occurredAt,
      stockReceiptId: params.targetStockReceiptId,
      stockIssueId: params.stockIssueId,
      cashVoucherId: null,
      reversalOfId: null,
      adjustmentId: null,
      note: null,
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'supplier_debt.return_recorded',
      entityType: 'supplier_debt_account',
      entityId: account0.id,
      afterJson: { supplierId: params.supplierId, stockIssueId: params.stockIssueId, entryId: entry.id, amount: params.totalAmount.toString() },
      ip: params.meta.ip,
      userAgent: params.meta.userAgent,
    });
  }

  /** `EXPENSE` (phiếu chi) → PAYMENT (giảm nợ); `INCOME` (phiếu thu, "NCC hoàn tiền" — Phần C) →
   * REFUND_RECEIVED (tăng nợ, tức giảm phần "NCC nợ lại"). `targetStockReceiptId` chỉ có ý nghĩa với
   * PAYMENT (xem đơn giản hoá đã ghi ở đầu file — `recordVoucherPosted()` luôn truyền `null`). */
  private async applyVoucherEntry(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    account: SupplierDebtAccount,
    voucher: CashVoucher,
    targetStockReceiptId: string | null,
    meta: RequestMeta,
  ): Promise<void> {
    const entryType: SupplierDebtEntryType = voucher.direction === 'EXPENSE' ? 'PAYMENT' : 'REFUND_RECEIVED';
    const amountChange = voucher.direction === 'EXPENSE' ? -voucher.amount : voucher.amount;
    const { entry } = await this.applyEntry(tx, tenantId, actorId, account, {
      entryType,
      amountChange,
      occurredAt: voucher.occurredAt,
      stockReceiptId: targetStockReceiptId,
      stockIssueId: null,
      cashVoucherId: voucher.id,
      reversalOfId: null,
      adjustmentId: null,
      note: null,
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: entryType === 'PAYMENT' ? 'supplier_debt.payment_recorded' : 'supplier_debt.refund_received_recorded',
      entityType: 'supplier_debt_account',
      entityId: account.id,
      afterJson: { cashVoucherId: voucher.id, entryId: entry.id, amount: voucher.amount.toString() },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** Hook từ `CashVoucherService.approve()` — voucher CÓ `supplierId` vừa chuyển `POSTED`. */
  async recordVoucherPosted(tx: Prisma.TransactionClient, tenantId: string, actorId: string, voucher: CashVoucher, meta: RequestMeta): Promise<void> {
    if (!voucher.supplierId) return;
    const account = await this.getOrCreateAccount(tx, tenantId, actorId, voucher.supplierId);
    await this.applyVoucherEntry(tx, tenantId, actorId, account, voucher, null, meta);
  }

  /** Hook từ `CashVoucherService.voidVoucher()` — voucher CÓ `supplierId` vừa bị huỷ. Không có gì
   * để đảo nếu voucher CHƯA từng `POSTED` (còn `PENDING_APPROVAL` lúc huỷ — chưa từng ghi sổ). */
  async reverseVoucherPayment(tx: Prisma.TransactionClient, tenantId: string, actorId: string, voucher: CashVoucher, reason: string, meta: RequestMeta): Promise<void> {
    if (!voucher.supplierId) return;
    const original = await this.entryRepository.findByCashVoucherId(tx, tenantId, voucher.id);
    if (!original) return;

    const account = await this.accountRepository.findBySupplierId(tx, tenantId, voucher.supplierId);
    if (!account) return; // không nên xảy ra (original tồn tại ⇒ account phải tồn tại) — phòng thủ.

    const { entry } = await this.applyEntry(tx, tenantId, actorId, account, {
      entryType: 'REVERSAL',
      amountChange: -original.amountChange,
      occurredAt: new Date(),
      stockReceiptId: original.stockReceiptId,
      stockIssueId: null,
      cashVoucherId: voucher.id,
      reversalOfId: original.id,
      adjustmentId: null,
      note: reason,
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'supplier_debt.payment_reversed',
      entityType: 'supplier_debt_account',
      entityId: account.id,
      afterJson: { cashVoucherId: voucher.id, reversalEntryId: entry.id, reversedEntryId: original.id, reason },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Phần D, Tầng 2 "Huỷ chứng từ" (docs/DECISIONS.md #180/#182, mục 4.1) — hook từ
   * `StockReceiptService.voidReceipt()`/`StockIssueService.voidIssue()` (Huỷ trực tiếp, đã có quyền
   * duyệt phiếu gốc) LẪN `approveAdjustment()` bên dưới (`VOID_REQUEST` được duyệt — hệ thống tự huỷ
   * hộ, đúng CÙNG logic huỷ, chỉ khác người thực thi). Mirror `reverseVoucherPayment()` — không có
   * gì để đảo nếu phiếu này KHÔNG gắn NCC (không tìm thấy bút toán PURCHASE/RETURN gốc) — phòng thủ
   * cho mọi `receiptType`/`issueType` khác. Đúng đúng 1 trong 2 tham số `stockReceiptId`/`stockIssueId`.
   */
  async reverseStockEntry(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    target: { stockReceiptId: string | null; stockIssueId: string | null },
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    const original = target.stockReceiptId
      ? await this.entryRepository.findActiveByStockReceiptId(tx, tenantId, target.stockReceiptId)
      : target.stockIssueId
        ? await this.entryRepository.findActiveByStockIssueId(tx, tenantId, target.stockIssueId)
        : null;
    if (!original) return;

    const account = await this.accountRepository.findById(tx, tenantId, original.accountId);
    if (!account) return; // không nên xảy ra (original tồn tại ⇒ account phải tồn tại) — phòng thủ.

    // Phần E — điểm chốt DUY NHẤT cho MỌI đường Huỷ chứng từ (Huỷ trực tiếp `voidReceipt()`/
    // `voidIssue()` LẪN duyệt "Đề nghị huỷ", cả 2 đều đi qua `voidPostedCore()` → hàm này). Nằm
    // TRONG `tx` chung với các bước đảo thẻ kho đã chạy trước đó ở `voidPostedCore()` — throw ở đây
    // rollback toàn bộ giao dịch, không cần sửa gì ở `stock-receipt.service.ts`/`stock-issue.service.ts`.
    await assertSupplierDebtWritable(tx, tenantId, actorId, account.lockedAsOfDate, original.occurredAt);

    const { entry } = await this.applyEntry(tx, tenantId, actorId, account, {
      entryType: 'REVERSAL',
      amountChange: -original.amountChange,
      occurredAt: new Date(),
      stockReceiptId: original.stockReceiptId,
      stockIssueId: original.stockIssueId,
      cashVoucherId: null,
      reversalOfId: original.id,
      adjustmentId: null,
      note: reason,
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: target.stockReceiptId ? 'supplier_debt.purchase_reversed' : 'supplier_debt.return_reversed',
      entityType: 'supplier_debt_account',
      entityId: account.id,
      afterJson: {
        stockReceiptId: target.stockReceiptId,
        stockIssueId: target.stockIssueId,
        reversalEntryId: entry.id,
        reversedEntryId: original.id,
        reason,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** `POST /supplier-debt/:supplierId/opening-balance` — chỉ khi NCC CHƯA có bút toán nào (account
   * chưa tồn tại — account LUÔN được tạo CÙNG LÚC với bút toán đầu tiên, không có đường nào account
   * tồn tại mà 0 bút toán). Cho phép `amount` ÂM (Q8 — NCC đã nợ lại từ trước khi dùng phần mềm). */
  async recordOpeningBalance(tenantId: string, actorId: string, supplierId: string, dto: RecordSupplierDebtOpeningBalanceRequest, meta: RequestMeta): Promise<SupplierDebtSummary> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const existingAccount = await this.accountRepository.findBySupplierId(tx, tenantId, supplierId);
      if (existingAccount) throw new SupplierDebtOpeningBalanceAlreadyExistsError();

      const account = await this.accountRepository.create(tx, tenantId, actorId, supplierId);
      const amountChange = BigInt(dto.amount);
      const { entry } = await this.applyEntry(tx, tenantId, actorId, account, {
        entryType: 'OPENING_BALANCE',
        amountChange,
        occurredAt: new Date(dto.occurredAt),
        stockReceiptId: null,
        stockIssueId: null,
        cashVoucherId: null,
        reversalOfId: null,
        adjustmentId: null,
        note: dto.note ?? null,
      });
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'supplier_debt.opening_balance_recorded',
        entityType: 'supplier_debt_account',
        entityId: account.id,
        afterJson: { supplierId, entryId: entry.id, amount: amountChange.toString() },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.getSummary(tenantId, supplierId);
  }

  /**
   * Phần B — `POST /supplier-debt/:supplierId/payment` — "Thanh toán công nợ" trên TỔNG nợ (KHÔNG
   * chọn từng phiếu, phân bổ FIFO ngầm lúc đọc — đúng `allocateSupplierDebt()`). Cùng khuôn tạo
   * voucher như phần "Trả ngay" ở `recordPurchaseApproval()` (mã `CASH_PAYMENT`, `description`/
   * `partnerName` tự sinh — không nhận từ client), khác ở chỗ đây là top-level method tự mở
   * transaction của chính nó (không tham gia transaction Duyệt phiếu nhập nào). Ràng buộc (kế hoạch
   * kỹ thuật mục 3): số tiền ≤ (số nợ hiện tại − tổng phiếu chi gắn NCC đang Chờ duyệt) — chặn lập
   * nhiều yêu cầu thanh toán cộng dồn vượt quá công nợ thật.
   */
  async recordPayment(tenantId: string, actorId: string, supplierId: string, dto: RecordSupplierDebtPaymentRequest, meta: RequestMeta): Promise<SupplierDebtSummary> {
    // Đúng khuôn "port tự mở transaction đọc riêng, resolve TRƯỚC transaction chính" đã áp dụng ở
    // `CashVoucherService.create()`.
    const approvalEnabled = await this.clinicConfigReader.getCashVoucherApprovalEnabled(tenantId);
    const cashierShiftId = await this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const cashAccount = await this.cashAccountRepository.findById(tx, tenantId, dto.cashAccountId);
      if (!cashAccount) throw new NotFoundException();

      const account0 = await this.getOrCreateAccount(tx, tenantId, actorId, supplierId);
      await this.assertBalanceIntegrity(tx, tenantId, account0);
      const pendingMap = await this.cashVoucherRepository.sumPendingApprovalBySupplierIds(tx, tenantId, [supplierId]);
      const maxPayable = account0.balance - (pendingMap.get(supplierId) ?? 0n);
      if (BigInt(dto.amount) > maxPayable) {
        throw new UnprocessableEntityException('Số tiền thanh toán không được vượt quá công nợ còn lại (đã trừ phiếu chờ duyệt).');
      }

      const voucherNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'CASH_PAYMENT', occurredAt);
      const status: 'POSTED' | 'PENDING_APPROVAL' = approvalEnabled ? 'PENDING_APPROVAL' : 'POSTED';
      const voucher = await this.cashVoucherRepository.create(tx, tenantId, actorId, {
        voucherNo,
        direction: 'EXPENSE',
        incomeExpenseTypeCode: 'SUPPLIER_DEBT_PAYMENT',
        cashAccountId: dto.cashAccountId,
        paymentMethodCode: dto.paymentMethodCode,
        amount: BigInt(dto.amount),
        occurredAt,
        partnerName: supplier.name,
        description: dto.note?.trim() ? `Thanh toán công nợ — ${supplier.name} (${dto.note.trim()})` : `Thanh toán công nợ — ${supplier.name}`,
        status,
        cashierShiftId,
        supplierId,
      });
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_voucher.created',
        entityType: 'cash_voucher',
        entityId: voucher.id,
        afterJson: { voucherNo, direction: 'EXPENSE', amount: dto.amount.toString(), status, supplierId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      if (status === 'POSTED') {
        await this.applyVoucherEntry(tx, tenantId, actorId, account0, voucher, null, meta);
      }
    });
    return this.getSummary(tenantId, supplierId);
  }

  /**
   * Phần C — `POST /supplier-debt/:supplierId/refund` — "Thu tiền NCC hoàn lại" (Q8), CHỈ hợp lệ khi
   * `balance < 0` (NCC đang nợ lại phòng khám), `amount ≤ |balance|`. Sinh `cash_voucher` INCOME
   * (`SUPPLIER_REFUND`) — LUÔN `POSTED` NGAY (đúng `CashVoucherService.create()`: chỉ EXPENSE mới
   * xét `cashVoucherApprovalEnabled`, xem `sumPendingApprovalBySupplierIds()`), nên ghi
   * `REFUND_RECEIVED` thẳng trong CÙNG transaction — không cần hook `recordVoucherPosted()` qua
   * `CashVoucherService.approve()` như "Thanh toán công nợ" (Phần B, EXPENSE có thể Chờ duyệt).
   */
  async recordRefund(tenantId: string, actorId: string, supplierId: string, dto: RecordSupplierDebtRefundRequest, meta: RequestMeta): Promise<SupplierDebtSummary> {
    const cashierShiftId = await this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const cashAccount = await this.cashAccountRepository.findById(tx, tenantId, dto.cashAccountId);
      if (!cashAccount) throw new NotFoundException();

      const account0 = await this.accountRepository.findBySupplierId(tx, tenantId, supplierId);
      if (!account0 || account0.balance >= 0n) {
        throw new UnprocessableEntityException('Nhà cung cấp này không đang nợ lại phòng khám — không có gì để hoàn tiền.');
      }
      await this.assertBalanceIntegrity(tx, tenantId, account0);
      const maxRefundable = -account0.balance;
      if (BigInt(dto.amount) > maxRefundable) {
        throw new UnprocessableEntityException('Số tiền nhận không được vượt quá số nhà cung cấp đang nợ lại.');
      }

      const voucherNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'CASH_RECEIPT', occurredAt);
      const voucher = await this.cashVoucherRepository.create(tx, tenantId, actorId, {
        voucherNo,
        direction: 'INCOME',
        incomeExpenseTypeCode: 'SUPPLIER_REFUND',
        cashAccountId: dto.cashAccountId,
        paymentMethodCode: dto.paymentMethodCode,
        amount: BigInt(dto.amount),
        occurredAt,
        partnerName: supplier.name,
        description: dto.note?.trim() ? `Nhà cung cấp hoàn tiền — ${supplier.name} (${dto.note.trim()})` : `Nhà cung cấp hoàn tiền — ${supplier.name}`,
        status: 'POSTED',
        cashierShiftId,
        supplierId,
      });
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'cash_voucher.created',
        entityType: 'cash_voucher',
        entityId: voucher.id,
        afterJson: { voucherNo, direction: 'INCOME', amount: dto.amount.toString(), status: 'POSTED', supplierId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      await this.applyVoucherEntry(tx, tenantId, actorId, account0, voucher, null, meta);
    });
    return this.getSummary(tenantId, supplierId);
  }

  private toEntryInputs(entries: SupplierDebtEntry[]): SupplierDebtEntryInput[] {
    return entries.map((e) => ({
      id: e.id,
      entryType: e.entryType,
      amountChange: Number(e.amountChange),
      stockReceiptId: e.stockReceiptId,
      reversalOfId: e.reversalOfId,
    }));
  }

  /** Tổng theo `entryType`, ĐÃ loại cặp gốc+REVERSAL (đúng bước 1 thuật toán `allocateSupplierDebt()`,
   * @nexamed/core) — bút toán bị đảo (VD "Trả ngay" bị huỷ, `reverseVoucherPayment()`) KHÔNG được
   * tính vào `totalPaid`, và bản thân dòng REVERSAL cũng không rơi vào bucket nào ở đây. */
  private sumByTypeExcludingReversed(entries: SupplierDebtEntry[]): Map<SupplierDebtEntryType, bigint> {
    const reversedIds = new Set(entries.filter((e) => e.reversalOfId).map((e) => e.reversalOfId!));
    const map = new Map<SupplierDebtEntryType, bigint>();
    for (const e of entries) {
      if (e.entryType === 'REVERSAL' || reversedIds.has(e.id)) continue;
      map.set(e.entryType, (map.get(e.entryType) ?? 0n) + e.amountChange);
    }
    return map;
  }

  /** Phần D, mục 4.2 điểm 6 — `SUM(amountChange)` TOÀN BỘ (gồm cả REVERSAL, khác `entryTotals` đã
   * loại cặp gốc+REVERSAL) PHẢI khớp `balance` snapshot — tính từ chính `entries` đã tải sẵn (không
   * round-trip DB thêm, khác `assertBalanceIntegrity()` bên dưới dùng ở nơi CHƯA tải entries). */
  private rawEntrySum(entries: SupplierDebtEntry[]): bigint {
    return entries.reduce((sum, e) => sum + e.amountChange, 0n);
  }

  private buildSummary(
    supplierId: string,
    account: SupplierDebtAccount | null,
    entryTotals: Map<SupplierDebtEntryType, bigint>,
    pendingApproval: bigint,
    rawEntrySum: bigint,
    pendingAdjustmentCount: number,
  ): SupplierDebtSummary {
    const sum = (type: SupplierDebtEntryType): bigint => entryTotals.get(type) ?? 0n;
    return {
      supplierId,
      openingBalanceAmount: Number(sum('OPENING_BALANCE')),
      totalPurchase: Number(sum('PURCHASE')),
      totalPaid: Number(-sum('PAYMENT')),
      totalReturnAndAdjustment: Number(-sum('RETURN') - sum('ADJUSTMENT_DECREASE') + sum('ADJUSTMENT_INCREASE')),
      balance: Number(account?.balance ?? 0n),
      pendingApprovalAmount: Number(pendingApproval),
      canRecordOpeningBalance: account === null,
      pendingAdjustmentCount,
      balanceIntegrityOk: account === null || rawEntrySum === account.balance,
      lockedAsOfDate: account?.lockedAsOfDate?.toISOString() ?? null,
    };
  }

  async getSummary(tenantId: string, supplierId: string): Promise<SupplierDebtSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const account = await this.accountRepository.findBySupplierId(tx, tenantId, supplierId);
      const entries = account ? await this.entryRepository.listByAccountId(tx, tenantId, account.id) : [];
      const pendingMap = await this.cashVoucherRepository.sumPendingApprovalBySupplierIds(tx, tenantId, [supplierId]);
      const pendingAdjustmentMap = await this.adjustmentRepository.countPendingBySupplierIds(tx, tenantId, [supplierId]);
      return this.buildSummary(
        supplierId,
        account,
        this.sumByTypeExcludingReversed(entries),
        pendingMap.get(supplierId) ?? 0n,
        this.rawEntrySum(entries),
        pendingAdjustmentMap.get(supplierId) ?? 0,
      );
    });
  }

  /** `GET /supplier-debt/summaries` — trang "Nhà cung cấp" (cột "Còn nợ") + "Công nợ nhà cung cấp". */
  async listSummaries(tenantId: string, includeInactive: boolean): Promise<ListSupplierDebtSummariesResponse> {
    const items = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const suppliers = await this.supplierRepository.list(tx, tenantId, includeInactive);
      const supplierIds = suppliers.map((s) => s.id);
      const accounts = await this.accountRepository.listBySupplierIds(tx, tenantId, supplierIds);
      const accountBySupplierId = new Map(accounts.map((a) => [a.supplierId, a]));
      const allEntries = await this.entryRepository.listByAccountIds(
        tx,
        tenantId,
        accounts.map((a) => a.id),
      );
      const entriesByAccountId = new Map<string, SupplierDebtEntry[]>();
      for (const e of allEntries) {
        const list = entriesByAccountId.get(e.accountId) ?? [];
        list.push(e);
        entriesByAccountId.set(e.accountId, list);
      }
      const pendingMap = await this.cashVoucherRepository.sumPendingApprovalBySupplierIds(tx, tenantId, supplierIds);
      const pendingAdjustmentMap = await this.adjustmentRepository.countPendingBySupplierIds(tx, tenantId, supplierIds);

      return suppliers.map((s) => {
        const account = accountBySupplierId.get(s.id) ?? null;
        const entries = account ? (entriesByAccountId.get(account.id) ?? []) : [];
        return this.buildSummary(
          s.id,
          account,
          this.sumByTypeExcludingReversed(entries),
          pendingMap.get(s.id) ?? 0n,
          this.rawEntrySum(entries),
          pendingAdjustmentMap.get(s.id) ?? 0,
        );
      });
    });
    return { items };
  }

  /** Tab "Sổ công nợ" — CŨ→MỚI, `from`/`to` (nếu có) lọc theo `occurredAt` chỉ ở TẦNG HIỂN THỊ
   * (không ảnh hưởng số liệu — `balanceAfter` đã tính sẵn theo TOÀN BỘ lịch sử lúc ghi sổ). */
  async listLedger(tenantId: string, supplierId: string, query: ListSupplierDebtLedgerQuery): Promise<ListSupplierDebtLedgerResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const account = await this.accountRepository.findBySupplierId(tx, tenantId, supplierId);
      if (!account) return { items: [] };

      const all = await this.entryRepository.listByAccountId(tx, tenantId, account.id);
      const reversedIds = new Set(all.filter((e) => e.reversalOfId).map((e) => e.reversalOfId!));
      const fromDate = query.from ? new Date(`${query.from}T00:00:00+07:00`) : null;
      const toDate = query.to ? new Date(`${query.to}T23:59:59.999+07:00`) : null;
      const filtered = all.filter((e) => (!fromDate || e.occurredAt >= fromDate) && (!toDate || e.occurredAt <= toDate));

      const ids = new Set<string>();
      for (const e of filtered) ids.add(e.createdBy);
      const names = ids.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...ids]) : new Map<string, string>();

      const items = filtered.map((e) => ({
        id: e.id,
        entryType: e.entryType,
        amountChange: Number(e.amountChange),
        balanceAfter: Number(e.balanceAfter),
        occurredAt: e.occurredAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
        stockReceiptId: e.stockReceiptId,
        stockReceiptNo: null, // web tự ghép qua GET /inventory/receipts?supplierId= (xem shared/supplier-debt.ts)
        stockIssueId: e.stockIssueId,
        stockIssueNo: null, // cùng lý do trên — ghép qua GET /inventory/issues?supplierId= (Phần C)
        cashVoucherId: e.cashVoucherId,
        cashVoucherNo: null, // cùng lý do trên — ghép qua "Phiếu thanh toán NCC" (Phần B)
        reversalOfId: e.reversalOfId,
        reversed: reversedIds.has(e.id),
        note: e.note,
        createdByName: names.get(e.createdBy) ?? 'Không rõ',
      }));
      return { items };
    });
  }

  /** Tab "Phiếu nhập" — trạng thái đã trả/còn nợ của mỗi khoản PURCHASE/OPENING_BALANCE, tính bằng
   * `allocateSupplierDebt()` (@nexamed/core). Web tự ghép `receiptNo`/`occurredAt`/`voided` qua
   * `GET /inventory/receipts?supplierId=` theo `stockReceiptId` (xem `packages/shared/src/supplier-debt.ts`). */
  async listReceiptStatuses(tenantId: string, supplierId: string): Promise<ListSupplierDebtReceiptsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const account = await this.accountRepository.findBySupplierId(tx, tenantId, supplierId);
      if (!account) return { items: [], totalOriginalAmount: 0, totalPaidAmount: 0, totalDueAmount: 0 };

      const all = await this.entryRepository.listByAccountId(tx, tenantId, account.id);
      const { items: allocated } = allocateSupplierDebt(this.toEntryInputs(all));
      const items = allocated
        .filter((it) => it.entryType === 'PURCHASE' || it.entryType === 'OPENING_BALANCE')
        .map((it) => ({
          stockReceiptId: it.stockReceiptId,
          isOpeningBalance: it.entryType === 'OPENING_BALANCE',
          originalAmount: it.originalAmount,
          paidAmount: it.paidAmount,
          dueAmount: it.dueAmount,
          status: it.status,
        }));
      return {
        items,
        totalOriginalAmount: items.reduce((sum, it) => sum + it.originalAmount, 0),
        totalPaidAmount: items.reduce((sum, it) => sum + it.paidAmount, 0),
        totalDueAmount: items.reduce((sum, it) => sum + it.dueAmount, 0),
      };
    });
  }

  /** Phần B — `GET /supplier-debt/payments` — trang "Phiếu thanh toán NCC" (mọi NCC, lọc được theo
   * 1 NCC) + tab "Thanh toán" trên trang chi tiết NCC (`supplierId` cố định). Mọi `cash_voucher` có
   * `supplierId` (Trả ngay lúc nhập LẪN Thanh toán công nợ Phần B) — chưa có nguồn INCOME nào (Phần
   * C "NCC hoàn tiền" chưa code). Mặc định 90 ngày gần nhất khi bỏ trống `from`/`to` (S6-03 #142). */
  async listPayments(tenantId: string, query: ListSupplierDebtPaymentsQuery): Promise<ListSupplierDebtPaymentsResponse> {
    const { from, to } = resolveRecentDateRange(query.from, query.to);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.cashVoucherRepository.listSupplierLinked(tx, tenantId, { supplierId: query.supplierId, from, to, status: query.status });
      const suppliers = await this.supplierRepository.list(tx, tenantId, true);
      const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));

      const userIds = new Set<string>();
      for (const r of rows) {
        userIds.add(r.createdBy);
        if (r.approvedBy) userIds.add(r.approvedBy);
      }
      const names = userIds.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...userIds]) : new Map<string, string>();

      let pendingApprovalCount = 0;
      const items = rows.map((r) => {
        if (r.status === 'PENDING_APPROVAL' && !r.deletedAt) pendingApprovalCount += 1;
        return {
          id: r.id,
          voucherNo: r.voucherNo,
          direction: r.direction,
          amount: Number(r.amount),
          paymentMethodCode: r.paymentMethodCode,
          occurredAt: r.occurredAt.toISOString(),
          description: r.description,
          status: r.status,
          voided: r.deletedAt !== null,
          supplierId: r.supplierId!,
          supplierName: supplierNameById.get(r.supplierId!) ?? 'Không rõ',
          createdByName: names.get(r.createdBy) ?? 'Không rõ',
          approvedByName: r.approvedBy ? (names.get(r.approvedBy) ?? 'Không rõ') : null,
          approvedAt: r.approvedAt?.toISOString() ?? null,
          rejectionReason: r.rejectionReason,
        };
      });
      return { items, pendingApprovalCount };
    });
  }

  private async toAdjustmentDtos(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: SupplierDebtAdjustmentRow[],
  ): Promise<SupplierDebtAdjustmentDto[]> {
    const suppliers = await this.supplierRepository.list(tx, tenantId, true);
    const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.createdBy);
      if (r.approvedBy) userIds.add(r.approvedBy);
    }
    const names = userIds.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...userIds]) : new Map<string, string>();

    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      supplierId: r.supplierId,
      supplierName: supplierNameById.get(r.supplierId) ?? 'Không rõ',
      adjustmentNo: r.adjustmentNo,
      kind: r.kind,
      amount: r.amount !== null ? Number(r.amount) : null,
      targetReceiptId: r.targetReceiptId,
      targetIssueId: r.targetIssueId,
      targetVoucherId: r.targetVoucherId,
      reason: r.reason,
      evidenceRef: r.evidenceRef,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      createdByName: names.get(r.createdBy) ?? 'Không rõ',
      approvedByName: r.approvedBy ? (names.get(r.approvedBy) ?? 'Không rõ') : null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      // #182 câu 1 — CHO PHÉP người có quyền duyệt tự lập rồi tự duyệt luôn (phòng khám nhỏ chỉ 1
      // quản lý); nhãn "Tự duyệt" giữ dấu vết thay vì cấm hẳn.
      selfApproved: r.approvedBy !== null && r.approvedBy === r.createdBy,
      rejectionReason: r.rejectionReason,
    }));
  }

  /**
   * Phần D, Tầng 2 "Đề nghị huỷ" (`kind='VOID_REQUEST'`, người KHÔNG có quyền duyệt phiếu nhập/xuất
   * gốc) + Tầng 3 "Phiếu điều chỉnh công nợ" (`kind='INCREASE'|'DECREASE'`, KHÔNG đụng tồn kho/giá
   * vốn) — `POST /supplier-debt/adjustments`. Validate `VOID_REQUEST`: phiếu đích PHẢI đang gắn NCC
   * (có bút toán PURCHASE/RETURN còn hiệu lực) VÀ thuộc ĐÚNG NCC đã chọn — không kiểm `status` phiếu
   * ở đây (nếu phiếu đã bị huỷ trước đó, `approveAdjustment()` sẽ thất bại rõ ràng ở bước thực thi,
   * người duyệt Từ chối thay vì âm thầm sai). KHÔNG đụng sổ công nợ ở bước tạo — chỉ lúc Duyệt.
   */
  async createAdjustment(tenantId: string, actorId: string, dto: CreateSupplierDebtAdjustmentRequest, meta: RequestMeta): Promise<SupplierDebtAdjustmentDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, dto.supplierId);
      if (!supplier) throw new NotFoundException();

      if (dto.kind === 'VOID_REQUEST') {
        const targetEntry = dto.targetReceiptId
          ? await this.entryRepository.findActiveByStockReceiptId(tx, tenantId, dto.targetReceiptId)
          : await this.entryRepository.findActiveByStockIssueId(tx, tenantId, dto.targetIssueId!);
        if (!targetEntry) {
          throw new UnprocessableEntityException('Phiếu này không gắn nhà cung cấp hoặc không hợp lệ để đề nghị huỷ.');
        }
        const targetAccount = await this.accountRepository.findById(tx, tenantId, targetEntry.accountId);
        if (!targetAccount || targetAccount.supplierId !== dto.supplierId) {
          throw new UnprocessableEntityException('Phiếu này không thuộc nhà cung cấp đã chọn.');
        }
      }

      const adjustmentNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'SUPPLIER_DEBT_ADJUSTMENT', new Date());
      const row = await this.adjustmentRepository.create(tx, tenantId, actorId, {
        supplierId: dto.supplierId,
        adjustmentNo,
        kind: dto.kind,
        amount: dto.amount != null ? BigInt(dto.amount) : null,
        targetReceiptId: dto.targetReceiptId ?? null,
        targetIssueId: dto.targetIssueId ?? null,
        targetVoucherId: dto.targetVoucherId ?? null,
        reason: dto.reason,
        evidenceRef: dto.evidenceRef ?? null,
      });
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'supplier_debt_adjustment.created',
        entityType: 'supplier_debt_adjustment',
        entityId: row.id,
        afterJson: { supplierId: dto.supplierId, kind: dto.kind, amount: dto.amount ?? null, reason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const [item] = await this.toAdjustmentDtos(tx, tenantId, [row]);
      return item!;
    });
  }

  /**
   * Duyệt "Phiếu điều chỉnh công nợ"/"Đề nghị huỷ" — perm `supplier_debt.approve` (KHÔNG cần thêm
   * `stock_receipt.approve`/`stock_issue.create` của người duyệt, chốt qua AskUserQuestion phiên
   * này — mặc định chỉ `clinic_admin` có `supplier_debt.approve` nên luôn đủ thẩm quyền thực tế).
   * `INCREASE`/`DECREASE` ghi thẳng bút toán; `VOID_REQUEST` gọi `StockReceiptService`/
   * `StockIssueService.voidPostedForAdjustment()` (chạy TRONG CÙNG transaction — tự đảo công nợ qua
   * hook đã gắn sẵn ở `voidPostedCore()`, không gọi lại `reverseStockEntry()` ở đây). TOÀN BỘ trong
   * 1 transaction — nguyên tử giữa "Huỷ chứng từ"/"ghi bút toán" và "chuyển trạng thái Đã duyệt".
   */
  async approveAdjustment(tenantId: string, actorId: string, id: string, dto: ApproveSupplierDebtAdjustmentRequest, meta: RequestMeta): Promise<SupplierDebtAdjustmentDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const adjustment = await this.adjustmentRepository.findById(tx, tenantId, id);
      if (!adjustment) throw new NotFoundException();
      if (adjustment.status !== 'PENDING_APPROVAL') throw new SupplierDebtAdjustmentNotPendingError();

      if (adjustment.kind === 'VOID_REQUEST') {
        if (adjustment.targetReceiptId) {
          await this.stockReceiptService.voidPostedForAdjustment(tx, tenantId, actorId, adjustment.targetReceiptId, adjustment.reason, meta);
        } else {
          await this.stockIssueService.voidPostedForAdjustment(tx, tenantId, actorId, adjustment.targetIssueId!, adjustment.reason, meta);
        }
      } else {
        const account0 = await this.getOrCreateAccount(tx, tenantId, actorId, adjustment.supplierId);
        // Phần E — CHỈ khi gắn 1 chứng từ cũ cụ thể (`targetReceiptId`/`targetIssueId`, tuỳ chọn cho
        // INCREASE/DECREASE) mới có "chứng từ có ngày ≤ ngày chốt" bị đụng tới; không có target thì
        // đây chỉ là 1 khoản điều chỉnh số dư mới (dated hôm nay), không chạm lịch sử, bỏ qua kiểm.
        const targetEntry = adjustment.targetReceiptId
          ? await this.entryRepository.findActiveByStockReceiptId(tx, tenantId, adjustment.targetReceiptId)
          : adjustment.targetIssueId
            ? await this.entryRepository.findActiveByStockIssueId(tx, tenantId, adjustment.targetIssueId)
            : null;
        if (targetEntry) {
          await assertSupplierDebtWritable(tx, tenantId, actorId, account0.lockedAsOfDate, targetEntry.occurredAt);
        }
        const entryType: SupplierDebtEntryType = adjustment.kind === 'INCREASE' ? 'ADJUSTMENT_INCREASE' : 'ADJUSTMENT_DECREASE';
        const amountChange = adjustment.kind === 'INCREASE' ? adjustment.amount! : -adjustment.amount!;
        await this.applyEntry(tx, tenantId, actorId, account0, {
          entryType,
          amountChange,
          occurredAt: new Date(),
          stockReceiptId: adjustment.targetReceiptId,
          stockIssueId: adjustment.targetIssueId,
          cashVoucherId: null,
          reversalOfId: null,
          adjustmentId: adjustment.id,
          note: adjustment.reason,
        });
      }

      const count = await this.adjustmentRepository.markApproved(tx, tenantId, id, dto.version, actorId, new Date());
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'supplier_debt_adjustment.approved',
        entityType: 'supplier_debt_adjustment',
        entityId: id,
        afterJson: { kind: adjustment.kind, selfApproved: actorId === adjustment.createdBy },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const approved = await this.adjustmentRepository.findById(tx, tenantId, id);
      const [item] = await this.toAdjustmentDtos(tx, tenantId, [approved!]);
      return item!;
    });
  }

  async rejectAdjustment(tenantId: string, actorId: string, id: string, dto: RejectSupplierDebtAdjustmentRequest, meta: RequestMeta): Promise<SupplierDebtAdjustmentDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const adjustment = await this.adjustmentRepository.findById(tx, tenantId, id);
      if (!adjustment) throw new NotFoundException();
      if (adjustment.status !== 'PENDING_APPROVAL') throw new SupplierDebtAdjustmentNotPendingError();

      const count = await this.adjustmentRepository.markRejected(tx, tenantId, id, dto.version, actorId, dto.rejectionReason);
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'supplier_debt_adjustment.rejected',
        entityType: 'supplier_debt_adjustment',
        entityId: id,
        afterJson: { kind: adjustment.kind, rejectionReason: dto.rejectionReason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      // Phần E — phiếu điều chỉnh này do 1 "Biên bản đối chiếu" tự sinh ra (chênh lệch) mà bị Từ
      // chối → biên bản đó chuyển "Đã huỷ" (quyết định chốt qua AskUserQuestion: KHÔNG cho sửa lại,
      // phải lập biên bản mới — giữ nguyên bản cũ để tra vết, đúng nguyên tắc "bản ghi bất biến").
      const linkedReconciliation = await this.reconciliationRepository.findByResultingAdjustmentId(tx, tenantId, id);
      if (linkedReconciliation) {
        await this.reconciliationRepository.markCancelled(tx, tenantId, linkedReconciliation.id, actorId);
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'supplier_debt_reconciliation.cancelled',
          entityType: 'supplier_debt_reconciliation',
          entityId: linkedReconciliation.id,
          afterJson: { reason: 'resulting_adjustment_rejected', adjustmentId: id },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      const rejected = await this.adjustmentRepository.findById(tx, tenantId, id);
      const [item] = await this.toAdjustmentDtos(tx, tenantId, [rejected!]);
      return item!;
    });
  }

  /** Tab "Nhật ký điều chỉnh" (trang chi tiết NCC) + badge "Có điều chỉnh" trên
   * `StockReceiptFormPage`/`StockIssueFormPage` (`targetReceiptId`/`targetIssueId`). */
  async listAdjustments(tenantId: string, query: ListSupplierDebtAdjustmentsQuery): Promise<ListSupplierDebtAdjustmentsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.adjustmentRepository.list(tx, tenantId, query);
      const items = await this.toAdjustmentDtos(tx, tenantId, rows);
      return { items };
    });
  }

  // ============ Phần E "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md #182 câu 3) ============

  /** `yyyy-mm-dd` → cuối ngày giờ Việt Nam (đúng khuôn `listLedger()`'s `toDate`) — bao trọn mọi
   * chứng từ trong ngày đối chiếu. */
  private parseAsOfDate(asOfDate: string): Date {
    return new Date(`${asOfDate}T23:59:59.999+07:00`);
  }

  /** "Số hệ thống tại ngày X" — `0` nếu NCC chưa từng có bút toán nào (chưa có account). */
  private async computeSystemBalanceAsOf(tx: Prisma.TransactionClient, tenantId: string, supplierId: string, asOfDate: Date): Promise<number> {
    const account = await this.accountRepository.findBySupplierId(tx, tenantId, supplierId);
    if (!account) return 0;
    const sum = await this.entryRepository.sumAmountChangeAsOf(tx, tenantId, account.id, asOfDate);
    return Number(sum);
  }

  /** `GET /supplier-debt/:supplierId/reconciliation-preview` — chỉ đọc, không ghi gì. Dùng cho ô
   * xem trước trong dialog "Lập biên bản đối chiếu" TRƯỚC khi submit. */
  async previewReconciliation(tenantId: string, supplierId: string, asOfDate: string, confirmedBalance: number): Promise<PreviewSupplierDebtReconciliationResponse> {
    const parsedAsOfDate = this.parseAsOfDate(asOfDate);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const systemBalance = await this.computeSystemBalanceAsOf(tx, tenantId, supplierId, parsedAsOfDate);
      const { differenceAmount } = computeSupplierDebtReconciliationOutcome(systemBalance, confirmedBalance);
      return { systemBalance, confirmedBalance, differenceAmount };
    });
  }

  /**
   * `POST /supplier-debt/:supplierId/reconciliations` — "Lập biên bản đối chiếu" (gộp 1 bước, chốt
   * qua AskUserQuestion, kế hoạch `playful-baking-kazoo.md`). Tính `systemBalance`/`differenceAmount`
   * ngay; khớp (`0`) → tự CHỐT trong CÙNG transaction; lệch → tự sinh `supplier_debt_adjustment`
   * `PENDING_APPROVAL` (kind theo dấu chênh lệch), giữ `DRAFT` — phải Duyệt phiếu đó rồi gọi
   * `finalizeReconciliation()` riêng.
   */
  async createReconciliation(
    tenantId: string,
    actorId: string,
    supplierId: string,
    dto: CreateSupplierDebtReconciliationRequest,
    meta: RequestMeta,
  ): Promise<SupplierDebtReconciliationDto> {
    const asOfDate = this.parseAsOfDate(dto.asOfDate);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();

      const latestFinalizedAsOfDate = await this.reconciliationRepository.findLatestFinalizedAsOfDate(tx, tenantId, supplierId);
      if (latestFinalizedAsOfDate && asOfDate.getTime() <= latestFinalizedAsOfDate.getTime()) {
        throw new SupplierDebtReconciliationAsOfDateTooEarlyError();
      }

      const systemBalance = await this.computeSystemBalanceAsOf(tx, tenantId, supplierId, asOfDate);
      const outcome = computeSupplierDebtReconciliationOutcome(systemBalance, dto.confirmedBalance);
      const reconciliationNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'SUPPLIER_DEBT_RECONCILIATION', new Date());

      let resultingAdjustmentId: string | null = null;
      if (outcome.adjustmentKind) {
        const adjustmentNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'SUPPLIER_DEBT_ADJUSTMENT', new Date());
        const adjustmentRow = await this.adjustmentRepository.create(tx, tenantId, actorId, {
          supplierId,
          adjustmentNo,
          kind: outcome.adjustmentKind,
          amount: BigInt(outcome.adjustmentAmount!),
          targetReceiptId: null,
          targetIssueId: null,
          targetVoucherId: null,
          reason: `Tự sinh từ Biên bản đối chiếu ${reconciliationNo} (đối chiếu tại ngày ${dto.asOfDate}) — số hệ thống ${systemBalance.toLocaleString('vi-VN')}đ, NCC xác nhận ${dto.confirmedBalance.toLocaleString('vi-VN')}đ.`,
          evidenceRef: reconciliationNo,
        });
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'supplier_debt_adjustment.created',
          entityType: 'supplier_debt_adjustment',
          entityId: adjustmentRow.id,
          afterJson: { supplierId, kind: outcome.adjustmentKind, amount: outcome.adjustmentAmount, reconciliationNo },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        resultingAdjustmentId = adjustmentRow.id;
      }

      const row = await this.reconciliationRepository.create(tx, tenantId, actorId, {
        supplierId,
        reconciliationNo,
        asOfDate,
        systemBalance: BigInt(systemBalance),
        confirmedBalance: BigInt(dto.confirmedBalance),
        differenceAmount: BigInt(outcome.differenceAmount),
        resultingAdjustmentId,
        note: dto.note ?? null,
      });
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'supplier_debt_reconciliation.created',
        entityType: 'supplier_debt_reconciliation',
        entityId: row.id,
        afterJson: { supplierId, asOfDate: dto.asOfDate, systemBalance, confirmedBalance: dto.confirmedBalance, differenceAmount: outcome.differenceAmount },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      if (outcome.adjustmentKind === null) {
        // Khớp tuyệt đối — tự Chốt NGAY trong CÙNG transaction (gộp 1 bước, #182 câu 3).
        await this.finalizeReconciliationCore(tx, tenantId, actorId, row, row.version, meta);
      }

      const finalRow = await this.reconciliationRepository.findById(tx, tenantId, row.id);
      const [item] = await this.toReconciliationDtos(tx, tenantId, [finalRow!]);
      return item!;
    });
  }

  /** Lõi "Chốt biên bản" dùng chung cho đường tự-chốt-ngay (`createReconciliation()`, khớp tuyệt
   * đối) và `finalizeReconciliation()` (đường lệch, sau khi phiếu điều chỉnh đã Duyệt) — nâng
   * `SupplierDebtAccount.lockedAsOfDate = max(hiện tại, asOfDate)` + chuyển biên bản `FINALIZED`,
   * TRONG CÙNG transaction (nguyên tử, đúng khuôn `voidPostedCore()` Phần D). `expectedVersion` của
   * BIÊN BẢN tách riêng khỏi `reconciliation.version` (đọc sẵn) để `finalizeReconciliation()` có thể
   * truyền `version` do CLIENT gửi lên (bắt đúng race 2 người cùng bấm "Chốt") — đường tự-chốt-ngay
   * dùng thẳng `row.version` (vừa tạo, không ai khác biết `id` để race). */
  private async finalizeReconciliationCore(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    reconciliation: SupplierDebtReconciliationRow,
    expectedVersion: number,
    meta: RequestMeta,
  ): Promise<void> {
    const account = await this.getOrCreateAccount(tx, tenantId, actorId, reconciliation.supplierId);
    const newLockedAsOfDate =
      !account.lockedAsOfDate || reconciliation.asOfDate.getTime() > account.lockedAsOfDate.getTime() ? reconciliation.asOfDate : account.lockedAsOfDate;
    const lockCount = await this.accountRepository.updateLockedAsOfDate(tx, tenantId, account.id, account.version, actorId, newLockedAsOfDate);
    if (lockCount === 0) throw new ConcurrentModificationError();

    const finalizedAt = new Date();
    const count = await this.reconciliationRepository.markFinalized(tx, tenantId, reconciliation.id, expectedVersion, actorId, finalizedAt);
    if (count === 0) throw new ConcurrentModificationError();

    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'supplier_debt_reconciliation.finalized',
      entityType: 'supplier_debt_reconciliation',
      entityId: reconciliation.id,
      afterJson: { supplierId: reconciliation.supplierId, asOfDate: reconciliation.asOfDate.toISOString(), lockedAsOfDate: newLockedAsOfDate.toISOString() },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** `POST /supplier-debt/:supplierId/reconciliations/:id/finalize` — đường "lệch": gọi SAU khi
   * phiếu điều chỉnh tự sinh (`resultingAdjustmentId`) đã được Duyệt (`APPROVED`). Chưa Duyệt/đã Từ
   * chối/biên bản không còn `DRAFT` → `SupplierDebtReconciliationNotReadyError` (409). */
  async finalizeReconciliation(
    tenantId: string,
    actorId: string,
    supplierId: string,
    id: string,
    dto: FinalizeSupplierDebtReconciliationRequest,
    meta: RequestMeta,
  ): Promise<SupplierDebtReconciliationDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const reconciliation = await this.reconciliationRepository.findById(tx, tenantId, id);
      if (!reconciliation || reconciliation.supplierId !== supplierId) throw new NotFoundException();
      if (reconciliation.status !== 'DRAFT') throw new SupplierDebtReconciliationNotReadyError();

      if (reconciliation.resultingAdjustmentId) {
        const adjustment = await this.adjustmentRepository.findById(tx, tenantId, reconciliation.resultingAdjustmentId);
        if (!adjustment || adjustment.status !== 'APPROVED') throw new SupplierDebtReconciliationNotReadyError();
      }

      await this.finalizeReconciliationCore(tx, tenantId, actorId, reconciliation, dto.version, meta);

      const finalRow = await this.reconciliationRepository.findById(tx, tenantId, id);
      const [item] = await this.toReconciliationDtos(tx, tenantId, [finalRow!]);
      return item!;
    });
  }

  /** Tab "Đối chiếu & Chốt kỳ" (trang chi tiết NCC). */
  async listReconciliations(tenantId: string, supplierId: string): Promise<ListSupplierDebtReconciliationsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const supplier = await this.supplierRepository.findById(tx, tenantId, supplierId);
      if (!supplier) throw new NotFoundException();
      const rows = await this.reconciliationRepository.list(tx, tenantId, supplierId);
      const items = await this.toReconciliationDtos(tx, tenantId, rows);
      return { items };
    });
  }

  private async toReconciliationDtos(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: SupplierDebtReconciliationRow[],
  ): Promise<SupplierDebtReconciliationDto[]> {
    const adjustmentIds = rows.filter((r) => r.resultingAdjustmentId).map((r) => r.resultingAdjustmentId!);
    const adjustments = await this.adjustmentRepository.findByIds(tx, tenantId, adjustmentIds);
    const adjustmentStatusById = new Map(adjustments.map((a) => [a.id, a.status]));

    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.createdBy);
      if (r.finalizedBy) userIds.add(r.finalizedBy);
    }
    const names = userIds.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...userIds]) : new Map<string, string>();

    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      supplierId: r.supplierId,
      reconciliationNo: r.reconciliationNo,
      asOfDate: r.asOfDate.toISOString(),
      systemBalance: Number(r.systemBalance),
      confirmedBalance: Number(r.confirmedBalance),
      differenceAmount: Number(r.differenceAmount),
      resultingAdjustmentId: r.resultingAdjustmentId,
      resultingAdjustmentStatus: r.resultingAdjustmentId ? (adjustmentStatusById.get(r.resultingAdjustmentId) ?? null) : null,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      createdByName: names.get(r.createdBy) ?? 'Không rõ',
      finalizedByName: r.finalizedBy ? (names.get(r.finalizedBy) ?? 'Không rõ') : null,
      finalizedAt: r.finalizedAt?.toISOString() ?? null,
    }));
  }
}
