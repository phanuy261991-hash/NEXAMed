import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ExamTypePrice, type ReferenceCatalog } from '@prisma/client';
import {
  CATALOG_SEQUENCE_PREFIX,
  ConcurrentModificationError,
  ExamTypePriceOverlapError,
  formatShortSequentialCode,
  generateReferenceCatalogCode,
  REFERENCE_CATALOG_SHORT_CODE_PREFIXES,
  ReferenceCatalogDefaultNotAllowedError,
  ReferenceCatalogDuplicateCodeError,
  ReferenceCatalogInvalidAbbreviationError,
  ReferenceCatalogInvalidTreatmentFormCodeError,
} from '@nexamed/core';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import {
  ICD10_ABBREVIATION_CODE_PATTERN,
  normalizeIcd10AbbreviationCode,
  specimenCapColorSchema,
  type CreateReferenceCatalogRequest,
  type SpecimenCapColor,
  type ExamTypePriceInput,
  type ExamTypePriceItem,
  type ListReferenceCatalogResponse,
  type ReferenceCatalogCategory,
  type ReferenceCatalogItem,
  type UpdateReferenceCatalogRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ReferenceCatalogRepository } from './reference-catalog.repository';
import { ExamTypePriceRepository, type CreateExamTypePriceData } from './exam-type-price.repository';

function isDuplicateCodeViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Partial unique `reference_catalog_one_default_per_category_uq` (#268): hai người cùng đặt Loại giá mặc định đồng thời — người sau
 * phải thấy "dữ liệu vừa bị người khác đổi", KHÔNG phải "mã đã tồn tại" (khác với P2002 trên `(tenant_id, category, code)`).
 */
export function isDefaultFlagViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes('one_default') || !text.includes('code');
}

/** C20 — exclusion constraint chặn chồng lấn ngày hiệu lực (docs/DECISIONS.md #079). Vi phạm
 * exclusion constraint không có mã Prisma riêng (`PrismaClientUnknownRequestError`, SQLSTATE
 * 23P01), cùng cách xử lý đã ghi ở `AppointmentService` cho C2 (docs/DECISIONS.md #026) — kiểm cả
 * mã SQLSTATE lẫn tên constraint để không nhầm với lỗi DB khác cũng rơi vào nhánh Unknown. */
function isExclusionViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientUnknownRequestError &&
    err.message.includes('23P01') &&
    err.message.includes('exam_type_price_no_overlap_excl')
  );
}

/**
 * Danh mục RIÊNG THEO TENANT (docs/DECISIONS.md #230 — trước đó dùng chung mọi tenant): mỗi tenant có
 * bản riêng, mọi truy vấn lọc `tenantId` của phiên. Quyền: `reference_catalog.read` (mọi vai trò
 * lâm sàng) / `reference_catalog.manage` (chỉ `clinic_admin`) — xem .claude/docs/security-audit.md.
 */
@Injectable()
export class ReferenceCatalogService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    private readonly examTypePriceRepository: ExamTypePriceRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
  ) {}

  /**
   * Mã tự sinh khi client không cung cấp `code` — category có trong
   * `REFERENCE_CATALOG_SHORT_CODE_PREFIXES` (docs/DECISIONS.md #113) dùng mã NGẮN, TUẦN TỰ
   * (`CodeSequenceRepository` theo tenant, khoá `CATALOG:<tiền tố>`, atomic, không cần retry). Category khác (nếu có nơi nào gọi
   * API thẳng bỏ trống `code` cho category vốn luôn nhập tay ở UI) rơi về cơ chế ngẫu nhiên cũ
   * làm lưới an toàn — không đổi hành vi ngoài phạm vi 6 category đã chốt.
   */
  private async generateCode(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    category: ReferenceCatalogCategory,
  ): Promise<string> {
    const shortPrefix = REFERENCE_CATALOG_SHORT_CODE_PREFIXES[category];
    if (shortPrefix) {
      const seq = await this.codeSequenceRepository.next(tx, tenantId, CATALOG_SEQUENCE_PREFIX + shortPrefix, actorId);
      return formatShortSequentialCode(shortPrefix, seq);
    }
    return generateReferenceCatalogCode(category);
  }

  /**
   * `ICD10_ABBREVIATION` (#206): `code` là TỪ viết tắt do người dùng nhập — lưu dạng chuẩn hoá (chữ
   * thường + NFC, nên "THA" và "tha" là cùng 1 mục, bị chặn trùng như mọi mã khác) và phải đúng MỘT
   * từ chữ/số. Category khác trả nguyên `code` (có thể `undefined` → tự sinh mã như cũ).
   */
  private normalizeCodeForCategory(category: ReferenceCatalogCategory, code: string | undefined): string | undefined {
    if (category === 'TREATMENT_FORM' && code !== undefined) {
      // Hình thức điều trị (#242 GĐ3): mã SỐ của Bộ Y tế, nhập tay (không tự sinh; lúc TẠO bắt buộc có mã — kiểm ở `create`).
      const trimmed = code.trim();
      if (!/^\d{1,9}$/.test(trimmed)) throw new ReferenceCatalogInvalidTreatmentFormCodeError();
      return trimmed;
    }
    if (category !== 'ICD10_ABBREVIATION' || code === undefined) {
      return code;
    }
    const normalized = normalizeIcd10AbbreviationCode(code);
    if (!ICD10_ABBREVIATION_CODE_PATTERN.test(normalized)) {
      throw new ReferenceCatalogInvalidAbbreviationError();
    }
    return normalized;
  }

  async listByCategory(
    tenantId: string,
    category: ReferenceCatalogCategory,
    includeInactive: boolean,
  ): Promise<ListReferenceCatalogResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.referenceCatalogRepository.listByCategory(tx, tenantId, category, includeInactive);
      // Batch 1 query cho CẢ danh sách (không phải N+1) — chỉ EXAM_TYPE có đơn giá, xem
      // .claude/docs/coding-standards.md mục "Hiệu suất".
      const pricesByCode = await this.loadPricesForRows(tx, tenantId, category, rows);
      return { items: rows.map((r) => this.toItem(r, pricesByCode?.get(r.code))) };
    });
  }

  /**
   * Nhập Excel Thuốc & Vật tư (#210) — đọc MỘT lần mọi mục (kể cả đã ẩn) của nhiều category trong
   * transaction của người gọi, để dựng chỉ mục "tên → mã" đối chiếu hàng loạt (không N+1).
   */
  async listAllForImport(
    tx: Prisma.TransactionClient,
    tenantId: string,
    categories: ReferenceCatalogCategory[],
  ): Promise<{ category: ReferenceCatalogCategory; code: string; name: string; isActive: boolean }[]> {
    const rows = await this.referenceCatalogRepository.listByCategories(tx, tenantId, categories);
    return rows.map((r) => ({ category: r.category, code: r.code, name: r.name, isActive: r.isActive }));
  }

  /**
   * Nhập Excel Thuốc & Vật tư (#210) — tạo MỘT mục theo TÊN (mã tự sinh, đúng như "Thêm nhanh" ở form
   * thuốc) trong transaction của người gọi (không mở transaction riêng → nhập hỏng giữa chừng thì
   * rollback cả danh mục vừa tạo). Quyền `reference_catalog.manage` do nơi gọi kiểm trước.
   */
  async createByNameInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    category: ReferenceCatalogCategory,
    name: string,
    meta: RequestMeta,
  ): Promise<string> {
    const code = await this.generateCode(tx, tenantId, actorId, category);
    const created = await this.referenceCatalogRepository.create(tx, tenantId, actorId, { category, code, name, sortOrder: 0 });
    await writeAuditLog(tx, tenantId, {
      actorId,
      action: 'reference_catalog.created',
      entityType: 'reference_catalog',
      entityId: created.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return created.code;
  }

  async create(
    tenantId: string,
    actorId: string,
    dto: CreateReferenceCatalogRequest,
    meta: RequestMeta,
  ): Promise<ReferenceCatalogItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // Không nhập tay mã (mở rộng ADM-01, yêu cầu chủ dự án 2026-08-20) — web chỉ ẩn ô "Mã" cho
      // 6 category không có nguồn dữ liệu chính thức, backend không hardcode danh sách category,
      // chỉ tự sinh khi thiếu `code`. Mã ngắn tuần tự cấp atomic (docs/DECISIONS.md #113) nên
      // không cần retry khi trùng — chỉ mã client TỰ NHẬP mới có thể trùng thật.
      const providedCode = this.normalizeCodeForCategory(dto.category, dto.code);
      if (dto.category === 'ICD10_ABBREVIATION' && providedCode === undefined) {
        throw new ReferenceCatalogInvalidAbbreviationError();
      }
      if (dto.category === 'TREATMENT_FORM' && providedCode === undefined) {
        throw new ReferenceCatalogInvalidTreatmentFormCodeError();
      }
      const code = providedCode ?? (await this.generateCode(tx, tenantId, actorId, dto.category));
      // Loại giá mặc định (#268): chỉ PRICE_TYPE đang dùng; mục mặc định cũ của công ty tự bỏ cờ TRƯỚC khi ghi mục mới (cùng giao dịch).
      if (dto.isDefault === true) {
        if (dto.category !== 'PRICE_TYPE' || dto.isActive === false) throw new ReferenceCatalogDefaultNotAllowedError();
        await this.referenceCatalogRepository.clearDefaultExcept(tx, tenantId, dto.category, null, actorId);
      }
      let created: ReferenceCatalog;
      try {
        created = await this.referenceCatalogRepository.create(tx, tenantId, actorId, {
          category: dto.category,
          code,
          name: dto.name,
          sortOrder: dto.sortOrder,
          price: dto.price !== undefined ? BigInt(dto.price) : null,
          unit: dto.unit ?? null,
          deactivatesAccount: dto.deactivatesAccount ?? false,
          countsAsCash: dto.countsAsCash ?? false,
          description: dto.description ?? null,
          bytCode: dto.bytCode ?? null,
          fullName: dto.fullName ?? null,
          capColor: dto.capColor ?? null,
          abbreviation: dto.abbreviation ?? null,
          direction: dto.direction ?? null,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
        });
      } catch (err) {
        if (dto.isDefault === true && isDefaultFlagViolation(err)) {
          throw new ConcurrentModificationError();
        }
        if (isDuplicateCodeViolation(err)) {
          throw new ReferenceCatalogDuplicateCodeError();
        }
        throw err;
      }

      let prices: ExamTypePrice[] | undefined;
      if (dto.category === 'EXAM_TYPE' && dto.examTypePrices !== undefined) {
        prices = await this.replaceExamTypePrices(tx, tenantId, created.code, actorId, dto.examTypePrices);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'reference_catalog.created',
        entityType: 'reference_catalog',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toItem(created, prices);
    });
  }

  /** Dùng chung cho `create`/`update` — bulk-replace + map lỗi C20 thành `ExamTypePriceOverlapError`. */
  private async replaceExamTypePrices(
    tx: Prisma.TransactionClient,
    tenantId: string,
    examTypeCode: string,
    actorId: string,
    items: ExamTypePriceInput[],
  ): Promise<ExamTypePrice[]> {
    const data: CreateExamTypePriceData[] = items.map((item) => ({
      priceTypeCode: item.priceTypeCode,
      unitCode: item.unitCode,
      amount: BigInt(item.amount),
      effectiveFrom: new Date(item.effectiveFrom),
      effectiveTo: item.effectiveTo ? new Date(item.effectiveTo) : null,
    }));
    try {
      await this.examTypePriceRepository.replaceForExamType(tx, tenantId, examTypeCode, actorId, data);
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new ExamTypePriceOverlapError();
      }
      throw err;
    }
    return this.examTypePriceRepository.listByExamTypeCodes(tx, tenantId, [examTypeCode]);
  }

  /** Batch-fetch prices cho toàn bộ danh sách EXAM_TYPE trong 1 query — trả `undefined` cho category khác. */
  private async loadPricesForRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
    category: ReferenceCatalogCategory,
    rows: ReferenceCatalog[],
  ): Promise<Map<string, ExamTypePrice[]> | undefined> {
    if (category !== 'EXAM_TYPE' || rows.length === 0) return undefined;
    const all = await this.examTypePriceRepository.listByExamTypeCodes(
      tx,
      tenantId,
      rows.map((r) => r.code),
    );
    const map = new Map<string, ExamTypePrice[]>();
    for (const price of all) {
      const list = map.get(price.examTypeCode) ?? [];
      list.push(price);
      map.set(price.examTypeCode, list);
    }
    return map;
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateReferenceCatalogRequest,
    meta: RequestMeta,
  ): Promise<ReferenceCatalogItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.referenceCatalogRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }
      const nextCode = this.normalizeCodeForCategory(existing.category, dto.code);

      // Loại giá mặc định (#268): đặt mặc định chỉ cho PRICE_TYPE đang dùng, và bỏ cờ mục mặc định cũ TRƯỚC khi ghi (cùng giao dịch —
      // lệch `version` ở bước ghi sau sẽ rollback cả bước bỏ cờ này). Ẩn mục đang là mặc định qua PATCH cũng bỏ luôn cờ của chính nó.
      if (dto.isDefault === true) {
        if (existing.category !== 'PRICE_TYPE' || (dto.isActive ?? existing.isActive) === false) throw new ReferenceCatalogDefaultNotAllowedError();
        await this.referenceCatalogRepository.clearDefaultExcept(tx, tenantId, existing.category, id, actorId);
      }
      const nextIsDefault = dto.isDefault === true ? true : dto.isDefault === false || dto.isActive === false ? false : undefined;

      // Luôn gọi `update` kể cả khi PATCH chỉ gửi `examTypePrices` (bảng con): `data` rỗng vẫn tăng
      // `version` của bản ghi cha, nên khoá lạc quan (docs/DECISIONS.md #207) áp cho MỌI lần sửa. Lệch
      // version (`count=0` trong khi bản ghi còn tồn tại — đã kiểm `findById` ở trên) → 409.
      let count: number;
      try {
        count = await this.referenceCatalogRepository.update(tx, tenantId, id, dto.version, actorId, {
          code: nextCode,
          name: dto.name,
          sortOrder: dto.sortOrder,
          price: dto.price !== undefined ? BigInt(dto.price) : undefined,
          unit: dto.unit,
          deactivatesAccount: dto.deactivatesAccount,
          countsAsCash: dto.countsAsCash,
          description: dto.description,
          bytCode: dto.bytCode,
          fullName: dto.fullName,
          capColor: dto.capColor,
          abbreviation: dto.abbreviation,
          direction: dto.direction,
          isDefault: nextIsDefault,
          isActive: dto.isActive,
        });
      } catch (err) {
        if (dto.isDefault === true && isDefaultFlagViolation(err)) {
          throw new ConcurrentModificationError();
        }
        if (isDuplicateCodeViolation(err)) {
          throw new ReferenceCatalogDuplicateCodeError();
        }
        throw err;
      }
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      if (existing.category === 'EXAM_TYPE' && dto.examTypePrices !== undefined) {
        // Mã EXAM_TYPE không đổi được qua UI (tự sinh, đúng khuôn UNIT/4 category nhân sự) nên
        // dùng thẳng `existing.code` — an toàn kể cả khi client vẫn còn gửi `dto.code` cũ.
        await this.replaceExamTypePrices(tx, tenantId, existing.code, actorId, dto.examTypePrices);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'reference_catalog.updated',
        entityType: 'reference_catalog',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.referenceCatalogRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      // Luôn trả lại đơn giá hiện có (kể cả khi request này không đụng tới) — response phải phản
      // ánh đúng trạng thái DB, không chỉ những gì vừa ghi.
      const prices =
        updated.category === 'EXAM_TYPE' ? await this.examTypePriceRepository.listByExamTypeCodes(tx, tenantId, [updated.code]) : undefined;
      return this.toItem(updated, prices);
    });
  }

  async setActive(
    tenantId: string,
    actorId: string,
    id: string,
    isActive: boolean,
    expectedVersion: number,
    meta: RequestMeta,
  ): Promise<ReferenceCatalogItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.referenceCatalogRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const count = await this.referenceCatalogRepository.setActive(tx, tenantId, id, expectedVersion, isActive, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: isActive ? 'reference_catalog.reactivated' : 'reference_catalog.deactivated',
        entityType: 'reference_catalog',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.referenceCatalogRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      const prices =
        updated.category === 'EXAM_TYPE' ? await this.examTypePriceRepository.listByExamTypeCodes(tx, tenantId, [updated.code]) : undefined;
      return this.toItem(updated, prices);
    });
  }

  private toItem(row: ReferenceCatalog, prices?: ExamTypePrice[]): ReferenceCatalogItem {
    return {
      id: row.id,
      category: row.category,
      code: row.code,
      name: row.name,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      price: row.price !== null ? Number(row.price) : null,
      unit: row.unit,
      deactivatesAccount: row.deactivatesAccount,
      countsAsCash: row.countsAsCash,
      description: row.description,
      direction: row.direction,
      bytCode: row.bytCode,
      fullName: row.fullName,
      capColor: specimenCapColorSchema.safeParse(row.capColor).success ? (row.capColor as SpecimenCapColor) : null,
      abbreviation: row.abbreviation,
      isDefault: row.isDefault,
      version: row.version,
      // Category khác luôn `undefined` (field không áp dụng). EXAM_TYPE luôn là MẢNG thật (kể cả
      // rỗng — ví dụ tenant khác chưa tạo đơn giá cho mục dùng chung này) chứ không phải
      // `undefined`, để frontend không phải phân biệt 2 trạng thái "chưa tải"/"không có dòng nào".
      prices: row.category === 'EXAM_TYPE' ? (prices ?? []).map((p) => this.toPriceItem(p)) : undefined,
    };
  }

  private toPriceItem(row: ExamTypePrice): ExamTypePriceItem {
    return {
      id: row.id,
      priceTypeCode: row.priceTypeCode,
      unitCode: row.unitCode,
      amount: Number(row.amount),
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : undefined,
    };
  }
}
