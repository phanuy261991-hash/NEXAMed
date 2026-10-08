import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  applyPriceListLine,
  computePriceListStatus,
  resolveDrugBaseUnitPrice,
  resolveEffectivePrice,
  type PriceListLineCandidate,
  type ResolvedEffectivePrice,
} from '@nexamed/core';
import type {
  LookupPriceEntry,
  LookupPriceQuery,
  LookupPriceResponse,
  PriceableScope,
  PriceListItemKind,
  ResolvedPrice,
  ResolvePriceItem,
  ResolvePricesRequest,
  ResolvePricesResponse,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { PriceListRepository, type ActivePriceListLine } from './price-list.repository';
import { itemKey, PriceableCatalogService, type ItemRef, type LoadedItem } from './priceable-catalog.service';

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toLineCandidate(line: ActivePriceListLine): PriceListLineCandidate {
  return {
    priceListId: line.priceList.id,
    priceListName: line.priceList.name,
    priority: line.priceList.priority,
    effectiveFrom: dateOnly(line.priceList.effectiveFrom),
    createdAtMs: line.priceList.createdAt.getTime(),
    mode: line.mode,
    value: Number(line.value),
    priceTypeCode: line.priceTypeCode,
    unitCode: line.unitCode,
  };
}

/** Khoá mặt hàng của 1 dòng bảng giá — khớp `itemKey()` của `PriceableCatalogService`. */
export function lineItemKey(line: { itemKind: PriceListItemKind; examTypeCode: string | null; technicalServiceId: string | null; servicePackageId: string | null; drugId: string | null }): string {
  const ref = line.examTypeCode ?? line.technicalServiceId ?? line.servicePackageId ?? line.drugId ?? '';
  return itemKey(line.itemKind, ref);
}

function toResolved(r: ResolvedEffectivePrice, codeByListId: Map<string, string>): ResolvedPrice {
  return {
    baseAmount: r.baseAmount,
    amount: r.amount,
    applied: r.applied
      ? {
          priceListId: r.applied.priceListId,
          code: codeByListId.get(r.applied.priceListId) ?? '',
          name: r.applied.priceListName,
          priority: r.applied.priority,
          mode: r.applied.mode,
          value: r.applied.value,
        }
      : null,
  };
}

/** Chọn mức giá (Loại giá × Đơn vị) của 1 mặt hàng theo yêu cầu; mặc định = mức đầu tiên. `null` khi không có mức nào. */
export function pickScope(scopes: readonly PriceableScope[], want: { priceTypeCode?: string; unitCode?: string }): PriceableScope | null {
  if (scopes.length === 0) return null;
  const found = scopes.find((s) => (want.priceTypeCode === undefined || s.priceTypeCode === want.priceTypeCode) && (want.unitCode === undefined || s.unitCode === want.unitCode));
  return found ?? (want.priceTypeCode === undefined && want.unitCode === undefined ? (scopes[0] ?? null) : null);
}

/**
 * Tính giá áp dụng của mặt hàng vào một ngày (Cận lâm sàng GĐ2, docs/DECISIONS.md #212): bảng giá có thời hạn ưu tiên cao
 * nhất đang hiệu lực thắng, không có thì giá mặc định. Ngày áp giá = ngày TIẾP NHẬN / ngày LẬP PHIẾU (chốt 06/10/2026) —
 * nơi gọi truyền vào, service không tự đọc đồng hồ.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly priceListRepository: PriceListRepository,
    private readonly catalog: PriceableCatalogService,
  ) {}

  async resolve(tenantId: string, dto: ResolvePricesRequest): Promise<ResolvePricesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({ items: await this.resolveWithin(tx, tenantId, dto.date, dto.items) }));
  }

  /** Tính nhiều mặt hàng trong 1 transaction có sẵn — đúng thứ tự `items`. Mặt hàng không tồn tại → giá `null`. */
  async resolveWithin(tx: Prisma.TransactionClient, tenantId: string, date: string, items: readonly ResolvePriceItem[]): Promise<ResolvedPrice[]> {
    const refs: ItemRef[] = items.map((i) => ({ itemKind: i.itemKind, ref: i.ref }));
    const loaded = await this.catalog.load(tx, tenantId, date, refs);
    const { linesByKey, codeByListId } = await this.activeLinesByKey(tx, tenantId, date, refs);
    return items.map((req) => {
      const found = loaded.get(itemKey(req.itemKind, req.ref));
      if (!found) return { baseAmount: null, amount: null, applied: null };
      const scope = pickScope(found.item.scopes, { priceTypeCode: req.priceTypeCode, unitCode: req.unitCode });
      const resolved = resolveEffectivePrice({
        baseAmount: scope?.amount ?? null,
        lines: linesByKey.get(itemKey(req.itemKind, req.ref)) ?? [],
        priceTypeCode: scope?.priceTypeCode ?? null,
        unitCode: scope?.unitCode ?? null,
      });
      return toResolved(resolved, codeByListId);
    });
  }

  /**
   * Giá bán theo ĐƠN VỊ CƠ SỞ của từng thuốc/vật tư sau bảng giá có thời hạn — kho phát thuốc luôn tính tiền theo đơn vị cơ
   * sở (#164). Thuốc không có trong kết quả = không tồn tại. Giá `null` = chưa có giá bán (nơi gọi tự quyết định, hiện coi là 0).
   */
  async resolveDrugBaseUnitPricesWithin(tx: Prisma.TransactionClient, tenantId: string, date: string, drugIds: readonly string[]): Promise<Map<string, number | null>> {
    const unique = [...new Set(drugIds)];
    const out = new Map<string, number | null>();
    if (unique.length === 0) return out;
    const refs: ItemRef[] = unique.map((id) => ({ itemKind: 'DRUG', ref: id }));
    const loaded = await this.catalog.load(tx, tenantId, date, refs);
    const { linesByKey } = await this.activeLinesByKey(tx, tenantId, date, refs);
    for (const id of unique) {
      const found = loaded.get(itemKey('DRUG', id));
      if (!found?.drug) continue;
      const r = resolveDrugBaseUnitPrice({
        baseAmount: found.drug.defaultSellPrice,
        lines: linesByKey.get(itemKey('DRUG', id)) ?? [],
        baseUnitCode: found.drug.baseUnitCode,
        factorByUnitCode: found.drug.factorByUnitCode,
      });
      out.set(id, r.amount);
    }
    return out;
  }

  async lookup(tenantId: string, query: LookupPriceQuery): Promise<LookupPriceResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const ref: ItemRef = { itemKind: query.itemKind, ref: query.ref };
      const loaded = await this.catalog.load(tx, tenantId, query.date, [ref]);
      const found: LoadedItem | undefined = loaded.get(itemKey(query.itemKind, query.ref));
      if (!found) throw new NotFoundException();

      const scopes = found.item.scopes.length > 0 ? found.item.scopes : [{ priceTypeCode: null, unitCode: null, amount: null }];
      const noScope: PriceableScope = { priceTypeCode: null, unitCode: null, amount: null };
      const scope: PriceableScope = pickScope(scopes, { priceTypeCode: query.priceTypeCode, unitCode: query.unitCode }) ?? scopes[0] ?? noScope;

      const rows = await this.priceListRepository.listLinesForItem(tx, tenantId, {
        examTypeCode: query.itemKind === 'EXAM_TYPE' ? query.ref : undefined,
        technicalServiceId: query.itemKind === 'TECHNICAL_SERVICE' ? query.ref : undefined,
        servicePackageId: query.itemKind === 'PACKAGE' ? query.ref : undefined,
        drugId: query.itemKind === 'DRUG' || query.itemKind === 'MEDICAL_SUPPLY' ? query.ref : undefined,
      });

      // Chỉ xét dòng áp được cho mức giá đang tra; dòng thuộc bảng chưa tới/đã hết hạn/đã ngừng vẫn hiện (inEffect=false).
      const relevant = rows.filter((row) => (row.priceTypeCode === null || row.priceTypeCode === scope.priceTypeCode) && (row.unitCode === null || row.unitCode === scope.unitCode));
      const inEffect = (row: (typeof relevant)[number]): boolean => computePriceListStatus({ isActive: row.priceList.isActive, effectiveFrom: dateOnly(row.priceList.effectiveFrom), effectiveTo: dateOnly(row.priceList.effectiveTo) }, query.date) === 'ACTIVE';

      const candidates: PriceListLineCandidate[] = relevant.filter(inEffect).map((row) => toLineCandidate({ ...row, priceList: row.priceList }));
      const resolved = resolveEffectivePrice({ baseAmount: scope.amount, lines: candidates, priceTypeCode: scope.priceTypeCode, unitCode: scope.unitCode });
      const winnerListId = resolved.applied?.priceListId ?? null;

      const entries: LookupPriceEntry[] = relevant.map((row) => ({
        priceListId: row.priceList.id,
        code: row.priceList.code,
        name: row.priceList.name,
        priority: row.priceList.priority,
        mode: row.mode,
        value: Number(row.value),
        amount: row.mode === 'PERCENT_OFF' && scope.amount === null ? null : applyPriceListLine(scope.amount ?? 0, { mode: row.mode, value: Number(row.value) }),
        inEffect: inEffect(row),
        isApplied: row.priceList.id === winnerListId,
      }));
      entries.sort((a, b) => b.priority - a.priority);
      entries.push({
        priceListId: null,
        code: 'BG0000',
        name: 'Bảng giá chung',
        priority: 0,
        mode: null,
        value: null,
        amount: scope.amount,
        inEffect: true,
        isApplied: winnerListId === null,
      });

      const codeByListId = new Map(relevant.map((r) => [r.priceList.id, r.priceList.code]));
      return {
        item: { itemKind: query.itemKind, ref: query.ref, code: found.item.code, name: found.item.name },
        date: query.date,
        scope,
        scopes,
        entries,
        result: toResolved(resolved, codeByListId),
      };
    });
  }

  private async activeLinesByKey(
    tx: Prisma.TransactionClient,
    tenantId: string,
    date: string,
    refs: readonly ItemRef[],
  ): Promise<{ linesByKey: Map<string, PriceListLineCandidate[]>; codeByListId: Map<string, string> }> {
    const lines = await this.priceListRepository.listActiveLines(tx, tenantId, new Date(date), {
      examTypeCodes: refs.filter((r) => r.itemKind === 'EXAM_TYPE').map((r) => r.ref),
      technicalServiceIds: refs.filter((r) => r.itemKind === 'TECHNICAL_SERVICE').map((r) => r.ref),
      servicePackageIds: refs.filter((r) => r.itemKind === 'PACKAGE').map((r) => r.ref),
      drugIds: refs.filter((r) => r.itemKind === 'DRUG' || r.itemKind === 'MEDICAL_SUPPLY').map((r) => r.ref),
    });
    const linesByKey = new Map<string, PriceListLineCandidate[]>();
    const codeByListId = new Map<string, string>();
    for (const line of lines) {
      const key = lineItemKey(line);
      const arr = linesByKey.get(key) ?? [];
      arr.push(toLineCandidate(line));
      linesByKey.set(key, arr);
      codeByListId.set(line.priceList.id, line.priceList.code);
    }
    return { linesByKey, codeByListId };
  }
}
