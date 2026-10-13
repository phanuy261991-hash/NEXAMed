import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_LABELS, moduleLabel } from './permission-grouping';

/**
 * Chặn lỗ hổng lặp lại nhiều lần (#105/#122/#136/#158/#190/13-10-2026): thêm permission cho module mới mà quên nhãn tiếng Việt ở `MODULE_LABELS`
 * → trang "Vai trò & Phân quyền" hiện tên module thô (`price_list`...). Web không import giá trị từ `@nexamed/core` (#073) nên đọc thẳng file nguồn danh mục quyền.
 */
const PERMISSIONS_SOURCE = resolve(__dirname, '../../../../../packages/core/src/rbac/permissions.ts');

function modulesInPermissionCatalog(): string[] {
  const source = readFileSync(PERMISSIONS_SOURCE, 'utf8');
  return [...new Set([...source.matchAll(/\{\s*module:\s*'([a-z_]+)'/g)].map((m) => m[1]!))].sort();
}

describe('nhãn module ở trang Vai trò & Phân quyền', () => {
  it('đọc được danh mục quyền (tránh test rỗng vô nghĩa)', () => {
    expect(modulesInPermissionCatalog().length).toBeGreaterThan(30);
  });

  it('MỌI module trong danh mục quyền đều có nhãn tiếng Việt', () => {
    const missing = modulesInPermissionCatalog().filter((m) => MODULE_LABELS[m] === undefined);
    expect(missing).toEqual([]);
  });

  it('nhãn không phải là chính tên module thô', () => {
    for (const m of modulesInPermissionCatalog()) {
      expect(moduleLabel(m)).not.toBe(m);
    }
  });
});
