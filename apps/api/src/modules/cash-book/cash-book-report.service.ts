import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { REFERENCE_CATALOG_READER_PORT, type ReferenceCatalogReaderPort } from '@nexamed/core';
import type { CashBookLedgerResponse, CashFlowReportResponse, CashVoucher, ListCashVouchersQuery } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CashAccountRepository } from './cash-account.repository';
import { CashVoucherRepository } from './cash-voucher.repository';
import { CashVoucherService } from './cash-voucher.service';
import { PaymentRepository } from '../billing/payment.repository';

/** `to` là ngày (không giờ) — luôn diễn giải thành CUỐI ngày giờ Việt Nam, đúng khuôn
 * `CashVoucherService.list()` (`packages/shared` không có tiện ích ngày-VN dùng lại được ở đây vì
 * `packages/core` mới có `vietnamDayRange`, nhưng import ngược từ `apps/api` sang không hợp lý cho
 * một hằng offset đơn giản — giữ đúng offset `+07:00` cố định như chỗ khác trong module này). */
function endOfDayVn(date: string): Date {
  return new Date(`${date}T23:59:59.999+07:00`);
}
function startOfDayVn(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

/** Ngày lịch Việt Nam dạng `YYYY-MM-DD` — dùng để nhóm 2 nguồn dữ liệu có bản chất thời gian khác
 * hẳn nhau vào cùng 1 "ngày" trước khi so sánh thời gian thật. `cash_voucher.occurredAt` là NGÀY
 * người dùng chọn tay ("Ngày phát sinh"), lưu ở nửa đêm UTC — không mang ý nghĩa giờ-phút thật nào
 * cả; `payment.paidAt` là mốc thời gian thật của giao dịch. So thẳng 2 giá trị này bằng
 * `getTime()` sẽ luôn xếp phiếu (nửa đêm) lên TRƯỚC bất kỳ khoản thu nào cùng ngày có giờ sau 00:00
 * — dù phiếu đó lập SAU về mặt thời gian thực (chủ dự án phát hiện 2026-09-07). */
function vnDateKey(d: Date): string {
  return new Date(d.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10);
}

/**
 * "Sổ quỹ & Thu chi" Giai đoạn 2 — Sổ quỹ (liệt kê chứng từ + số dư luỹ kế theo 1 quỹ) + Báo cáo
 * dòng tiền (tổng hợp toàn phòng khám). Gộp dữ liệu từ CẢ `payment` (tiền lượt khám, module
 * `billing`) LẪN `cash_voucher` (tiền ngoài dịch vụ khám, module `cash-book`) — đặt ở module
 * `cash-book` nhưng KHÔNG import `BillingModule` trực tiếp (tránh vòng phụ thuộc mới với
 * `CashBookModule` vốn đã có 2 vòng `forwardRef` với `CashierShiftModule`/`BillingModule`) — module
 * riêng `CashBookReportModule` import CẢ HAI, xem `cash-book-report.module.ts`.
 */
@Injectable()
export class CashBookReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly cashVoucherRepository: CashVoucherRepository,
    private readonly cashVoucherService: CashVoucherService,
    private readonly paymentRepository: PaymentRepository,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
  ) {}

  async getLedger(tenantId: string, cashAccountId: string, from?: string, to?: string): Promise<CashBookLedgerResponse> {
    const fromAt = from ? startOfDayVn(from) : undefined;
    const toAt = to ? endOfDayVn(to) : undefined;

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const account = await this.cashAccountRepository.findById(tx, tenantId, cashAccountId);
      if (!account) {
        throw new NotFoundException();
      }

      let openingBalance = Number(account.openingBalance);
      if (fromAt) {
        const [voucherBefore, paymentBefore] = await Promise.all([
          this.cashVoucherRepository.sumBeforeForAccount(tx, tenantId, cashAccountId, fromAt),
          this.paymentRepository.sumBeforeForCashAccount(tx, tenantId, cashAccountId, fromAt),
        ]);
        openingBalance += Number(voucherBefore.asSourceIncome - voucherBefore.asSourceExpense + voucherBefore.asCounter);
        openingBalance += Number(paymentBefore.paymentAmount - paymentBefore.refundAmount);
      }

      const [voucherRows, paymentRows] = await Promise.all([
        this.cashVoucherRepository.listForAccountLedger(tx, tenantId, cashAccountId, fromAt, toAt),
        this.paymentRepository.listForCashAccount(tx, tenantId, cashAccountId, fromAt, toAt),
      ]);

      type Entry = {
        occurredAt: Date;
        createdAt: Date;
        entryType: CashBookLedgerResponse['entries'][number]['entryType'];
        description: string;
        referenceNo: string;
        amountSigned: number;
        sortKey: string;
      };
      const entries: Entry[] = [];
      for (const row of voucherRows) {
        const isTransferOut = row.cashAccountId === cashAccountId && row.counterAccountId !== null;
        const isTransferIn = row.counterAccountId === cashAccountId;
        let entryType: Entry['entryType'];
        let amountSigned: number;
        if (isTransferOut) {
          entryType = 'TRANSFER_OUT';
          amountSigned = -Number(row.amount);
        } else if (isTransferIn) {
          entryType = 'TRANSFER_IN';
          amountSigned = Number(row.amount);
        } else if (row.direction === 'INCOME') {
          entryType = 'VOUCHER_INCOME';
          amountSigned = Number(row.amount);
        } else {
          entryType = 'VOUCHER_EXPENSE';
          amountSigned = -Number(row.amount);
        }
        entries.push({ occurredAt: row.occurredAt, createdAt: row.createdAt, entryType, description: row.description, referenceNo: row.voucherNo, amountSigned, sortKey: row.id });
      }
      for (const row of paymentRows) {
        const isPayment = row.type === 'PAYMENT';
        entries.push({
          occurredAt: row.paidAt,
          createdAt: row.createdAt,
          entryType: isPayment ? 'INVOICE_PAYMENT' : 'INVOICE_REFUND',
          description: isPayment ? 'Thu tiền khám' : 'Hoàn tiền khám',
          referenceNo: row.invoice.invoiceNo,
          amountSigned: isPayment ? Number(row.amount) : -Number(row.amount),
          sortKey: row.id,
        });
      }
      // So NGÀY lịch VN trước (tôn trọng "Ngày phát sinh" backdate/postdate của phiếu thu/chi thủ
      // công) — CÙNG ngày thì so `createdAt` thật (thời điểm ghi nhận), không so thẳng `occurredAt`
      // (xem giải thích ở `vnDateKey`).
      // So NGÀY lịch VN trước (tôn trọng "Ngày phát sinh" backdate/postdate của phiếu thu/chi thủ
      // công) — CÙNG ngày thì so `createdAt` thật (thời điểm ghi nhận), không so thẳng `occurredAt`
      // (xem giải thích ở `vnDateKey`).
      entries.sort((a, b) => {
        const dayCompare = vnDateKey(a.occurredAt).localeCompare(vnDateKey(b.occurredAt));
        if (dayCompare !== 0) return dayCompare;
        return a.createdAt.getTime() - b.createdAt.getTime() || a.sortKey.localeCompare(b.sortKey);
      });

      let runningBalance = openingBalance;
      const dtoEntries = entries.map((e) => {
        runningBalance += e.amountSigned;
        return {
          id: `${e.entryType}:${e.sortKey}`,
          occurredAt: e.occurredAt.toISOString(),
          entryType: e.entryType,
          description: e.description,
          referenceNo: e.referenceNo,
          amountSigned: e.amountSigned,
          runningBalance,
        };
      });

      return {
        cashAccountId: account.id,
        cashAccountName: account.name,
        openingBalance,
        closingBalance: runningBalance,
        entries: dtoEntries,
      };
    });
  }

  /**
   * "Xuất Excel" cho "Phiếu thu/chi" (`CashVoucherListPage.tsx`) — dùng LẠI `CashVoucherService.list()`
   * (tự có transaction riêng) cho items+tổng kết, chỉ thêm 2 map resolve tên (`incomeExpenseTypeCode`
   * → tên, `cashAccountId` → tên quỹ) — đúng khuôn đã dùng ở `getCashFlowReport()` ngay dưới, vì
   * `cashVoucherSchema` cố ý KHÔNG resolve 2 trường này (web tự map cho màn hình, xem comment ở
   * `packages/shared/src/cash-book.ts`).
   */
  async getVoucherExportData(
    tenantId: string,
    query: ListCashVouchersQuery,
  ): Promise<{
    items: CashVoucher[];
    totalIncomeAmount: number;
    totalExpenseAmount: number;
    typeLabelByCode: Map<string, string>;
    accountNameById: Map<string, string>;
  }> {
    const [{ items, totalIncomeAmount, totalExpenseAmount }, incomeExpenseTypes, accounts] = await Promise.all([
      this.cashVoucherService.list(tenantId, query),
      this.referenceCatalogReader.listByCategory(tenantId, 'INCOME_EXPENSE_TYPE'),
      this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cashAccountRepository.list(tx, tenantId)),
    ]);
    return {
      items,
      totalIncomeAmount,
      totalExpenseAmount,
      typeLabelByCode: new Map(incomeExpenseTypes.map((t) => [t.code, t.name])),
      accountNameById: new Map(accounts.map((a) => [a.id, a.name])),
    };
  }

  async getCashFlowReport(tenantId: string, from: string, to: string): Promise<CashFlowReportResponse> {
    const fromAt = startOfDayVn(from);
    const toAt = endOfDayVn(to);
    const afterToAt = new Date(toAt.getTime() + 1);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [accounts, incomeExpenseTypes, paymentRows, voucherRows] = await Promise.all([
        this.cashAccountRepository.list(tx, tenantId),
        this.referenceCatalogReader.listByCategory(tenantId, 'INCOME_EXPENSE_TYPE'),
        this.paymentRepository.listForReport(tx, tenantId, fromAt, toAt),
        this.cashVoucherRepository.listPostedForReport(tx, tenantId, fromAt, toAt),
      ]);
      const typeLabelByCode = new Map(incomeExpenseTypes.map((t) => [t.code, t.name]));

      // byType — "Thu tiền khám"/"Hoàn tiền khám" (payment) + mỗi Loại thu chi (voucher KHÔNG PHẢI
      // Chuyển quỹ — counterAccountId=null). Chuyển quỹ (counterAccountId có giá trị) loại trừ hoàn
      // toàn khỏi byType/tổng toàn phòng khám — không phải doanh thu/chi phí thật.
      const byTypeMap = new Map<string, { label: string; totalIncome: number; totalExpense: number }>();
      byTypeMap.set('INVOICE', { label: 'Thu tiền khám', totalIncome: 0, totalExpense: 0 });
      for (const row of paymentRows) {
        const bucket = byTypeMap.get('INVOICE')!;
        if (row.type === 'PAYMENT') bucket.totalIncome += Number(row.amount);
        else bucket.totalExpense += Number(row.amount);
      }
      for (const row of voucherRows) {
        if (row.counterAccountId) continue; // Chuyển quỹ — không tính vào byType/tổng toàn phòng khám.
        const key = row.incomeExpenseTypeCode!;
        if (!byTypeMap.has(key)) {
          byTypeMap.set(key, { label: typeLabelByCode.get(key) ?? key, totalIncome: 0, totalExpense: 0 });
        }
        const bucket = byTypeMap.get(key)!;
        if (row.direction === 'INCOME') bucket.totalIncome += Number(row.amount);
        else bucket.totalExpense += Number(row.amount);
      }
      const byType = [...byTypeMap.entries()].map(([key, v]) => ({ key, ...v }));
      const totalIncome = byType.reduce((sum, g) => sum + g.totalIncome, 0);
      const totalExpense = byType.reduce((sum, g) => sum + g.totalExpense, 0);

      // byAccount — GỒM CẢ Chuyển quỹ 2 chiều (đứng từ góc 1 quỹ cụ thể, tiền thật sự ra/vào).
      const byAccountMap = new Map<string, { totalIncome: number; totalExpense: number }>();
      const ensure = (id: string) => {
        if (!byAccountMap.has(id)) byAccountMap.set(id, { totalIncome: 0, totalExpense: 0 });
        return byAccountMap.get(id)!;
      };
      for (const row of paymentRows) {
        if (!row.cashAccountId) continue;
        const bucket = ensure(row.cashAccountId);
        if (row.type === 'PAYMENT') bucket.totalIncome += Number(row.amount);
        else bucket.totalExpense += Number(row.amount);
      }
      for (const row of voucherRows) {
        const sourceBucket = ensure(row.cashAccountId);
        if (row.counterAccountId) {
          sourceBucket.totalExpense += Number(row.amount); // Chuyển quỹ — quỹ nguồn luôn bị trừ.
          ensure(row.counterAccountId).totalIncome += Number(row.amount); // quỹ đích luôn được cộng.
        } else if (row.direction === 'INCOME') {
          sourceBucket.totalIncome += Number(row.amount);
        } else {
          sourceBucket.totalExpense += Number(row.amount);
        }
      }

      const byAccount = await Promise.all(
        accounts.map(async (account) => {
          const [voucherBefore, paymentBefore] = await Promise.all([
            this.cashVoucherRepository.sumBeforeForAccount(tx, tenantId, account.id, afterToAt),
            this.paymentRepository.sumBeforeForCashAccount(tx, tenantId, account.id, afterToAt),
          ]);
          const closingBalance =
            Number(account.openingBalance) +
            Number(voucherBefore.asSourceIncome - voucherBefore.asSourceExpense + voucherBefore.asCounter) +
            Number(paymentBefore.paymentAmount - paymentBefore.refundAmount);
          const bucket = byAccountMap.get(account.id) ?? { totalIncome: 0, totalExpense: 0 };
          return { key: account.id, label: account.name, totalIncome: bucket.totalIncome, totalExpense: bucket.totalExpense, closingBalance };
        }),
      );

      return { totalIncome, totalExpense, byType, byAccount };
    });
  }
}
