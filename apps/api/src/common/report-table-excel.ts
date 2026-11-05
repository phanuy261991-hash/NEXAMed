import ExcelJS from 'exceljs';
import { addReportExcelHeader, type ReportExcelHeader } from './report-excel-header';

/**
 * Bộ dựng Excel DẠNG BẢNG dùng chung cho các báo cáo danh sách (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi sheet: đầu báo cáo chuẩn (`addReportExcelHeader`),
 * các dòng tóm tắt, rồi một hoặc nhiều bảng (tiêu đề đậm, dòng cộng đậm). Ô số (`numeric`) ghi dạng SỐ có dấu phân cách hàng nghìn để cộng/lọc được trong Excel; ô chữ ghi chữ.
 */
export type ExcelCell = string | number | null;

export interface ExcelTableColumn {
  header: string;
  width?: number;
  /** Cột số tiền/số lượng: ghi số, định dạng `#,##0`. */
  numeric?: boolean;
}

export interface ExcelTableSection {
  title?: string;
  columns: ExcelTableColumn[];
  rows: ExcelCell[][];
  /** Dòng cộng in đậm ngay dưới các dòng dữ liệu. */
  totalRows?: ExcelCell[][];
  /** Chữ thay cho bảng khi không có dòng nào. */
  emptyText?: string;
}

export interface ExcelTableSheet {
  /** Tên sheet (tự cắt còn 31 ký tự, bỏ ký tự cấm, không trùng sheet khác). */
  name: string;
  header: ReportExcelHeader;
  infoLines?: string[];
  sections: ExcelTableSection[];
  note?: string;
}

/** Số dòng tối đa một bản xuất danh sách (cùng giới hạn của "Hẹn tái khám"). */
export const REPORT_EXPORT_ROW_LIMIT = 5000;

function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Báo cáo';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${base} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

export async function buildTableReportExcel(sheets: readonly ExcelTableSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(uniqueSheetName(spec.name, used));
    addReportExcelHeader(sheet, spec.header);
    for (const line of spec.infoLines ?? []) sheet.addRow([line]);
    if ((spec.infoLines ?? []).length > 0) sheet.addRow([]);

    const widths: number[] = [];
    const moneyColumns = new Set<number>();
    for (const section of spec.sections) {
      if (section.title) {
        const titleRow = sheet.addRow([section.title.toUpperCase()]);
        titleRow.font = { bold: true };
      }
      if (section.rows.length === 0 && (section.totalRows ?? []).length === 0) {
        sheet.addRow([section.emptyText ?? 'Không có dữ liệu.']);
        sheet.addRow([]);
        continue;
      }
      const head = sheet.addRow(section.columns.map((c) => c.header));
      head.font = { bold: true };
      section.columns.forEach((c, i) => {
        widths[i] = Math.max(widths[i] ?? 0, c.width ?? 14);
        if (c.numeric) moneyColumns.add(i + 1);
      });
      for (const row of section.rows) sheet.addRow(row);
      for (const row of section.totalRows ?? []) sheet.addRow(row).font = { bold: true };
      sheet.addRow([]);
    }
    if (spec.note) sheet.addRow([spec.note]).font = { italic: true };
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });
    for (const c of moneyColumns) sheet.getColumn(c).numFmt = '#,##0';
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
