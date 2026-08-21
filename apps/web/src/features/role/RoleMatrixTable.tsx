import { Fragment } from 'react';
import type { DataScope, RolePermissionEntry } from '@nexamed/shared';
import { Combobox, type ComboboxOption } from '../../shared/ui/Combobox';
import { groupPermissionsBySection, type ModuleGroup } from './permission-grouping';

const SCOPE_OPTIONS: ComboboxOption[] = [
  { value: 'none', label: 'Không' },
  { value: 'personal', label: 'Cá nhân' },
  { value: 'department', label: 'Khoa/phòng' },
  { value: 'global', label: 'Toàn bộ' },
];

function ScopeCell({
  entry,
  disabled,
  onChange,
  width = 'w-32',
}: {
  entry: RolePermissionEntry | undefined;
  disabled: boolean;
  onChange: (permissionId: string, scope: DataScope) => void;
  width?: string;
}) {
  if (!entry) {
    return (
      <span className="text-sm text-slate-300" title="Tính năng này không có quyền loại này trong hệ thống — không phải ô có thể chọn.">
        —
      </span>
    );
  }
  return (
    <div className={`${width} flex-shrink-0`}>
      <Combobox
        id={`scope-${entry.permissionId}`}
        value={entry.dataScope}
        options={SCOPE_OPTIONS}
        disabled={disabled}
        onChange={(value) => onChange(entry.permissionId, value as DataScope)}
      />
    </div>
  );
}

function ModuleRow({
  group,
  disabled,
  onScopeChange,
}: {
  group: ModuleGroup;
  disabled: boolean;
  onScopeChange: (permissionId: string, scope: DataScope) => void;
}) {
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
      <td className="px-4 py-3 align-middle font-medium text-slate-900">{group.label}</td>
      <td className="px-2 py-3 text-center align-middle">
        <ScopeCell entry={group.read} disabled={disabled} onChange={onScopeChange} />
      </td>
      <td className="px-2 py-3 text-center align-middle">
        <ScopeCell entry={group.create} disabled={disabled} onChange={onScopeChange} />
      </td>
      <td className="px-2 py-3 text-center align-middle">
        <ScopeCell entry={group.update} disabled={disabled} onChange={onScopeChange} />
      </td>
      <td
        className="px-2 py-3 text-center align-middle text-slate-300"
        title="Hệ thống không xoá cứng dữ liệu nghiệp vụ — thao tác gần nghĩa &quot;xoá&quot; (huỷ, gộp, ẩn...) nằm ở cột Đặc quyền mở rộng."
      >
        —
      </td>
      <td className="px-4 py-3 align-middle">
        {group.special.length === 0 ? (
          <span className="text-sm text-slate-300" title="Tính năng này không có đặc quyền mở rộng nào.">
            —
          </span>
        ) : (
          <div className="flex flex-col gap-1.5">
            {group.special.map((entry) => (
              <div key={entry.permissionId} className="flex items-center gap-2">
                <span className="w-32 flex-shrink-0 truncate text-xs font-medium text-slate-600" title={entry.description}>
                  {entry.description}
                </span>
                <ScopeCell entry={entry} disabled={disabled} onChange={onScopeChange} width="w-28" />
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Bảng ma trận quyền của MỘT vai trò — bố cục CRUD (Xem/Thêm/Sửa/Xoá/Đặc quyền mở rộng) theo
 * mockup đã duyệt (ADM-07). `table-fixed` bắt buộc — bảng HTML mặc định (`table-layout: auto`)
 * tự nới rộng cột để vừa nội dung, bỏ qua các class `w-*` khai trên `<th>` — đúng cùng bẫy đã ghi
 * ở `.claude/docs/ui-guidelines.md` mục 9c (bảng CSS Grid) nhưng áp dụng cho `<table>` thật: nếu
 * không khoá `table-fixed`, cột "Đặc quyền mở rộng" (nhiều chip) đẩy cả bảng rộng hơn khung nhìn,
 * cắt cụt các cột bên phải mà không có dấu hiệu cuộn rõ ràng — lỗi thật gặp khi kiểm bằng trình
 * duyệt lần đầu.
 *
 * Hàng được nhóm theo `groupPermissionsBySection` (mockup gộp nhiều module liên quan dưới một
 * tiêu đề chung, ví dụ "Lượt khám"/"Sinh hiệu"/"Chẩn đoán" dưới "Tiếp nhận & Lượt khám") — chỉ
 * hiện tiêu đề nhóm khi nhóm có từ 2 module trở lên, tránh lặp lại đúng tên module 2 lần liền
 * nhau (bug thật gặp ở bản đầu, chỉ có 1 module/nhóm).
 */
export function RoleMatrixTable({
  permissions,
  disabled,
  onScopeChange,
}: {
  permissions: readonly RolePermissionEntry[];
  disabled: boolean;
  onScopeChange: (permissionId: string, scope: DataScope) => void;
}) {
  const sections = groupPermissionsBySection(permissions);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 scroll-hover">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-44" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-12" />
          <col className="w-64" />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="px-4 py-2.5 text-left">Tính năng</th>
            <th className="px-2 py-2.5 text-center">Xem</th>
            <th className="px-2 py-2.5 text-center">Thêm</th>
            <th className="px-2 py-2.5 text-center">Sửa</th>
            <th className="px-2 py-2.5 text-center">Xoá</th>
            <th className="px-4 py-2.5 text-left">Đặc quyền mở rộng</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section, sectionIndex) => (
            <Fragment key={section.sectionLabel ?? `section-${sectionIndex}`}>
              {section.sectionLabel && (
                <tr className="bg-slate-50">
                  <td colSpan={6} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {section.sectionLabel}
                  </td>
                </tr>
              )}
              {section.groups.map((group) => (
                <ModuleRow key={group.module} group={group} disabled={disabled} onScopeChange={onScopeChange} />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}