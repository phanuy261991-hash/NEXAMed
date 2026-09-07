import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { CashBookLedgerResponse, CashFlowReportResponse, CashVoucher, CashVoucherStatus } from '@nexamed/shared';

/** Nhãn tiếng Việt cho `cashVoucherStatusSchema` — khai RIÊNG ở backend, KHÔNG import từ chỗ hiển
 * thị tương ứng bên `apps/web` (`CashVoucherListPage.tsx` có `STATUS_META` cùng nội dung) vì hằng
 * số/hàm thuần xuất từ `packages/shared` không luôn resolve được qua `vite build` (bug bundler đã
 * gặp lặp lại #032/#091/#114) — 3 chuỗi nhãn ngắn, chấp nhận trùng lặp có chủ đích thay vì rủi ro vỡ
 * build web để đổi lấy dùng chung. */
const VOUCHER_STATUS_LABELS: Record<CashVoucherStatus, string> = {
  POSTED: 'Đã ghi sổ',
  PENDING_APPROVAL: 'Chờ duyệt',
  REJECTED: 'Đã từ chối',
};

/** Nhãn tiếng Việt cho `cashBookLedgerEntryTypeSchema` — cùng lý do KHÔNG dùng chung với
 * `ENTRY_TYPE_META` (`apps/web/src/features/cash-book/CashBookPage.tsx`) ở trên. */
const LEDGER_ENTRY_TYPE_LABELS: Record<CashBookLedgerResponse['entries'][number]['entryType'], string> = {
  INVOICE_PAYMENT: 'Thu tiền khám',
  INVOICE_REFUND: 'Hoàn tiền khám',
  VOUCHER_INCOME: 'Phiếu thu',
  VOUCHER_EXPENSE: 'Phiếu chi',
  TRANSFER_IN: 'Chuyển quỹ đến',
  TRANSFER_OUT: 'Chuyển quỹ đi',
};

/** "Xuất Excel" cho Báo cáo dòng tiền (GĐ2) — đúng khuôn `WorkShiftAssignmentImportService.buildExport()`
 * (`exceljs`, backend-only — không đẩy thư viện này ra `apps/web`, giữ đúng nguyên tắc hiệu năng #073). */
@Injectable()
export class CashBookExportService {
  async buildCashFlowReportExcel(from: string, to: string, report: CashFlowReportResponse): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    const summarySheet = workbook.addWorksheet('Tổng quan');
    summarySheet.addRow([`Báo cáo dòng tiền — Từ ${from} đến ${to}`]);
    summarySheet.addRow([]);
    summarySheet.addRow(['Tổng thu', report.totalIncome]);
    summarySheet.addRow(['Tổng chi', report.totalExpense]);
    summarySheet.addRow(['Chênh lệch', report.totalIncome - report.totalExpense]);
    summarySheet.getColumn(1).width = 20;
    summarySheet.getColumn(2).width = 18;
    summarySheet.getColumn(2).numFmt = '#,##0';

    const byTypeSheet = workbook.addWorksheet('Theo Loại thu chi');
    byTypeSheet.addRow(['Loại thu chi', 'Tổng thu', 'Tổng chi']);
    for (const g of report.byType) {
      byTypeSheet.addRow([g.label, g.totalIncome, g.totalExpense]);
    }
    byTypeSheet.getColumn(1).width = 28;
    byTypeSheet.getColumn(2).width = 16;
    byTypeSheet.getColumn(3).width = 16;
    byTypeSheet.getColumn(2).numFmt = '#,##0';
    byTypeSheet.getColumn(3).numFmt = '#,##0';

    const byAccountSheet = workbook.addWorksheet('Theo Quỹ');
    byAccountSheet.addRow(['Quỹ', 'Tổng thu', 'Tổng chi', 'Tồn quỹ']);
    for (const g of report.byAccount) {
      byAccountSheet.addRow([g.label, g.totalIncome, g.totalExpense, g.closingBalance]);
    }
    byAccountSheet.getColumn(1).width = 24;
    byAccountSheet.getColumn(2).width = 16;
    byAccountSheet.getColumn(3).width = 16;
    byAccountSheet.getColumn(4).width = 16;
    byAccountSheet.getColumn(2).numFmt = '#,##0';
    byAccountSheet.getColumn(3).numFmt = '#,##0';
    byAccountSheet.getColumn(4).numFmt = '#,##0';

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }

  /** "Xuất Excel" cho "Phiếu thu / Phiếu chi" (`CashVoucherListPage.tsx`) — đúng bộ lọc + thứ tự
   * đang xem trên màn hình (server đã trả `items` mới→cũ, không sắp lại ở đây). */
  async buildCashVoucherListExcel(
    from: string | undefined,
    to: string | undefined,
    data: {
      items: CashVoucher[];
      totalIncomeAmount: number;
      totalExpenseAmount: number;
      typeLabelByCode: Map<string, string>;
      accountNameById: Map<string, string>;
    },
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Phiếu thu chi');

    const rangeLabel = from && to ? `Từ ${from} đến ${to}` : 'Toàn bộ';
    sheet.addRow([`Phiếu thu / Phiếu chi — ${rangeLabel}`]);
    sheet.addRow([]);
    sheet.addRow(['Tổng thu', data.totalIncomeAmount]);
    sheet.addRow(['Tổng chi', data.totalExpenseAmount]);
    sheet.addRow(['Chênh lệch', data.totalIncomeAmount - data.totalExpenseAmount]);
    sheet.addRow([]);

    const headerRow = sheet.addRow(['Mã phiếu', 'Ngày phát sinh', 'Loại thu chi', 'Diễn giải', 'Đối tác', 'Số tiền', 'Trạng thái']);
    headerRow.font = { bold: true };

    for (const item of data.items) {
      const typeLabel = item.counterAccountId
        ? `Chuyển quỹ: ${data.accountNameById.get(item.cashAccountId) ?? '—'} → ${data.accountNameById.get(item.counterAccountId) ?? '—'}`
        : (data.typeLabelByCode.get(item.incomeExpenseTypeCode ?? '') ?? item.incomeExpenseTypeCode ?? '—');
      const signedAmount = item.direction === 'INCOME' ? item.amount : -item.amount;
      sheet.addRow([
        item.voucherNo,
        item.occurredAt.slice(0, 10),
        typeLabel,
        item.description,
        item.partnerName ?? '',
        signedAmount,
        item.voided ? 'Đã huỷ' : VOUCHER_STATUS_LABELS[item.status],
      ]);
    }

    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 14;
    sheet.getColumn(3).width = 32;
    sheet.getColumn(4).width = 36;
    sheet.getColumn(5).width = 20;
    sheet.getColumn(6).width = 16;
    sheet.getColumn(7).width = 14;
    sheet.getColumn(6).numFmt = '#,##0';

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }

  /** "Xuất Excel" cho "Sổ quỹ" (`CashBookPage.tsx`) — thứ tự CŨ→MỚI (chuẩn kế toán, đúng thứ tự
   * server tính `runningBalance`), khác thứ tự MỚI→CŨ hiển thị trên màn hình (chỉ đảo ở tầng UI,
   * xem comment `CashBookPage.tsx`/`docs/DECISIONS.md` #125). */
  async buildCashBookLedgerExcel(ledger: CashBookLedgerResponse, from: string | undefined, to: string | undefined): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sổ quỹ');

    const rangeLabel = from && to ? `Từ ${from} đến ${to}` : 'Toàn bộ';
    sheet.addRow([`Sổ quỹ — ${ledger.cashAccountName} — ${rangeLabel}`]);
    sheet.addRow([]);
    sheet.addRow(['Số dư đầu kỳ', ledger.openingBalance]);
    sheet.addRow(['Số dư cuối kỳ', ledger.closingBalance]);
    sheet.addRow([]);

    const headerRow = sheet.addRow(['Ngày', 'Loại chứng từ', 'Diễn giải', 'Số tiền', 'Số dư luỹ kế']);
    headerRow.font = { bold: true };

    for (const entry of ledger.entries) {
      sheet.addRow([
        entry.occurredAt.slice(0, 10),
        LEDGER_ENTRY_TYPE_LABELS[entry.entryType],
        entry.description,
        entry.amountSigned,
        entry.runningBalance,
      ]);
    }

    sheet.getColumn(1).width = 14;
    sheet.getColumn(2).width = 20;
    sheet.getColumn(3).width = 40;
    sheet.getColumn(4).width = 16;
    sheet.getColumn(5).width = 16;
    sheet.getColumn(4).numFmt = '#,##0';
    sheet.getColumn(5).numFmt = '#,##0';

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }
}
