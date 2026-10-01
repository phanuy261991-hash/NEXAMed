import { describe, expect, it } from 'vitest';
import type { DataScope, RolePermissionEntry } from '@nexamed/shared';
import { findMissingCompanions } from './companion-hints';

function entry(module: string, action: string, dataScope: DataScope, companions: string[] = []): RolePermissionEntry {
  return { permissionId: `${module}.${action}`, module, action, description: `${module} ${action}`, dataScope, companions };
}

describe('findMissingCompanions (gợi ý quyền đi kèm, docs/DECISIONS.md #208)', () => {
  it('quyền đang cấp cần quyền đi kèm đang "Không" → báo thiếu, kèm quyền nào cần nó', () => {
    const matrix = [
      entry('stock_receipt', 'create', 'global', ['drug.read', 'cash_account.read']),
      entry('drug', 'read', 'none'),
      entry('cash_account', 'read', 'none'),
    ];
    const missing = findMissingCompanions(matrix);
    expect(missing.map((m) => m.permissionId).sort()).toEqual(['cash_account.read', 'drug.read']);
    expect(missing.find((m) => m.permissionId === 'drug.read')!.neededBy).toEqual(['Phiếu nhập kho – Thêm']);
  });

  it('đã cấp quyền đi kèm (bất kể scope) → không báo; quyền gốc "Không" → không gợi ý gì', () => {
    expect(findMissingCompanions([entry('stock_receipt', 'create', 'personal', ['drug.read']), entry('drug', 'read', 'department')])).toEqual([]);
    expect(findMissingCompanions([entry('stock_receipt', 'create', 'none', ['drug.read']), entry('drug', 'read', 'none')])).toEqual([]);
  });

  it('nhiều quyền cùng cần một quyền đi kèm → gộp 1 dòng, liệt kê đủ quyền cần nó; quyền đi kèm không có trong danh mục thì bỏ qua', () => {
    const matrix = [
      entry('stock_receipt', 'read', 'global', ['drug.read']),
      entry('stock_count', 'read', 'global', ['drug.read', 'khong.ton_tai']),
      entry('drug', 'read', 'none'),
    ];
    const missing = findMissingCompanions(matrix);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.neededBy).toEqual(['Phiếu nhập kho – Xem', 'Kiểm kê kho – Xem']);
  });
});
