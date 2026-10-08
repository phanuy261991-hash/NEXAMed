import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { computeServicePackagePrice, computeUnitConversion, stripVietnameseDiacritics } from '@nexamed/core';
import type { PriceableGroup, PriceableItem, PriceableScope, PriceListItemKind } from '@nexamed/shared';
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

  // ---------------------------------------------------------------------------------------------
  // Thêm hàng loạt vào bảng giá (hộp thoại "Thêm theo nhóm" + nhập Excel)
  // ---------------------------------------------------------------------------------------------

  /**
   * Các nhóm chọn được cho từng loại mặt hàng kèm số mặt hàng đang dùng. Dịch vụ khám và gói không có nhóm nên mỗi loại là MỘT nhóm "tất cả" (`code = null`);
   * dịch vụ kỹ thuật theo Nhóm dịch vụ, thuốc/vật tư theo Nhóm thuốc, mặt hàng chưa gán nhóm gom vào "Chưa phân nhóm" (`code = null`).
   */
  async listGroups(tx: Prisma.TransactionClient, tenantId: string): Promise<PriceableGroup[]> {
    const groups: PriceableGroup[] = [];

    const exams = await this.referenceCatalogRepository.listByCategory(tx, 'EXAM_TYPE', false);
    groups.push({ kind: 'EXAM_TYPE', code: null, name: 'Tất cả dịch vụ khám', itemCount: exams.length });

    const techRows = await this.technicalServiceRepository.list(tx, tenantId, { includeInactive: false });
    const techCategoryNames = new Map((await this.referenceCatalogRepository.listByCategory(tx, 'TECH_SERVICE_CATEGORY', true)).map((c) => [c.code, c.name]));
    groups.push(...countGroups('TECHNICAL_SERVICE', techRows.map((r) => r.categoryCode), techCategoryNames));

    const packages = await this.servicePackageRepository.countActive(tx, tenantId);
    groups.push({ kind: 'PACKAGE', code: null, name: 'Tất cả gói dịch vụ', itemCount: packages });

    const drugGroupNames = new Map((await this.referenceCatalogRepository.listByCategory(tx, 'DRUG_GROUP', true)).map((c) => [c.code, c.name]));
    const medicines = await this.drugRepository.list(tx, tenantId, { itemType: 'MEDICINE', includeInactive: false });
    groups.push(...countGroups('DRUG', medicines.map((d) => d.drugGroupCode), drugGroupNames));
    const supplies = await this.drugRepository.list(tx, tenantId, { itemType: 'SUPPLY', includeInactive: false });
    groups.push(...countGroups('MEDICAL_SUPPLY', supplies.map((d) => d.drugGroupCode), drugGroupNames));

    return groups.filter((g) => g.itemCount > 0);
  }

  /** Mặt hàng thuộc các nhóm đã chọn (kèm giá mặc định hôm nay). Mỗi mặt hàng chỉ xuất hiện một lần dù thuộc nhiều nhóm được chọn. */
  async listByGroups(tx: Prisma.TransactionClient, tenantId: string, date: string, selections: readonly { kind: PriceListItemKind; code: string | null }[]): Promise<PriceableItem[]> {
    const refs: ItemRef[] = [];
    const seen = new Set<string>();
    const push = (itemKind: PriceListItemKind, ref: string) => {
      const key = itemKey(itemKind, ref);
      if (seen.has(key)) return;
      seen.add(key);
      refs.push({ itemKind, ref });
    };
    const codesOf = (kind: PriceListItemKind) => selections.filter((s) => s.kind === kind);

    if (codesOf('EXAM_TYPE').length > 0) {
      for (const row of await this.referenceCatalogRepository.listByCategory(tx, 'EXAM_TYPE', false)) push('EXAM_TYPE', row.code);
    }
    const techSel = codesOf('TECHNICAL_SERVICE');
    if (techSel.length > 0) {
      const wanted = new Set(techSel.map((s) => s.code));
      for (const row of await this.technicalServiceRepository.list(tx, tenantId, { includeInactive: false })) {
        if (wanted.has(row.categoryCode ?? null)) push('TECHNICAL_SERVICE', row.id);
      }
    }
    if (codesOf('PACKAGE').length > 0) {
      for (const row of await this.servicePackageRepository.list(tx, tenantId, { includeInactive: false })) push('PACKAGE', row.id);
    }
    for (const [kind, itemType] of [['DRUG', 'MEDICINE'], ['MEDICAL_SUPPLY', 'SUPPLY']] as const) {
      const sel = codesOf(kind);
      if (sel.length === 0) continue;
      const wanted = new Set(sel.map((s) => s.code));
      for (const row of await this.drugRepository.list(tx, tenantId, { itemType, includeInactive: false })) {
        if (wanted.has(row.drugGroupCode ?? null)) push(kind, row.id);
      }
    }

    const loaded = await this.load(tx, tenantId, date, refs);
    const out: PriceableItem[] = [];
    for (const r of refs) {
      const found = loaded.get(itemKey(r.itemKind, r.ref));
      if (found) out.push(found.item);
    }
    return out;
  }

  /**
   * Tra mặt hàng theo MÃ cho nhập Excel (không phân biệt hoa/thường): dịch vụ khám theo `code`, dịch vụ kỹ thuật/gói/thuốc/vật tư theo `code` của bảng riêng.
   * Trả map `<loại>:<mã chữ thường>` → mặt hàng kèm giá mặc định; mã không có trong danh mục (hoặc đã ngừng) không có trong map.
   */
  async findByCodes(tx: Prisma.TransactionClient, tenantId: string, date: string, wanted: readonly { kind: PriceListItemKind; code: string }[]): Promise<Map<string, PriceableItem>> {
    const norm = (c: string) => c.trim().toLowerCase();
    const wantedByKind = (kind: PriceListItemKind) => new Set(wanted.filter((w) => w.kind === kind).map((w) => norm(w.code)));
    const refs: { ref: ItemRef; lookup: string }[] = [];

    const exam = wantedByKind('EXAM_TYPE');
    if (exam.size > 0) {
      for (const row of await this.referenceCatalogRepository.listByCategory(tx, 'EXAM_TYPE', false)) {
        if (exam.has(norm(row.code))) refs.push({ ref: { itemKind: 'EXAM_TYPE', ref: row.code }, lookup: `EXAM_TYPE:${norm(row.code)}` });
      }
    }
    const tech = wantedByKind('TECHNICAL_SERVICE');
    if (tech.size > 0) {
      for (const row of await this.technicalServiceRepository.list(tx, tenantId, { includeInactive: false })) {
        if (tech.has(norm(row.code))) refs.push({ ref: { itemKind: 'TECHNICAL_SERVICE', ref: row.id }, lookup: `TECHNICAL_SERVICE:${norm(row.code)}` });
      }
    }
    const packages = wantedByKind('PACKAGE');
    if (packages.size > 0) {
      for (const row of await this.servicePackageRepository.list(tx, tenantId, { includeInactive: false })) {
        if (packages.has(norm(row.code))) refs.push({ ref: { itemKind: 'PACKAGE', ref: row.id }, lookup: `PACKAGE:${norm(row.code)}` });
      }
    }
    for (const [kind, itemType] of [['DRUG', 'MEDICINE'], ['MEDICAL_SUPPLY', 'SUPPLY']] as const) {
      const codes = wantedByKind(kind);
      if (codes.size === 0) continue;
      for (const row of await this.drugRepository.list(tx, tenantId, { itemType, includeInactive: false })) {
        if (codes.has(norm(row.code))) refs.push({ ref: { itemKind: kind, ref: row.id }, lookup: `${kind}:${norm(row.code)}` });
      }
    }

    const loaded = await this.load(tx, tenantId, date, refs.map((r) => r.ref));
    const out = new Map<string, PriceableItem>();
    for (const r of refs) {
      const found = loaded.get(itemKey(r.ref.itemKind, r.ref.ref));
      if (found) out.set(r.lookup, found.item);
    }
    return out;
  }
}

/** Đếm mặt hàng theo mã nhóm → danh sách nhóm (tên nhóm lấy từ danh mục; mã không còn trong danh mục thì hiện chính mã), nhóm trống gom vào "Chưa phân nhóm". */
function countGroups(kind: PriceListItemKind, groupCodes: readonly (string | null)[], names: Map<string, string>): PriceableGroup[] {
  const counts = new Map<string | null, number>();
  for (const code of groupCodes) counts.set(code ?? null, (counts.get(code ?? null) ?? 0) + 1);
  const named = [...counts.entries()]
    .filter(([code]) => code !== null)
    .map(([code, itemCount]) => ({ kind, code, name: names.get(code as string) ?? (code as string), itemCount }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const none = counts.get(null);
  return none ? [...named, { kind, code: null, name: 'Chưa phân nhóm', itemCount: none }] : named;
}
