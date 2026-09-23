import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { GetStockLedgerReportResponse } from '@nexamed/shared';

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
    sheet.addRow(['Mã', 'Tên mặt hàng', 'ĐVT', 'Kho', 'Đầu kỳ', 'Nhập', 'Xuất', 'Cuối kỳ']);
    for (const item of report.items) {
      sheet.addRow([item.drugCode, item.drugName, item.unitCode ?? '', item.warehouseName, item.openingQuantity, item.totalIn, item.totalOut, item.closingQuantity]);
    }
    sheet.addRow([]);
    sheet.addRow(['', '', '', 'Tổng cộng', report.totalOpeningQuantity, report.totalIn, report.totalOut, report.totalClosingQuantity]);

    sheet.getColumn(1).width = 14;
    sheet.getColumn(2).width = 32;
    sheet.getColumn(3).width = 10;
    sheet.getColumn(4).width = 20;
    for (const col of [5, 6, 7, 8]) {
      sheet.getColumn(col).width = 14;
      sheet.getColumn(col).numFmt = '#,##0';
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }
}
