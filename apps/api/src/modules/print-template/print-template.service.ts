import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrintTemplate as PrintTemplateRow } from '@prisma/client';
import {
  ConcurrentModificationError,
  PrintTemplateDefaultCannotDeleteError,
  PrintTemplateDuplicatePaperError,
  PrintTemplatePaperNotAllowedError,
} from '@nexamed/core';
import {
  buildBuiltinPrintTemplate,
  buildPrintTemplateCatalog,
  buildResolvedPrintTemplate,
  buildDefaultPrintTemplateConfig,
  withDefaultPrintNotice,
  defaultPrintTemplateName,
  paperForQuickSetupPreset,
  printDocumentTypeSchema,
  PRINT_DOCUMENT_TYPE_REGISTRY,
  printTemplateConfigSchema,
  type CreatePrintTemplateRequest,
  type DeletePrintTemplateRequest,
  type ListPrintTemplatesResponse,
  type ListResolvedPrintTemplatesResponse,
  type PrintDocumentType,
  type PrintPaperSize,
  type PrintQuickSetupRequest,
  type PrintQuickSetupResponse,
  type PrintTemplate,
  type PrintTemplateConfig,
  type ResolvedPrintTemplate,
  type UpdatePrintTemplateRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { PrintTemplateRepository } from './print-template.repository';

const ALL_DOCUMENT_TYPES = printDocumentTypeSchema.options;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Enum Postgres vẫn còn giá trị cũ `PARACLINICAL_RESULT` (không gỡ được) nhưng migration `20261008120100` đã chuyển hết dòng sang `LAB_RESULT`/`IMAGING_RESULT`,
 * nên ở đây coi như không bao giờ gặp — ép về kiểu chứng từ hiện hành của `@nexamed/shared`.
 */
function documentTypeOf(row: PrintTemplateRow): PrintDocumentType {
  return row.documentType as PrintDocumentType;
}

/**
 * "Quản lý mẫu in" (docs/DECISIONS.md #211). Mỗi chứng từ có nhiều bản mẫu theo khổ giấy (duy nhất theo khổ),
 * đúng 1 bản mặc định. Chưa lưu gì → dùng bản dựng sẵn trong `packages/shared` (không seed), nên bản dựng sẵn
 * chỉ "thành dòng thật" khi người dùng lưu lần đầu — và khi thêm bản đầu tiên KHÁC khổ dựng sẵn, bản dựng sẵn
 * được lưu cùng lúc (làm bản mặc định) để không biến mất khỏi danh sách.
 */
@Injectable()
export class PrintTemplateService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: PrintTemplateRepository,
  ) {}

  async list(tenantId: string): Promise<ListPrintTemplatesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.list(tx, tenantId);
      const items: PrintTemplate[] = [];
      for (const documentType of ALL_DOCUMENT_TYPES) {
        const ofType = rows.filter((r) => r.documentType === documentType);
        if (ofType.length === 0) items.push(buildBuiltinPrintTemplate(documentType));
        else items.push(...ofType.map((r) => this.toDto(r)));
      }
      return { items, catalog: buildPrintTemplateCatalog() };
    });
  }

  /**
   * Bản MẶC ĐỊNH đang áp dụng của từng chứng từ + các khổ giấy khác có thể chọn lúc in — mọi nhân viên đã đăng nhập
   * cần (in tức thì, nút chọn khổ), không lộ dữ liệu nhạy cảm.
   */
  async listResolved(tenantId: string): Promise<ListResolvedPrintTemplatesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.list(tx, tenantId);
      return {
        items: ALL_DOCUMENT_TYPES.map((documentType) => {
          const ofType = rows.filter((r) => r.documentType === documentType);
          const chosen = ofType.find((r) => r.isDefault) ?? ofType[0];
          if (!chosen) {
            const builtin = buildBuiltinPrintTemplate(documentType);
            return buildResolvedPrintTemplate(documentType, builtin.paperSize, builtin.config);
          }
          const dto = this.toDto(chosen);
          const storedByPaper: Partial<Record<PrintPaperSize, PrintTemplateConfig>> = {};
          for (const r of ofType) storedByPaper[r.paperSize] = this.parseConfig(r);
          return buildResolvedPrintTemplate(documentType, dto.paperSize, dto.config, storedByPaper);
        }),
      };
    });
  }

  async create(tenantId: string, actorId: string, dto: CreatePrintTemplateRequest, meta: RequestMeta): Promise<PrintTemplate> {
    this.assertPaperAllowed(dto.documentType, dto.paperSize);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      if (await this.repository.findByTypeAndPaper(tx, tenantId, dto.documentType, dto.paperSize)) {
        throw new PrintTemplateDuplicatePaperError();
      }
      const existingCount = await this.repository.countByType(tx, tenantId, dto.documentType);
      const builtinPaper = PRINT_DOCUMENT_TYPE_REGISTRY[dto.documentType].defaultPaper;

      // Bản dựng sẵn chưa lưu: giữ nó làm mặc định khi người dùng thêm bản KHÁC khổ đầu tiên.
      if (existingCount === 0 && dto.paperSize !== builtinPaper) {
        await this.insert(tx, tenantId, actorId, meta, {
          documentType: dto.documentType,
          paperSize: builtinPaper,
          name: defaultPrintTemplateName(dto.documentType, builtinPaper),
          isDefault: true,
          config: buildDefaultPrintTemplateConfig(builtinPaper),
        });
      }
      const isDefault = existingCount === 0 && dto.paperSize === builtinPaper ? true : (dto.isDefault ?? false);
      if (isDefault) await this.repository.clearDefaultExcept(tx, tenantId, actorId, dto.documentType, null);

      const created = await this.insert(tx, tenantId, actorId, meta, {
        documentType: dto.documentType,
        paperSize: dto.paperSize,
        name: dto.name,
        isDefault,
        config: dto.config ?? buildDefaultPrintTemplateConfig(dto.paperSize),
      });
      return this.toDto(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdatePrintTemplateRequest, meta: RequestMeta): Promise<PrintTemplate> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (dto.isDefault) await this.repository.clearDefaultExcept(tx, tenantId, actorId, existing.documentType, existing.id);

      const count = await this.repository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, {
        name: dto.name,
        isDefault: dto.isDefault,
        configJson: dto.config as Prisma.InputJsonValue | undefined,
      });
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, { actorId, action: 'print_template.updated', entityType: 'print_template', entityId: id, ip: meta.ip, userAgent: meta.userAgent });
      const updated = await this.repository.findById(tx, tenantId, id);
      if (!updated) throw new NotFoundException();
      return this.toDto(updated);
    });
  }

  async remove(tenantId: string, actorId: string, id: string, dto: DeletePrintTemplateRequest, meta: RequestMeta): Promise<{ id: string }> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (existing.isDefault && (await this.repository.countByType(tx, tenantId, existing.documentType)) > 1) {
        throw new PrintTemplateDefaultCannotDeleteError();
      }
      const count = await this.repository.softDelete(tx, tenantId, id, dto.version, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, { actorId, action: 'print_template.deleted', entityType: 'print_template', entityId: id, ip: meta.ip, userAgent: meta.userAgent });
      return { id };
    });
  }

  /**
   * "Thiết lập nhanh": khai khổ giấy + đầu trang MỘT lần, áp cho các chứng từ đã chọn. Mỗi chứng từ → bản mẫu
   * ở khổ đích (tạo nếu chưa có, ghi đè khối đầu trang nếu đã có) và đặt làm mặc định. Khổ đích không được mở
   * cho chứng từ đó (ví dụ Bệnh án chỉ A4) thì dùng khổ dựng sẵn của chứng từ.
   */
  async quickSetup(tenantId: string, actorId: string, dto: PrintQuickSetupRequest, meta: RequestMeta): Promise<PrintQuickSetupResponse> {
    const documentTypes = [...new Set(dto.documentTypes)];
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.list(tx, tenantId);
      for (const documentType of documentTypes) {
        const registry = PRINT_DOCUMENT_TYPE_REGISTRY[documentType];
        const currentDefault = rows.find((r) => r.documentType === documentType && r.isDefault);
        let target: PrintPaperSize = paperForQuickSetupPreset(dto.paperPreset, documentType) ?? currentDefault?.paperSize ?? registry.defaultPaper;
        if (!registry.allowedPapers.includes(target)) target = registry.defaultPaper;

        await this.repository.clearDefaultExcept(tx, tenantId, actorId, documentType, null);
        const existing = await this.repository.findByTypeAndPaper(tx, tenantId, documentType, target);
        if (existing) {
          // Đọc lại version SAU khi clearDefaultExcept (có thể đã tăng nếu chính bản này từng là mặc định).
          const fresh = await this.repository.findById(tx, tenantId, existing.id);
          if (!fresh) throw new NotFoundException();
          const config = { ...this.parseConfig(fresh), header: dto.header };
          const count = await this.repository.updateIfVersionMatches(tx, tenantId, fresh.id, fresh.version, actorId, {
            isDefault: true,
            configJson: config as Prisma.InputJsonValue,
          });
          if (count === 0) throw new ConcurrentModificationError();
        } else {
          await this.repository.create(tx, tenantId, actorId, {
            documentType,
            paperSize: target,
            name: defaultPrintTemplateName(documentType, target),
            isDefault: true,
            configJson: { ...buildDefaultPrintTemplateConfig(target), header: dto.header } as Prisma.InputJsonValue,
          });
        }
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'print_template.quick_setup',
        entityType: 'print_template',
        entityId: tenantId,
        afterJson: { paperPreset: dto.paperPreset, documentTypes },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { appliedCount: documentTypes.length };
    });
  }

  /** Bản mặc định đang áp dụng của MỘT chứng từ (dùng cho nơi render ở máy chủ, ví dụ Bệnh án PDF). */
  async resolveOne(tenantId: string, documentType: PrintDocumentType): Promise<ResolvedPrintTemplate> {
    const all = await this.listResolved(tenantId);
    return all.items.find((i) => i.documentType === documentType) ?? buildResolvedPrintTemplate(documentType, PRINT_DOCUMENT_TYPE_REGISTRY[documentType].defaultPaper, buildDefaultPrintTemplateConfig(PRINT_DOCUMENT_TYPE_REGISTRY[documentType].defaultPaper));
  }

  private assertPaperAllowed(documentType: PrintDocumentType, paperSize: PrintPaperSize): void {
    if (!PRINT_DOCUMENT_TYPE_REGISTRY[documentType].allowedPapers.includes(paperSize)) throw new PrintTemplatePaperNotAllowedError();
  }

  private async insert(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    meta: RequestMeta,
    data: { documentType: PrintDocumentType; paperSize: PrintPaperSize; name: string; isDefault: boolean; config: PrintTemplateConfig },
  ): Promise<PrintTemplateRow> {
    let created: PrintTemplateRow;
    try {
      created = await this.repository.create(tx, tenantId, actorId, {
        documentType: data.documentType,
        paperSize: data.paperSize,
        name: data.name,
        isDefault: data.isDefault,
        configJson: data.config as Prisma.InputJsonValue,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new PrintTemplateDuplicatePaperError();
      throw err;
    }
    await writeAuditLog(tx, tenantId, { actorId, action: 'print_template.created', entityType: 'print_template', entityId: created.id, ip: meta.ip, userAgent: meta.userAgent });
    return created;
  }

  /** Cấu hình lưu hỏng/cũ → rơi về mặc định theo khổ giấy (in không bao giờ vỡ vì dữ liệu cấu hình). */
  private parseConfig(row: PrintTemplateRow): PrintTemplateConfig {
    const parsed = printTemplateConfigSchema.safeParse(row.configJson);
    return withDefaultPrintNotice(documentTypeOf(row), parsed.success ? parsed.data : buildDefaultPrintTemplateConfig(row.paperSize));
  }

  private toDto(row: PrintTemplateRow): PrintTemplate {
    return {
      id: row.id,
      documentType: documentTypeOf(row),
      name: row.name,
      paperSize: row.paperSize,
      isDefault: row.isDefault,
      isBuiltin: false,
      config: this.parseConfig(row),
      version: row.version,
    };
  }
}
