import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DotsThree } from '@phosphor-icons/react';
import { Button } from './Button';

export interface RowActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Dòng chú thích nhỏ dưới nhãn (ví dụ điều kiện áp dụng, hoặc lý do mục đang bị khoá). */
  description?: string;
  onClick: () => void;
  /** Hành động cảnh báo (huỷ/trả lại...) — chữ đỏ. */
  danger?: boolean;
  /** Khoá mục (vẫn hiện để người dùng biết có tồn tại, kèm `description` giải thích). */
  disabled?: boolean;
}

const MENU_WIDTH = 300;
const MENU_GAP = 6;

/**
 * Menu "⋯" cho MỘT DÒNG bảng (mockup 13d "Thao tác khác"). Khác `ActionMenu` (nút có nhãn + mũi tên, xổ tại chỗ): bảng dữ liệu nằm trong vùng cuộn (`overflow-auto`) nên menu xổ tại chỗ bị
 * cắt ở các dòng cuối — menu này vẽ qua portal, định vị `fixed` theo nút bấm, tự lật lên trên khi sát đáy màn hình, đóng khi bấm ra ngoài / Esc / cuộn / đổi cỡ cửa sổ.
 */
export function RowActionMenu({ label, items }: { label: string; items: RowActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonWrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonWrapRef.current) return;
    const rect = buttonWrapRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 130;
    const fitsBelow = rect.bottom + MENU_GAP + menuHeight <= window.innerHeight - 8;
    const top = fitsBelow ? rect.bottom + MENU_GAP : Math.max(8, rect.top - MENU_GAP - menuHeight);
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setPosition({ top, left });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonWrapRef.current?.contains(target)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <span ref={buttonWrapRef} className="inline-flex">
        <Button type="button" variant="secondary" className="flex-shrink-0 px-2.5" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <DotsThree size={16} weight="bold" aria-hidden="true" />
        </Button>
      </span>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[70] rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
            style={{ width: MENU_WIDTH, top: position?.top ?? -9999, left: position?.left ?? -9999 }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.danger ? 'text-rose-700 enabled:hover:bg-rose-50' : 'text-slate-700 enabled:hover:bg-slate-50'
                }`}
              >
                {item.icon && <span className="mt-0.5 flex-none">{item.icon}</span>}
                <span className="min-w-0">
                  {item.label}
                  {item.description && <span className="mt-0.5 block text-xs font-normal text-slate-500">{item.description}</span>}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
