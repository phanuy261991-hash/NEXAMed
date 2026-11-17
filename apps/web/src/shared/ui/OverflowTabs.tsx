import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { layoutOverflowTabs } from './overflow-tabs-layout';

export interface OverflowTabItem<T extends string = string> {
  id: T;
  /** Tên đầy đủ: hiện trong menu "Thêm", `title` và tên truy cập của nút. */
  label: string;
  /** Nhãn rút ngắn hiện trên thanh; bỏ trống thì dùng `label`. */
  shortLabel?: string;
  icon?: Icon;
  /** Chấm số cạnh nhãn, chỉ hiện khi > 0. */
  badge?: number;
  badgeTone?: 'blue' | 'green';
  /** Càng nhỏ càng ở lại thanh lâu khi chật. */
  priority: number;
  /** Phần phụ sau nhãn (ví dụ dấu "đã có chẩn đoán"). */
  trailing?: (active: boolean) => ReactNode;
}

const GAP = 6;

/**
 * Thanh tab KHÔNG cuộn ngang (docs/DECISIONS.md #300, mockup Cách 2): hiện vừa đủ theo bề rộng thật, phần còn lại vào nút "Thêm ▾".
 * Tab đang chọn luôn hiện trên thanh; chấm xanh cạnh "Thêm" khi trong menu có tab đang có số. Thêm tab mới chỉ cần khai báo `priority`.
 * Đo bề rộng bằng bản sao ẩn của chính các nút nên khớp kiểu chữ và icon theo cỡ màn hình.
 */
export function OverflowTabs<T extends string>({
  tabs,
  active,
  onChange,
  moreLabel = 'Thêm',
  className = '',
  ariaLabel,
}: {
  tabs: OverflowTabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  moreLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreWrapRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [moreWidth, setMoreWidth] = useState(0);
  const [open, setOpen] = useState(false);

  const signature = tabs.map((t) => `${t.id}|${t.shortLabel ?? t.label}|${t.badge ?? 0}|${t.trailing ? 1 : 0}`).join(';');

  const measure = useCallback(() => {
    const box = measureRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const next: Record<string, number> = {};
    box.querySelectorAll<HTMLElement>('[data-measure-id]').forEach((el) => {
      next[el.dataset.measureId as string] = el.offsetWidth;
    });
    setWidths((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const more = box.querySelector<HTMLElement>('[data-measure-more]');
    if (more) setMoreWidth(more.offsetWidth);
    setAvailable(inner.clientWidth);
  }, []);

  // Đo trước khi vẽ lên màn hình để không nháy; đo lại khi nội dung tab đổi và khi vùng chứa đổi cỡ.
  useLayoutEffect(() => {
    measure();
  }, [measure, signature]);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(inner);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (moreWrapRef.current && !moreWrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const byId = useMemo(() => new Map<string, OverflowTabItem<T>>(tabs.map((t) => [t.id, t])), [tabs]);
  const layout = useMemo(
    () =>
      layoutOverflowTabs({
        ids: tabs.map((t) => t.id),
        priorityIds: [...tabs].sort((a, b) => a.priority - b.priority).map((t) => t.id),
        widths,
        moreWidth,
        available,
        gap: GAP,
        activeId: active,
      }),
    [tabs, widths, moreWidth, available, active],
  );

  // Hết chỗ thừa thì đóng menu (tránh menu rỗng).
  useEffect(() => {
    if (layout.overflow.length === 0) setOpen(false);
  }, [layout.overflow.length]);

  const overflowHasBadge = layout.overflow.some((id) => (byId.get(id)?.badge ?? 0) > 0);

  const tabButton = (t: OverflowTabItem<T>, isActive: boolean, measuring: boolean) => {
    const text = t.shortLabel ?? t.label;
    return (
      <button
        key={t.id}
        type="button"
        data-measure-id={measuring ? t.id : undefined}
        tabIndex={measuring ? -1 : undefined}
        onClick={measuring ? undefined : () => onChange(t.id)}
        aria-current={!measuring && isActive ? 'true' : undefined}
        aria-label={!measuring && text !== t.label ? t.label : undefined}
        title={!measuring && text !== t.label ? t.label : undefined}
        className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition-colors min-[1440px]:px-3.5 ${
          isActive ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
        }`}
      >
        {t.icon && <t.icon size={15} weight={isActive ? 'fill' : 'bold'} aria-hidden="true" className="hidden min-[1440px]:block" />}
        {text}
        {t.badge !== undefined && t.badge > 0 && (
          <span
            className={`rounded-full px-1.5 text-[10.5px] font-semibold ${
              isActive ? (t.badgeTone === 'green' ? 'bg-white text-emerald-700' : 'bg-white text-blue-700') : t.badgeTone === 'green' ? 'bg-emerald-500 text-white' : 'bg-blue-600 text-white'
            }`}
          >
            {t.badge}
          </span>
        )}
        {t.trailing?.(isActive)}
      </button>
    );
  };

  const moreButtonInner = (
    <>
      {moreLabel}
      <CaretDown size={12} weight="bold" aria-hidden="true" />
    </>
  );

  return (
    <div className={`relative flex h-11 flex-shrink-0 items-center border-b border-slate-200 bg-white px-4 ${className}`}>
      <div ref={innerRef} className="relative flex min-w-0 flex-1 items-center" style={{ gap: GAP }} role="tablist" aria-label={ariaLabel}>
        {layout.visible.map((id) => tabButton(byId.get(id) as OverflowTabItem<T>, id === active, false))}
        {layout.overflow.length > 0 && (
          <div ref={moreWrapRef} className="relative ml-auto flex-shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            >
              {moreButtonInner}
              {overflowHasBadge && <span className="h-2 w-2 rounded-full bg-blue-600" aria-label="Có mục đang có số" />}
            </button>
            {open && (
              <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 shadow-md">
                {layout.overflow.map((id) => {
                  const t = byId.get(id) as OverflowTabItem<T>;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        onChange(t.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {t.label}
                      {t.badge !== undefined && t.badge > 0 && (
                        <span className={`ml-auto rounded-full px-1.5 text-[10.5px] font-semibold text-white ${t.badgeTone === 'green' ? 'bg-emerald-500' : 'bg-blue-600'}`}>{t.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* Bản sao ẩn để đo bề rộng thật của từng nút (cùng lớp CSS nên theo đúng cỡ chữ/icon của màn hình). Bọc trong khung 0×0 có overflow-hidden để không làm rộng trang. */}
        <div aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
          <div ref={measureRef} className="flex w-max" style={{ gap: GAP }}>
            {tabs.map((t) => tabButton(t, false, true))}
            <span data-measure-more className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold">
              {moreButtonInner}
              <span className="h-2 w-2" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
