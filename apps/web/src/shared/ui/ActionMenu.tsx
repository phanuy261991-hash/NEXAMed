import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { Button } from './Button';

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Hành động cảnh báo (huỷ/dừng...) — chữ đỏ, không dùng cho hành động thường. */
  danger?: boolean;
}

/**
 * Nút gộp nhiều hành động phụ thành 1 menu xổ ra — `.claude/docs/ui-guidelines.md` mục 4.5 (chốt
 * 2026-08-27, #082): "≤3 nút xếp ngang, >3 nút gộp menu". Cùng khuôn dropdown đã dùng ở
 * `TopBar.tsx` (avatar → "Đăng xuất") — trích xuất dùng chung ở lần dùng thứ hai (thanh hành động
 * màn khám, gộp "Trả về hàng chờ"/"Hủy khám" vào nút "Xử lý").
 */
export function ActionMenu({
  label,
  items,
  align = 'right',
  openDirection = 'down',
}: {
  label: string;
  items: ActionMenuItem[];
  align?: 'left' | 'right';
  /** `up` — dùng khi nút nằm sát đáy màn hình (thanh hành động cố định) để menu không tràn khỏi viewport. */
  openDirection?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </Button>

      {open && (
        <div
          role="menu"
          className={`absolute z-20 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-md ${align === 'right' ? 'right-0' : 'left-0'} ${
            openDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm font-medium ${
                item.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}