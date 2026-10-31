import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  getVietnamDateString,
  IMPORT_NO_LABEL,
  IMPORT_RESULT_TYPE_LABELS,
  IMPORT_SERVICE_KIND_LABELS,
  IMPORT_YES_LABEL,
  maxDataScope,
  normalizeImportName,
  parseImportInteger,
  parseImportResultType,
  parseImportServiceKind,
  parseImportYesNo,
} from '@nexamed/core';
import {
  createTechnicalServiceRequestSchema,
  TECHNICAL_SERVICE_IMPORT_EXAMPLE_PREFIX,
  TECHNICAL_SERVICE_IMPORT_MAX_ROWS,
  type CreateTechnicalServiceRequest,
  type TechnicalServiceImportCommitResponse,
  type TechnicalServiceImportPreviewResponse,
  type TechnicalServiceImportRow,
  type TechnicalServiceImportRowError,
  type TechnicalServiceKind,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';
import type { RequestMeta } from '../../common/request-meta';
import { CatalogNameResolver, createNewCatalogItems, neededNewItems, replaceTemporaryCode, type NewCatalogItem } from '../../common/excel-import/catalog-name-resolver';
import { cellText, collapseSpaces, loadWorkbook, readSheetRows, type Cell, type ImportRecord } from '../../common/excel-import/excel-import';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { ReferenceCatalogService } from '../reference-catalog/reference-catalog.service';
import { TechnicalServiceRepository } from './technical-service.repository';
import { TechnicalServiceService } from './technical-service.service';
import { COLUMN, SERVICE_COLUMNS, SHEET_SERVICES } from './technical-service-import.columns';
import {
  buildServiceExportWorkbook,
  buildServiceImportTemplate,
  TECHNICAL_SERVICE_IMPORT_CATEGORIES,
  TECHNICAL_SERVICE_IMPORT_CATEGORY_LABELS,
  type TechnicalServiceImportCategory,
} from './technical-service-import.workbook';

const IMPORT_TIMEOUT_MS = 120_000;
const MAX_NAME_LENGTH = 200;
const MAX_SHORT_NAME_LENGTH = 100;
const MAX_NATIONAL_CODE_LENGTH = 50;
const MAX_TURNAROUND_MINUTES = 60 * 24 * 30;

/** Trường của yêu cầu tạo dịch vụ → cột trong file, để lỗi do schema chung vẫn chỉ đúng cột cần sửa. */
const COLUMN_BY_FIELD: Record<string, string> = {
  serviceKind: COLUMN.kind,
  name: COLUMN.name,
  shortName: COLUMN.shortName,
  nationalCode: COLUMN.nationalCode,
  categoryCode: COLUMN.category,
  specimenTypeCode: COLUMN.specimen,
  isPerformedInHouse: COLUMN.inHouse,
  departmentId: COLUMN.department,
  turnaroundMinutes: COLUMN.turnaround,
  resultType: COLUMN.resultType,
  prices: COLUMN.price,
};

interface ServiceDraft {
  rowNumber: number;
  name: string;
  serviceKind: TechnicalServiceKind | null;
  /** Dịch vụ cùng Loại + Tên đã có trong hệ thống — bỏ qua toàn bộ (không đối chiếu thêm). */
  existing: boolean;
  errors: TechnicalServiceImportRowError[];
  /** Khoá danh mục chưa có mà dòng này tham chiếu — chỉ tạo mới nếu dòng hợp lệ. */
  newKeys: Set<string>;
  price: number | null;
  parsed?: CreateTechnicalServiceRequest;
}

interface Analysis {
  drafts: ServiceDraft[];
  newItems: ReadonlyMap<string, NewCatalogItem<TechnicalServiceImportCategory>>;
  exampleRowCount: number;
}

function isExampleName(name: string): boolean {
  return name.toLowerCase().startsWith(TECHNICAL_SERVICE_IMPORT_EXAMPLE_PREFIX.toLowerCase());
}

function serviceKey(kind: TechnicalServiceKind, name: string): string {
  return `${kind}|${normalizeImportName(name)}`;
}

/**
 * Nhập/Xuất Excel "Dịch vụ kỹ thuật" (docs/DECISIONS.md #276) — khuôn `DrugImportService` (#210): `preview` chỉ đọc + đối chiếu, `commit` đọc lại ĐÚNG file rồi ghi
 * trong MỘT transaction (hoặc nhập đủ hoặc không nhập gì). Mọi lỗi dòng nêu rõ sheet + số dòng + TÊN CỘT + cách sửa để người dùng sửa file rồi tải lại. Quy tắc dữ
 * liệu KHÔNG viết lại: dùng thẳng `createTechnicalServiceRequestSchema` và `TechnicalServiceService.createInTx` (cùng form "Thêm dịch vụ"). Danh mục dùng chung
 * (Nhóm dịch vụ/Loại mẫu/Đơn vị tính) tra theo TÊN, chưa có thì tự tạo (cần `reference_catalog.manage`); Khoa/Phòng chỉ chọn tên đã có.
 */
@Injectable()
export class TechnicalServiceImportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly technicalServiceService: TechnicalServiceService,
    private readonly technicalServiceRepository: TechnicalServiceRepository,
    private readonly referenceCatalogService: ReferenceCatalogService,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
  ) {}

  async buildTemplate(tenantId: string): Promise<Buffer> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.referenceCatalogService.listAllForImport(tx, tenantId, [...TECHNICAL_SERVICE_IMPORT_CATEGORIES]);
      const names = { TECH_SERVICE_CATEGORY: [], SPECIMEN_TYPE: [], UNIT: [], DEPARTMENT: [] } as Record<TechnicalServiceImportCategory | 'DEPARTMENT', string[]>;
      for (const r of rows) {
        if (r.isActive) names[r.category as TechnicalServiceImportCategory].push(r.name);
      }
      names.DEPARTMENT = (await this.technicalServiceRepository.listActiveDepartmentOptions(tx, tenantId)).map((d) => d.name);
      return buildServiceImportTemplate(names);
    });
  }

  async buildExport(tenantId: string, actorId: string, meta: RequestMeta): Promise<Buffer> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const services = await this.technicalServiceService.listAllInTx(tx, tenantId);
      const catalogRows = await this.referenceCatalogService.listAllForImport(tx, tenantId, [...TECHNICAL_SERVICE_IMPORT_CATEGORIES]);
      const nameByCode = new Map(catalogRows.map((r) => [`${r.category}|${r.code}`, r.name]));
      const nameOf = (category: TechnicalServiceImportCategory, code: string | null): string => (code ? (nameByCode.get(`${category}|${code}`) ?? code) : '');
      const defaultPriceType = (await this.referenceCatalogRepository.listByCategory(tx, tenantId, 'PRICE_TYPE', false)).find((r) => r.isDefault)?.code;

      const records: ImportRecord[] = services.map((s) => {
        // Giá đang hiệu lực hôm nay; nhiều Loại giá thì ưu tiên Loại giá mặc định (đúng mức máy chủ dùng để tính tiền, #268).
        const price = s.currentPrices.find((p) => p.priceTypeCode === defaultPriceType) ?? s.currentPrices[0];
        return {
          kind: IMPORT_SERVICE_KIND_LABELS[s.serviceKind],
          name: s.name,
          shortName: s.shortName ?? '',
          nationalCode: s.nationalCode ?? '',
          category: nameOf('TECH_SERVICE_CATEGORY', s.categoryCode),
          specimen: nameOf('SPECIMEN_TYPE', s.specimenTypeCode),
          inHouse: s.isPerformedInHouse ? IMPORT_YES_LABEL : IMPORT_NO_LABEL,
          department: s.departmentName ?? '',
          turnaround: s.turnaroundMinutes ?? '',
          resultType: IMPORT_RESULT_TYPE_LABELS[s.resultType],
          unit: price ? nameOf('UNIT', price.unitCode) : '',
          price: price ? price.amount : '',
          '__Trạng thái': s.isActive ? 'Đang dùng' : 'Đã ẩn',
        };
      });

      const buffer = await buildServiceExportWorkbook(records);
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'technical_service.exported',
        entityType: 'technical_service',
        entityId: tenantId,
        afterJson: { count: services.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return buffer;
    });
  }

  async preview(tenantId: string, actorId: string, fileBuffer: Buffer): Promise<TechnicalServiceImportPreviewResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => this.toPreview(await this.analyze(tx, tenantId, actorId, fileBuffer)));
  }

  async commit(tenantId: string, actorId: string, fileBuffer: Buffer, meta: RequestMeta): Promise<TechnicalServiceImportCommitResponse> {
    return this.unitOfWork.runInTenantScope(
      tenantId,
      async (tx) => {
        const analysis = await this.analyze(tx, tenantId, actorId, fileBuffer);
        const preview = this.toPreview(analysis);
        const valid = analysis.drafts.filter((d) => d.parsed);

        // Tạo trước các mục danh mục chưa có (mã tự sinh) rồi thay mã tạm trong từng dịch vụ.
        const newCodes = await createNewCatalogItems(this.referenceCatalogService, tx, tenantId, actorId, preview.newCatalogItems as NewCatalogItem<TechnicalServiceImportCategory>[], meta);
        const fix = (code: string): string => replaceTemporaryCode(code, newCodes);

        for (const draft of valid) {
          const dto = draft.parsed!;
          await this.technicalServiceService.createInTx(
            tx,
            tenantId,
            actorId,
            {
              ...dto,
              categoryCode: dto.categoryCode === undefined ? undefined : fix(dto.categoryCode),
              specimenTypeCode: dto.specimenTypeCode === undefined ? undefined : fix(dto.specimenTypeCode),
              prices: dto.prices?.map((p) => ({ ...p, unitCode: fix(p.unitCode) })),
            },
            meta,
          );
        }

        const result: TechnicalServiceImportCommitResponse = {
          createdCount: valid.length,
          duplicateCount: preview.duplicateRows.length,
          errorCount: preview.errorRows.length,
          newCatalogItemCount: preview.newCatalogItems.length,
        };
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'technical_service.imported',
          entityType: 'technical_service',
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

  private toPreview(analysis: Analysis): TechnicalServiceImportPreviewResponse {
    const toRow = (d: ServiceDraft): TechnicalServiceImportRow => ({ rowNumber: d.rowNumber, name: d.name, serviceKind: d.serviceKind ?? 'LAB', price: d.price });
    const valid = analysis.drafts.filter((d) => d.parsed);
    const duplicates = analysis.drafts.filter((d) => d.existing);

    // Chỉ tạo mới danh mục mà dịch vụ HỢP LỆ tham chiếu (dịch vụ lỗi không để lại rác trong danh mục dùng chung).
    const neededKeys = new Set<string>();
    for (const d of valid) for (const k of d.newKeys) neededKeys.add(k);

    return {
      validRows: valid.map(toRow),
      duplicateRows: duplicates.map(toRow),
      errorRows: analysis.drafts.flatMap((d) => d.errors).sort((a, b) => a.rowNumber - b.rowNumber),
      newCatalogItems: neededNewItems(analysis.newItems, neededKeys, TECHNICAL_SERVICE_IMPORT_CATEGORIES),
      exampleRowCount: analysis.exampleRowCount,
    };
  }

  /** Đọc + đối chiếu toàn file (CHỈ đọc DB). `preview` và `commit` dùng chung nên 2 bước luôn cho cùng kết quả. */
  private async analyze(tx: Prisma.TransactionClient, tenantId: string, actorId: string, fileBuffer: Buffer): Promise<Analysis> {
    const workbook = await loadWorkbook(fileBuffer);
    const sheet = workbook.getWorksheet(SHEET_SERVICES) ?? workbook.worksheets[0];
    const rows = readSheetRows(sheet, SHEET_SERVICES, SERVICE_COLUMNS, TECHNICAL_SERVICE_IMPORT_MAX_ROWS + 1_000);
    const realRows = rows.filter((r) => !isExampleName(cellText(r.cells.name)));
    if (realRows.length > TECHNICAL_SERVICE_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`File có ${realRows.length.toLocaleString('vi-VN')} dịch vụ — tối đa ${TECHNICAL_SERVICE_IMPORT_MAX_ROWS.toLocaleString('vi-VN')} dịch vụ mỗi lần nhập, hãy chia nhỏ file.`);
    }

    const canCreateCatalog = maxDataScope(await findScopesForUserPermission(tx, tenantId, actorId, 'reference_catalog', 'manage')) !== 'none';
    const catalogRows = await this.referenceCatalogService.listAllForImport(tx, tenantId, [...TECHNICAL_SERVICE_IMPORT_CATEGORIES]);
    const resolver = new CatalogNameResolver<TechnicalServiceImportCategory>(catalogRows, canCreateCatalog, TECHNICAL_SERVICE_IMPORT_CATEGORY_LABELS);

    const departments = new Map((await this.technicalServiceRepository.listActiveDepartmentOptions(tx, tenantId)).map((d) => [normalizeImportName(d.name), d.id]));
    const priceTypes = await this.referenceCatalogRepository.listByCategory(tx, tenantId, 'PRICE_TYPE', false);
    const priceTypeCode = (priceTypes.find((p) => p.isDefault) ?? priceTypes[0])?.code;
    const today = getVietnamDateString();

    const existingKeys = new Set(
      (await this.technicalServiceRepository.list(tx, tenantId, { includeInactive: true })).map((s) => serviceKey(s.serviceKind, s.name)),
    );

    const drafts: ServiceDraft[] = [];
    const firstRowByKey = new Map<string, number>();
    const exampleRowCount = rows.length - realRows.length;

    for (const r of realRows) {
      const c = r.cells;
      const draft: ServiceDraft = { rowNumber: r.rowNumber, name: collapseSpaces(cellText(c.name)), serviceKind: null, existing: false, errors: [], newKeys: new Set(), price: null };
      drafts.push(draft);
      const fail = (column: string, message: string): void => {
        draft.errors.push({ sheet: SHEET_SERVICES, rowNumber: r.rowNumber, name: draft.name || '(trống)', reason: `Cột "${column}": ${message}` });
      };

      // ---- Loại + Tên: khoá nhận diện dịch vụ ----
      const kind = parseImportServiceKind(c.kind);
      if (!kind.ok) fail(COLUMN.kind, 'phải là Xét nghiệm, Chẩn đoán hình ảnh hoặc Thăm dò chức năng.');
      else if (kind.value === null) fail(COLUMN.kind, 'bắt buộc — chọn Xét nghiệm, Chẩn đoán hình ảnh hoặc Thăm dò chức năng.');
      else draft.serviceKind = kind.value;

      if (draft.name === '') fail(COLUMN.name, 'bắt buộc, không được để trống.');
      else if (draft.name.length > MAX_NAME_LENGTH) fail(COLUMN.name, `tối đa ${MAX_NAME_LENGTH} ký tự (hiện ${draft.name.length}).`);

      if (draft.serviceKind !== null && draft.name !== '') {
        const key = serviceKey(draft.serviceKind, draft.name);
        const firstRow = firstRowByKey.get(key);
        if (firstRow !== undefined) {
          fail(COLUMN.name, `dịch vụ bị lặp trong file (cùng Loại + Tên với dòng ${firstRow}) — xoá một dòng.`);
        } else {
          firstRowByKey.set(key, r.rowNumber);
          if (existingKeys.has(key)) {
            draft.existing = true;
            draft.errors = [];
            continue;
          }
        }
      }

      // ---- Các cột còn lại ----
      const shortName = collapseSpaces(cellText(c.shortName));
      if (shortName.length > MAX_SHORT_NAME_LENGTH) fail(COLUMN.shortName, `tối đa ${MAX_SHORT_NAME_LENGTH} ký tự (hiện ${shortName.length}).`);
      const nationalCode = cellText(c.nationalCode);
      if (nationalCode.length > MAX_NATIONAL_CODE_LENGTH) fail(COLUMN.nationalCode, `tối đa ${MAX_NATIONAL_CODE_LENGTH} ký tự (hiện ${nationalCode.length}).`);

      const inHouseCell = parseImportYesNo(c.inHouse);
      if (!inHouseCell.ok) fail(COLUMN.inHouse, 'phải là Có hoặc Không (để trống = Có).');
      const inHouse = inHouseCell.ok ? (inHouseCell.value ?? true) : true;

      const resolveCatalog = (category: TechnicalServiceImportCategory, raw: Cell | undefined, column: string): string | undefined => {
        if (cellText(raw) === '') return undefined;
        const result = resolver.resolve(category, cellText(raw));
        if (!result.ok) {
          fail(column, result.reason);
          return undefined;
        }
        if (result.newKey !== null) draft.newKeys.add(result.newKey);
        return result.code;
      };

      const categoryCode = resolveCatalog('TECH_SERVICE_CATEGORY', c.category, COLUMN.category);

      let specimenTypeCode: string | undefined;
      if (cellText(c.specimen) !== '') {
        if (draft.serviceKind !== null && draft.serviceKind !== 'LAB') fail(COLUMN.specimen, 'chỉ dùng cho Xét nghiệm — để trống với Chẩn đoán hình ảnh/Thăm dò chức năng.');
        else specimenTypeCode = resolveCatalog('SPECIMEN_TYPE', c.specimen, COLUMN.specimen);
      }

      let departmentId: string | undefined;
      if (cellText(c.department) !== '') {
        departmentId = departments.get(normalizeImportName(cellText(c.department)));
        if (departmentId === undefined) fail(COLUMN.department, `không có khoa/phòng "${collapseSpaces(cellText(c.department))}" — gõ đúng tên khoa/phòng đã có (xem sheet "Danh mục hiện có") hoặc để trống; khoa/phòng không tự tạo từ file.`);
      }

      const turnaround = parseImportInteger(c.turnaround);
      if (!turnaround.ok || (turnaround.value !== null && (turnaround.value < 1 || turnaround.value > MAX_TURNAROUND_MINUTES))) {
        fail(COLUMN.turnaround, `phải là số nguyên dương tính bằng phút, tối đa ${MAX_TURNAROUND_MINUTES.toLocaleString('vi-VN')}.`);
      }

      const resultType = parseImportResultType(c.resultType);
      if (!resultType.ok) fail(COLUMN.resultType, 'phải là Theo chỉ số, Mô tả + kết luận hoặc Cả hai (để trống = theo loại dịch vụ).');

      // ---- Giá: chỉ dịch vụ làm tại phòng khám ----
      const price = parseImportInteger(c.price);
      const hasPriceInput = cellText(c.price) !== '' || cellText(c.unit) !== '';
      let unitCode: string | undefined;
      if (inHouseCell.ok && inHouse) {
        if (!price.ok) fail(COLUMN.price, 'phải là số nguyên không âm, đơn vị đồng (ví dụ 80000).');
        else if (price.value === null) fail(COLUMN.price, 'bắt buộc khi làm tại phòng khám — nhập giá (đồng), hoặc đổi "Làm tại phòng khám" thành Không.');
        if (cellText(c.unit) === '') fail(COLUMN.unit, 'bắt buộc khi làm tại phòng khám — nhập đơn vị tính của giá (ví dụ Lần).');
        else unitCode = resolveCatalog('UNIT', c.unit, COLUMN.unit);
        if (priceTypeCode === undefined) fail(COLUMN.price, 'phòng khám chưa có Loại giá dịch vụ nào — thêm ở Danh mục dùng chung (Loại giá) trước khi nhập giá.');
      } else if (inHouseCell.ok && hasPriceInput) {
        fail(COLUMN.price, 'dịch vụ chỉ định ra ngoài (Làm tại phòng khám = Không) không có giá — để trống cột "Giá bán" và "Đơn vị tính".');
      }

      if (draft.errors.length > 0 || draft.serviceKind === null) continue;
      const amount = price.ok ? price.value : null;
      draft.price = inHouse ? amount : null;

      // ---- Schema chung (cùng form "Thêm dịch vụ") ----
      const parsed = createTechnicalServiceRequestSchema.safeParse({
        name: draft.name,
        serviceKind: draft.serviceKind,
        ...(shortName !== '' ? { shortName } : {}),
        ...(nationalCode !== '' ? { nationalCode } : {}),
        ...(categoryCode !== undefined ? { categoryCode } : {}),
        ...(specimenTypeCode !== undefined ? { specimenTypeCode } : {}),
        isPerformedInHouse: inHouse,
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(turnaround.ok && turnaround.value !== null ? { turnaroundMinutes: turnaround.value } : {}),
        ...(resultType.ok && resultType.value !== null ? { resultType: resultType.value } : {}),
        ...(inHouse && amount !== null && unitCode !== undefined && priceTypeCode !== undefined
          ? { prices: [{ priceTypeCode, unitCode, amount, effectiveFrom: today }] }
          : {}),
      });
      if (!parsed.success) {
        const reported = new Set<string>();
        for (const issue of parsed.error.issues) {
          const column = COLUMN_BY_FIELD[String(issue.path[0])] ?? 'không xác định';
          if (reported.has(column)) continue;
          reported.add(column);
          fail(column, 'giá trị không hợp lệ — kiểm tra lại theo hướng dẫn ở sheet "Hướng dẫn".');
        }
        continue;
      }
      draft.parsed = parsed.data;
    }

    return { drafts, newItems: resolver.newItems, exampleRowCount };
  }
}
