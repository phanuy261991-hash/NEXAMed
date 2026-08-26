import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
import type { ComboboxOption } from './Combobox';

const ROW_HEIGHT_PX = 36;
const VISIBLE_ROWS = 5;

/**
 * Dropdown chọn 1 giá trị cho danh sách DÀI (chốt 2026-08-26, mockup duyệt trước khi code) — khác
 * `Combobox` (mục 4.1b) ở chỗ ô đóng chỉ là NÚT hiện nhãn đã chọn (không gõ trực tiếp vào ô được),
 * mở ra mới có ô tìm kiếm RIÊNG nằm trong panel. Dùng khi danh mục có thể lên tới hàng trăm mục
 * (ví dụ "Đơn vị tính") và cần tách bạch rõ "đang xem giá trị đã chọn" khỏi "đang gõ tìm" — với
 * `Combobox` gốc, ô hiện chuỗi tìm NGAY LÚC gõ nên với danh sách rất dài dễ mất dấu giá trị đã chọn
 * trước đó. Vẫn cùng ngôn ngữ thị giác (viền, mũi tên, panel `top-full`) để đồng nhất toàn app.
 */
export function SearchableCombobox({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Chọn...',
  searchPlaceholder = 'Nhập từ khoá tìm kiếm...',
}: {
  id: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function openDropdown() {
    if (disabled) return;
    setQuery('');
    setOpen(true);
    // Panel vừa mount xong mới focus được — cùng khung 1 tick như `PatientHistoryDialog` đã làm
    // cho các panel mở-là-focus khác trong dự án.
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function selectOption(opt: ComboboxOption) {
    onChange(opt.value);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 py-2 pl-3 pr-9 text-left text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800"
      >
        <span className={`truncate ${selected ? '' : 'font-normal text-slate-400'}`}>{selected ? selected.label : placeholder}</span>
      </button>

      <div className="pointer-events-none absolute right-0 top-0 flex h-full w-8 items-center justify-center text-slate-400">
        <CaretDown size={13} weight="bold" className={`transition-transform duration-150 ${open ? 'rotate-180 text-blue-600' : ''}`} />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-slate-300 bg-white shadow-lg">
          <div className="relative border-b border-slate-200">
            <MagnifyingGlass size={14} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full py-2 pl-8 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <ul role="listbox" style={{ maxHeight: ROW_HEIGHT_PX * VISIBLE_ROWS }} className="scroll-hover overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-400">Không tìm thấy</li>
            ) : (
              filtered.map((opt) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                  className={`flex h-9 cursor-pointer items-center px-3 text-sm ${
                    opt.value === value ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}