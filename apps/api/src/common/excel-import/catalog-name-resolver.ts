import type { Prisma } from '@prisma/client';
import { normalizeImportName } from '@nexamed/core';
import type { RequestMeta } from '../request-meta';
import { collapseSpaces } from './excel-import';

/**
 * Đối chiếu TÊN trong file Excel với danh mục dùng chung (`reference_catalog`) cho các chức năng "Nhập Excel": tên đã có → dùng mã đó; chưa có và người nhập
 * có quyền quản lý danh mục → đánh dấu "sẽ tạo mới" (mã tạm `NEW_CATALOG_CODE_PREFIX…`, thay bằng mã thật lúc commit); không có quyền → lỗi dòng.
 * Dùng chung cho Thuốc & Vật tư (#210) và Dịch vụ kỹ thuật (#276) — hai nơi KHÔNG được viết riêng luật này.
 */
export const NEW_CATALOG_CODE_PREFIX = '\u0001NEW|';

export interface CatalogRow {
  category: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface NewCatalogItem<C extends string> {
  category: C;
  name: string;
}

export type CatalogResolution = { ok: true; code: string; newKey: string | null } | { ok: false; reason: string };

export function catalogKey(category: string, name: string): string {
  return `${category}|${normalizeImportName(name)}`;
}

export class CatalogNameResolver<C extends string> {
  private readonly index = new Map<string, { code: string; isActive: boolean }>();
  /** Mục sẽ tạo mới (theo khoá `catalogKey`) — gồm cả mục chỉ mặt hàng LỖI dùng; `neededNewItems` lọc lại theo mặt hàng hợp lệ. */
  readonly newItems = new Map<string, NewCatalogItem<C>>();

  constructor(
    rows: readonly CatalogRow[],
    private readonly canCreate: boolean,
    private readonly labels: Record<C, string>,
  ) {
    for (const r of rows) {
      const key = catalogKey(r.category, r.name);
      const existing = this.index.get(key);
      // Ưu tiên mục đang hoạt động khi trùng tên với mục đã ẩn.
      if (!existing || (!existing.isActive && r.isActive)) this.index.set(key, { code: r.code, isActive: r.isActive });
    }
  }

  /** Tên → mã. Lỗi khi tên đang bị ẩn, hoặc chưa có mà không có quyền tạo mới. */
  resolve(category: C, rawName: string): CatalogResolution {
    const name = collapseSpaces(rawName);
    const label = this.labels[category];
    const key = catalogKey(category, name);
    const found = this.index.get(key);
    if (found) {
      if (!found.isActive) return { ok: false, reason: `${label} "${name}" đang bị ẩn trong danh mục — kích hoạt lại hoặc dùng tên khác.` };
      return { ok: true, code: found.code, newKey: null };
    }
    if (!this.canCreate) {
      return {
        ok: false,
        reason: `${label} "${name}" chưa có trong danh mục và tài khoản của bạn không có quyền tạo mới danh mục dùng chung — chọn tên đã có (xem sheet "Danh mục hiện có") hoặc nhờ quản trị viên nhập.`,
      };
    }
    if (!this.newItems.has(key)) this.newItems.set(key, { category, name });
    return { ok: true, code: `${NEW_CATALOG_CODE_PREFIX}${key}`, newKey: key };
  }
}

/** Các mục sẽ tạo mới mà ít nhất một mặt hàng HỢP LỆ cần (mặt hàng lỗi không để lại rác trong danh mục dùng chung), xếp theo thứ tự danh mục rồi theo tên. */
export function neededNewItems<C extends string>(newItems: ReadonlyMap<string, NewCatalogItem<C>>, neededKeys: ReadonlySet<string>, categoryOrder: readonly C[]): NewCatalogItem<C>[] {
  return [...neededKeys]
    .map((k) => newItems.get(k)!)
    .sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.name.localeCompare(b.name, 'vi'));
}

export interface CatalogCreator<C extends string> {
  createByNameInTx(tx: Prisma.TransactionClient, tenantId: string, actorId: string, category: C, name: string, meta: RequestMeta): Promise<string>;
}

/** Tạo các mục danh mục mới (trong CÙNG transaction của lần nhập) và trả bảng "khoá → mã thật" để thay mã tạm. */
export async function createNewCatalogItems<C extends string>(
  creator: CatalogCreator<C>,
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorId: string,
  items: readonly NewCatalogItem<C>[],
  meta: RequestMeta,
): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  for (const item of items) {
    codes.set(catalogKey(item.category, item.name), await creator.createByNameInTx(tx, tenantId, actorId, item.category, item.name, meta));
  }
  return codes;
}

/** Mã tạm → mã thật (mã đã là mã thật thì giữ nguyên). */
export function replaceTemporaryCode(code: string, newCodes: ReadonlyMap<string, string>): string {
  return code.startsWith(NEW_CATALOG_CODE_PREFIX) ? (newCodes.get(code.slice(NEW_CATALOG_CODE_PREFIX.length)) ?? code) : code;
}
