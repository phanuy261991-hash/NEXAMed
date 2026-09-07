import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { CashFlowReportResponse } from '@nexamed/shared';

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
}
