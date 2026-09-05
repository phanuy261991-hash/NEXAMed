import { CheckCircle } from '@phosphor-icons/react';

/**
 * Banner xanh thoáng qua báo đã lưu — hiện sau "Lưu và nhập tiếp" (`.claude/docs/ui-guidelines.md`
 * mục 4.7), khi form KHÔNG đóng nên cần tín hiệu tại chỗ thay cho việc modal biến mất như "Lưu"
 * thường. Tự ẩn sau ~2 giây (`useSaveFlash`), không chặn thao tác tiếp theo.
 */
export function SaveFlashBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="status"
      className="mb-3.5 flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"
    >
      <CheckCircle size={16} weight="fill" className="flex-none" aria-hidden="true" />
      Đã lưu — tiếp tục nhập mục mới
    </div>
  );
}
