import type { RolePermissionEntry } from '@nexamed/shared';
import { moduleLabel } from './permission-grouping';

const ACTION_LABELS: Record<string, string> = { read: 'Xem', create: 'Thêm', update: 'Sửa' };

/** "Phiếu nhập kho – Thêm" — nhãn ngắn của một quyền cho khung gợi ý (action lạ dùng luôn mô tả của quyền). */
export function permissionShortLabel(entry: Pick<RolePermissionEntry, 'module' | 'action' | 'description'>): string {
  return `${moduleLabel(entry.module)} – ${ACTION_LABELS[entry.action] ?? entry.description}`;
}

export interface MissingCompanion {
  permissionId: string;
  /** Nhãn quyền còn thiếu, ví dụ "Danh mục Thuốc, Vật tư & Nhà cung cấp – Xem". */
  label: string;
  /** Các quyền ĐANG ĐƯỢC CẤP cần quyền này (để người quản trị hiểu vì sao). */
  neededBy: string[];
}

/**
 * Quyền đi kèm còn THIẾU của một ma trận (docs/DECISIONS.md #208): với mỗi quyền đang cấp (scope khác "none"), mọi
 * quyền trong `companions` mà vai trò đang để "none" đều là quyền thiếu. Thuần hiển thị gợi ý — không chặn lưu.
 * Truyền ma trận ĐÃ GỘP thay đổi đang chờ (không phải bản trên server) để gợi ý cập nhật ngay khi bấm chọn.
 */
export function findMissingCompanions(permissions: readonly RolePermissionEntry[]): MissingCompanion[] {
  const byKey = new Map(permissions.map((p) => [`${p.module}.${p.action}`, p]));
  const missing = new Map<string, MissingCompanion>();
  for (const p of permissions) {
    if (p.dataScope === 'none') continue;
    for (const companionKey of p.companions) {
      const target = byKey.get(companionKey);
      if (!target || target.dataScope !== 'none') continue;
      const entry = missing.get(target.permissionId) ?? { permissionId: target.permissionId, label: permissionShortLabel(target), neededBy: [] };
      entry.neededBy.push(permissionShortLabel(p));
      missing.set(target.permissionId, entry);
    }
  }
  return [...missing.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}
