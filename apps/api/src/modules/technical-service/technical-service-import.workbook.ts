import ExcelJS from 'exceljs';
import { TECHNICAL_SERVICE_IMPORT_MAX_ROWS } from '@nexamed/shared';
import type { ImportRecord } from '../../common/excel-import/excel-import';
import { addCatalogSheet, addDataSheet, addListValidation, IMPORT_HEADER_FILL, workbookToBuffer } from '../../common/excel-import/excel-import-workbook';
import { IMPORT_RESULT_TYPE_LABELS, IMPORT_SERVICE_KIND_LABELS, IMPORT_NO_LABEL, IMPORT_YES_LABEL } from '@nexamed/core';
import { SERVICE_COLUMNS, SERVICE_EXAMPLES, SHEET_CATALOG, SHEET_GUIDE, SHEET_SERVICES, serviceColumnHeaderText, type ServiceColumnRequirement } from './technical-service-import.columns';

/** Danh mục dùng chung mà file nhập tham chiếu theo TÊN (tên chưa có thì tự tạo mới lúc commit) + Khoa/Phòng (chỉ chọn, không tự tạo). */
export const TECHNICAL_SERVICE_IMPORT_CATEGORIES = ['TECH_SERVICE_CATEGORY', 'SPECIMEN_TYPE', 'UNIT'] as const;
export type TechnicalServiceImportCategory = (typeof TECHNICAL_SERVICE_IMPORT_CATEGORIES)[number];

export const TECHNICAL_SERVICE_IMPORT_CATEGORY_LABELS: Record<TechnicalServiceImportCategory, string> = {
  TECH_SERVICE_CATEGORY: 'Nhóm dịch vụ',
  SPECIMEN_TYPE: 'Loại mẫu',
  UNIT: 'Đơn vị tính',
};

const CATALOG_SHEET_COLUMNS = [...TECHNICAL_SERVICE_IMPORT_CATEGORIES, 'DEPARTMENT'] as const;
type CatalogSheetColumn = (typeof CATALOG_SHEET_COLUMNS)[number];
const CATALOG_SHEET_LABELS: Record<CatalogSheetColumn, string> = { ...TECHNICAL_SERVICE_IMPORT_CATEGORY_LABELS, DEPARTMENT: 'Khoa/Phòng (chỉ chọn, không tự tạo)' };

const REQUIREMENT_TEXT: Record<ServiceColumnRequirement, string> = {
  required: 'Bắt buộc',
  inHouseRequired: 'Bắt buộc khi làm tại phòng khám',
  labOnly: 'Tuỳ chọn (chỉ Xét nghiệm)',
  optional: 'Tuỳ chọn',
};

function addListValidations(sheet: ExcelJS.Worksheet): void {
  const lists: Record<string, string> = {
    kind: `"${Object.values(IMPORT_SERVICE_KIND_LABELS).join(',')}"`,
    inHouse: `"${IMPORT_YES_LABEL},${IMPORT_NO_LABEL}"`,
    resultType: `"${Object.values(IMPORT_RESULT_TYPE_LABELS).join(',')}"`,
  };
  SERVICE_COLUMNS.forEach((c, i) => {
    const list = lists[c.key];
    if (list) addListValidation(sheet, i + 1, list, TECHNICAL_SERVICE_IMPORT_MAX_ROWS);
  });
}

function addGuideSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(SHEET_GUIDE);
  sheet.columns = [{ width: 22 }, { width: 30 }, { width: 30 }, { width: 110 }];
  const title = sheet.addRow(['HƯỚNG DẪN NHẬP DỊCH VỤ KỸ THUẬT TỪ EXCEL']);
  title.font = { bold: true, size: 14 };
  sheet.addRow([]);
  const general = [
    'Cách làm:',
    `1) Sheet "${SHEET_SERVICES}": mỗi dòng là 1 dịch vụ (xét nghiệm, chẩn đoán hình ảnh hoặc thăm dò chức năng). Điền các cột có dấu * (cột có "(tại phòng khám)" chỉ bắt buộc khi Làm tại phòng khám = Có).`,
    '2) Các dòng ví dụ (Tên bắt đầu bằng VD-, chữ nghiêng xám) hệ thống TỰ BỎ QUA — có thể giữ hoặc xoá, nhưng đừng đặt tên thật bắt đầu bằng VD-.',
    '3) Lưu file .xlsx, vào Danh mục dịch vụ kỹ thuật > "Nhập Excel", chọn file. Hệ thống đọc và HIỆN KẾT QUẢ XEM TRƯỚC (hợp lệ / đã có sẵn / lỗi, kèm số dòng, tên cột và cách sửa) — chưa ghi gì cho tới khi bạn bấm "Xác nhận nhập".',
    '',
    'Lưu ý:',
    '- Mã dịch vụ (XN/CD/TD…) do hệ thống tự cấp. Dịch vụ cùng Loại + cùng Tên đã có trong hệ thống: bỏ qua, không ghi đè. Dòng sai: không nhập, kèm lý do ở màn xem trước — sửa file rồi tải lên lại.',
    '- Nhóm dịch vụ, Loại mẫu, Đơn vị tính: gõ TÊN (không phân biệt hoa thường/dấu). Tên chưa có trong danh mục sẽ được TỰ TẠO MỚI khi bạn xác nhận nhập (xem sheet "Danh mục hiện có" để chọn đúng tên sẵn có, tránh tạo trùng). Khoa/Phòng thì phải là tên ĐÃ CÓ.',
    '- File này chỉ nhập DỊCH VỤ + MỘT đơn giá gốc. Chỉ số xét nghiệm và khoảng tham chiếu tạo ở màn Chỉ số xét nghiệm; giá theo ngày hẹn/khuyến mại cài ở màn Dịch vụ hoặc Bảng giá.',
    `- Tối đa ${TECHNICAL_SERVICE_IMPORT_MAX_ROWS.toLocaleString('vi-VN')} dịch vụ mỗi lần nhập, file không quá 5 MB. Không đổi tên sheet, không chèn/đổi thứ tự cột.`,
  ];
  for (const text of general) {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, 4);
    row.alignment = { wrapText: true, vertical: 'top' };
    if (text.endsWith(':')) row.font = { bold: true };
  }
  sheet.addRow([]);
  const header = sheet.addRow(['Sheet', 'Cột', 'Mức độ', 'Cách điền']);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = IMPORT_HEADER_FILL;
  });
  for (const c of SERVICE_COLUMNS) {
    const row = sheet.addRow([SHEET_SERVICES, c.label, REQUIREMENT_TEXT[c.requirement], c.guide]);
    row.alignment = { wrapText: true, vertical: 'top' };
  }
}

/** File mẫu: sheet nhập (kèm dòng ví dụ) + "Hướng dẫn" + "Danh mục hiện có" (tên đang có của phòng khám, kể cả Khoa/Phòng). */
export async function buildServiceImportTemplate(catalogNames: Record<CatalogSheetColumn, string[]>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addDataSheet(workbook, SHEET_SERVICES, SERVICE_COLUMNS, SERVICE_EXAMPLES, { example: true, headerText: serviceColumnHeaderText });
  addListValidations(sheet);
  addGuideSheet(workbook);
  addCatalogSheet(workbook, SHEET_CATALOG, CATALOG_SHEET_COLUMNS, CATALOG_SHEET_LABELS, catalogNames);
  return workbookToBuffer(workbook);
}

/** File xuất: cùng sheet với file mẫu (nhập lại được; dịch vụ trùng Loại + Tên sẽ vào nhóm "Đã có sẵn") + cột "Trạng thái" cuối sheet. */
export async function buildServiceExportWorkbook(records: ImportRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addDataSheet(workbook, SHEET_SERVICES, SERVICE_COLUMNS, records, { example: false, headerText: serviceColumnHeaderText, extraHeaders: ['Trạng thái'] });
  addListValidations(sheet);
  return workbookToBuffer(workbook);
}
