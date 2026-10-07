import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { computeServicePackagePrice, computeUnitConversion, stripVietnameseDiacritics } from '@nexamed/core';
import type { PriceableItem, PriceableScope, PriceListItemKind } from '@nexamed/shared';
import { DrugRepository, type DrugWithDetails } from '../drug/drug.repository';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { ExamTypePriceRepository } from '../reference-catalog/exam-type-price.repository';
import { TechnicalServiceRepository } from '../technical-service/technical-service.repository';
import { ServicePackageRepository } from './service-package.repository';

/** Mặt hàng cần tính giá — `ref` = `examTypeCode` (dịch vụ khám) hoặc id (dịch vụ kỹ thuật/gói/thuốc/vật tư). */
export interface ItemRef {
  itemKind: PriceListItemKind;
  ref: string;
}

/** Thuốc và vật tư cùng nằm trong bảng `drug` nên dùng chung 1 khoá — phân biệt bằng `drug.item_type` khi hiển thị. */
export function itemKey(itemKind: PriceListItemKind, ref: string): string {
  const group = itemKind === 'DRUG' || itemKind === 'MEDICAL_SUPPLY' ? 'DRUG' : itemKind;
  return `${group}:${ref}`;
}

export interface DrugPricingInfo {
  baseUnitCode: string;
  defaultSellPrice: number | null;
  /** Hệ số quy đổi ra đơn vị cơ sở của MỌI bậc (đơn vị cơ sở = 1). */
  factorByUnitCode: Map<string, number>;
}

export interface LoadedItem {
  item: PriceableItem;
  /** Chỉ có với thuốc/vật tư — dữ liệu để quy "Giá mới" của bậc lớn về giá 1 đơn vị cơ sở. */
  drug: DrugPricingInfo | null;
}

const NO_PRICE_TYPE_ORDER = 9999;

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isActiveOn(from: Date, to: Date | null, date: string): boolean {
  return dateOnly(from) <= date && (to === null || dateOnly(to) >= date);
}

function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = stripVietnameseDiacritics(q);
  return fields.some((f) => f && stripVietnameseDiacritics(f).includes(needle));
}

/**
 * Đọc "giá mặc định" (giá nhập trực tiếp trên mặt hàng = Bảng giá chung) của mọi loại mặt hàng có thể nằm trong bảng
 * giá hoặc gói: dịch vụ khám, dịch vụ kỹ thuật, gói, thuốc, vật tư. Các bảng gốc thuộc module khác nên đọc qua repository
 * mà module đó export (cùng tiền lệ `InventoryModule` đọc `DrugRepository`), KHÔNG gọi Prisma trực tiếp ở đây.
 */
@Injectable()
export class PriceableCatalogService {
  constructor(
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    private readonly examTypePriceRepository: ExamTypePriceRepository,
    private readonly technicalServiceRepository: TechnicalServiceRepository,
    private readonly servicePackageRepository: ServicePackageRepository,
    private readonly drugRepository: DrugRepository,
  ) {}

  /** Thứ tự hiển thị của các Loại giá dịch vụ (`reference_catalog` PRICE_TYPE) — quyết định "mức giá đầu tiên" của dịch vụ. */
  async priceTypeOrder(tx: Prisma.TransactionClient): Promise<Map<string, number>> {
    const rows = await this.referenceCatalogRepository.listByCategory(tx, 'PRICE_TYPE', true);
    return new Map(rows.map((r, index) => [r.code, index]));
  }

  /** Giá lẻ của 1 dịch vụ = mức giá ĐẦU TIÊN (theo thứ tự Loại giá) đang có giá — dùng để cộng "tổng giá lẻ" của gói. */
  static listPriceOf(item: PriceableItem): number | null {
    return item.scopes.find((s) => s.amount !== null)?.amount ?? null;
  }

  async load(tx: Prisma.TransactionClient, tenantId: string, date: string, refs: readonly ItemRef[]): Promise<Map<string, LoadedItem>> {
    const result = new Map<string, LoadedItem>();
    const examCodes = new Set<string>();
    const techIds = new Set<string>();
    const packageIds = new Set<string>();
    const drugIds = new Set<string>();
    for (const r of refs) {
      if (r.itemKind === 'EXAM_TYPE') examCodes.add(r.ref);
      else if (r.itemKind === 'TECHNICAL_SERVICE') techIds.add(r.ref);
      else if (r.itemKind === 'PACKAGE') packageIds.add(r.ref);
      else drugIds.add(r.ref);
    }

    const order = await this.priceTypeOrder(tx);
    const sortScopes = (scopes: PriceableScope[]): PriceableScope[] =>
      [...scopes].sort((a, b) => (order.get(a.priceTypeCode ?? '') ?? NO_PRICE_TYPE_ORDER) - (order.get(b.priceTypeCode ?? '') ?? NO_PRICE_TYPE_ORDER));

    // Dịch vụ con của gói cũng cần giá lẻ — gom vào cùng lượt đọc.
    const packages = await this.servicePackageRepository.findByIds(tx, tenantId, [...packageIds]);
    const packageItems = await this.servicePackageRepository.listItems(tx, tenantId, packages.map((p) => p.id));
    for (const it of packageItems) {
      if (it.itemKind === 'EXAM_TYPE' && it.examTypeCode) examCodes.add(it.examTypeCode);
      if (it.itemKind === 'TECHNICAL_SERVICE' && it.technicalServiceId) techIds.add(it.technicalServiceId);
    }

    // --- dịch vụ khám ---
    const baseItems = new Map<string, PriceableItem>();
    if (examCodes.size > 0) {
      const catalog = await this.referenceCatalogRepository.listByCategory(tx, 'EXAM_TYPE', true);
      const prices = await this.examTypePriceRepository.listByExamTypeCodes(tx, tenantId, [...examCodes]);
      for (const row of catalog.filter((c) => examCodes.has(c.code))) {
        const scopes = sortScopes(
          prices
            .filter((p) => p.examTypeCode === row.code && isActiveOn(p.effectiveFrom, p.effectiveTo, date))
            .map((p) => ({ priceTypeCode: p.priceTypeCode, unitCode: p.unitCode, amount: Number(p.amount) })),
        );
        baseItems.set(itemKey('EXAM_TYPE', row.code), { itemKind: 'EXAM_TYPE', ref: row.code, code: row.code, name: row.name, groupName: 'Khám bệnh', scopes });
      }
    }

    // --- dịch vụ kỹ thuật ---
    if (techIds.size > 0) {
      const rows = await this.technicalServiceRepository.findRowsByIds(tx, tenantId, [...techIds]);
      const categoryNames = new Map((await this.referenceCatalogRepository.listByCategory(tx, 'TECH_SERVICE_CATEGORY', true)).map((c) => [c.code, c.name]));
      const prices = await this.technicalServiceRepository.listPrices(tx, tenantId, rows.map((r) => r.id));
      for (const row of rows) {
        const scopes = sortScopes(
          prices
            .filter((p) => p.technicalServiceId === row.id && isActiveOn(p.effectiveFrom, p.effectiveTo, date))
            .map((p) => ({ priceTypeCode: p.priceTypeCode, unitCode: p.unitCode, amount: Number(p.amount) })),
        );
        baseItems.set(itemKey('TECHNICAL_SERVICE', row.id), {
          itemKind: 'TECHNICAL_SERVICE',
          ref: row.id,
          code: row.code,
          name: row.name,
          groupName: row.categoryCode ? (categoryNames.get(row.categoryCode) ?? null) : null,
          scopes,
        });
      }
    }

    for (const r of refs) {
      if (r.itemKind === 'EXAM_TYPE' || r.itemKind === 'TECHNICAL_SERVICE') {
        const found = baseItems.get(itemKey(r.itemKind, r.ref));
        if (found) result.set(itemKey(r.itemKind, r.ref), { item: found, drug: null });
      }
    }

    // --- gói ---
    for (const pkg of packages) {
      const children = packageItems.filter((i) => i.servicePackageId === pkg.id);
      const computed = computeServicePackagePrice({
        mode: pkg.pricingMode,
        fixedPrice: pkg.fixedPrice === null ? null : Number(pkg.fixedPrice),
        discountType: pkg.discountType,
        discountValue: pkg.discountValue === null ? null : Number(pkg.discountValue),
        items: children.map((c) => {
          const child =
            c.itemKind === 'EXAM_TYPE' && c.examTypeCode
              ? baseItems.get(itemKey('EXAM_TYPE', c.examTypeCode))
              : c.technicalServiceId
                ? baseItems.get(itemKey('TECHNICAL_SERVICE', c.technicalServiceId))
                : undefined;
          return { quantity: c.quantity, unitPrice: child ? PriceableCatalogService.listPriceOf(child) : null };
        }),
      });
      result.set(itemKey('PACKAGE', pkg.id), {
        item: { itemKind: 'PACKAGE', ref: pkg.id, code: pkg.code, name: pkg.name, groupName: null, scopes: [{ priceTypeCode: null, unitCode: null, amount: computed.price }] },
        drug: null,
      });
    }

    // --- thuốc / vật tư ---
    if (drugIds.size > 0) {
      const drugs = await this.drugRepository.findByIdsWithDetails(tx, tenantId, [...drugIds]);
      for (const drug of drugs) {
        const loaded = this.loadDrug(drug);
        result.set(itemKey(loaded.item.itemKind, drug.id), loaded);
      }
    }
    return result;
  }

  private loadDrug(drug: DrugWithDetails): LoadedItem {
    const defaultSellPrice = drug.defaultSellPrice === null ? null : Number(drug.defaultSellPrice);
    // Dữ liệu cũ (trước Kho Thuốc GĐ1) có thể chưa có đơn vị cơ sở — coi là chuỗi rỗng, bậc đó hiển thị không tên đơn vị.
    const baseUnitCode = drug.baseUnitCode ?? '';
    const levels = computeUnitConversion(
      baseUnitCode,
      drug.units.map((u) => ({ unitCode: u.unitCode, sortOrder: u.sortOrder, factorToUnitBelow: u.factorToUnitBelow })),
    );
    const factorByUnitCode = new Map(levels.map((l) => [l.unitCode, l.factorToBaseUnit]));
    const scopes: PriceableScope[] = levels.map((level) => {
      const unit = drug.units.find((u) => u.unitCode === level.unitCode);
      const tierPrice = drug.unitPricingEnabled && unit?.sellPrice != null ? Number(unit.sellPrice) : null;
      const amount = level.factorToBaseUnit === 1 ? defaultSellPrice : (tierPrice ?? (defaultSellPrice === null ? null : defaultSellPrice * level.factorToBaseUnit));
      return { priceTypeCode: null, unitCode: level.unitCode === '' ? null : level.unitCode, amount };
    });
    return {
      item: { itemKind: drug.itemType === 'SUPPLY' ? 'MEDICAL_SUPPLY' : 'DRUG', ref: drug.id, code: drug.code, name: drug.name, groupName: null, scopes },
      drug: { baseUnitCode, defaultSellPrice, factorByUnitCode },
    };
  }

  /** Tìm mặt hàng theo tên/mã/viết tắt để thêm vào bảng giá hoặc tra thử giá — kèm mức giá mặc định hôm nay. */
  async search(tx: Prisma.TransactionClient, tenantId: string, date: string, q: string, kind: PriceListItemKind | undefined, limit: number): Promise<PriceableItem[]> {
    const perKind = kind ? limit : Math.max(4, Math.ceil(limit / 2));
    const refs: ItemRef[] = [];
    const wants = (k: PriceListItemKind) => kind === undefined || kind === k;

    if (wants('EXAM_TYPE')) {
      const catalog = await this.referenceCatalogRepository.listByCategory(tx, 'EXAM_TYPE', false);
      for (const row of catalog.filter((c) => matchesQuery(q, c.code, c.name)).slice(0, perKind)) refs.push({ itemKind: 'EXAM_TYPE', ref: row.code });
    }
    if (wants('TECHNICAL_SERVICE')) {
      // Danh mục vài trăm dịch vụ nên lọc trong bộ nhớ để gõ KHÔNG DẤU cũng ra (repository chỉ so khớp chuỗi có dấu).
      const rows = (await this.technicalServiceRepository.list(tx, tenantId, { includeInactive: false })).filter((r) => matchesQuery(q, r.code, r.name, r.shortName));
      for (const row of rows.slice(0, perKind)) refs.push({ itemKind: 'TECHNICAL_SERVICE', ref: row.id });
    }
    if (wants('PACKAGE')) {
      const rows = (await this.servicePackageRepository.list(tx, tenantId, { includeInactive: false })).filter((r) => matchesQuery(q, r.code, r.name));
      for (const row of rows.slice(0, perKind)) refs.push({ itemKind: 'PACKAGE', ref: row.id });
    }
    if (wants('DRUG')) {
      const rows = await this.drugRepository.list(tx, tenantId, { q, itemType: 'MEDICINE', includeInactive: false });
      for (const row of rows.slice(0, perKind)) refs.push({ itemKind: 'DRUG', ref: row.id });
    }
    if (wants('MEDICAL_SUPPLY')) {
      const rows = await this.drugRepository.list(tx, tenantId, { q, itemType: 'SUPPLY', includeInactive: false });
      for (const row of rows.slice(0, perKind)) refs.push({ itemKind: 'MEDICAL_SUPPLY', ref: row.id });
    }

    const loaded = await this.load(tx, tenantId, date, refs);
    const out: PriceableItem[] = [];
    for (const r of refs) {
      const found = loaded.get(itemKey(r.itemKind, r.ref));
      if (found) out.push(found.item);
    }
    return out.slice(0, limit * (kind ? 1 : 5));
  }
}
