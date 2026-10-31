import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { IMPORT_NO_LABEL, IMPORT_YES_LABEL, normalizeImportName } from '@nexamed/core';

/**
 * Phần ĐỌC file Excel dùng chung của các chức năng "Nhập Excel" (Thuốc & Vật tư #210, Dịch vụ kỹ thuật #276, ...): mở file, kiểm tiêu đề cột đúng mẫu,
 * đọc từng dòng thành ô thô. KHÔNG biết gì về nghiệp vụ — mỗi chức năng tự khai báo cột (`ImportColumnBase`) và tự diễn giải ô.
 */
export type Cell = string | number | null;

export interface SheetRow {
  rowNumber: number;
  cells: Record<string, Cell>;
}

export interface ImportColumnBase {
  key: string;
  /** Nhãn thuần của cột — KHÔNG được chứa `*` hay `(`: bộ đọc cắt từ ký tự đó trở đi ở ô tiêu đề để lấy lại nhãn. */
  label: string;
  width: number;
  /** Hướng dẫn điền — hiện ở sheet "Hướng dẫn". */
  guide: string;
  /** Cột lưu dạng CHỮ (mã/số đăng ký/mã vạch) — định dạng ô `@` để Excel không nuốt số 0 đầu. */
  text?: boolean;
}

/** Một dòng dữ liệu để ghi ra file (ví dụ/xuất): khoá cột → giá trị; cột phụ ngoài mẫu dùng khoá `__<tiêu đề>`. */
export type ImportRecord = Record<string, string | number>;

export function cellText(cell: Cell | undefined): string {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

export function collapseSpaces(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Lấy lại nhãn thuần từ ô tiêu đề (bỏ dấu hiệu bắt buộc/ghi chú sau `*` hoặc `(`). */
export function headerLabelOf(headerText: string): string {
  return headerText.replace(/\s*[*(].*$/, '').trim();
}

export function readCell(cell: ExcelJS.Cell): Cell {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'boolean') return v ? IMPORT_YES_LABEL : IMPORT_NO_LABEL;
  const t = String(cell.text ?? '').trim();
  return t === '' ? null : t;
}

export async function loadWorkbook(fileBuffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new BadRequestException('Không đọc được file. Hãy dùng file .xlsx theo đúng file mẫu.');
  }
  return workbook;
}

/** Đọc các dòng dữ liệu (bỏ dòng tiêu đề và dòng trống). Sai tiêu đề cột → 400 "không đúng mẫu"; quá `maxRows` dòng → 400. `sheet` thiếu → không có dòng nào. */
export function readSheetRows(sheet: ExcelJS.Worksheet | undefined, name: string, columns: readonly ImportColumnBase[], maxRows: number): SheetRow[] {
  if (!sheet) return [];
  columns.forEach((c, i) => {
    const got = headerLabelOf(String(sheet.getCell(1, i + 1).text ?? ''));
    if (normalizeImportName(got) !== normalizeImportName(c.label)) {
      throw new BadRequestException(`Sheet "${name}": cột ${i + 1} phải là "${c.label}" — file không đúng mẫu, hãy tải lại file mẫu.`);
    }
  });
  const rows: SheetRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: Record<string, Cell> = {};
    let any = false;
    columns.forEach((c, i) => {
      const v = readCell(row.getCell(i + 1));
      cells[c.key] = v;
      if (v !== null) any = true;
    });
    if (any) rows.push({ rowNumber, cells });
  });
  if (rows.length > maxRows) {
    throw new BadRequestException(`Sheet "${name}" có ${rows.length.toLocaleString('vi-VN')} dòng — tối đa ${maxRows.toLocaleString('vi-VN')} dòng mỗi lần nhập.`);
  }
  return rows;
}
