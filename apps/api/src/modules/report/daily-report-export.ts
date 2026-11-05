import ExcelJS from 'exceljs';
import { REVENUE_GROUPS, REVENUE_GROUP_LABEL } from '@nexamed/core';
import type { DailyBranchReportDto, DailyReport } from '@nexamed/shared';
import { addReportExcelHeader, formatReportDateTime } from '../../common/report-excel-header';

export interface DailyReportExcelContext {
  clinicName: string;
  /** Tên chi nhánh khi báo cáo của MỘT chi nhánh và công ty có nhiều chi nhánh; bỏ trống ở công ty 1 chi nhánh. */
  singleBranchName: string | null;
  scopeLabel: string | null;
  exportedByName: string;
  exportedAt: Date;
}

const MONEY_FORMAT = '#,##0';
const SHIFT_STATUS_LABEL = { OPEN: 'Đang mở', CLOSED: 'Đã chốt' } as const;

/** Tên sheet Excel: tối đa 31 ký tự, không có `\ / ? * [ ] :`, không trùng nhau. */
function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Chi nhánh';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${base} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

function boldRow(sheet: ExcelJS.Worksheet, values: Array<string | number>): void {
  const row = sheet.addRow(values);
  row.font = { bold: true };
}

function setWidths(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

function formatMoneyColumns(sheet: ExcelJS.Worksheet, columns: number[]): void {
  for (const c of columns) sheet.getColumn(c).numFmt = MONEY_FORMAT;
}

/** Các khối số liệu của MỘT chi nhánh (hoặc dòng cộng): lượt khám, tiền thu theo phương thức, ghi nhận theo nhóm, chưa thu, thu chi tại quầy. */
function writeBranchBlocks(sheet: ExcelJS.Worksheet, data: Pick<DailyBranchReportDto, 'visits' | 'collection' | 'recognized' | 'unpaid' | 'counterVouchers'>): void {
  boldRow(sheet, ['1. Lượt khám', 'Số lượt']);
  sheet.addRow(['Tiếp nhận', data.visits.received]);
  sheet.addRow(['Khám mới', data.visits.newCount]);
  sheet.addRow(['Tái khám', data.visits.returnCount]);
  sheet.addRow(['Hoàn tất', data.visits.completed]);
  sheet.addRow(['Đang chờ hoặc đang khám', data.visits.stillOpen]);
  sheet.addRow(['Huỷ', data.visits.cancelled]);
  sheet.addRow(['Không đến', data.visits.noShow]);
  sheet.addRow([]);

  boldRow(sheet, ['2. Tiền thu theo phương thức', 'Lượt thu', 'Số tiền']);
  for (const m of data.collection.byMethod) sheet.addRow([m.methodName, m.paymentCount, m.amount]);
  boldRow(sheet, ['Tổng thu', data.collection.collectedCount, data.collection.collectedAmount]);
  sheet.addRow(['Hoàn tiền', data.collection.refundedCount, -data.collection.refundedAmount]);
  boldRow(sheet, ['Thực thu', '', data.collection.netAmount]);
  sheet.addRow([]);

  boldRow(sheet, ['3. Ghi nhận theo nhóm (theo ngày khám)', '', 'Số tiền']);
  for (const group of REVENUE_GROUPS) sheet.addRow([REVENUE_GROUP_LABEL[group], '', data.recognized.byGroup[group]]);
  boldRow(sheet, ['Tổng ghi nhận', '', data.recognized.total]);
  sheet.addRow([`Phiếu chưa thu cuối ngày (${data.unpaid.invoiceCount} phiếu)`, data.unpaid.invoiceCount, data.unpaid.amount]);
  sheet.addRow([]);

  boldRow(sheet, ['Thu chi tại quầy (ngoài dịch vụ khám)', '', 'Số tiền']);
  sheet.addRow(['Thu', '', data.counterVouchers.incomeAmount]);
  sheet.addRow(['Chi', '', data.counterVouchers.expenseAmount]);
}

function writeShifts(sheet: ExcelJS.Worksheet, branch: DailyBranchReportDto): void {
  sheet.addRow([]);
  boldRow(sheet, ['4. Các ca thu ngân', 'Thu ngân', 'Mở', 'Đóng', 'Trạng thái', 'Tiền mặt dự kiến', 'Kiểm đếm', 'Lệch']);
  if (branch.shifts.length === 0) {
    sheet.addRow(['Không có ca nào mở trong ngày']);
    return;
  }
  for (const s of branch.shifts) {
    sheet.addRow([
      `${s.shiftNo} · ${s.label}`,
      s.cashierName,
      formatReportDateTime(new Date(s.openedAt)),
      s.closedAt ? formatReportDateTime(new Date(s.closedAt)) : '',
      SHIFT_STATUS_LABEL[s.status],
      s.expectedCash ?? '',
      s.countedCash ?? '',
      s.discrepancy ?? '',
    ]);
  }
}

/**
 * Bản Excel của "Báo cáo ngày" (docs/DECISIONS.md #287), cùng khuôn tờ in: phạm vi từ hai chi nhánh trở lên có một sheet "Tổng hợp" (bảng một dòng mỗi chi nhánh + dòng cộng + các khối cộng)
 * rồi MỖI CHI NHÁNH MỘT SHEET; phạm vi một chi nhánh chỉ có một sheet "Báo cáo ngày". Đầu mỗi sheet theo đầu báo cáo chuẩn (`addReportExcelHeader`).
 */
export async function buildDailyReportExcel(report: DailyReport, context: DailyReportExcelContext): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  const multiBranch = report.branches.length > 1;
  const base = { clinicName: context.clinicName, from: report.date, to: report.date, exportedByName: context.exportedByName, exportedAt: context.exportedAt };

  if (multiBranch) {
    const sheet = workbook.addWorksheet(uniqueSheetName('Tổng hợp', usedNames));
    addReportExcelHeader(sheet, { ...base, title: 'Báo cáo ngày — tổng hợp các chi nhánh', scopeLabel: context.scopeLabel });
    boldRow(sheet, ['Chi nhánh', 'Tiếp nhận', 'Khám mới', 'Tái khám', 'Ghi nhận', 'Thực thu', 'Chưa thu', 'Chênh lệch kiểm đếm']);
    for (const b of report.branches) {
      const diff = b.shifts.reduce((s, x) => s + (x.discrepancy ?? 0), 0);
      sheet.addRow([b.branchName, b.visits.received, b.visits.newCount, b.visits.returnCount, b.recognized.total, b.collection.netAmount, b.unpaid.amount, diff]);
    }
    const t = report.totals;
    boldRow(sheet, [`Cộng ${report.branches.length} chi nhánh`, t.visits.received, t.visits.newCount, t.visits.returnCount, t.recognized.total, t.collection.netAmount, t.unpaid.amount, t.shiftDiscrepancy]);
    sheet.addRow([]);
    writeBranchBlocks(sheet, t);
    setWidths(sheet, [42, 14, 14, 14, 18, 18, 18, 22]);
    formatMoneyColumns(sheet, [3, 5, 6, 7, 8]);
  }

  for (const branch of report.branches) {
    const sheet = workbook.addWorksheet(uniqueSheetName(multiBranch ? branch.branchName : 'Báo cáo ngày', usedNames));
    addReportExcelHeader(sheet, {
      ...base,
      title: 'Báo cáo ngày',
      branchName: multiBranch ? branch.branchName : context.singleBranchName,
      scopeLabel: multiBranch ? context.scopeLabel : null,
    });
    writeBranchBlocks(sheet, branch);
    writeShifts(sheet, branch);
    setWidths(sheet, [42, 18, 18, 18, 14, 20, 16, 14]);
    formatMoneyColumns(sheet, [3, 6, 7, 8]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
