import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PriceList, PriceListItem, Prisma } from '@prisma/client';
import { applyPriceListLine, computePriceListStatus, ConcurrentModificationError, getVietnamDateString } from '@nexamed/core';
import type {
  CreatePriceListRequest,
  ItemsByGroupsRequest,
  ListPriceableGroupsResponse,
  ListPriceListsQuery,
  ListPriceListsResponse,
  PriceListDetail,
  PriceListLineInput,
  PriceListLineView,
  PriceListStatus,
  PriceListSummary,
  SearchPriceableItemsQuery,
  SearchPriceableItemsResponse,
  UpdatePriceListRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BusinessCodeService } from '../clinic/business-code.service';
import { DrugRepository } from '../drug/drug.repository';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { TechnicalServiceRepository } from '../technical-service/technical-service.repository';
import { ServicePackageRepository } from './service-package.repository';
import { PriceListRepository, type PriceListLineData, type UpdatePriceListData } from './price-list.repository';
import { itemKey, PriceableCatalogService, type ItemRef } from './priceable-catalog.service';
import { pickScope } from './pricing.service';

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function statusOf(list: Pick<PriceList, 'isActive' | 'effectiveFrom' | 'effectiveTo'>, today: string): PriceListStatus {
  return computePriceListStatus({ isActive: list.isActive, effectiveFrom: dateOnly(list.effectiveFrom), effectiveTo: dateOnly(list.effectiveTo) }, today);
}

/** Hai dòng cùng mặt hàng trong cùng bảng giá có chồng phạm vi không (null = "mọi ...")? Chồng thì cùng bảng sẽ mơ hồ → cấm. */
function scopesOverlap(a: PriceListLineInput, b: PriceListLineInput): boolean {
  const typeOverlap = a.priceTypeCode === undefined || b.priceTypeCode === undefined || a.priceTypeCode === b.priceTypeCode;
  const unitOverlap = a.unitCode === undefined || b.unitCode === undefined || a.unitCode === b.unitCode;
  return typeOverlap && unitOverlap;
}

function lineRef(line: PriceListLineInput): string {
  return line.examTypeCode ?? line.technicalServiceId ?? line.servicePackageId ?? line.drugId ?? '';
}

/**
 * Bảng giá có thời hạn (Cận lâm sàng GĐ2, docs/DECISIONS.md #212). Chỉ quản lý bảng + dòng; việc TÍNH giá nằm ở
 * `PricingService`. "Bảng giá chung" (BG0000) là dòng ảo — giá nhập trên từng mặt hàng — không có bản ghi.
 */
@Injectable()
export class PriceListService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: PriceListRepository,
    private readonly catalog: PriceableCatalogService,
    private readonly businessCodeService: BusinessCodeService,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    private readonly technicalServiceRepository: TechnicalServiceRepository,
    private readonly servicePackageRepository: ServicePackageRepository,
    private readonly drugRepository: DrugRepository,
  ) {}

  async list(tenantId: string, query: ListPriceListsQuery): Promise<ListPriceListsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const today = getVietnamDateString();
      const rows = await this.repository.list(tx, tenantId, query.search);
      const counts = await this.repository.countLinesByPriceList(tx, tenantId, rows.map((r) => r.id));
      const all: PriceListSummary[] = rows.map((r) => this.toSummary(r, counts.get(r.id) ?? 0, today));
      const tally = { all: all.length, ACTIVE: 0, UPCOMING: 0, EXPIRED: 0, STOPPED: 0 };
      for (const s of all) tally[s.status] += 1;
      return {
        general: { code: 'BG0000', name: 'Bảng giá chung', priority: 0, itemCount: await this.countGeneralItems(tx, tenantId) },
        items: query.status ? all.filter((s) => s.status === query.status) : all,
        counts: tally,
      };
    });
  }

  async getById(tenantId: string, id: string): Promise<PriceListDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.loadDetail(tx, tenantId, id));
  }

  async create(tenantId: string, actorId: string, dto: CreatePriceListRequest, meta: RequestMeta): Promise<PriceListDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const lines = await this.validateLines(tx, tenantId, dto.lines);
      const code = await this.businessCodeService.generate(tx, tenantId, actorId, 'PRICE_LIST', new Date());
      const created = await this.repository.create(tx, tenantId, actorId, {
        code,
        name: dto.name,
        description: dto.description ?? null,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: new Date(dto.effectiveTo),
        priority: dto.priority,
      });
      await this.repository.replaceLines(tx, tenantId, created.id, actorId, lines);
      await writeAuditLog(tx, tenantId, { actorId, action: 'price_list.created', entityType: 'price_list', entityId: created.id, ip: meta.ip, userAgent: meta.userAgent });
      return this.loadDetail(tx, tenantId, created.id);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdatePriceListRequest, meta: RequestMeta): Promise<PriceListDetail> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      const lines = dto.lines !== undefined ? await this.validateLines(tx, tenantId, dto.lines) : undefined;

      const data: UpdatePriceListData = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.effectiveFrom !== undefined) data.effectiveFrom = new Date(dto.effectiveFrom);
      if (dto.effectiveTo !== undefined) data.effectiveTo = new Date(dto.effectiveTo);
      if (dto.priority !== undefined) data.priority = dto.priority;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      const from = data.effectiveFrom ?? existing.effectiveFrom;
      const to = data.effectiveTo ?? existing.effectiveTo;
      if (to < from) throw new BadRequestException('Ngày kết thúc phải sau hoặc bằng Ngày bắt đầu.');

      // Luôn đi qua đây (kể cả khi chỉ đổi dòng) để khoá lạc quan + tăng `version` đúng 1 lần.
      const count = await this.repository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, data);
      if (count === 0) throw new ConcurrentModificationError();
      if (lines !== undefined) await this.repository.replaceLines(tx, tenantId, id, actorId, lines);

      const action = dto.isActive === undefined || dto.isActive === existing.isActive ? 'price_list.updated' : dto.isActive ? 'price_list.resumed' : 'price_list.stopped';
      await writeAuditLog(tx, tenantId, { actorId, action, entityType: 'price_list', entityId: id, ip: meta.ip, userAgent: meta.userAgent });
      return this.loadDetail(tx, tenantId, id);
    });
  }

  /** Ghi audit mỗi lần xuất Excel (đọc dữ liệu giá hàng loạt ra ngoài hệ thống). */
  async recordExportAudit(tenantId: string, actorId: string, id: string, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, { actorId, action: 'price_list.exported', entityType: 'price_list', entityId: id, ip: meta.ip, userAgent: meta.userAgent }),
    );
  }

  /** Tìm mặt hàng để thêm vào bảng giá / tra thử giá — kèm mức giá mặc định hôm nay của từng Loại giá/Bậc đơn vị. */
  async listGroups(tenantId: string): Promise<ListPriceableGroupsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({ groups: await this.catalog.listGroups(tx, tenantId) }));
  }

  async itemsByGroups(tenantId: string, dto: ItemsByGroupsRequest): Promise<SearchPriceableItemsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({ items: await this.catalog.listByGroups(tx, tenantId, getVietnamDateString(), dto.groups) }));
  }

  async searchItems(tenantId: string, query: SearchPriceableItemsQuery): Promise<SearchPriceableItemsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({
      items: await this.catalog.search(tx, tenantId, getVietnamDateString(), query.q, query.kind, query.limit),
    }));
  }

  // ---------------------------------------------------------------------------------------------

  private toSummary(row: PriceList, itemCount: number, today: string): PriceListSummary {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      effectiveFrom: dateOnly(row.effectiveFrom),
      effectiveTo: dateOnly(row.effectiveTo),
      priority: row.priority,
      isActive: row.isActive,
      version: row.version,
      status: statusOf(row, today),
      itemCount,
    };
  }

  /** Số mặt hàng của "Bảng giá chung" = mọi mặt hàng đang dùng có thể có giá (khám + kỹ thuật + gói + thuốc/vật tư). */
  private async countGeneralItems(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const [exam, tech, packages, drugs] = await Promise.all([
      this.referenceCatalogRepository.listByCategory(tx, 'EXAM_TYPE', false),
      this.technicalServiceRepository.countsByKind(tx, tenantId, false),
      this.servicePackageRepository.countActive(tx, tenantId),
      this.drugRepository.countActive(tx, tenantId),
    ]);
    return exam.length + tech.LAB + tech.IMAGING + tech.FUNCTIONAL + packages + drugs;
  }

  /**
   * Mặt hàng phải tồn tại; loại (Thuốc/Vật tư) phải khớp `drug.item_type`; không có 2 dòng chồng phạm vi cho cùng mặt hàng.
   * Dòng "Giá mới" của dịch vụ khám/kỹ thuật không bắt buộc Loại giá đó đang có giá (cho phép đặt giá cho mức chưa có).
   */
  private async validateLines(tx: Prisma.TransactionClient, tenantId: string, lines: PriceListLineInput[]): Promise<PriceListLineData[]> {
    const byItem = new Map<string, PriceListLineInput[]>();
    for (const line of lines) {
      const key = itemKey(line.itemKind, lineRef(line));
      const group = byItem.get(key) ?? [];
      if (group.some((other) => scopesOverlap(other, line))) {
        throw new BadRequestException('Một mặt hàng không thể có 2 dòng trùng phạm vi (Loại giá/Đơn vị) trong cùng bảng giá.');
      }
      group.push(line);
      byItem.set(key, group);
    }

    const refs: ItemRef[] = lines.map((l) => ({ itemKind: l.itemKind, ref: lineRef(l) }));
    const loaded = await this.catalog.load(tx, tenantId, getVietnamDateString(), refs);
    for (const line of lines) {
      const found = loaded.get(itemKey(line.itemKind, lineRef(line)));
      if (!found) throw new BadRequestException('Có mặt hàng không tồn tại trong danh mục.');
      if ((line.itemKind === 'DRUG' || line.itemKind === 'MEDICAL_SUPPLY') && found.item.itemKind !== line.itemKind) {
        throw new BadRequestException(`"${found.item.name}" không phải ${line.itemKind === 'DRUG' ? 'thuốc' : 'vật tư y tế'}.`);
      }
      if (line.unitCode !== undefined && found.drug && !found.drug.factorByUnitCode.has(line.unitCode)) {
        throw new BadRequestException(`Đơn vị không thuộc chuỗi quy đổi của "${found.item.name}".`);
      }
    }
    return lines.map((line, index) => ({
      itemKind: line.itemKind,
      examTypeCode: line.examTypeCode ?? null,
      technicalServiceId: line.technicalServiceId ?? null,
      servicePackageId: line.servicePackageId ?? null,
      drugId: line.drugId ?? null,
      priceTypeCode: line.priceTypeCode ?? null,
      unitCode: line.unitCode ?? null,
      mode: line.mode,
      value: BigInt(line.value),
      sortOrder: index,
    }));
  }

  private async loadDetail(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PriceListDetail> {
    const row = await this.repository.findById(tx, tenantId, id);
    if (!row) throw new NotFoundException();
    const lines = await this.repository.listLines(tx, tenantId, id);
    const today = getVietnamDateString();
    return { ...this.toSummary(row, lines.length, today), lines: await this.toLineViews(tx, tenantId, row, lines, today) };
  }

  /** Giá mặc định hiển thị tính theo hôm nay nếu bảng đang hiệu lực, không thì theo ngày bắt đầu của bảng. */
  private async toLineViews(tx: Prisma.TransactionClient, tenantId: string, list: PriceList, lines: PriceListItem[], today: string): Promise<PriceListLineView[]> {
    const from = dateOnly(list.effectiveFrom);
    const to = dateOnly(list.effectiveTo);
    const refDate = today >= from && today <= to ? today : from;
    const refs: ItemRef[] = lines.map((l) => ({ itemKind: l.itemKind, ref: l.examTypeCode ?? l.technicalServiceId ?? l.servicePackageId ?? l.drugId ?? '' }));
    const loaded = await this.catalog.load(tx, tenantId, refDate, refs);
    return lines.map((l) => {
      const ref = l.examTypeCode ?? l.technicalServiceId ?? l.servicePackageId ?? l.drugId ?? '';
      const found = loaded.get(itemKey(l.itemKind, ref));
      const scope = found ? pickScope(found.item.scopes, { priceTypeCode: l.priceTypeCode ?? undefined, unitCode: l.unitCode ?? undefined }) : null;
      const baseAmount = scope?.amount ?? null;
      const value = Number(l.value);
      return {
        id: l.id,
        itemKind: l.itemKind,
        examTypeCode: l.examTypeCode,
        technicalServiceId: l.technicalServiceId,
        servicePackageId: l.servicePackageId,
        drugId: l.drugId,
        code: found?.item.code ?? ref,
        name: found?.item.name ?? 'Mặt hàng không còn trong danh mục',
        priceTypeCode: l.priceTypeCode,
        unitCode: l.unitCode,
        mode: l.mode,
        value,
        baseAmount,
        finalAmount: l.mode === 'PERCENT_OFF' && baseAmount === null ? null : applyPriceListLine(baseAmount ?? 0, { mode: l.mode, value }),
        scopes: found?.item.scopes ?? [],
        itemMissing: !found,
      };
    });
  }
}
