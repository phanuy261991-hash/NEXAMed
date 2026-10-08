import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import {
  IMPORT_CONTROL_TYPE_LABELS,
  IMPORT_ITEM_TYPE_LABELS,
  IMPORT_NO_LABEL,
  IMPORT_YES_LABEL,
  maxDataScope,
  normalizeImportName,
  parseImportControlType,
  parseImportInteger,
  parseImportItemType,
  parseImportStrength,
  parseImportYesNo,
} from '@nexamed/core';
import {
  createDrugRequestSchema,
  DRUG_IMPORT_EXAMPLE_CODE_PREFIX,
  DRUG_IMPORT_MAX_ROWS,
  type CreateDrugRequest,
  type DrugImportCommitResponse,
  type DrugImportNewCatalogItem,
  type DrugImportPreviewResponse,
  type DrugImportRowError,
  type DrugImportValidRow,
  type DrugIngredientInput,
  type DrugUnitInput,
  type ReferenceCatalogCategory,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ReferenceCatalogService } from '../reference-catalog/reference-catalog.service';
import { DrugRepository } from './drug.repository';
import { DrugService } from './drug.service';
import {
  headerLabelOf,
  INGREDIENT_COLUMNS,
  ITEM_COLUMNS,
  SHEET_INGREDIENTS,
  SHEET_ITEMS,
  SHEET_UNITS,
  UNIT_COLUMNS,
  type ImportColumn,
  type ImportRecord,
} from './drug-import.columns';
import {
  buildDrugExportWorkbook,
  buildDrugImportTemplate,
  DRUG_IMPORT_CATEGORIES,
  DRUG_IMPORT_CATEGORY_LABELS,
  type DrugImportCategory,
} from './drug-import.workbook';

type Cell = string | number | null;
interface SheetRow {
  rowNumber: number;
  cells: Record<string, Cell>;
}

/** Tiền tố đánh dấu mã danh mục CHƯA CÓ (sẽ tạo lúc commit) — thay bằng mã thật ở `fixCode()`. */
const NEW_CODE_PREFIX = '\u0001NEW|';
const IMPORT_TIMEOUT_MS = 120_000;
const SHEET_ORDER: Record<string, number> = { [SHEET_ITEMS]: 0, [SHEET_INGREDIENTS]: 1, [SHEET_UNITS]: 2 };

interface ItemDraft {
  rowNumber: number;
  code: string;
  name: string;
  itemType: 'MEDICINE' | 'SUPPLY' | null;
  /** Mã đã có trong hệ thống — bỏ qua toàn bộ (không đối chiếu thêm). */
  existing: boolean;
  errors: DrugImportRowError[];
  ingredients: DrugIngredientInput[];
  units: DrugUnitInput[];
  /** Giá riêng từng bậc quy đổi (cùng thứ tự `units`) — dùng kiểm "điền đủ hoặc để trống hết". */
  unitPrices: (number | null)[];
  ingredientRowCount: number;
  unitRowCount: number;
  /** Khoá danh mục chưa có mà mặt hàng này tham chiếu — chỉ tạo mới nếu mặt hàng hợp lệ. */
  newKeys: Set<string>;
  baseUnitCode: string | undefined;
  fields: Record<string, unknown>;
  parsed?: CreateDrugRequest;
}

interface Analysis {
  drafts: ItemDraft[];
  looseErrors: DrugImportRowError[];
  newItems: Map<string, DrugImportNewCatalogItem>;
  exampleRowCount: number;
}

function text(cell: Cell | undefined): string {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

function collapse(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function isExampleCode(code: string): boolean {
  return code.toLowerCase().startsWith(DRUG_IMPORT_EXAMPLE_CODE_PREFIX.toLowerCase());
}

function readCell(cell: ExcelJS.Cell): Cell {
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

/**
 * Nhập/Xuất Excel "Thuốc & Vật tư y tế" (docs/DECISIONS.md #210) — khuôn `WorkShiftAssignmentImportService`:
 * `preview` chỉ đọc + đối chiếu, `commit` đọc lại ĐÚNG file rồi ghi trong MỘT transaction (hoặc nhập đủ
 * hoặc không nhập gì). Quy tắc kiểm hợp lệ KHÔNG viết lại — dùng thẳng `createDrugRequestSchema` (cùng
 * form "Thêm mặt hàng"); phần riêng của nhập file chỉ là đọc ô, đối chiếu TÊN → mã danh mục, và gom
 * dòng con (hoạt chất/quy đổi) theo Mã thuốc. Tên danh mục chưa có thì tự tạo mới lúc commit (cần quyền
 * `reference_catalog.manage`; thiếu quyền → dòng đó là lỗi, không tạo gì).
 */
@Injectable()
export class DrugImportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly drugRepository: DrugRepository,
    private readonly drugService: DrugService,
    private readonly referenceCatalogService: ReferenceCatalogService,
  ) {}

  async buildTemplate(tenantId: string): Promise<Buffer> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.referenceCatalogService.listAllForImport(tx, [...DRUG_IMPORT_CATEGORIES]);
      const names = Object.fromEntries(DRUG_IMPORT_CATEGORIES.map((c) => [c, [] as string[]])) as Record<DrugImportCategory, string[]>;
      for (const r of rows) {
        if (r.isActive) names[r.category as DrugImportCategory].push(r.name);
      }
      return buildDrugImportTemplate(names);
    });
  }

  async buildExport(tenantId: string, actorId: string, meta: RequestMeta): Promise<Buffer> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const drugs = await this.drugRepository.list(tx, tenantId, { includeInactive: true });
      const catalogRows = await this.referenceCatalogService.listAllForImport(tx, [...DRUG_IMPORT_CATEGORIES]);
      const nameByCode = new Map(catalogRows.map((r) => [`${r.category}|${r.code}`, r.name]));
      const nameOf = (category: DrugImportCategory, code: string | null): string => (code ? (nameByCode.get(`${category}|${code}`) ?? code) : '');
      const yesNo = (v: boolean): string => (v ? IMPORT_YES_LABEL : IMPORT_NO_LABEL);

      const items: ImportRecord[] = [];
      const ingredients: ImportRecord[] = [];
      const units: ImportRecord[] = [];
      for (const d of drugs) {
        const medicine = d.itemType === 'MEDICINE';
        items.push({
          code: d.code,
          name: d.name,
          itemType: IMPORT_ITEM_TYPE_LABELS[d.itemType],
          baseUnit: nameOf('UNIT', d.baseUnitCode),
          price: d.defaultSellPrice === null ? '' : Number(d.defaultSellPrice),
          manufacturer: nameOf('MANUFACTURER', d.manufacturerCode),
          isBatchManaged: yesNo(d.isBatchManaged),
          drugGroup: nameOf('DRUG_GROUP', d.drugGroupCode),
          route: nameOf('DRUG_ROUTE', d.routeCode),
          registrationNumber: d.registrationNumber ?? '',
          dosageForm: nameOf('DOSAGE_FORM', d.dosageForm),
          country: nameOf('COUNTRY_OF_ORIGIN', d.countryOfOrigin),
          controlType: medicine ? IMPORT_CONTROL_TYPE_LABELS[d.controlType] : '',
          isPrescriptionOnly: medicine ? yesNo(d.isPrescriptionOnly) : '',
          nationalCode: d.nationalCode ?? '',
          barcode: d.barcode ?? '',
          shortcutCode: d.shortcutCode ?? '',
          packagingSpec: d.packagingSpec ?? '',
          storageCondition: nameOf('STORAGE_CONDITION', d.storageConditions),
          storageLocation: nameOf('STORAGE_LOCATION', d.storageLocation),
          defaultDosage: d.defaultDosage ?? '',
          usageInstruction: d.usageInstruction ?? '',
          contraindications: d.contraindications ?? '',
          minStockAlert: d.minStockAlert ?? '',
          maxStockAlert: d.maxStockAlert ?? '',
          // Cột phụ cuối sheet 1 — `addDataSheet` đọc khoá `__<tiêu đề>`; bộ đọc nhập bỏ qua cột này.
          '__Trạng thái': d.isActive ? 'Đang dùng' : 'Đã ẩn',
        });
        for (const ing of d.ingredients) {
          ingredients.push({
            code: d.code,
            ingredient: nameOf('ACTIVE_INGREDIENT', ing.activeIngredientCode),
            strength: ing.strengthValue / 1000,
            strengthUnit: nameOf('UNIT', ing.strengthUnitCode),
          });
        }
        for (const u of d.units) {
          units.push({ code: d.code, unit: nameOf('UNIT', u.unitCode), factor: u.factorToUnitBelow, price: u.sellPrice === null ? '' : Number(u.sellPrice) });
        }
      }

      const buffer = await buildDrugExportWorkbook(items, ingredients, units);
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'drug.exported',
        entityType: 'drug',
        entityId: tenantId,
        afterJson: { count: drugs.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return buffer;
    });
  }

  async preview(tenantId: string, actorId: string, fileBuffer: Buffer): Promise<DrugImportPreviewResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const analysis = await this.analyze(tx, tenantId, actorId, fileBuffer);
      return this.toPreview(analysis);
    });
  }

  async commit(tenantId: string, actorId: string, fileBuffer: Buffer, meta: RequestMeta): Promise<DrugImportCommitResponse> {
    return this.unitOfWork.runInTenantScope(
      tenantId,
      async (tx) => {
        const analysis = await this.analyze(tx, tenantId, actorId, fileBuffer);
        const preview = this.toPreview(analysis);
        const valid = analysis.drafts.filter((d) => d.parsed);

        // Tạo trước các mục danh mục chưa có (mã tự sinh) rồi thay mã tạm trong từng mặt hàng.
        const newCodes = new Map<string, string>();
        for (const item of preview.newCatalogItems) {
          const key = `${item.category}|${normalizeImportName(item.name)}`;
          newCodes.set(key, await this.referenceCatalogService.createByNameInTx(tx, tenantId, actorId, item.category, item.name, meta));
        }
        const fixCode = (c: string): string => (c.startsWith(NEW_CODE_PREFIX) ? (newCodes.get(c.slice(NEW_CODE_PREFIX.length)) ?? c) : c);
        const fixOptional = (c: string | undefined): string | undefined => (c === undefined ? undefined : fixCode(c));

        for (const draft of valid) {
          const dto = draft.parsed!;
          await this.drugService.createInTx(
            tx,
            tenantId,
            actorId,
            {
              ...dto,
              baseUnitCode: fixCode(dto.baseUnitCode),
              manufacturerCode: fixCode(dto.manufacturerCode),
              drugGroupCode: fixOptional(dto.drugGroupCode),
              routeCode: fixOptional(dto.routeCode),
              dosageForm: fixOptional(dto.dosageForm),
              countryOfOrigin: fixOptional(dto.countryOfOrigin),
              storageConditions: fixOptional(dto.storageConditions),
              storageLocation: fixOptional(dto.storageLocation),
              ingredients: dto.ingredients.map((i) => ({ ...i, activeIngredientCode: fixCode(i.activeIngredientCode), strengthUnitCode: fixCode(i.strengthUnitCode) })),
              units: dto.units.map((u) => ({ ...u, unitCode: fixCode(u.unitCode) })),
            },
            meta,
          );
        }

        const result: DrugImportCommitResponse = {
          createdCount: valid.length,
          duplicateCount: preview.duplicateRows.length,
          errorCount: preview.errorRows.length,
          newCatalogItemCount: preview.newCatalogItems.length,
        };
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'drug.imported',
          entityType: 'drug',
          entityId: tenantId,
          afterJson: { ...result },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return result;
      },
      { timeoutMs: IMPORT_TIMEOUT_MS },
    );
  }

  private toPreview(analysis: Analysis): DrugImportPreviewResponse {
    const toRow = (d: ItemDraft): DrugImportValidRow => ({
      rowNumber: d.rowNumber,
      code: d.code,
      name: d.name,
      itemType: d.itemType ?? 'MEDICINE',
      ingredientCount: d.ingredientRowCount,
      unitCount: d.unitRowCount,
    });
    const valid = analysis.drafts.filter((d) => d.parsed);
    const duplicates = analysis.drafts.filter((d) => d.existing);

    // Chỉ tạo mới danh mục mà mặt hàng HỢP LỆ tham chiếu (mặt hàng lỗi không để lại rác trong danh mục dùng chung).
    const neededKeys = new Set<string>();
    for (const d of valid) for (const k of d.newKeys) neededKeys.add(k);
    const newCatalogItems = [...neededKeys]
      .map((k) => analysis.newItems.get(k)!)
      .sort((a, b) => DRUG_IMPORT_CATEGORIES.indexOf(a.category as DrugImportCategory) - DRUG_IMPORT_CATEGORIES.indexOf(b.category as DrugImportCategory) || a.name.localeCompare(b.name, 'vi'));

    const errorRows = [...analysis.looseErrors, ...analysis.drafts.flatMap((d) => d.errors)].sort(
      (a, b) => (SHEET_ORDER[a.sheet] ?? 9) - (SHEET_ORDER[b.sheet] ?? 9) || a.rowNumber - b.rowNumber,
    );

    return {
      validRows: valid.map(toRow),
      duplicateRows: duplicates.map(toRow),
      errorRows,
      newCatalogItems,
      exampleRowCount: analysis.exampleRowCount,
    };
  }

  private async loadWorkbook(fileBuffer: Buffer): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Không đọc được file. Hãy dùng file .xlsx theo đúng file mẫu.');
    }
    return workbook;
  }

  private readSheet(sheet: ExcelJS.Worksheet | undefined, name: string, columns: ImportColumn[], maxRows: number): SheetRow[] {
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

  /** Đọc + đối chiếu toàn file (CHỈ đọc DB). `preview` và `commit` dùng chung nên 2 bước luôn cho cùng kết quả. */
  private async analyze(tx: Prisma.TransactionClient, tenantId: string, actorId: string, fileBuffer: Buffer): Promise<Analysis> {
    const workbook = await this.loadWorkbook(fileBuffer);
    const itemSheet = workbook.getWorksheet(SHEET_ITEMS) ?? workbook.worksheets[0];
    const itemRows = this.readSheet(itemSheet, SHEET_ITEMS, ITEM_COLUMNS, DRUG_IMPORT_MAX_ROWS + 1_000);
    const ingredientRows = this.readSheet(workbook.getWorksheet(SHEET_INGREDIENTS), SHEET_INGREDIENTS, INGREDIENT_COLUMNS, DRUG_IMPORT_MAX_ROWS * 10);
    const unitRows = this.readSheet(workbook.getWorksheet(SHEET_UNITS), SHEET_UNITS, UNIT_COLUMNS, DRUG_IMPORT_MAX_ROWS * 10);

    const realItemRows = itemRows.filter((r) => !isExampleCode(text(r.cells.code)));
    if (realItemRows.length > DRUG_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`File có ${realItemRows.length.toLocaleString('vi-VN')} mặt hàng — tối đa ${DRUG_IMPORT_MAX_ROWS.toLocaleString('vi-VN')} mặt hàng mỗi lần nhập, hãy chia nhỏ file.`);
    }

    const canCreateCatalog = maxDataScope(await findScopesForUserPermission(tx, tenantId, actorId, 'reference_catalog', 'manage')) !== 'none';

    // Chỉ mục tên (đã chuẩn hoá) → mục danh mục, ưu tiên mục đang hoạt động.
    const catalogRows = await this.referenceCatalogService.listAllForImport(tx, [...DRUG_IMPORT_CATEGORIES]);
    const catalogIndex = new Map<string, { code: string; name: string; isActive: boolean }>();
    for (const r of catalogRows) {
      const key = `${r.category}|${normalizeImportName(r.name)}`;
      const existing = catalogIndex.get(key);
      if (!existing || (!existing.isActive && r.isActive)) catalogIndex.set(key, { code: r.code, name: r.name, isActive: r.isActive });
    }

    const existingDrugs = await this.drugRepository.listCodesAndShortcuts(tx, tenantId);
    const existingCodes = new Set(existingDrugs.map((d) => d.code));
    const existingShortcuts = new Set(existingDrugs.map((d) => d.shortcutCode).filter((s): s is string => !!s));

    const newItems = new Map<string, DrugImportNewCatalogItem>();
    const looseErrors: DrugImportRowError[] = [];
    let exampleRowCount = itemRows.length - realItemRows.length;
    const drafts: ItemDraft[] = [];
    const byCode = new Map<string, ItemDraft>();

    const err = (draft: ItemDraft | null, sheet: string, rowNumber: number, code: string, reason: string): void => {
      (draft ? draft.errors : looseErrors).push({ sheet, rowNumber, code: code || '(trống)', reason });
    };

    /** Tên → mã danh mục. Trả `undefined` (và ghi lỗi) khi tên đang bị ẩn hoặc chưa có mà không có quyền tạo. */
    const resolve = (draft: ItemDraft, category: DrugImportCategory, raw: Cell | undefined, sheet: string, rowNumber: number): string | undefined => {
      const name = collapse(text(raw));
      const label = DRUG_IMPORT_CATEGORY_LABELS[category];
      const key = `${category}|${normalizeImportName(name)}`;
      const found = catalogIndex.get(key);
      if (found) {
        if (!found.isActive) {
          err(draft, sheet, rowNumber, draft.code, `${label} "${name}" đang bị ẩn trong danh mục — kích hoạt lại hoặc dùng tên khác.`);
          return undefined;
        }
        return found.code;
      }
      if (!canCreateCatalog) {
        err(draft, sheet, rowNumber, draft.code, `${label} "${name}" chưa có trong danh mục và tài khoản của bạn không có quyền tạo mới danh mục dùng chung — chọn tên đã có (xem sheet "Danh mục hiện có") hoặc nhờ quản trị viên nhập.`);
        return undefined;
      }
      if (!newItems.has(key)) newItems.set(key, { category: category as ReferenceCatalogCategory, name });
      draft.newKeys.add(key);
      return `${NEW_CODE_PREFIX}${key}`;
    };

    const requiredCatalog = (draft: ItemDraft, category: DrugImportCategory, raw: Cell | undefined, columnLabel: string, sheet: string, rowNumber: number): string | undefined => {
      if (text(raw) === '') {
        err(draft, sheet, rowNumber, draft.code, `Thiếu ${columnLabel}.`);
        return undefined;
      }
      return resolve(draft, category, raw, sheet, rowNumber);
    };

    // ---- Sheet 1: mặt hàng ----
    for (const r of itemRows) {
      const code = text(r.cells.code);
      if (isExampleCode(code)) continue;
      const draft: ItemDraft = {
        rowNumber: r.rowNumber,
        code,
        name: text(r.cells.name),
        itemType: null,
        existing: false,
        errors: [],
        ingredients: [],
        units: [],
        unitPrices: [],
        ingredientRowCount: 0,
        unitRowCount: 0,
        newKeys: new Set(),
        baseUnitCode: undefined,
        fields: {},
      };
      drafts.push(draft);
      const itemErr = (reason: string): void => err(draft, SHEET_ITEMS, r.rowNumber, code, reason);

      if (code === '') {
        itemErr('Thiếu Mã.');
        continue;
      }
      const dup = byCode.get(code);
      if (dup) {
        itemErr(`Mã bị lặp trong file (đã có ở dòng ${dup.rowNumber}).`);
        continue;
      }
      byCode.set(code, draft);

      const type = parseImportItemType(r.cells.itemType);
      if (!type.ok) itemErr('Loại phải là "Thuốc" hoặc "Vật tư".');
      else if (type.value === null) itemErr('Thiếu Loại (Thuốc hoặc Vật tư).');
      else draft.itemType = type.value;

      if (existingCodes.has(code)) {
        draft.existing = true;
        draft.errors = [];
        continue;
      }
      if (draft.name === '') itemErr('Thiếu Tên.');
      if (draft.itemType === null) continue;
      const medicine = draft.itemType === 'MEDICINE';
      const c = r.cells;

      const baseUnit = requiredCatalog(draft, 'UNIT', c.baseUnit, 'Đơn vị cơ sở', SHEET_ITEMS, r.rowNumber);
      draft.baseUnitCode = baseUnit;
      const manufacturer = requiredCatalog(draft, 'MANUFACTURER', c.manufacturer, 'Hãng sản xuất', SHEET_ITEMS, r.rowNumber);

      const price = parseImportInteger(c.price);
      if (!price.ok) itemErr('Giá bán phải là số nguyên không âm (đồng).');
      else if (price.value === null) itemErr('Thiếu Giá bán.');

      const batch = parseImportYesNo(c.isBatchManaged);
      if (!batch.ok) itemErr('"Quản lý theo lô" phải là Có hoặc Không.');
      const minAlert = parseImportInteger(c.minStockAlert);
      if (!minAlert.ok) itemErr('Tồn tối thiểu phải là số nguyên không âm.');
      const maxAlert = parseImportInteger(c.maxStockAlert);
      if (!maxAlert.ok) itemErr('Tồn tối đa phải là số nguyên không âm.');

      const optionalText = (v: Cell | undefined): string | undefined => (text(v) === '' ? undefined : text(v));
      const shortcut = optionalText(c.shortcutCode)?.toLowerCase();
      if (shortcut !== undefined && shortcut.length > 20) itemErr('Gõ tắt tối đa 20 ký tự.');

      const fields: Record<string, unknown> = {
        code,
        name: draft.name,
        itemType: draft.itemType,
        isBatchManaged: batch.ok ? (batch.value ?? true) : true,
        baseUnitCode: baseUnit,
        defaultSellPrice: price.ok ? (price.value ?? undefined) : undefined,
        manufacturerCode: manufacturer,
        nationalCode: optionalText(c.nationalCode),
        packagingSpec: optionalText(c.packagingSpec),
        shortcutCode: shortcut,
        minStockAlert: minAlert.ok ? (minAlert.value ?? undefined) : undefined,
        maxStockAlert: maxAlert.ok ? (maxAlert.value ?? undefined) : undefined,
      };

      if (medicine) {
        const control = parseImportControlType(c.controlType);
        if (!control.ok) itemErr('Phân loại kiểm soát phải là Thường, Độc, Gây nghiện, Hướng thần hoặc Tiền chất.');
        const rx = parseImportYesNo(c.isPrescriptionOnly);
        if (!rx.ok) itemErr('"Chỉ bán theo đơn" phải là Có hoặc Không.');
        const optionalCatalog = (category: DrugImportCategory, v: Cell | undefined): string | undefined => (text(v) === '' ? undefined : resolve(draft, category, v, SHEET_ITEMS, r.rowNumber));
        Object.assign(fields, {
          controlType: control.ok ? (control.value ?? 'NORMAL') : 'NORMAL',
          isPrescriptionOnly: rx.ok ? (rx.value ?? true) : true,
          drugGroupCode: optionalCatalog('DRUG_GROUP', c.drugGroup),
          routeCode: optionalCatalog('DRUG_ROUTE', c.route),
          registrationNumber: optionalText(c.registrationNumber),
          dosageForm: optionalCatalog('DOSAGE_FORM', c.dosageForm),
          countryOfOrigin: optionalCatalog('COUNTRY_OF_ORIGIN', c.country),
          storageConditions: optionalCatalog('STORAGE_CONDITION', c.storageCondition),
          storageLocation: optionalCatalog('STORAGE_LOCATION', c.storageLocation),
          barcode: optionalText(c.barcode),
          defaultDosage: optionalText(c.defaultDosage),
          usageInstruction: optionalText(c.usageInstruction),
          contraindications: optionalText(c.contraindications),
        });
      }
      draft.fields = fields;
    }

    // ---- Sheet 2/3: dòng con theo Mã thuốc ----
    const childParent = (rowCode: string, sheet: string, rowNumber: number): ItemDraft | null | undefined => {
      if (rowCode === '') {
        err(null, sheet, rowNumber, '', 'Thiếu Mã thuốc.');
        return undefined;
      }
      const parent = byCode.get(rowCode);
      if (!parent) {
        err(
          null,
          sheet,
          rowNumber,
          rowCode,
          existingCodes.has(rowCode)
            ? 'Mã thuốc này đã có sẵn trong hệ thống — hoạt chất/quy đổi chỉ nhập kèm mặt hàng mới (sửa trực tiếp ở Danh mục).'
            : `Mã thuốc không có ở sheet "${SHEET_ITEMS}".`,
        );
        return undefined;
      }
      // Mặt hàng đã có sẵn (bỏ qua) hoặc lỗi loại → không xử lý dòng con (lỗi gốc đã báo ở sheet 1).
      return parent.existing || parent.itemType === null ? null : parent;
    };

    for (const r of ingredientRows) {
      const code = text(r.cells.code);
      if (isExampleCode(code)) {
        exampleRowCount++;
        continue;
      }
      const target = childParent(code, SHEET_INGREDIENTS, r.rowNumber);
      if (target === undefined) continue;
      if (target === null) {
        // Mặt hàng đã có sẵn/lỗi loại: chỉ đếm dòng con cho màn xem trước, không xử lý.
        const skipped = byCode.get(code);
        if (skipped) skipped.ingredientRowCount++;
        continue;
      }
      target.ingredientRowCount++;
      const e = (reason: string): void => err(target, SHEET_INGREDIENTS, r.rowNumber, code, reason);
      if (target.itemType === 'SUPPLY') {
        e('Vật tư y tế không có hoạt chất/hàm lượng.');
        continue;
      }
      const ingredient = requiredCatalog(target, 'ACTIVE_INGREDIENT', r.cells.ingredient, 'Hoạt chất', SHEET_INGREDIENTS, r.rowNumber);
      const strength = parseImportStrength(r.cells.strength);
      if (!strength.ok) e('Hàm lượng phải là số không âm (tối đa 3 chữ số thập phân).');
      else if (strength.value === null) e('Thiếu Hàm lượng.');
      const strengthUnit = requiredCatalog(target, 'UNIT', r.cells.strengthUnit, 'Đơn vị hàm lượng', SHEET_INGREDIENTS, r.rowNumber);
      if (ingredient !== undefined && strength.ok && strength.value !== null && strengthUnit !== undefined) {
        if (target.ingredients.some((i) => i.activeIngredientCode === ingredient)) {
          e(`Hoạt chất "${collapse(text(r.cells.ingredient))}" bị lặp ở cùng mã thuốc.`);
        } else {
          target.ingredients.push({ activeIngredientCode: ingredient, strengthValue: strength.value, strengthUnitCode: strengthUnit });
        }
      }
    }

    for (const r of unitRows) {
      const code = text(r.cells.code);
      if (isExampleCode(code)) {
        exampleRowCount++;
        continue;
      }
      const parent = childParent(code, SHEET_UNITS, r.rowNumber);
      if (parent === undefined) continue;
      if (parent === null) {
        const dup = byCode.get(code);
        if (dup) dup.unitRowCount++;
        continue;
      }
      parent.unitRowCount++;
      const e = (reason: string): void => err(parent, SHEET_UNITS, r.rowNumber, code, reason);
      const unit = requiredCatalog(parent, 'UNIT', r.cells.unit, 'Đơn vị lớn hơn', SHEET_UNITS, r.rowNumber);
      const factor = parseImportInteger(r.cells.factor);
      if (!factor.ok || (factor.value !== null && factor.value < 1)) e('Quy đổi phải là số nguyên dương.');
      else if (factor.value === null) e('Thiếu Quy đổi ra đơn vị ngay bên dưới.');
      const price = parseImportInteger(r.cells.price);
      if (!price.ok) e('Giá bán phải là số nguyên không âm (đồng).');
      if (unit !== undefined && factor.ok && factor.value !== null && factor.value >= 1 && price.ok) {
        if (unit === parent.baseUnitCode) {
          e('Đơn vị lớn hơn không được trùng đơn vị cơ sở.');
        } else if (parent.units.some((u) => u.unitCode === unit)) {
          e(`Đơn vị "${collapse(text(r.cells.unit))}" bị lặp ở cùng mã thuốc.`);
        } else {
          parent.units.push({ unitCode: unit, sortOrder: parent.units.length, factorToUnitBelow: factor.value, sellPrice: price.value });
          parent.unitPrices.push(price.value);
        }
      }
    }

    // ---- Kiểm tra cuối từng mặt hàng: giá bậc nhất quán, gõ tắt không trùng, rồi schema chung ----
    const seenShortcuts = new Map<string, number>();
    for (const draft of drafts) {
      if (draft.existing || draft.itemType === null || draft.errors.length > 0) continue;
      const e = (sheet: string, reason: string): void => err(draft, sheet, draft.rowNumber, draft.code, reason);

      const priced = draft.unitPrices.filter((p) => p !== null).length;
      if (priced > 0 && priced < draft.unitPrices.length) {
        e(SHEET_UNITS, 'Giá bán các bậc quy đổi phải điền đủ cho tất cả các bậc của mã này hoặc để trống hết.');
      }
      const shortcut = draft.fields.shortcutCode as string | undefined;
      if (shortcut !== undefined) {
        const firstRow = seenShortcuts.get(shortcut);
        if (existingShortcuts.has(shortcut)) e(SHEET_ITEMS, `Gõ tắt "${shortcut}" đã được mặt hàng khác trong hệ thống dùng.`);
        else if (firstRow !== undefined) e(SHEET_ITEMS, `Gõ tắt "${shortcut}" trùng với mặt hàng ở dòng ${firstRow} trong file.`);
      }
      if (draft.errors.length > 0) continue;

      const parsed = createDrugRequestSchema.safeParse({
        ...draft.fields,
        unitPricingEnabled: draft.unitPrices.length > 0 && priced === draft.unitPrices.length,
        ingredients: draft.ingredients,
        units: draft.units,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) e(SHEET_ITEMS, issue.message);
        continue;
      }
      draft.parsed = parsed.data;
      if (shortcut !== undefined) seenShortcuts.set(shortcut, draft.rowNumber);
    }

    return { drafts, looseErrors, newItems, exampleRowCount };
  }
}
