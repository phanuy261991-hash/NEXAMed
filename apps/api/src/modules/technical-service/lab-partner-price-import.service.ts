import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CLINIC_CONFIG_READER_PORT, LabPartnerDisabledError, normalizeImportName, parseImportInteger, parseImportServiceKind, IMPORT_SERVICE_KIND_LABELS, type ClinicConfigReaderPort } from '@nexamed/core';
import {
  LAB_PARTNER_PRICE_IMPORT_MAX_ROWS,
  TECHNICAL_SERVICE_IMPORT_EXAMPLE_PREFIX,
  type LabPartnerPriceImportChange,
  type LabPartnerPriceImportCommitResponse,
  type LabPartnerPriceImportError,
  type LabPartnerPriceImportPreviewResponse,
  type TechnicalServiceKind,
} from '@nexamed/shared';
import ExcelJS from 'exceljs';
import type { RequestMeta } from '../../common/request-meta';
import { cellText, collapseSpaces, headerLabelOf, loadWorkbook, readCell, type Cell, type ImportColumnBase, type ImportRecord } from '../../common/excel-import/excel-import';
import { addCatalogSheet, addDataSheet, IMPORT_HEADER_FILL, workbookToBuffer } from '../../common/excel-import/excel-import-workbook';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { TechnicalServiceRepository } from './technical-service.repository';

const SHEET_PRICES = 'Giá trả đối tác';
const SHEET_GUIDE = 'Hướng dẫn';
const SHEET_CATALOG = 'Danh mục hiện có';
const FIXED_COLUMNS = [
  { key: 'kind', label: 'Loại', required: true, width: 20 },
  { key: 'name', label: 'Tên dịch vụ', required: true, width: 40 },
  { key: 'defaultPartner', label: 'Đối tác mặc định', required: false, width: 32 },
] as const;
const PARTNER_HEADER = /^Giá trả\s*\[([^\]]+)\]/i;

interface Partner {
  id: string;
  code: string;
  name: string;
}

interface Draft {
  rowNumber: number;
  name: string;
  errors: LabPartnerPriceImportError[];
  changes: LabPartnerPriceImportChange[];
  blankCells: number;
  /** Giá cần ghi (chỉ ô có nhập, đã kiểm hợp lệ). */
  newAmounts: Map<string, number>;
  defaultSupplierId: string | null;
  defaultChanged: boolean;
  serviceId: string | null;
}

interface Analysis {
  drafts: Draft[];
  currentByService: Map<string, { supplierId: string; amount: number; isDefault: boolean }[]>;
  ignoredColumns: string[];
  exampleRowCount: number;
  serviceRowCount: number;
}

const isExampleName = (name: string): boolean => name.toLowerCase().startsWith(TECHNICAL_SERVICE_IMPORT_EXAMPLE_PREFIX.toLowerCase());
const serviceKey = (kind: TechnicalServiceKind, name: string): string => `${kind}|${normalizeImportName(name)}`;
/** Tên đối tác ghi vào tiêu đề cột: bỏ `*` và `(` vì bộ đọc cắt tiêu đề từ ký tự đó trở đi. */
const headerSafe = (name: string): string => collapseSpaces(name.replace(/[*()]/g, ' '));

/**
 * Nhập/Xuất Excel "Giá trả đối tác" (docs/DECISIONS.md #291 GĐ4, mockup đã chốt 10/11/2026): file RIÊNG, mỗi dòng một dịch vụ đã bật "Gửi đối tác", mỗi đối tác ĐANG DÙNG một cột `Giá trả [mã] tên`,
 * cột "Đối tác mặc định" (tên). Ô giá để trống = giữ nguyên; chỉ ĐỔI giá của dịch vụ đã có (không tạo dịch vụ, không tự bật "Gửi đối tác", không xoá giá). `preview` chỉ đọc + đối chiếu, `commit` đọc lại ĐÚNG file rồi ghi
 * trong MỘT transaction (có lỗi thì không ghi gì). Quy tắc ghi dùng chính `replacePartnerPrices` của form dịch vụ. Dữ liệu CHUNG cả công ty; cần quyền sửa dịch vụ kỹ thuật; công tắc "Dùng đối tác xét nghiệm" tắt → 409.
 */
@Injectable()
export class LabPartnerPriceImportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: TechnicalServiceRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfig: ClinicConfigReaderPort,
  ) {}

  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.clinicConfig.getLabPartnerEnabled(tenantId))) throw new LabPartnerDisabledError();
  }

  /** Cột của file: 3 cột cố định + mỗi đối tác đang dùng một cột giá. */
  private columnsFor(partners: readonly Partner[]): (ImportColumnBase & { required: boolean })[] {
    return [
      ...FIXED_COLUMNS.map((c) => ({ key: c.key, label: c.label, width: c.width, guide: '', required: c.required })),
      ...partners.map((p) => ({ key: `p:${p.id}`, label: `Giá trả [${p.code}] ${headerSafe(p.name)}`, width: 30, guide: '', required: false })),
    ];
  }

  private async loadContext(tx: Prisma.TransactionClient, tenantId: string) {
    const partners = await this.repository.listActivePartners(tx, tenantId);
    const services = (await this.repository.list(tx, tenantId, { includeInactive: false })).filter((s) => s.sentToPartner);
    const prices = await this.repository.listPartnerPrices(
      tx,
      tenantId,
      services.map((s) => s.id),
    );
    return { partners, services, prices };
  }

  private async buildWorkbook(tenantId: string, withExample: boolean): Promise<Buffer> {
    await this.assertEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const { partners, services, prices } = await this.loadContext(tx, tenantId);
      const columns = this.columnsFor(partners);
      const partnerName = new Map(partners.map((p) => [p.id, p.name]));
      const records: ImportRecord[] = services.map((s) => {
        const own = prices.filter((p) => p.technicalServiceId === s.id);
        const record: ImportRecord = { kind: IMPORT_SERVICE_KIND_LABELS[s.serviceKind], name: s.name, defaultPartner: partnerName.get(own.find((p) => p.isDefault)?.supplierId ?? '') ?? '' };
        for (const p of partners) {
          const price = own.find((o) => o.supplierId === p.id);
          record[`p:${p.id}`] = price ? Number(price.amount) : '';
        }
        return record;
      });

      const workbook = new ExcelJS.Workbook();
      const sheet = addDataSheet(workbook, SHEET_PRICES, columns, records, { example: false, headerText: (c) => (c.required ? `${c.label} *` : c.label) });
      if (withExample) {
        const first = partners[0];
        const example = sheet.insertRow(2, [IMPORT_SERVICE_KIND_LABELS.LAB, `${TECHNICAL_SERVICE_IMPORT_EXAMPLE_PREFIX}Công thức máu`, first?.name ?? '', ...partners.map((p, i) => (i === 0 ? 45000 : ''))]);
        example.font = { italic: true, color: { argb: 'FF94A3B8' } };
      }
      this.addGuideSheet(workbook, partners);
      addCatalogSheet(workbook, SHEET_CATALOG, ['partner', 'service'] as const, { partner: 'Đối tác đang dùng (mã · tên)', service: 'Dịch vụ gửi đối tác (Loại · Tên)' }, {
        partner: partners.map((p) => `${p.code} · ${p.name}`),
        service: services.map((s) => `${IMPORT_SERVICE_KIND_LABELS[s.serviceKind]} · ${s.name}`),
      });
      return workbookToBuffer(workbook);
    });
  }

  private addGuideSheet(workbook: ExcelJS.Workbook, partners: readonly Partner[]): void {
    const sheet = workbook.addWorksheet(SHEET_GUIDE);
    sheet.columns = [{ width: 110 }];
    const lines = [
      'HƯỚNG DẪN NHẬP GIÁ TRẢ ĐỐI TÁC TỪ EXCEL',
      '',
      `1) Sheet "${SHEET_PRICES}": mỗi dòng là một dịch vụ xét nghiệm đã bật "Gửi đối tác"; mỗi đối tác đang dùng một cột "Giá trả [mã] tên". Điền giá trả (số nguyên, đơn vị đồng, ví dụ 135000).`,
      '2) Ô giá để trống = giữ nguyên giá hiện có. File này không xoá giá; muốn xoá giá của một cặp dịch vụ × đối tác thì xoá ở form dịch vụ.',
      '3) Cột "Đối tác mặc định": gõ ĐÚNG tên đối tác (xem sheet "Danh mục hiện có"); để trống = giữ đối tác mặc định hiện tại. Đối tác mặc định phải đã có giá cho dịch vụ đó.',
      '4) Dịch vụ tìm theo Loại + Tên (không phân biệt hoa/thường/dấu). Dịch vụ không có trong hệ thống hoặc chưa bật "Gửi đối tác" là dòng lỗi — bật ở form dịch vụ rồi nhập lại. File không tạo dịch vụ mới.',
      '5) Dòng ví dụ (Tên bắt đầu bằng VD-, chữ nghiêng xám) được bỏ qua. Cột của đối tác không còn dùng bị bỏ qua. Không đổi tên sheet, không đổi thứ tự 3 cột đầu.',
      `6) Lưu file .xlsx rồi vào Danh mục Cận lâm sàng › Đối tác xét nghiệm › "Giá trả (Excel)" › "Nhập giá trả từ Excel". Hệ thống HIỆN KẾT QUẢ XEM TRƯỚC, chưa ghi gì tới khi bạn bấm "Ghi giá". Có lỗi thì không ghi gì cả. Giá mới không đổi giá đã chụp cho mẫu đã gửi.`,
      `Tối đa ${LAB_PARTNER_PRICE_IMPORT_MAX_ROWS.toLocaleString('vi-VN')} dịch vụ mỗi lần nhập, file không quá 5 MB.`,
    ];
    lines.forEach((text, i) => {
      const row = sheet.addRow([text]);
      row.alignment = { wrapText: true, vertical: 'top' };
      if (i === 0) row.font = { bold: true, size: 14 };
    });
    if (partners.length === 0) sheet.addRow(['Chưa có đối tác xét nghiệm nào đang dùng — thêm đối tác trước.']);
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = IMPORT_HEADER_FILL;
    });
  }

  buildTemplate(tenantId: string): Promise<Buffer> {
    return this.buildWorkbook(tenantId, true);
  }

  async buildExport(tenantId: string, actorId: string, meta: RequestMeta): Promise<Buffer> {
    const buffer = await this.buildWorkbook(tenantId, false);
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, { actorId, action: 'technical_service.partner_prices_exported', entityType: 'technical_service', entityId: tenantId, afterJson: {}, ip: meta.ip, userAgent: meta.userAgent }),
    );
    return buffer;
  }

  async preview(tenantId: string, fileBuffer: Buffer): Promise<LabPartnerPriceImportPreviewResponse> {
    await this.assertEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => this.toPreview(await this.analyze(tx, tenantId, fileBuffer)));
  }

  async commit(tenantId: string, actorId: string, fileBuffer: Buffer, meta: RequestMeta): Promise<LabPartnerPriceImportCommitResponse> {
    await this.assertEnabled(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const analysis = await this.analyze(tx, tenantId, fileBuffer);
      const errorCount = analysis.drafts.reduce((n, d) => n + d.errors.length, 0);
      if (errorCount > 0) throw new UnprocessableEntityException(`File còn ${errorCount} lỗi — sửa file rồi xem trước lại, chưa ghi giá nào.`);

      let updatedPrices = 0;
      let updatedServices = 0;
      let defaultChanges = 0;
      for (const draft of analysis.drafts) {
        const real = draft.changes.filter((c) => c.result !== 'SAME').length;
        if (real === 0 && !draft.defaultChanged) continue;
        const current = analysis.currentByService.get(draft.serviceId!) ?? [];
        const amounts = new Map(current.map((c) => [c.supplierId, c.amount]));
        for (const [supplierId, amount] of draft.newAmounts) amounts.set(supplierId, amount);
        const currentDefault = current.find((c) => c.isDefault)?.supplierId ?? null;
        const defaultSupplierId = draft.defaultSupplierId ?? currentDefault ?? [...amounts.keys()][0]!;
        const items = [...amounts].map(([supplierId, amount]) => ({ supplierId, amount: BigInt(amount), isDefault: supplierId === defaultSupplierId }));
        await this.repository.replacePartnerPrices(tx, tenantId, draft.serviceId!, actorId, items);
        updatedPrices += real;
        updatedServices += 1;
        if (draft.defaultChanged) defaultChanges += 1;
      }

      const result: LabPartnerPriceImportCommitResponse = { updatedPriceCount: updatedPrices, updatedServiceCount: updatedServices, defaultChangeCount: defaultChanges };
      await writeAuditLog(tx, tenantId, { actorId, action: 'technical_service.partner_prices_imported', entityType: 'technical_service', entityId: tenantId, afterJson: { ...result }, ip: meta.ip, userAgent: meta.userAgent });
      return result;
    });
  }

  private toPreview(analysis: Analysis): LabPartnerPriceImportPreviewResponse {
    const errorRows = analysis.drafts.flatMap((d) => d.errors).sort((a, b) => a.rowNumber - b.rowNumber);
    const valid = errorRows.length === 0;
    return {
      changes: valid ? analysis.drafts.flatMap((d) => d.changes) : [],
      defaultChangeCount: valid ? analysis.drafts.filter((d) => d.defaultChanged).length : 0,
      blankCellCount: analysis.drafts.reduce((n, d) => n + d.blankCells, 0),
      serviceRowCount: analysis.serviceRowCount,
      errorRows,
      ignoredColumns: analysis.ignoredColumns,
      exampleRowCount: analysis.exampleRowCount,
    };
  }

  /** Đọc + đối chiếu toàn file (CHỈ đọc DB). `preview` và `commit` dùng chung nên 2 bước luôn cho cùng kết quả. */
  private async analyze(tx: Prisma.TransactionClient, tenantId: string, fileBuffer: Buffer): Promise<Analysis> {
    const workbook = await loadWorkbook(fileBuffer);
    const sheet = workbook.getWorksheet(SHEET_PRICES) ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('File không có sheet nào — hãy dùng file mẫu.');

    FIXED_COLUMNS.forEach((c, i) => {
      const got = headerLabelOf(String(sheet.getCell(1, i + 1).text ?? ''));
      if (normalizeImportName(got) !== normalizeImportName(c.label)) throw new BadRequestException(`Sheet "${SHEET_PRICES}": cột ${i + 1} phải là "${c.label}" — file không đúng mẫu, hãy tải lại file mẫu.`);
    });

    const partners = await this.repository.listActivePartners(tx, tenantId);
    const partnerByCode = new Map(partners.map((p) => [p.code.toUpperCase(), p]));
    const partnerByName = new Map(partners.map((p) => [normalizeImportName(p.name), p]));
    const partnerColumns: { index: number; partner: Partner }[] = [];
    const ignoredColumns: string[] = [];
    const seenCodes = new Set<string>();
    for (let col = FIXED_COLUMNS.length + 1; col <= sheet.columnCount; col++) {
      const text = collapseSpaces(String(sheet.getCell(1, col).text ?? ''));
      if (text === '') continue;
      const match = PARTNER_HEADER.exec(text);
      if (!match) {
        ignoredColumns.push(text);
        continue;
      }
      const code = match[1]!.trim().toUpperCase();
      if (seenCodes.has(code)) throw new BadRequestException(`Sheet "${SHEET_PRICES}": cột đối tác [${match[1]}] bị lặp — mỗi đối tác chỉ một cột giá.`);
      seenCodes.add(code);
      const partner = partnerByCode.get(code);
      if (!partner) ignoredColumns.push(text);
      else partnerColumns.push({ index: col, partner });
    }

    const rows: { rowNumber: number; cells: Record<string, Cell> }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells: Record<string, Cell> = {
        kind: readCell(row.getCell(1)),
        name: readCell(row.getCell(2)),
        defaultPartner: readCell(row.getCell(3)),
      };
      for (const pc of partnerColumns) cells[`p:${pc.partner.id}`] = readCell(row.getCell(pc.index));
      if (Object.values(cells).some((v) => v !== null)) rows.push({ rowNumber, cells });
    });
    const realRows = rows.filter((r) => !isExampleName(cellText(r.cells.name)));
    if (realRows.length > LAB_PARTNER_PRICE_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`File có ${realRows.length.toLocaleString('vi-VN')} dịch vụ — tối đa ${LAB_PARTNER_PRICE_IMPORT_MAX_ROWS.toLocaleString('vi-VN')} dịch vụ mỗi lần nhập, hãy chia nhỏ file.`);
    }

    const allServices = await this.repository.list(tx, tenantId, { includeInactive: true });
    const serviceByKey = new Map(allServices.map((s) => [serviceKey(s.serviceKind, s.name), s]));
    const currentRows = await this.repository.listPartnerPrices(
      tx,
      tenantId,
      allServices.filter((s) => s.sentToPartner).map((s) => s.id),
    );
    const currentByService = new Map<string, { supplierId: string; amount: number; isDefault: boolean }[]>();
    for (const p of currentRows) {
      const list = currentByService.get(p.technicalServiceId) ?? [];
      list.push({ supplierId: p.supplierId, amount: Number(p.amount), isDefault: p.isDefault });
      currentByService.set(p.technicalServiceId, list);
    }

    const drafts: Draft[] = [];
    const firstRowByKey = new Map<string, number>();
    for (const r of realRows) {
      const c = r.cells;
      const draft: Draft = { rowNumber: r.rowNumber, name: collapseSpaces(cellText(c.name)), errors: [], changes: [], blankCells: 0, newAmounts: new Map(), defaultSupplierId: null, defaultChanged: false, serviceId: null };
      drafts.push(draft);
      const fail = (column: string, message: string): void => {
        draft.errors.push({ sheet: SHEET_PRICES, rowNumber: r.rowNumber, name: draft.name || '(trống)', reason: `Cột "${column}": ${message}` });
      };

      const kind = parseImportServiceKind(c.kind);
      if (!kind.ok) fail('Loại', 'phải là Xét nghiệm, Chẩn đoán hình ảnh hoặc Thăm dò chức năng.');
      else if (kind.value === null) fail('Loại', 'bắt buộc — chọn Xét nghiệm.');
      if (draft.name === '') fail('Tên dịch vụ', 'bắt buộc, không được để trống.');
      if (!kind.ok || kind.value === null || draft.name === '') continue;

      const key = serviceKey(kind.value, draft.name);
      const firstRow = firstRowByKey.get(key);
      if (firstRow !== undefined) {
        fail('Tên dịch vụ', `dịch vụ bị lặp trong file (cùng Loại + Tên với dòng ${firstRow}) — xoá một dòng.`);
        continue;
      }
      firstRowByKey.set(key, r.rowNumber);

      const service = serviceByKey.get(key);
      if (!service) {
        fail('Tên dịch vụ', `không có dịch vụ "${draft.name}" thuộc loại ${IMPORT_SERVICE_KIND_LABELS[kind.value]}. Kiểm tra tên ở sheet "${SHEET_CATALOG}".`);
        continue;
      }
      if (!service.sentToPartner) {
        fail('Tên dịch vụ', `dịch vụ "${service.name}" chưa đặt "Gửi đối tác". Bật ở form dịch vụ rồi nhập lại.`);
        continue;
      }
      draft.serviceId = service.id;
      const current = currentByService.get(service.id) ?? [];

      for (const pc of partnerColumns) {
        const raw = c[`p:${pc.partner.id}`];
        const column = `Giá trả [${pc.partner.code}]`;
        if (cellText(raw) === '') {
          draft.blankCells += 1;
          continue;
        }
        const amount = parseImportInteger(raw);
        if (!amount.ok || amount.value === null || amount.value < 0 || amount.value > 2_000_000_000) {
          fail(column, `"${cellText(raw)}" không phải số hợp lệ. Nhập số nguyên không âm, đơn vị đồng, ví dụ 135000.`);
          continue;
        }
        const existing = current.find((x) => x.supplierId === pc.partner.id);
        draft.newAmounts.set(pc.partner.id, amount.value);
        draft.changes.push({
          rowNumber: r.rowNumber,
          serviceName: service.name,
          partnerCode: pc.partner.code,
          partnerName: pc.partner.name,
          currentAmount: existing ? existing.amount : null,
          newAmount: amount.value,
          result: !existing ? 'ADD' : existing.amount === amount.value ? 'SAME' : 'CHANGE',
        });
      }

      if (cellText(c.defaultPartner) !== '') {
        const target = partnerByName.get(normalizeImportName(cellText(c.defaultPartner)));
        if (!target) {
          fail('Đối tác mặc định', `không có đối tác "${collapseSpaces(cellText(c.defaultPartner))}" đang dùng — gõ đúng tên (xem sheet "${SHEET_CATALOG}") hoặc để trống.`);
        } else if (!draft.newAmounts.has(target.id) && !current.some((x) => x.supplierId === target.id)) {
          fail('Đối tác mặc định', `đối tác "${target.name}" chưa có giá cho dịch vụ này — nhập giá ở cột của đối tác đó hoặc đổi đối tác mặc định.`);
        } else {
          draft.defaultSupplierId = target.id;
          draft.defaultChanged = (current.find((x) => x.isDefault)?.supplierId ?? null) !== target.id;
        }
      }
    }

    return { drafts, currentByService, ignoredColumns, exampleRowCount: rows.length - realRows.length, serviceRowCount: realRows.length };
  }
}
