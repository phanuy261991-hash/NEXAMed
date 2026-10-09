import { useEffect, useRef, useState } from 'react';
import { Columns } from '@phosphor-icons/react';

export interface ColumnVisibilityOption {
  key: string;
  label: string;
  /** Tiêu đề nhóm ("Lâm sàng", "Chi phí"...) — các lựa chọn cùng `group` xếp liền nhau. */
  group?: string;
}

/**
 * Nút "Cột hiển thị" + hộp chọn cột bằng ô tích (docs/DECISIONS.md #223). Chỉ lo giao diện: nhận danh sách cột tuỳ chọn, tập đang hiện và hai hàm `onToggle`/`onShowAll`
 * (kết hợp `useColumnVisibility`). `hint` là dòng giải thích ở đầu hộp (ví dụ liệt kê các cột cố định luôn hiện). Đóng bằng bấm ra ngoài hoặc phím Esc.
 */
export function ColumnVisibilityMenu({
  idPrefix,
  options,
  visible,
  onToggle,
  onShowAll,
  hint,
  footnote,
}: {
  idPrefix: string;
  options: readonly ColumnVisibilityOption[];
  visible: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onShowAll: () => void;
  hint?: string;
  footnote?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (options.length === 0) return null;
  const shown = options.filter((o) => visible.has(o.key)).length;
  const groups = [...new Set(options.map((o) => o.group ?? ''))];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <Columns size={15} weight="bold" aria-hidden="true" />
        Cột hiển thị
        <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600">
          {shown}/{options.length}
        </span>
      </button>
      {open && (
        <div role="dialog" aria-label="Chọn cột hiển thị" className="absolute right-0 top-full z-40 mt-1.5 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          {hint && <p className="mb-2 text-xs font-medium text-slate-500">{hint}</p>}
          {groups.map((group) => (
            <div key={group} className="mb-2">
              {group && <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">{group}</div>}
              {options
                .filter((o) => (o.group ?? '') === group)
                .map((o) => (
                  <label key={o.key} htmlFor={`${idPrefix}-${o.key}`} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
                    <input id={`${idPrefix}-${o.key}`} type="checkbox" className="h-4 w-4 accent-blue-600" checked={visible.has(o.key)} onChange={() => onToggle(o.key)} />
                    {o.label}
                  </label>
                ))}
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <button type="button" onClick={onShowAll} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
              Hiện tất cả
            </button>
            {footnote && <span className="text-[11px] text-slate-400">{footnote}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
