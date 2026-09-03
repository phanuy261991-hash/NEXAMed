import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ExamTypePrice, type ReferenceCatalog } from '@prisma/client';
import {
  ExamTypePriceOverlapError,
  formatShortSequentialCode,
  generateReferenceCatalogCode,
  REFERENCE_CATALOG_SHORT_CODE_PREFIXES,
  ReferenceCatalogDuplicateCodeError,
} from '@nexamed/core';
import { GlobalCodeSequenceRepository } from '../../infrastructure/persistence/global-code-sequence.repository';
import type {
  CreateReferenceCatalogRequest,
  ExamTypePriceInput,
  ExamTypePriceItem,
  ListReferenceCatalogResponse,
  ReferenceCatalogCategory,
  ReferenceCatalogItem,
  UpdateReferenceCatalogRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ReferenceCatalogRepository } from './reference-catalog.repository';
import { ExamTypePriceRepository, type CreateExamTypePriceData } from './exam-type-price.repository';

function isDuplicateCodeViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
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
 * Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch — docs/DECISIONS.md, đảo ngược #034
 * phần ethnicity/nationality). Không tenant_id trên `reference_catalog` nhưng `writeAuditLog`
 * vẫn cần `tenantId`/`actorId` của người thao tác — audit luôn gắn theo tenant của actor, đúng
 * khuôn `writeAuditLog` dùng ở mọi service khác. Quyền: `reference_catalog.read` (mọi vai trò
 * lâm sàng) / `reference_catalog.manage` (chỉ `clinic_admin`) — xem .claude/docs/security-audit.md.
 */
@Injectable()
export class ReferenceCatalogService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    private readonly examTypePriceRepository: ExamTypePriceRepository,
    private readonly globalCodeSequenceRepository: GlobalCodeSequenceRepository,
  ) {}

  /**
   * Mã tự sinh khi client không cung cấp `code` — category có trong
   * `REFERENCE_CATALOG_SHORT_CODE_PREFIXES` (docs/DECISIONS.md #113) dùng mã NGẮN, TUẦN TỰ
   * (`GlobalCodeSequenceRepository`, atomic, không cần retry). Category khác (nếu có nơi nào gọi
   * API thẳng bỏ trống `code` cho category vốn luôn nhập tay ở UI) rơi về cơ chế ngẫu nhiên cũ
   * làm lưới an toàn — không đổi hành vi ngoài phạm vi 6 category đã chốt.
   */
  private async generateCode(tx: Prisma.TransactionClient, category: ReferenceCatalogCategory): Promise<string> {
    const shortPrefix = REFERENCE_CATALOG_SHORT_CODE_PREFIXES[category];
    if (shortPrefix) {
      const seq = await this.globalCodeSequenceRepository.next(tx, shortPrefix);
      return formatShortSequentialCode(shortPrefix, seq);
    }
    return generateReferenceCatalogCode(category);
  }

  async listByCategory(
    tenantId: string,
    category: ReferenceCatalogCategory,
    includeInactive: boolean,
  ): Promise<ListReferenceCatalogResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.referenceCatalogRepository.listByCategory(tx, category, includeInactive);
      // Batch 1 query cho CẢ danh sách (không phải N+1) — chỉ EXAM_TYPE có đơn giá, xem
      // .claude/docs/coding-standards.md mục "Hiệu suất".
      const pricesByCode = await this.loadPricesForRows(tx, tenantId, category, rows);
      return { items: rows.map((r) => this.toItem(r, pricesByCode?.get(r.code))) };
    });
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
      const code = dto.code ?? (await this.generateCode(tx, dto.category));
      let created: ReferenceCatalog;
      try {
        created = await this.referenceCatalogRepository.create(tx, {
          category: dto.category,
          code,
          name: dto.name,
          sortOrder: dto.sortOrder,
          price: dto.price !== undefined ? BigInt(dto.price) : null,
          unit: dto.unit ?? null,
          deactivatesAccount: dto.deactivatesAccount ?? false,
          countsAsCash: dto.countsAsCash ?? false,
          description: dto.description ?? null,
          isActive: dto.isActive ?? true,
        });
      } catch (err) {
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
      const existing = await this.referenceCatalogRepository.findById(tx, id);
      if (!existing) {
        throw new NotFoundException();
      }

      // `examTypePrices` là PATCH riêng cho bảng con `exam_type_price`, không phải cột nào của
      // `reference_catalog` — bỏ nó ra trước khi xét "có gì để sửa ở bảng cha không". Một PATCH
      // CHỈ gửi `examTypePrices` (không đụng tên/trạng thái/mô tả...) là hợp lệ và phổ biến (chỉ
      // thêm/sửa đơn giá) — gọi `updateMany` với `data` toàn `undefined` sẽ là no-op không sinh
      // câu UPDATE nào (Prisma bỏ hết field `undefined`), trả `count: 0` dù bản ghi vẫn tồn tại —
      // phát hiện thật qua test PATCH chỉ gửi `examTypePrices`, không phải đoán từ tài liệu Prisma.
      const hasCatalogFieldChanges =
        dto.code !== undefined ||
        dto.name !== undefined ||
        dto.sortOrder !== undefined ||
        dto.price !== undefined ||
        dto.unit !== undefined ||
        dto.deactivatesAccount !== undefined ||
        dto.countsAsCash !== undefined ||
        dto.description !== undefined ||
        dto.isActive !== undefined;

      if (hasCatalogFieldChanges) {
        let count: number;
        try {
          count = await this.referenceCatalogRepository.update(tx, id, {
            code: dto.code,
            name: dto.name,
            sortOrder: dto.sortOrder,
            price: dto.price !== undefined ? BigInt(dto.price) : undefined,
            unit: dto.unit,
            deactivatesAccount: dto.deactivatesAccount,
            countsAsCash: dto.countsAsCash,
            description: dto.description,
            isActive: dto.isActive,
          });
        } catch (err) {
          if (isDuplicateCodeViolation(err)) {
            throw new ReferenceCatalogDuplicateCodeError();
          }
          throw err;
        }
        if (count === 0) {
          throw new NotFoundException();
        }
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

      const updated = await this.referenceCatalogRepository.findById(tx, id);
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
    meta: RequestMeta,
  ): Promise<ReferenceCatalogItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.referenceCatalogRepository.findById(tx, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const count = await this.referenceCatalogRepository.setActive(tx, id, isActive);
      if (count === 0) {
        throw new NotFoundException();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: isActive ? 'reference_catalog.reactivated' : 'reference_catalog.deactivated',
        entityType: 'reference_catalog',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.referenceCatalogRepository.findById(tx, id);
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
