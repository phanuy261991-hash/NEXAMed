import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CASHIER_SHIFT_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  getVietnamDateString,
  REFERENCE_CATALOG_READER_PORT,
  stripVietnameseDiacritics,
  vietnamDayRange,
  WalletClosedError,
  WalletInsufficientBalanceError,
  type CashierShiftReaderPort,
  type DoctorDirectoryPort,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import type {
  ListWalletsQuery,
  ListWalletsResponse,
  ListWalletTransactionsQuery,
  ListWalletTransactionsResponse,
  PatientWallet as PatientWalletDto,
  SettleWalletRequest,
  SettleWalletResponse,
  TopUpWalletRequest,
  TopUpWalletResponse,
} from '@nexamed/shared';
import type { PatientWallet } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { CashAccountRepository } from '../cash-book/cash-account.repository';
import { CashVoucherRepository } from '../cash-book/cash-voucher.repository';
import { PatientRepository } from '../patient/patient.repository';
import { PatientWalletRepository, type WalletTotals } from './patient-wallet.repository';

export interface WalletSnapshot {
  id: string;
  balance: bigint;
  status: 'ACTIVE' | 'CLOSED';
  version: number;
}

/**
 * "Ví tạm ứng" (Patient Advance-Payment Wallet) — bệnh nhân nộp tiền trước, hệ thống tự cấn trừ
 * khi phát sinh phiếu thu (tiếp nhận). API THUẦN cho module khác gọi (`tryGetActiveWallet`/
 * `deduct`/`creditBack` nhận `tx` ĐÃ MỞ sẵn từ Reception/Billing — chia sẻ transaction giữa module,
 * đúng tiền lệ #042) — service này KHÔNG tự đánh dấu `invoice` đã thu (đó là việc của phía gọi,
 * vốn đã có `InvoiceRepository`/`PaymentRepository` riêng). Nạp/tất toán (`credit`/`settle`) tạo
 * `cash_voucher` thật (tiền vào/ra két) — tự động vào Chốt ca/Sổ quỹ/Báo cáo dòng tiền mà không
 * phải sửa gì ở 3 chỗ đó, vì bản chất vẫn là 1 `cash_voucher` bình thường.
 */
@Injectable()
export class PatientWalletService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly walletRepository: PatientWalletRepository,
    private readonly patientRepository: PatientRepository,
    private readonly cashVoucherRepository: CashVoucherRepository,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly businessCodeService: BusinessCodeService,
    @Inject(CASHIER_SHIFT_READER_PORT) private readonly cashierShiftReader: CashierShiftReaderPort,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /**
   * KHÁC `InvoiceService.resolveCashAccountId()` (billing) — bên đó resolve cho `payment.
   * cashAccountId` (NULLABLE, chỉ có ý nghĩa với tiền mặt vào TRỰC TIẾP két, phương thức khác trả
   * `null` vì không cần đối soát). Ở đây resolve cho `cash_voucher.cashAccountId` (BẮT BUỘC có giá
   * trị — mọi phiếu thu/chi đều phải gắn đúng 1 "Quỹ", kể cả chuyển khoản/thẻ, đúng cách
   * `CashVoucherService.create()` nhận `dto.cashAccountId` trực tiếp từ client). Tiền mặt
   * (`countsAsCash`) → két riêng (`drawerAccountId`, "Thủ quỹ riêng" GĐ2) nếu có, không thì quỹ
   * CASH mặc định; phương thức khác → quỹ BANK mặc định. `null` nếu tenant chưa cấu hình quỹ tương
   * ứng — phía gọi (`credit()`/`settle()`) tự ném lỗi rõ ràng thay vì để Prisma báo lỗi FK mơ hồ.
   */
  private async resolveVoucherCashAccountId(tx: Prisma.TransactionClient, tenantId: string, method: string, drawerAccountId: string | null): Promise<string | null> {
    const meta = await this.referenceCatalogReader.listByCategory(tenantId, 'PAYMENT_METHOD');
    const isCash = meta.find((m) => m.code === method)?.countsAsCash ?? false;
    if (isCash) {
      if (drawerAccountId) {
        return drawerAccountId;
      }
      const account = await this.cashAccountRepository.findDefault(tx, tenantId, 'CASH');
      return account?.id ?? null;
    }
    const account = await this.cashAccountRepository.findDefault(tx, tenantId, 'BANK');
    return account?.id ?? null;
  }

  private async getOrCreate(tx: Prisma.TransactionClient, tenantId: string, actorId: string, patientId: string): Promise<PatientWallet> {
    const existing = await this.walletRepository.findByPatientId(tx, tenantId, patientId);
    if (existing) return existing;
    return this.walletRepository.create(tx, tenantId, actorId, patientId);
  }

  private toDto(wallet: PatientWallet, totals: WalletTotals, lastTransactionAt: Date | null): PatientWalletDto {
    return {
      id: wallet.id,
      patientId: wallet.patientId,
      balance: Number(wallet.balance),
      status: wallet.status,
      totalToppedUp: Number(totals.totalToppedUp),
      totalUsed: Number(totals.totalUsed),
      topUpCount: totals.topUpCount,
      deductCount: totals.deductCount,
      lastTransactionAt: lastTransactionAt?.toISOString() ?? null,
      closedAt: wallet.closedAt?.toISOString() ?? null,
      version: wallet.version,
    };
  }

  /**
   * Dùng bởi Reception (auto-deduct lúc tiếp nhận) và Billing (`pay-with-wallet`) — `tx` ĐÃ MỞ
   * sẵn từ phía gọi. `null` khi bệnh nhân chưa từng có ví hoặc ví đã khoá (Tất toán) — phía gọi tự
   * quyết định tiếp (bỏ qua auto-deduct, hoặc hiện phương thức khác ở màn thanh toán).
   */
  async tryGetActiveWallet(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<WalletSnapshot | null> {
    const wallet = await this.walletRepository.findByPatientId(tx, tenantId, patientId);
    if (!wallet || wallet.status !== 'ACTIVE') return null;
    return { id: wallet.id, balance: wallet.balance, status: wallet.status, version: wallet.version };
  }

  /**
   * Trừ ví — phía gọi (Reception/Billing) PHẢI tự kiểm số dư đủ TRƯỚC khi gọi (qua
   * `tryGetActiveWallet`) rồi mới tự đánh dấu `invoice` đã thu; hàm này chỉ ghi nhận biến động ví,
   * KHÔNG đụng gì tới `invoice`/`payment`. Vẫn tự kiểm lại optimistic lock + số dư (double-check,
   * chống race 2 request cấn trừ đồng thời).
   */
  async deduct(tx: Prisma.TransactionClient, tenantId: string, actorId: string, patientId: string, amount: bigint, invoiceId: string, meta: RequestMeta): Promise<void> {
    const wallet = await this.walletRepository.findByPatientId(tx, tenantId, patientId);
    if (!wallet || wallet.status !== 'ACTIVE') {
      throw new WalletClosedError();
    }
    const newBalance = wallet.balance - amount;
    if (newBalance < 0n) {
      throw new WalletInsufficientBalanceError(Number(wallet.balance), Number(amount), Number(amount - wallet.balance));
    }
    const count = await this.walletRepository.updateBalance(tx, tenantId, wallet.id, wallet.version, actorId, newBalance);
    if (count === 0) {
      throw new ConcurrentModificationError();
    }
    await this.walletRepository.createTransaction(tx, tenantId, actorId, { walletId: wallet.id, type: 'DEDUCT', amount, balanceAfter: newBalance, invoiceId });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'patient_wallet.deducted',
      entityType: 'patient_wallet',
      entityId: wallet.id,
      afterJson: { amount: amount.toString(), invoiceId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Cộng lại ví — huỷ lượt khám đã trừ ví (`InvoiceService.refund()`), hoặc "Đánh dấu chưa thu"
   * đảo ngược 1 dòng WALLET (`InvoiceService.revertPayment()`). LUÔN thành công (tiền quay lại ví
   * là hợp lệ dù ví đang ở trạng thái nào) — KHÔNG tự đổi `status`: ví đã khoá (Tất toán) vẫn cộng
   * được, để lại số dư dương bất thường là tín hiệu cho quản lý xử lý tay (hiếm gặp — tất toán rồi
   * mới phát sinh hoàn tiền của giao dịch cũ).
   */
  async creditBack(tx: Prisma.TransactionClient, tenantId: string, actorId: string, patientId: string, amount: bigint, invoiceId: string, note: string, meta: RequestMeta): Promise<void> {
    const wallet = await this.getOrCreate(tx, tenantId, actorId, patientId);
    const newBalance = wallet.balance + amount;
    const count = await this.walletRepository.updateBalance(tx, tenantId, wallet.id, wallet.version, actorId, newBalance);
    if (count === 0) {
      throw new ConcurrentModificationError();
    }
    await this.walletRepository.createTransaction(tx, tenantId, actorId, { walletId: wallet.id, type: 'REFUND', amount, balanceAfter: newBalance, invoiceId, note });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'patient_wallet.credited_back',
      entityType: 'patient_wallet',
      entityId: wallet.id,
      afterJson: { amount: amount.toString(), invoiceId, note },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Core nạp tiền — dùng bởi `topUp()` (endpoint riêng, tự mở transaction) VÀ
   * `InvoiceService.topUpAndPayWithWallet()` (Billing, trong transaction CỦA CHÍNH billing — `tx`
   * nhận từ tham số, không tự mở). Tự tạo ví nếu bệnh nhân chưa từng có (nạp lần đầu).
   */
  async credit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    patientId: string,
    amount: bigint,
    paymentMethodCode: string,
    cashAccountIdInput: string | undefined,
    note: string | undefined,
    meta: RequestMeta,
  ): Promise<{ balance: bigint; voucherNo: string; occurredAt: Date }> {
    const wallet = await this.getOrCreate(tx, tenantId, actorId, patientId);
    if (wallet.status !== 'ACTIVE') {
      throw new WalletClosedError();
    }
    const patient = await this.patientRepository.findById(tx, tenantId, patientId);
    if (!patient) {
      throw new NotFoundException();
    }
    const [cashierShiftId, drawerAccountId] = await Promise.all([
      this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId),
      this.cashierShiftReader.getCashAccountIdForActor(tenantId, actorId),
    ]);
    const cashAccountId = cashAccountIdInput ?? (await this.resolveVoucherCashAccountId(tx, tenantId, paymentMethodCode, drawerAccountId));
    if (!cashAccountId) {
      throw new BadRequestException('Chưa có quỹ nào để nhận tiền — tạo Quỹ tiền mặt/ngân hàng trước khi nạp tạm ứng.');
    }
    const occurredAt = new Date();
    const voucherNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'WALLET_TOPUP', occurredAt);
    const voucher = await this.cashVoucherRepository.create(tx, tenantId, actorId, {
      voucherNo,
      direction: 'INCOME',
      incomeExpenseTypeCode: 'PATIENT_ADVANCE',
      cashAccountId,
      paymentMethodCode,
      amount,
      occurredAt,
      partnerName: patient.fullName,
      description: `Nạp tạm ứng — ${patient.fullName} (${patient.patientCode})`,
      status: 'POSTED',
      cashierShiftId,
    });
    const newBalance = wallet.balance + amount;
    const count = await this.walletRepository.updateBalance(tx, tenantId, wallet.id, wallet.version, actorId, newBalance);
    if (count === 0) {
      throw new ConcurrentModificationError();
    }
    await this.walletRepository.createTransaction(tx, tenantId, actorId, {
      walletId: wallet.id,
      type: 'TOPUP',
      amount,
      balanceAfter: newBalance,
      cashVoucherId: voucher.id,
      note,
    });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'patient_wallet.topped_up',
      entityType: 'patient_wallet',
      entityId: wallet.id,
      afterJson: { amount: amount.toString(), voucherNo },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { balance: newBalance, voucherNo, occurredAt };
  }

  /** `POST /wallet/topup` — endpoint riêng, tự mở transaction. */
  async topUp(tenantId: string, actorId: string, dto: TopUpWalletRequest, meta: RequestMeta): Promise<TopUpWalletResponse> {
    const result = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.credit(tx, tenantId, actorId, dto.patientId, BigInt(dto.amount), dto.paymentMethodCode, dto.cashAccountId, dto.note, meta),
    );
    const wallet = await this.getWallet(tenantId, dto.patientId);
    return { wallet: wallet!, voucherNo: result.voucherNo, occurredAt: result.occurredAt.toISOString() };
  }

  /** `POST /wallet/settle` — hoàn số dư còn lại (nếu >0, tạo phiếu chi) rồi khoá ví. */
  async settle(tenantId: string, actorId: string, dto: SettleWalletRequest, meta: RequestMeta): Promise<SettleWalletResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const wallet = await this.walletRepository.findByPatientId(tx, tenantId, dto.patientId);
      if (!wallet) {
        throw new NotFoundException();
      }
      if (wallet.status !== 'ACTIVE') {
        throw new WalletClosedError();
      }

      let voucherNo: string | null = null;
      if (wallet.balance > 0n) {
        if (!dto.paymentMethodCode) {
          throw new BadRequestException('Còn số dư trong ví — phải chọn phương thức hoàn tiền.');
        }
        const patient = await this.patientRepository.findById(tx, tenantId, dto.patientId);
        if (!patient) {
          throw new NotFoundException();
        }
        const [cashierShiftId, drawerAccountId] = await Promise.all([
          this.cashierShiftReader.getRelevantOpenShiftId(tenantId, actorId),
          this.cashierShiftReader.getCashAccountIdForActor(tenantId, actorId),
        ]);
        const cashAccountId = dto.cashAccountId ?? (await this.resolveVoucherCashAccountId(tx, tenantId, dto.paymentMethodCode, drawerAccountId));
        if (!cashAccountId) {
          throw new BadRequestException('Chưa có quỹ nào để chi tiền — tạo Quỹ tiền mặt/ngân hàng trước khi tất toán.');
        }
        const occurredAt = new Date();
        voucherNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'WALLET_SETTLEMENT', occurredAt);
        const voucher = await this.cashVoucherRepository.create(tx, tenantId, actorId, {
          voucherNo,
          direction: 'EXPENSE',
          incomeExpenseTypeCode: 'PATIENT_ADVANCE',
          cashAccountId,
          paymentMethodCode: dto.paymentMethodCode,
          amount: wallet.balance,
          occurredAt,
          partnerName: patient.fullName,
          description: `Tất toán ví tạm ứng — ${patient.fullName} (${patient.patientCode})`,
          status: 'POSTED',
          cashierShiftId,
        });
        await this.walletRepository.createTransaction(tx, tenantId, actorId, {
          walletId: wallet.id,
          type: 'SETTLEMENT',
          amount: wallet.balance,
          balanceAfter: 0n,
          cashVoucherId: voucher.id,
        });
      }

      const refundedAmount = wallet.balance;
      const count = await this.walletRepository.updateBalance(tx, tenantId, wallet.id, wallet.version, actorId, 0n, { closedAt: new Date() });
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient_wallet.settled',
        entityType: 'patient_wallet',
        entityId: wallet.id,
        afterJson: { refundedAmount: refundedAmount.toString(), voucherNo },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.walletRepository.findById(tx, tenantId, wallet.id);
      const totals = await this.walletRepository.getTotals(tx, tenantId, wallet.id);
      return { wallet: this.toDto(updated!, totals, new Date()), voucherNo };
    });
  }

  async getWallet(tenantId: string, patientId: string): Promise<PatientWalletDto | null> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const wallet = await this.walletRepository.findByPatientId(tx, tenantId, patientId);
      if (!wallet) return null;
      const totals = await this.walletRepository.getTotals(tx, tenantId, wallet.id);
      const [last] = await this.walletRepository.listTransactions(tx, tenantId, wallet.id, { take: 1 });
      return this.toDto(wallet, totals, last?.createdAt ?? null);
    });
  }

  async listTransactions(tenantId: string, patientId: string, query: ListWalletTransactionsQuery): Promise<ListWalletTransactionsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const wallet = await this.walletRepository.findByPatientId(tx, tenantId, patientId);
      if (!wallet) {
        return { items: [], nextCursor: null };
      }
      const rows = await this.walletRepository.listTransactions(tx, tenantId, wallet.id, { cursor: query.cursor, take: query.limit + 1 });
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const lastRow = page[page.length - 1];
      const actorIds = [...new Set(page.map((r) => r.createdBy))];
      const names = actorIds.length > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, actorIds) : new Map<string, string>();
      return {
        items: page.map((r) => ({
          id: r.id,
          type: r.type,
          amount: Number(r.amount),
          balanceAfter: Number(r.balanceAfter),
          invoiceId: r.invoiceId,
          invoiceNo: r.invoice?.invoiceNo ?? null,
          encounterId: r.invoice?.encounterId ?? null,
          cashVoucherId: r.cashVoucherId,
          voucherNo: r.cashVoucher?.voucherNo ?? null,
          note: r.note,
          createdByName: names.get(r.createdBy) ?? 'Không rõ',
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: hasMore && lastRow ? lastRow.id : null,
      };
    });
  }

  /** Trang "Ví tạm ứng" tổng hợp (Sổ quỹ & Thu chi) — quyền `patient_wallet.settle`. */
  async listWallets(tenantId: string, query: ListWalletsQuery): Promise<ListWalletsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const qNormalized = query.q ? stripVietnameseDiacritics(query.q) : undefined;
      const rows = await this.walletRepository.listWallets(tx, tenantId, {
        qRaw: query.q,
        qNormalized,
        status: query.status,
        cursor: query.cursor,
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const lastRow = page[page.length - 1];
      const walletIds = page.map((w) => w.id);
      const [totalsMap, lastTxRows] = await Promise.all([
        this.walletRepository.getTotalsForWallets(tx, tenantId, walletIds),
        Promise.all(walletIds.map((id) => this.walletRepository.listTransactions(tx, tenantId, id, { take: 1 }))),
      ]);
      const lastTxByWallet = new Map(walletIds.map((id, i) => [id, lastTxRows[i]?.[0]?.createdAt ?? null]));

      const today = getVietnamDateString();
      const { startUtc, endUtc } = vietnamDayRange(today);
      const stats = await this.walletRepository.getOverallStats(tx, tenantId, startUtc, endUtc);

      return {
        items: page.map((w) => {
          const totals = totalsMap.get(w.id) ?? { totalToppedUp: 0n, totalUsed: 0n };
          return {
            walletId: w.id,
            patientId: w.patientId,
            patientCode: w.patient.patientCode,
            fullName: w.patient.fullName,
            phone: w.patient.phone,
            balance: Number(w.balance),
            totalToppedUp: Number(totals.totalToppedUp),
            totalUsed: Number(totals.totalUsed),
            lastTransactionAt: lastTxByWallet.get(w.id)?.toISOString() ?? null,
            status: w.status,
          };
        }),
        nextCursor: hasMore && lastRow ? lastRow.id : null,
        totalHeldBalance: Number(stats.totalHeldBalance),
        activeWalletCount: stats.activeWalletCount,
        toppedUpToday: Number(stats.toppedUpToday),
        deductedToday: Number(stats.deductedToday),
      };
    });
  }
}
