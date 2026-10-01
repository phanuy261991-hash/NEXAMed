import { Warning } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import type { MissingCompanion } from './companion-hints';

/**
 * Khung gợi ý "quyền đi kèm" dưới ma trận (docs/DECISIONS.md #208): vai trò đang được cấp quyền cần thêm quyền ĐỌC
 * danh mục/kho/quỹ... để trang hiển thị đủ — thiếu thì trang vẫn mở được nhưng một số ô chọn/bảng báo không có quyền.
 * Chỉ gợi ý: quản trị viên vẫn tự quyết, "Cấp kèm" chỉ đặt các ô đó về "Toàn bộ" trong thay đổi chờ lưu (chưa ghi gì).
 * Phong cách: vạch trái amber + bảng gạch phân cách, không xếp thẻ (`.claude/docs/ui-guidelines.md`).
 */
export function CompanionHint({ missing, disabled, onGrant }: { missing: readonly MissingCompanion[]; disabled: boolean; onGrant: () => void }) {
  if (missing.length === 0) return null;
  return (
    <div className="flex-shrink-0 border-t border-slate-200 border-l-4 border-l-amber-500 bg-amber-50/60 px-4 py-3" role="status">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Warning size={16} weight="fill" className="flex-shrink-0 text-amber-600" aria-hidden="true" />
            Thiếu {missing.length} quyền đi kèm
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Các trang của quyền đã cấp cần thêm quyền xem dưới đây để hiển thị đủ ô chọn/bảng; thiếu thì trang vẫn mở nhưng một số phần báo không có quyền.
          </p>
        </div>
        <Button type="button" variant="amberSolid" className="flex-shrink-0 px-3 py-1.5" disabled={disabled} onClick={onGrant}>
          Cấp kèm ({missing.length})
        </Button>
      </div>
      <ul className="scroll-hover mt-2 max-h-40 divide-y divide-amber-200/70 border-t border-amber-200/70 text-sm">
        {missing.map((m) => (
          <li key={m.permissionId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
            <span className="font-semibold text-slate-900">{m.label}</span>
            <span className="text-xs text-slate-600">cần cho: {m.neededBy.join(', ')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
