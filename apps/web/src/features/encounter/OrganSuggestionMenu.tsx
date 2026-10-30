import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppConfig } from '../../app/AppConfigProvider';
import { Button } from '../../shared/ui/Button';
import { useColumnVisibility } from '../../shared/hooks/useColumnVisibility';
import { useAuthStore } from '../auth/auth.store';
import { ORGAN_KEYS, ORGAN_SYSTEMS, organsPresent } from './organ-suggestions';

/**
 * Nút "Gợi ý theo cơ quan" + hộp chọn cơ quan (mockup đã chốt https://claude.ai/artifact/R6oTbDuS7fczynmib7V5BT, 30/10/2026). Chỉ lo giao diện: nhận nội dung ô hiện tại để làm mờ cơ quan đã có,
 * và gọi `onInsert(keys)` khi bác sĩ bấm "Chèn vào ô" — việc chèn chữ do nơi gọi làm (xem `insertOrganHeadings`). Bác sĩ ẩn/hiện từng cơ quan theo nhu cầu (10 mục hơi dài), lựa chọn nhớ
 * theo tài khoản trên máy đang dùng (localStorage, chỉ là tiện ích cá nhân). Đóng bằng bấm ra ngoài hoặc phím Esc.
 */
export function OrganSuggestionMenu({ idPrefix, text, onInsert }: { idPrefix: string; text: string; onInsert: (keys: string[]) => void }) {
  const { tenantId } = useAppConfig();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const visibility = useColumnVisibility(`nexamed:organ-suggestions:v1:${tenantId}:${userId}`, ORGAN_KEYS);
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const present = useMemo(() => (open ? organsPresent(text) : new Set<string>()), [open, text]);
  const shownOrgans = ORGAN_SYSTEMS.filter((o) => visibility.visible.has(o.key));
  const pickable = [...selected].filter((k) => visibility.visible.has(k) && !present.has(k));

  function close() {
    setOpen(false);
    setCustomizing(false);
    setSelected(new Set());
  }

  function toggleSelected(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  }

  function insert() {
    if (pickable.length === 0) return;
    onInsert(pickable);
    close();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="text-[13px] font-semibold text-blue-600 hover:text-blue-700 hover:underline"
      >
        Gợi ý theo cơ quan
      </button>
      {open && (
        <div role="dialog" aria-label="Chọn cơ quan cần khám" className="absolute right-0 top-full z-40 mt-1.5 w-[460px] max-w-[88vw] rounded-lg border border-slate-300 bg-white p-3.5 shadow-lg">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900">{customizing ? 'Ẩn/hiện cơ quan trong danh sách' : 'Chọn cơ quan cần khám'}</h4>
            <button type="button" onClick={() => setCustomizing((v) => !v)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline">
              {customizing ? 'Xong' : 'Ẩn/hiện cơ quan'}
            </button>
          </div>

          {customizing ? (
            <div className="flex flex-col gap-1">
              {ORGAN_SYSTEMS.map((o) => (
                <label key={o.key} htmlFor={`${idPrefix}-show-${o.key}`} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
                  <input id={`${idPrefix}-show-${o.key}`} type="checkbox" className="h-4 w-4 accent-blue-600" checked={visibility.visible.has(o.key)} onChange={() => visibility.toggle(o.key)} />
                  {o.label}
                </label>
              ))}
              <div className="mt-1 border-t border-slate-100 pt-2">
                <button type="button" onClick={visibility.showAll} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                  Hiện tất cả
                </button>
              </div>
            </div>
          ) : shownOrgans.length === 0 ? (
            <p className="py-2 text-sm font-medium text-slate-600">Đang ẩn hết cơ quan. Bấm "Ẩn/hiện cơ quan" để bật lại.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {shownOrgans.map((o) => {
                const used = present.has(o.key);
                const on = selected.has(o.key);
                return (
                  <label
                    key={o.key}
                    htmlFor={`${idPrefix}-pick-${o.key}`}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] font-semibold ${
                      used ? 'cursor-not-allowed border-dashed border-slate-300 bg-slate-100 text-slate-400' : on ? 'cursor-pointer border-blue-600 bg-blue-50 text-blue-700' : 'cursor-pointer border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <input id={`${idPrefix}-pick-${o.key}`} type="checkbox" className="h-3.5 w-3.5 accent-blue-600" disabled={used} checked={on && !used} onChange={() => toggleSelected(o.key)} />
                    <span className="min-w-0">
                      {o.label}
                      {used && <span className="font-normal"> (đã có trong ô)</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {!customizing && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" disabled={pickable.length === 0} onClick={insert}>
                {pickable.length > 0 ? `Chèn vào ô (${pickable.length})` : 'Chèn vào ô'}
              </Button>
              <Button type="button" variant="secondary" onClick={close}>
                Đóng
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
