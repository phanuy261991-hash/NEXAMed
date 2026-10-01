import ExcelJS from 'exceljs';
import { DRUG_IMPORT_MAX_ROWS } from '@nexamed/shared';
import {
  columnHeaderText,
  INGREDIENT_COLUMNS,
  INGREDIENT_EXAMPLES,
  ITEM_COLUMNS,
  ITEM_EXAMPLES,
  SHEET_CATALOG,
  SHEET_GUIDE,
  SHEET_INGREDIENTS,
  SHEET_ITEMS,
  SHEET_UNITS,
  UNIT_COLUMNS,
  UNIT_EXAMPLES,
  type ImportColumn,
  type ImportRecord,
} from './drug-import.columns';

/** 9 danh mục dùng chung mà file nhập tham chiếu theo TÊN — nhãn hiện ở sheet "Danh mục hiện có" và thông báo lỗi. */
export const DRUG_IMPORT_CATEGORIES = [
  'UNIT',
  'MANUFACTURER',
  'DRUG_GROUP',
  'DRUG_ROUTE',
  'DOSAGE_FORM',
  'COUNTRY_OF_ORIGIN',
  'STORAGE_CONDITION',
  'STORAGE_LOCATION',
  'ACTIVE_INGREDIENT',
] as const;
export type DrugImportCategory = (typeof DRUG_IMPORT_CATEGORIES)[number];

export const DRUG_IMPORT_CATEGORY_LABELS: Record<DrugImportCategory, string> = {
  UNIT: 'Đơn vị tính',
  MANUFACTURER: 'Hãng sản xuất',
  DRUG_GROUP: 'Nhóm thuốc',
  DRUG_ROUTE: 'Đường dùng',
  DOSAGE_FORM: 'Dạng bào chế',
  COUNTRY_OF_ORIGIN: 'Nước sản xuất',
  STORAGE_CONDITION: 'Điều kiện bảo quản',
  STORAGE_LOCATION: 'Vị trí bảo quản',
  ACTIVE_INGREDIENT: 'Hoạt chất',
};

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
const EXAMPLE_FONT: Partial<ExcelJS.Font> = { italic: true, color: { argb: 'FF94A3B8' } };

function addDataSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: ImportColumn[],
  rows: ImportRecord[],
  options: { example: boolean; extraHeaders?: string[] },
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

  const header = sheet.addRow([...columns.map(columnHeaderText), ...extra]);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });

  for (const record of rows) {
    const row = sheet.addRow([...columns.map((c) => record[c.key] ?? ''), ...extra.map((e) => record[`__${e}`] ?? '')]);
    if (options.example) row.font = EXAMPLE_FONT;
  }
  return sheet;
}

/** Ô chọn sẵn cho các cột giá trị cố định (Loại, Có/Không, Phân loại kiểm soát) — chống gõ sai. */
function addListValidations(sheet: ExcelJS.Worksheet): void {
  const lists: Record<string, string> = {
    itemType: '"Thuốc,Vật tư"',
    isBatchManaged: '"Có,Không"',
    isPrescriptionOnly: '"Có,Không"',
    controlType: '"Thường,Độc,Gây nghiện,Hướng thần,Tiền chất"',
  };
  ITEM_COLUMNS.forEach((c, i) => {
    const list = lists[c.key];
    if (!list) return;
    for (let r = 2; r <= DRUG_IMPORT_MAX_ROWS + 1; r++) {
      sheet.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [list], showErrorMessage: false };
    }
  });
}

const REQUIREMENT_TEXT = {
  required: 'Bắt buộc',
  medicineRequired: 'Bắt buộc với Thuốc',
  medicineOnly: 'Tuỳ chọn (chỉ Thuốc)',
  optional: 'Tuỳ chọn',
} as const;

function addGuideSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(SHEET_GUIDE);
  sheet.columns = [{ width: 20 }, { width: 32 }, { width: 22 }, { width: 110 }];
  const title = sheet.addRow(['HƯỚNG DẪN NHẬP THUỐC & VẬT TƯ TỪ EXCEL']);
  title.font = { bold: true, size: 14 };
  sheet.addRow([]);
  const general = [
    'Cách làm:',
    `1) Sheet "${SHEET_ITEMS}": mỗi dòng là 1 mặt hàng (thuốc hoặc vật tư). Điền các cột có dấu * (cột có "(thuốc)" chỉ bắt buộc khi Loại = Thuốc).`,
    `2) Sheet "${SHEET_INGREDIENTS}": mỗi thuốc cần ÍT NHẤT 1 hoạt chất kèm hàm lượng — ghi mã thuốc ở cột đầu, nhiều hoạt chất thì ghi nhiều dòng cùng mã. Vật tư không cần.`,
    `3) Sheet "${SHEET_UNITS}" (tuỳ chọn): nếu mặt hàng bán/nhập theo nhiều đơn vị (Hộp > Vỉ > Viên) thì khai các bậc quy đổi, xếp từ nhỏ đến lớn.`,
    '4) Các dòng ví dụ (mã bắt đầu bằng VD-, chữ nghiêng xám) hệ thống TỰ BỎ QUA — có thể giữ hoặc xoá, nhưng đừng đặt mã thật bắt đầu bằng VD-.',
    '5) Lưu file .xlsx, vào Danh mục Thuốc & Vật tư > "Nhập Excel", chọn file. Hệ thống đọc và HIỆN KẾT QUẢ XEM TRƯỚC (hợp lệ / đã có sẵn / lỗi) — chưa ghi gì cho tới khi bạn bấm "Xác nhận nhập".',
    '',
    'Lưu ý:',
    '- Các cột Đơn vị, Hãng sản xuất, Nhóm thuốc, Đường dùng, Dạng bào chế, Nước sản xuất, Điều kiện/Vị trí bảo quản, Hoạt chất: gõ TÊN (không phân biệt hoa thường/dấu). Tên chưa có trong danh mục sẽ được TỰ TẠO MỚI khi bạn xác nhận nhập (xem sheet "Danh mục hiện có" để chọn đúng tên sẵn có, tránh tạo trùng).',
    '- Mã đã tồn tại trong hệ thống: bỏ qua, không ghi đè. Dòng sai: không nhập, kèm lý do ở màn xem trước — sửa file rồi tải lên lại.',
    `- Tối đa ${DRUG_IMPORT_MAX_ROWS.toLocaleString('vi-VN')} mặt hàng mỗi lần nhập, file không quá 5 MB. Không đổi tên sheet, không chèn/đổi thứ tự cột.`,
    '- File này chỉ nhập DANH MỤC mặt hàng. Số lượng tồn kho đầu kỳ nhập riêng bằng Phiếu nhập kho.',
  ];
  for (const text of general) {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, 4);
    row.alignment = { wrapText: true, vertical: 'top' };
    if (text.endsWith(':')) row.font = { bold: true };
  }
  sheet.addRow([]);

  const tables: { name: string; columns: ImportColumn[] }[] = [
    { name: SHEET_ITEMS, columns: ITEM_COLUMNS },
    { name: SHEET_INGREDIENTS, columns: INGREDIENT_COLUMNS },
    { name: SHEET_UNITS, columns: UNIT_COLUMNS },
  ];
  const header = sheet.addRow(['Sheet', 'Cột', 'Mức độ', 'Cách điền']);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
  for (const table of tables) {
    for (const c of table.columns) {
      const row = sheet.addRow([table.name, c.label, REQUIREMENT_TEXT[c.requirement], c.guide]);
      row.alignment = { wrapText: true, vertical: 'top' };
    }
  }
}

function addCatalogSheet(workbook: ExcelJS.Workbook, names: Record<DrugImportCategory, string[]>): void {
  const sheet = workbook.addWorksheet(SHEET_CATALOG);
  sheet.columns = DRUG_IMPORT_CATEGORIES.map(() => ({ width: 28 }));
  const header = sheet.addRow(DRUG_IMPORT_CATEGORIES.map((c) => DRUG_IMPORT_CATEGORY_LABELS[c]));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
  const longest = Math.max(0, ...DRUG_IMPORT_CATEGORIES.map((c) => names[c].length));
  if (longest === 0) {
    sheet.addRow(['(Danh mục đang trống — mọi tên bạn nhập sẽ được tạo mới)']);
    return;
  }
  for (let i = 0; i < longest; i++) {
    sheet.addRow(DRUG_IMPORT_CATEGORIES.map((c) => names[c][i] ?? ''));
  }
}

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** File mẫu: 3 sheet nhập (kèm dòng ví dụ) + "Hướng dẫn" + "Danh mục hiện có" (tên đang có của phòng khám). */
export async function buildDrugImportTemplate(catalogNames: Record<DrugImportCategory, string[]>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const items = addDataSheet(workbook, SHEET_ITEMS, ITEM_COLUMNS, ITEM_EXAMPLES, { example: true });
  addListValidations(items);
  addDataSheet(workbook, SHEET_INGREDIENTS, INGREDIENT_COLUMNS, INGREDIENT_EXAMPLES, { example: true });
  addDataSheet(workbook, SHEET_UNITS, UNIT_COLUMNS, UNIT_EXAMPLES, { example: true });
  addGuideSheet(workbook);
  addCatalogSheet(workbook, catalogNames);
  return toBuffer(workbook);
}

/** File xuất: cùng 3 sheet với file mẫu (nhập lại được; mã trùng sẽ vào nhóm "Đã có sẵn") + cột "Trạng thái" cuối sheet 1. */
export async function buildDrugExportWorkbook(items: ImportRecord[], ingredients: ImportRecord[], units: ImportRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addDataSheet(workbook, SHEET_ITEMS, ITEM_COLUMNS, items, { example: false, extraHeaders: ['Trạng thái'] });
  addListValidations(sheet);
  addDataSheet(workbook, SHEET_INGREDIENTS, INGREDIENT_COLUMNS, ingredients, { example: false });
  addDataSheet(workbook, SHEET_UNITS, UNIT_COLUMNS, units, { example: false });
  return toBuffer(workbook);
}
