import type { ReactNode } from 'react';

/**
 * Boxed Section Form Pattern (`.claude/docs/ui-guidelines.md` mục 9b) — khối viền + badge nổi,
 * dùng để chia nhóm trường trong form nhiều trường. Trích xuất dùng chung khi phát hiện trùng lặp
 * lần 3 (`WorkShiftFormModal.tsx`, `BusinessCodeTemplateFormModal.tsx`, `CashVoucherFormDialog.tsx`
 * đều tự khai 2 hằng số className giống hệt nhau) — theo CLAUDE.md "trùng lặp lần thứ hai là dấu
 * hiệu phải trích xuất ra dùng chung".
 */
export function BoxedSection({ badge, className, children }: { badge: string; className?: string; children: ReactNode }) {
  return (
    <div className={`relative rounded-lg border border-slate-200 p-6 pt-8 ${className ?? ''}`}>
      <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">{badge}</span>
      {children}
    </div>
  );
}
