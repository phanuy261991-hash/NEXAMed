import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { getVietnamDateString, stripVietnameseDiacritics } from '@nexamed/core';
import {
  PRICE_LIST_IMPORT_EXAMPLE_CODE_PREFIX,
  PRICE_LIST_IMPORT_MAX_ROWS,
  type PriceableItem,
  type PriceListImportError,
  type PriceListImportPreviewResponse,
  type PriceListImportRow,
  type PriceListItemKind,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { DrugRepository } from '../drug/drug.repository';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { TechnicalServiceRepository } from '../technical-service/technical-service.repository';
import { PriceableCatalogService } from './priceable-catalog.service';
import { ServicePackageRepository } from './service-package.repository';

const SHEET_ITEMS = 'Mặt hàng';
const SHEET_GUIDE = 'Hướng dẫn';
const SHEET_CATALOG = 'Danh mục hiện có';

const KIND_LABELS: Record<PriceListItemKind, string> = {
  EXAM_TYPE: 'Dịch vụ khám',
  TECHNICAL_SERVICE: 'Dịch vụ kỹ thuật',
  PACKAGE: 'Gói dịch vụ',
  DRUG: 'Thuốc',
  MEDICAL_SUPPLY: 'Vật tư y tế',
};
const MODE_PERCENT = 'Giảm %';
const MODE_NEW_PRICE = 'Giá mới';

/** Cột của sheet "Mặt hàng" theo đúng thứ tự — tiêu đề (không kèm dấu * bắt buộc) dùng để kiểm file có đúng mẫu không. */
const COLUMNS = [
  { header: 'Loại mặt hàng', required: true, width: 22 },
  { header: 'Mã mặt hàng', required: true, width: 22 },
  { header: 'Loại giá / Đơn vị', required: false, width: 24 },
  { header: 'Cách tính', required: true, width: 16 },
  { header: 'Giá trị', required: true, width: 16 },
] as const;

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
const EXAMPLE_FONT: Partial<ExcelJS.Font> = { italic: true, color: { argb: 'FF94A3B8' } };

const norm = (v: string): string => stripVietnameseDiacritics(v).replace(/\s+/g, ' ').trim().toLowerCase();
const headerText = (c: (typeof COLUMNS)[number]): string => (c.required ? `${c.header} (*)` : c.header);

const KIND_BY_NAME = new Map<string, PriceListItemKind>([
  ...(Object.entries(KIND_LABELS) as [PriceListItemKind, string][]).map(([kind, label]) => [norm(label), kind] as const),
  [norm('Vật tư'), 'MEDICAL_SUPPLY'],
  [norm('Dịch vụ kỹ thuật (cận lâm sàng)'), 'TECHNICAL_SERVICE'],
]);

type Cell = string | number | null;

function readCell(cell: ExcelJS.Cell): Cell {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  const t = String(cell.text ?? '').trim();
  return t === '' ? null : t;
}

/** "50", "1.500.000", "1,500,000", 50 → số nguyên; sai định dạng → null. */
function parseWholeNumber(raw: Cell): number | null {
  if (raw === null) return null;
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 ? raw : null;
  const digits = raw.replace(/[.,\s]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

/**
 * Nhập Excel vào bảng giá (docs/DECISIONS.md #212, yêu cầu chủ dự án 07/10/2026). KHÔNG ghi gì vào DB: chỉ đọc file, đối chiếu mã mặt hàng/Loại giá/Đơn vị với danh mục
 * rồi trả các dòng hợp lệ + lỗi từng dòng. Web gộp dòng hợp lệ vào danh sách ĐANG SOẠN (file thắng dòng đã có của cùng mặt hàng) — người dùng vẫn phải bấm "Lưu bảng giá",
 * nên mọi quy tắc lưu (không trùng phạm vi, đơn vị thuộc chuỗi quy đổi...) vẫn do `PriceListService.validateLines` kiểm lần cuối.
 */
@Injectable()
export class PriceListImportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly catalog: PriceableCatalogService,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    private readonly technicalServiceRepository: TechnicalServiceRepository,
    private readonly servicePackageRepository: ServicePackageRepository,
    private readonly drugRepository: DrugRepository,
  ) {}

  /** File mẫu: sheet nhập có 2 dòng ví dụ (mã "VD-…" tự bị bỏ qua), sheet Hướng dẫn, sheet Danh mục hiện có để tra mã. */
  async buildTemplate(tenantId: string): Promise<Buffer> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const workbook = new ExcelJS.Workbook();

      const sheet = workbook.addWorksheet(SHEET_ITEMS, { views: [{ state: 'frozen', ySplit: 1 }] });
      COLUMNS.forEach((c, i) => {
        const col = sheet.getColumn(i + 1);
        col.width = c.width;
        col.numFmt = '@';
      });
      const header = sheet.addRow(COLUMNS.map(headerText));
      header.font = { bold: true };
      header.alignment = { vertical: 'middle', wrapText: true };
      header.eachCell((cell) => {
        cell.fill = HEADER_FILL;
      });
      const examples = [
        [KIND_LABELS.EXAM_TYPE, `${PRICE_LIST_IMPORT_EXAMPLE_CODE_PREFIX}KHAM01`, 'Mọi loại giá', MODE_PERCENT, '20'],
        [KIND_LABELS.DRUG, `${PRICE_LIST_IMPORT_EXAMPLE_CODE_PREFIX}THUOC01`, 'Viên', MODE_NEW_PRICE, '2500'],
      ];
      for (const e of examples) sheet.addRow(e).font = EXAMPLE_FONT;
      for (let r = 2; r <= PRICE_LIST_IMPORT_MAX_ROWS + 1; r++) {
        sheet.getCell(r, 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${Object.values(KIND_LABELS).join(',')}"`], showErrorMessage: false };
        sheet.getCell(r, 4).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${MODE_PERCENT},${MODE_NEW_PRICE}"`], showErrorMessage: false };
      }

      const guide = workbook.addWorksheet(SHEET_GUIDE);
      guide.getColumn(1).width = 26;
      guide.getColumn(2).width = 100;
      const guideRows: [string, string][] = [
        ['Mục đích', 'Thêm số lượng lớn mặt hàng vào bảng giá. Sau khi nhập, các dòng được đưa vào danh sách đang soạn — kiểm tra lại rồi bấm "Lưu bảng giá".'],
        ['Loại mặt hàng (*)', `Một trong: ${Object.values(KIND_LABELS).join(', ')}.`],
        ['Mã mặt hàng (*)', 'Mã đúng như trong danh mục (xem sheet "Danh mục hiện có"). Không phân biệt hoa/thường. Mã bắt đầu bằng "VD-" là dòng ví dụ, tự bị bỏ qua.'],
        ['Loại giá / Đơn vị', 'Dịch vụ khám/kỹ thuật: tên Loại giá dịch vụ (VD "Dịch vụ"); thuốc/vật tư: tên Đơn vị (VD "Hộp", "Viên"); gói dịch vụ: để trống. "Giảm %" có thể để trống (áp mọi Loại giá/mọi bậc đơn vị). "Giá mới" bắt buộc khi mặt hàng có nhiều Loại giá/bậc đơn vị; chỉ có một mức thì có thể để trống.'],
        ['Cách tính (*)', `"${MODE_PERCENT}" hoặc "${MODE_NEW_PRICE}".`],
        ['Giá trị (*)', `${MODE_PERCENT}: số nguyên từ 1 đến 100. ${MODE_NEW_PRICE}: số tiền đồng (VD 150000 hoặc 150.000).`],
        ['Mặt hàng đã có trong bảng', 'File THẮNG: dòng của mặt hàng đó trong danh sách đang soạn được thay bằng dòng trong file.'],
        ['Giới hạn', `Tối đa ${PRICE_LIST_IMPORT_MAX_ROWS.toLocaleString('vi-VN')} dòng mỗi lần nhập, file .xlsx dưới 5 MB.`],
      ];
      guide.addRow(['Mục', 'Giải thích']).font = { bold: true };
      for (const row of guideRows) guide.addRow(row);
      guide.eachRow((row) => {
        row.alignment = { vertical: 'top', wrapText: true };
      });

      await this.addCatalogSheet(workbook, tx, tenantId);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    });
  }

  private async addCatalogSheet(workbook: ExcelJS.Workbook, tx: Parameters<Parameters<UnitOfWorkService['runInTenantScope']>[1]>[0], tenantId: string): Promise<void> {
    const sheet = workbook.addWorksheet(SHEET_CATALOG, { views: [{ state: 'frozen', ySplit: 1 }] });
    [14, 22, 50, 4, 24, 24].forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });
    sheet.addRow(['Loại', 'Mã', 'Tên', '', 'Loại giá dịch vụ', 'Đơn vị']).font = { bold: true };

    const lines: [string, string, string][] = [];
    for (const row of await this.referenceCatalogRepository.listByCategory(tx, 'EXAM_TYPE', false)) lines.push([KIND_LABELS.EXAM_TYPE, row.code, row.name]);
    for (const row of await this.technicalServiceRepository.list(tx, tenantId, { includeInactive: false })) lines.push([KIND_LABELS.TECHNICAL_SERVICE, row.code, row.name]);
    for (const row of await this.servicePackageRepository.list(tx, tenantId, { includeInactive: false })) lines.push([KIND_LABELS.PACKAGE, row.code, row.name]);
    for (const row of await this.drugRepository.list(tx, tenantId, { includeInactive: false })) lines.push([row.itemType === 'SUPPLY' ? KIND_LABELS.MEDICAL_SUPPLY : KIND_LABELS.DRUG, row.code, row.name]);
    const priceTypes = (await this.referenceCatalogRepository.listByCategory(tx, 'PRICE_TYPE', false)).map((r) => r.name);
    const units = (await this.referenceCatalogRepository.listByCategory(tx, 'UNIT', false)).map((r) => r.name);

    const total = Math.max(lines.length, priceTypes.length, units.length);
    for (let i = 0; i < total; i++) {
      const line = lines[i];
      sheet.addRow([line?.[0] ?? '', line?.[1] ?? '', line?.[2] ?? '', '', priceTypes[i] ?? '', units[i] ?? '']);
    }
  }

  async preview(tenantId: string, fileBuffer: Buffer): Promise<PriceListImportPreviewResponse> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Không đọc được file. Hãy dùng file .xlsx theo đúng file mẫu.');
    }
    const sheet = workbook.getWorksheet(SHEET_ITEMS) ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('File không có sheet nào.');
    COLUMNS.forEach((c, i) => {
      const got = String(sheet.getCell(1, i + 1).text ?? '').replace(/\(\*\)/g, '');
      if (norm(got) !== norm(c.header)) throw new BadRequestException(`Cột ${i + 1} phải là "${headerText(c)}" — file không đúng mẫu, hãy tải lại file mẫu.`);
    });

    interface RawRow {
      rowNumber: number;
      kind: Cell;
      code: Cell;
      scope: Cell;
      mode: Cell;
      value: Cell;
    }
    const raw: RawRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells = COLUMNS.map((_, i) => readCell(row.getCell(i + 1)));
      if (cells.every((c) => c === null)) return;
      raw.push({ rowNumber, kind: cells[0]!, code: cells[1]!, scope: cells[2]!, mode: cells[3]!, value: cells[4]! });
    });

    const isExample = (r: RawRow) => typeof r.code === 'string' && r.code.toLowerCase().startsWith(PRICE_LIST_IMPORT_EXAMPLE_CODE_PREFIX.toLowerCase());
    const real = raw.filter((r) => !isExample(r));
    if (real.length > PRICE_LIST_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`File có ${real.length.toLocaleString('vi-VN')} dòng — tối đa ${PRICE_LIST_IMPORT_MAX_ROWS.toLocaleString('vi-VN')} dòng mỗi lần nhập, hãy chia nhỏ file.`);
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const errors: PriceListImportError[] = [];
      const rows: PriceListImportRow[] = [];

      // Gom các (loại, mã) cần tra để đọc danh mục một lượt.
      const wanted: { kind: PriceListItemKind; code: string }[] = [];
      const kindOf = new Map<number, PriceListItemKind>();
      for (const r of real) {
        const kind = typeof r.kind === 'string' ? KIND_BY_NAME.get(norm(r.kind)) : undefined;
        if (kind && r.code !== null) {
          kindOf.set(r.rowNumber, kind);
          wanted.push({ kind, code: String(r.code) });
        }
      }
      const items = await this.catalog.findByCodes(tx, tenantId, getVietnamDateString(), wanted);
      const priceTypes = new Map((await this.referenceCatalogRepository.listByCategory(tx, 'PRICE_TYPE', true)).flatMap((r) => [[norm(r.name), r.code] as const, [norm(r.code), r.code] as const]));
      const units = new Map((await this.referenceCatalogRepository.listByCategory(tx, 'UNIT', true)).flatMap((r) => [[norm(r.name), r.code] as const, [norm(r.code), r.code] as const]));

      const seen = new Set<string>();
      for (const r of real) {
        const fail = (message: string) => errors.push({ rowNumber: r.rowNumber, message });
        const kind = kindOf.get(r.rowNumber);
        if (r.kind === null || r.code === null) {
          fail('Thiếu Loại mặt hàng hoặc Mã mặt hàng.');
          continue;
        }
        if (!kind) {
          fail(`Loại mặt hàng "${String(r.kind)}" không hợp lệ — chọn một trong: ${Object.values(KIND_LABELS).join(', ')}.`);
          continue;
        }
        const item: PriceableItem | undefined = items.get(`${kind}:${String(r.code).trim().toLowerCase()}`);
        if (!item) {
          fail(`Không tìm thấy mã "${String(r.code)}" trong danh mục ${KIND_LABELS[kind].toLowerCase()} đang dùng.`);
          continue;
        }
        const modeNorm = typeof r.mode === 'string' ? norm(r.mode) : '';
        const mode = modeNorm === norm(MODE_PERCENT) || modeNorm === 'giam' ? 'PERCENT_OFF' : modeNorm === norm(MODE_NEW_PRICE) ? 'NEW_PRICE' : null;
        if (!mode) {
          fail(`Cách tính phải là "${MODE_PERCENT}" hoặc "${MODE_NEW_PRICE}".`);
          continue;
        }
        const value = parseWholeNumber(r.value);
        if (value === null) {
          fail('Giá trị phải là số nguyên không âm.');
          continue;
        }
        if (mode === 'PERCENT_OFF' && (value < 1 || value > 100)) {
          fail('Giá trị "Giảm %" phải từ 1 đến 100.');
          continue;
        }

        const isService = kind === 'EXAM_TYPE' || kind === 'TECHNICAL_SERVICE';
        const isStock = kind === 'DRUG' || kind === 'MEDICAL_SUPPLY';
        let priceTypeCode: string | null = null;
        let unitCode: string | null = null;
        const scopeText = r.scope === null ? '' : String(r.scope).trim();
        if (kind !== 'PACKAGE' && scopeText !== '' && norm(scopeText) !== norm('Mọi loại giá') && norm(scopeText) !== norm('Mọi bậc')) {
          // Danh mục (tên hoặc mã) trước; không có thì khớp thẳng mã Loại giá/Đơn vị mà chính mặt hàng này đang dùng (dữ liệu cũ có mã không nằm trong danh mục).
          const ownCodes = item.scopes.map((sc) => (isService ? sc.priceTypeCode : sc.unitCode)).filter((c): c is string => c !== null);
          const found = (isService ? priceTypes : units).get(norm(scopeText)) ?? ownCodes.find((c) => norm(c) === norm(scopeText));
          if (!found) {
            fail(`${isService ? 'Loại giá' : 'Đơn vị'} "${scopeText}" không có trong danh mục.`);
            continue;
          }
          if (isService) priceTypeCode = found;
          else unitCode = found;
        }
        if (mode === 'NEW_PRICE' && kind !== 'PACKAGE') {
          // "Giá mới" bắt buộc chỉ định đúng mức; mặt hàng chỉ có MỘT mức thì tự điền để khỏi bắt gõ.
          const levels = isService ? [...new Set(item.scopes.map((s) => s.priceTypeCode).filter((c): c is string => c !== null))] : [...new Set(item.scopes.map((s) => s.unitCode).filter((c): c is string => c !== null))];
          if (isService && priceTypeCode === null) {
            if (levels.length === 1) priceTypeCode = levels[0]!;
            else {
              fail('"Giá mới" cần chọn Loại giá dịch vụ (mặt hàng có nhiều hoặc chưa có mức giá).');
              continue;
            }
          }
          if (isStock && unitCode === null) {
            if (levels.length === 1) unitCode = levels[0]!;
            else {
              fail('"Giá mới" cần chọn Đơn vị (mặt hàng có nhiều bậc đơn vị).');
              continue;
            }
          }
        }
        if (mode === 'PERCENT_OFF') unitCode = null; // "Giảm %" áp mọi bậc đơn vị

        // Trùng mặt hàng kiểm SAU các lỗi riêng của dòng (giá trị/đơn vị...) để thông báo đúng nguyên nhân chính.
        const dupKey = `${kind}:${item.ref}`;
        if (seen.has(dupKey)) {
          fail(`Mặt hàng "${item.code}" đã xuất hiện ở dòng trên của file.`);
          continue;
        }
        seen.add(dupKey);
        rows.push({ rowNumber: r.rowNumber, item, priceTypeCode, unitCode, mode, value });
      }

      errors.sort((a, b) => a.rowNumber - b.rowNumber);
      return { rows, errors, exampleRowCount: raw.length - real.length };
    });
  }
}
