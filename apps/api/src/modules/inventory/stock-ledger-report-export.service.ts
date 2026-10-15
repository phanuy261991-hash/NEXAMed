import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { GetStockLedgerReportResponse, GetStockTransferShrinkageResponse } from '@nexamed/shared';

/** "Xuất Excel" cho "Báo cáo Nhập-Xuất-Tồn" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — `exceljs`,
 * backend-only (không đẩy thư viện này ra `apps/web`, #073), đúng khuôn `CashBookExportService.
 * buildCashFlowReportExcel()`. */
@Injectable()
export class StockLedgerReportExportService {
  async buildStockLedgerReportExcel(from: string, to: string, report: GetStockLedgerReportResponse): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet('Nhập-Xuất-Tồn');
    sheet.addRow([`Báo cáo Nhập-Xuất-Tồn — Từ ${from} đến ${to}`]);
    sheet.addRow([]);
    // Đợt 3 chi nhánh (#235): phạm vi từ 2 chi nhánh trở lên thì thêm cột Chi nhánh trước cột Kho; phạm vi 1 chi nhánh giữ nguyên file như cũ.
    const multiBranch = report.branchCount > 1;
    const lead = multiBranch ? ['Chi nhánh'] : [];
    sheet.addRow(['Mã', 'Tên mặt hàng', 'ĐVT', ...lead, 'Kho', 'Đầu kỳ', 'Nhập', 'Xuất', 'Cuối kỳ']);
    for (const item of report.items) {
      sheet.addRow([item.drugCode, item.drugName, item.unitCode ?? '', ...(multiBranch ? [item.branchName] : []), item.warehouseName, item.openingQuantity, item.totalIn, item.totalOut, item.closingQuantity]);
    }
    sheet.addRow([]);
    sheet.addRow(['', '', '', ...(multiBranch ? [''] : []), 'Tổng cộng', report.totalOpeningQuantity, report.totalIn, report.totalOut, report.totalClosingQuantity]);

    const widths = multiBranch ? [14, 32, 10, 24, 20, 14, 14, 14, 14] : [14, 32, 10, 20, 14, 14, 14, 14];
    widths.forEach((width, i) => {
      sheet.getColumn(i + 1).width = width;
    });
    for (let col = widths.length - 3; col <= widths.length; col++) sheet.getColumn(col).numFmt = '#,##0';

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }

  /** "Xuất Excel" cho "Báo cáo hao hụt điều chuyển" (Đợt 2 chi nhánh, #233) — cùng khuôn `buildStockLedgerReportExcel`. */
  async buildTransferShrinkageExcel(from: string, to: string, report: GetStockTransferShrinkageResponse): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Hao hụt điều chuyển');
    sheet.addRow([`Báo cáo hao hụt điều chuyển — Từ ${from} đến ${to}`]);
    sheet.addRow([]);
    sheet.addRow(['Số phiếu', 'Ngày chuyển', 'Kho gửi', 'Kho nhận', 'Mã', 'Tên mặt hàng', 'Số lượng', 'Giá vốn', 'Giá trị', 'Nguyên nhân']);
    for (const item of report.items) {
      sheet.addRow([
        item.transferNo,
        item.occurredAt.slice(0, 10),
        item.fromWarehouseName,
        item.toWarehouseName,
        item.drugCode,
        item.drugName,
        item.quantity,
        item.unitCost,
        item.lineValue,
        item.cause === 'WRITE_OFF' ? 'Ghi hao hụt' : 'Nhận lại thiếu',
      ]);
    }
    sheet.addRow([]);
    sheet.addRow(['', '', '', '', '', 'Tổng cộng', report.totalQuantity, '', report.totalValue, '']);

    for (const [col, width] of [[1, 16], [2, 14], [3, 24], [4, 24], [5, 14], [6, 32], [7, 12], [8, 14], [9, 16], [10, 18]] as const) sheet.getColumn(col).width = width;
    for (const col of [7, 8, 9]) sheet.getColumn(col).numFmt = '#,##0';

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }
}
