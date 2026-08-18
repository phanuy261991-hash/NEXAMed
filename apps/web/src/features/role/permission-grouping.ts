import type { RolePermissionEntry } from '@nexamed/shared';

/**
 * Nhãn tiếng Việt cho từng `module` trong danh mục `permission` (packages/core/src/rbac/
 * permissions.ts) — thuần trình bày, module lạ (thêm sau này, chưa kịp cập nhật nhãn) vẫn hiển
 * thị được bằng chính tên module thô (xem `moduleLabel`), không vỡ giao diện.
 */
const MODULE_LABELS: Record<string, string> = {
  patient: 'Bệnh nhân',
  appointment: 'Lịch hẹn',
  encounter: 'Lượt khám',
  vital_sign: 'Sinh hiệu',
  diagnosis: 'Chẩn đoán',
  clinical_note: 'Ghi chú SOAP',
  prescription: 'Đơn thuốc',
  clinic_config: 'Cấu hình phòng khám',
  user_account: 'Tài khoản người dùng',
  role_permission: 'Phân quyền',
  audit_log: 'Nhật ký hoạt động',
  reference_catalog: 'Danh mục dùng chung',
};

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}

/**
 * Nhóm nhiều module liên quan lại dưới một tiêu đề chung — đúng bố cục mockup đã duyệt (ADM-07):
 * mockup gộp ví dụ "Lượt khám"/"Sinh hiệu"/"Chẩn đoán" dưới tiêu đề "Tiếp nhận & Lượt khám" thay
 * vì liệt kê phẳng 12 module rời rạc. Chỉ hiện tiêu đề nhóm khi nhóm có TỪ 2 module trở lên (xem
 * `groupPermissionsBySection`) — nhóm 1 module thì tiêu đề sẽ trùng nghĩa với chính tên hàng bên
 * dưới, không có giá trị thông tin thêm.
 */
const SECTIONS: { label: string; modules: string[] }[] = [
  { label: 'Quản lý bệnh nhân', modules: ['patient'] },
  { label: 'Đặt lịch hẹn', modules: ['appointment'] },
  { label: 'Tiếp nhận & Lượt khám', modules: ['encounter', 'vital_sign', 'diagnosis'] },
  { label: 'Khám bệnh & Kê đơn', modules: ['clinical_note', 'prescription'] },
  { label: 'Cấu hình & Quản trị', modules: ['clinic_config', 'user_account', 'role_permission', 'audit_log'] },
  { label: 'Danh mục dùng chung', modules: ['reference_catalog'] },
];

export interface ModuleGroup {
  module: string;
  label: string;
  /** `action==='read'` — cột "Xem". `undefined` nếu module này không có quyền đọc. */
  read?: RolePermissionEntry;
  /** `action==='create'` — cột "Thêm". */
  create?: RolePermissionEntry;
  /** `action==='update'` — cột "Sửa". */
  update?: RolePermissionEntry;
  /** Mọi action khác (merge/cancel/sign/print/manage...) — cột "Đặc quyền mở rộng". */
  special: RolePermissionEntry[];
}

export interface PermissionSection {
  /** `null` nếu module này không thuộc nhóm nào định nghĩa sẵn (permission mới thêm sau, chưa kịp xếp) — không có tiêu đề, hiện thẳng module. */
  sectionLabel: string | null;
  groups: ModuleGroup[];
}

function toModuleGroup(module: string, entries: RolePermissionEntry[]): ModuleGroup {
  return {
    module,
    label: moduleLabel(module),
    read: entries.find((e) => e.action === 'read'),
    create: entries.find((e) => e.action === 'create'),
    update: entries.find((e) => e.action === 'update'),
    special: entries.filter((e) => !['read', 'create', 'update'].includes(e.action)),
  };
}

/**
 * Gộp danh sách quyền phẳng (module.action) thành các nhóm theo `SECTIONS`, tách 3 action chuẩn
 * (read/create/update) vào 3 cột CRUD trong mỗi hàng module, còn lại vào "Đặc quyền mở rộng" —
 * theo bố cục đã duyệt (ADM-07). Không có action "delete" nào trong danh mục hiện tại (hệ thống
 * không xoá cứng dữ liệu nghiệp vụ, xem CLAUDE.md) nên cột đó luôn trống ở tầng hiển thị
 * (`RoleMatrixTable.tsx`), không xuất hiện ở đây.
 */
export function groupPermissionsBySection(permissions: readonly RolePermissionEntry[]): PermissionSection[] {
  const byModule = new Map<string, RolePermissionEntry[]>();
  for (const p of permissions) {
    const list = byModule.get(p.module) ?? [];
    list.push(p);
    byModule.set(p.module, list);
  }

  const sections: PermissionSection[] = [];
  const seenModules = new Set<string>();

  for (const section of SECTIONS) {
    const groups: ModuleGroup[] = [];
    for (const module of section.modules) {
      const entries = byModule.get(module);
      if (!entries) continue;
      groups.push(toModuleGroup(module, entries));
      seenModules.add(module);
    }
    if (groups.length === 0) continue;
    sections.push({ sectionLabel: groups.length > 1 ? section.label : null, groups });
  }

  // Module có trong dữ liệu nhưng chưa kịp xếp vào SECTIONS ở trên (permission mới thêm sau) —
  // vẫn hiển thị, không âm thầm mất hàng, chỉ không có tiêu đề nhóm.
  const leftoverModules = [...byModule.keys()].filter((m) => !seenModules.has(m)).sort();
  for (const module of leftoverModules) {
    sections.push({ sectionLabel: null, groups: [toModuleGroup(module, byModule.get(module)!)] });
  }

  return sections;
}