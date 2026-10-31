import ExcelJS from 'exceljs';
import type { ImportColumnBase, ImportRecord } from './excel-import';

/** Phần GHI file Excel dùng chung của các chức năng "Nhập/Xuất Excel" (file mẫu, file xuất, sheet "Danh mục hiện có"). Xem `excel-import.ts`. */
export const IMPORT_HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
const EXAMPLE_FONT: Partial<ExcelJS.Font> = { italic: true, color: { argb: 'FF94A3B8' } };

/**
 * Sheet dữ liệu: tiêu đề cột đóng băng + (tuỳ chọn) dòng ví dụ chữ nghiêng xám. `headerText` quyết định chữ ở ô tiêu đề (nhãn + dấu hiệu bắt buộc).
 * `extraHeaders`: cột phụ cuối sheet (ví dụ "Trạng thái" ở file xuất) — dữ liệu lấy từ khoá `__<tiêu đề>`, bộ đọc nhập bỏ qua cột này.
 */
export function addDataSheet<C extends ImportColumnBase>(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: readonly C[],
  rows: readonly ImportRecord[],
  options: { example: boolean; headerText: (column: C) => string; extraHeaders?: string[] },
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  const extra = options.extraHeaders ?? [];
  columns.forEach((c, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = c.width;
    if (c.text) col.numFmt = '@';
  });
  extra.forEach((_, i) => {
    sheet.getColumn(columns.length + i + 1).width = 14;
  });

  const header = sheet.addRow([...columns.map(options.headerText), ...extra]);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((cell) => {
    cell.fill = IMPORT_HEADER_FILL;
  });

  for (const record of rows) {
    const row = sheet.addRow([...columns.map((c) => record[c.key] ?? ''), ...extra.map((e) => record[`__${e}`] ?? '')]);
    if (options.example) row.font = EXAMPLE_FONT;
  }
  return sheet;
}

/** Ô chọn sẵn cho các cột có giá trị cố định (Loại, Có/Không...) ở `rowCount` dòng đầu — chống gõ sai; `showErrorMessage: false` nên vẫn gõ tay được. */
export function addListValidation(sheet: ExcelJS.Worksheet, columnIndex: number, listFormula: string, rowCount: number): void {
  for (let r = 2; r <= rowCount + 1; r++) {
    sheet.getCell(r, columnIndex).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula], showErrorMessage: false };
  }
}

/** Sheet "Danh mục hiện có": mỗi danh mục một cột liệt kê tên đang dùng, để người điền chọn đúng tên sẵn có thay vì gõ ra tên mới. */
export function addCatalogSheet<K extends string>(workbook: ExcelJS.Workbook, sheetName: string, categories: readonly K[], labels: Record<K, string>, names: Record<K, string[]>): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = categories.map(() => ({ width: 28 }));
  const header = sheet.addRow(categories.map((c) => labels[c]));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = IMPORT_HEADER_FILL;
  });
  const longest = Math.max(0, ...categories.map((c) => names[c].length));
  if (longest === 0) {
    sheet.addRow(['(Danh mục đang trống — mọi tên bạn nhập sẽ được tạo mới)']);
    return;
  }
  for (let i = 0; i < longest; i++) {
    sheet.addRow(categories.map((c) => names[c][i] ?? ''));
  }
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
