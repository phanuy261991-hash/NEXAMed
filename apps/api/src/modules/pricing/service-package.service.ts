import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ServicePackage, ServicePackageItem } from '@prisma/client';
import { computePriceListStatus, computeServicePackagePrice, ConcurrentModificationError, getVietnamDateString } from '@nexamed/core';
import type {
  CreateServicePackageRequest,
  ListServicePackagesQuery,
  ListServicePackagesResponse,
  ServicePackageDetail,
  ServicePackageItemInput,
  ServicePackageItemView,
  ServicePackageStatus,
  ServicePackageSummary,
  UpdateServicePackageRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { itemKey, PriceableCatalogService, type ItemRef, type LoadedItem } from './priceable-catalog.service';
import { ServicePackageRepository, type ServicePackageItemData, type UpdateServicePackageData } from './service-package.repository';

const FAR_FUTURE = '9999-12-31';

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function statusOf(pkg: Pick<ServicePackage, 'isActive' | 'effectiveFrom' | 'effectiveTo'>, today: string): ServicePackageStatus {
  return computePriceListStatus({ isActive: pkg.isActive, effectiveFrom: dateOnly(pkg.effectiveFrom), effectiveTo: pkg.effectiveTo ? dateOnly(pkg.effectiveTo) : FAR_FUTURE }, today);
}

/**
 * Gói dịch vụ (Cận lâm sàng GĐ2, docs/DECISIONS.md #212): Dịch vụ khám + Dịch vụ kỹ thuật, giá cố định hoặc tổng trừ
 * chiết khấu. Giá gói của kiểu "tổng trừ chiết khấu" KHÔNG lưu — tính lại mỗi lần đọc nên tự theo đơn giá dịch vụ con.
 * GĐ2 chỉ quản lý danh mục; đưa gói vào chỉ định/hoá đơn là việc của GĐ3.
 */
@Injectable()
export class ServicePackageService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ServicePackageRepository,
    private readonly catalog: PriceableCatalogService,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    private readonly businessCodeService: BusinessCodeService,
  ) {}

  async list(tenantId: string, query: ListServicePackagesQuery): Promise<ListServicePackagesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.list(tx, tenantId, { search: query.search, includeInactive: true });
      const summaries = await this.buildSummaries(tx, tenantId, rows);
      // orderableOnly: CHỈ gói dùng được HÔM NAY (bật + trong khoảng hiệu lực); mặc định ẩn gói đã ngừng.
      const items = query.orderableOnly ? summaries.filter((s) => s.status === 'ACTIVE') : query.includeInactive ? summaries : summaries.filter((s) => s.isActive);
      return { items };
    });
  }

  async getById(tenantId: string, id: string): Promise<ServicePackageDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.loadDetail(tx, tenantId, id));
  }

  async create(tenantId: string, actorId: string, dto: CreateServicePackageRequest, meta: RequestMeta): Promise<ServicePackageDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const items = await this.validateItems(tx, tenantId, dto.items);
      const code = await this.businessCodeService.generate(tx, tenantId, actorId, 'SERVICE_PACKAGE', new Date());
      const created = await this.repository.create(tx, tenantId, actorId, {
        code,
        name: dto.name,
        pricingMode: dto.pricingMode,
        fixedPrice: dto.pricingMode === 'FIXED' && dto.fixedPrice !== undefined ? BigInt(dto.fixedPrice) : null,
        discountType: dto.pricingMode === 'SUM_MINUS_DISCOUNT' ? (dto.discountType ?? null) : null,
        discountValue: dto.pricingMode === 'SUM_MINUS_DISCOUNT' && dto.discountValue !== undefined ? BigInt(dto.discountValue) : null,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      });
      await this.repository.replaceItems(tx, tenantId, created.id, actorId, items);
      await writeAuditLog(tx, tenantId, { actorId, action: 'service_package.created', entityType: 'service_package', entityId: created.id, ip: meta.ip, userAgent: meta.userAgent });
      return this.loadDetail(tx, tenantId, created.id);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateServicePackageRequest, meta: RequestMeta): Promise<ServicePackageDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      const items = dto.items !== undefined ? await this.validateItems(tx, tenantId, dto.items) : undefined;

      const mode = dto.pricingMode ?? existing.pricingMode;
      const data: UpdateServicePackageData = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.pricingMode !== undefined) data.pricingMode = dto.pricingMode;
      if (dto.effectiveFrom !== undefined) data.effectiveFrom = new Date(dto.effectiveFrom);
      if (dto.effectiveTo !== undefined) data.effectiveTo = dto.effectiveTo === null ? null : new Date(dto.effectiveTo);
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

      // Cặp (kiểu giá, giá cố định, chiết khấu) phải nhất quán với CHECK ở DB: dựng trạng thái sau cùng rồi kiểm.
      const fixedPrice = dto.fixedPrice !== undefined ? dto.fixedPrice : existing.fixedPrice === null ? null : Number(existing.fixedPrice);
      const discountType = dto.discountType !== undefined ? dto.discountType : existing.discountType;
      const discountValue = dto.discountValue !== undefined ? dto.discountValue : existing.discountValue === null ? null : Number(existing.discountValue);
      if (mode === 'FIXED') {
        if (fixedPrice === null) throw new BadRequestException('Giá cố định bắt buộc nhập.');
        data.fixedPrice = BigInt(fixedPrice);
        data.discountType = null;
        data.discountValue = null;
      } else {
        if ((discountType === null) !== (discountValue === null)) throw new BadRequestException('Chiết khấu phải có cả loại và giá trị.');
        if (discountType === 'PERCENT' && discountValue !== null && discountValue > 100) throw new BadRequestException('Chiết khấu phần trăm tối đa 100.');
        data.fixedPrice = null;
        data.discountType = discountType;
        data.discountValue = discountValue === null ? null : BigInt(discountValue);
      }
      const from = data.effectiveFrom ?? existing.effectiveFrom;
      const to = data.effectiveTo === undefined ? existing.effectiveTo : data.effectiveTo;
      if (to !== null && to < from) throw new BadRequestException('Ngày kết thúc phải sau hoặc bằng Ngày hiệu lực.');

      // Luôn đi qua đây (kể cả khi chỉ đổi dịch vụ con) để khoá lạc quan + tăng `version` đúng 1 lần.
      const count = await this.repository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, data);
      if (count === 0) throw new ConcurrentModificationError();
      if (items !== undefined) await this.repository.replaceItems(tx, tenantId, id, actorId, items);

      await writeAuditLog(tx, tenantId, { actorId, action: 'service_package.updated', entityType: 'service_package', entityId: id, ip: meta.ip, userAgent: meta.userAgent });
      return this.loadDetail(tx, tenantId, id);
    });
  }

  /** Dịch vụ con phải tồn tại, không trùng nhau; thứ tự giữ đúng như người dùng sắp. */
  private async validateItems(tx: Prisma.TransactionClient, tenantId: string, items: ServicePackageItemInput[]): Promise<ServicePackageItemData[]> {
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.itemKind === 'EXAM_TYPE' ? `E:${item.examTypeCode}` : `T:${item.technicalServiceId}`;
      if (seen.has(key)) throw new BadRequestException('Dịch vụ bị trùng trong gói — muốn nhiều lần hãy tăng Số lượng.');
      seen.add(key);
    }
    const examCodes = items.filter((i) => i.itemKind === 'EXAM_TYPE').map((i) => i.examTypeCode as string);
    if (examCodes.length > 0) {
      const catalog = await this.referenceCatalogRepository.listByCategory(tx, 'EXAM_TYPE', true);
      const known = new Set(catalog.map((c) => c.code));
      if (examCodes.some((c) => !known.has(c))) throw new BadRequestException('Có Dịch vụ khám không tồn tại trong danh mục.');
    }
    const techIds = items.filter((i) => i.itemKind === 'TECHNICAL_SERVICE').map((i) => i.technicalServiceId as string);
    if (techIds.length > 0) {
      const loaded = await this.catalog.load(tx, tenantId, getVietnamDateString(), techIds.map((id): ItemRef => ({ itemKind: 'TECHNICAL_SERVICE', ref: id })));
      if (techIds.some((id) => !loaded.has(itemKey('TECHNICAL_SERVICE', id)))) throw new BadRequestException('Có Dịch vụ kỹ thuật không tồn tại trong danh mục.');
    }
    return items.map((item, index) => ({
      itemKind: item.itemKind,
      examTypeCode: item.itemKind === 'EXAM_TYPE' ? (item.examTypeCode ?? null) : null,
      technicalServiceId: item.itemKind === 'TECHNICAL_SERVICE' ? (item.technicalServiceId ?? null) : null,
      quantity: item.quantity,
      sortOrder: index,
    }));
  }

  private async loadDetail(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ServicePackageDetail> {
    const row = await this.repository.findById(tx, tenantId, id);
    if (!row) throw new NotFoundException();
    const summary = (await this.buildSummaries(tx, tenantId, [row]))[0];
    if (!summary) throw new NotFoundException();
    const children = await this.repository.listItems(tx, tenantId, [id]);
    const loaded = await this.loadChildren(tx, tenantId, getVietnamDateString(), children);
    return { ...summary, items: children.map((c) => this.toItemView(c, loaded)) };
  }

  private async loadChildren(tx: Prisma.TransactionClient, tenantId: string, date: string, children: ServicePackageItem[]): Promise<Map<string, LoadedItem>> {
    const refs: ItemRef[] = children.map((c) => (c.itemKind === 'EXAM_TYPE' ? { itemKind: 'EXAM_TYPE', ref: c.examTypeCode as string } : { itemKind: 'TECHNICAL_SERVICE', ref: c.technicalServiceId as string }));
    return this.catalog.load(tx, tenantId, date, refs);
  }

  private childKey(c: ServicePackageItem): string {
    return c.itemKind === 'EXAM_TYPE' ? itemKey('EXAM_TYPE', c.examTypeCode as string) : itemKey('TECHNICAL_SERVICE', c.technicalServiceId as string);
  }

  private toItemView(c: ServicePackageItem, loaded: Map<string, LoadedItem>): ServicePackageItemView {
    const found = loaded.get(this.childKey(c));
    return {
      id: c.id,
      itemKind: c.itemKind,
      code: found?.item.code ?? (c.examTypeCode ?? ''),
      name: found?.item.name ?? 'Dịch vụ không còn trong danh mục',
      groupName: found?.item.groupName ?? null,
      technicalServiceId: c.technicalServiceId,
      examTypeCode: c.examTypeCode,
      quantity: c.quantity,
      unitPrice: found ? PriceableCatalogService.listPriceOf(found.item) : null,
    };
  }

  /** Tóm tắt nhiều gói bằng 1 lượt đọc dịch vụ con + giá — không N+1. */
  private async buildSummaries(tx: Prisma.TransactionClient, tenantId: string, rows: ServicePackage[]): Promise<ServicePackageSummary[]> {
    const today = getVietnamDateString();
    const children = await this.repository.listItems(tx, tenantId, rows.map((r) => r.id));
    const loaded = await this.loadChildren(tx, tenantId, today, children);
    return rows.map((row) => {
      const mine = children.filter((c) => c.servicePackageId === row.id);
      const computed = computeServicePackagePrice({
        mode: row.pricingMode,
        fixedPrice: row.fixedPrice === null ? null : Number(row.fixedPrice),
        discountType: row.discountType,
        discountValue: row.discountValue === null ? null : Number(row.discountValue),
        items: mine.map((c) => {
          const found = loaded.get(this.childKey(c));
          return { quantity: c.quantity, unitPrice: found ? PriceableCatalogService.listPriceOf(found.item) : null };
        }),
      });
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        pricingMode: row.pricingMode,
        fixedPrice: row.fixedPrice === null ? null : Number(row.fixedPrice),
        discountType: row.discountType,
        discountValue: row.discountValue === null ? null : Number(row.discountValue),
        effectiveFrom: dateOnly(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? dateOnly(row.effectiveTo) : null,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
        version: row.version,
        status: statusOf(row, today),
        itemCount: mine.length,
        retailTotal: computed.retailTotal,
        unpricedItemCount: computed.unpricedItemCount,
        price: computed.price,
        saving: computed.saving,
      };
    });
  }
}
