import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CaretDown } from '@phosphor-icons/react';

export interface ComboboxOption {
  value: string;
  label: string;
}

const ROW_HEIGHT_PX = 36;
const VISIBLE_ROWS = 5;

/**
 * Dropdown tìm kiếm được (gõ để lọc), thay cho `<select>` thuần khi danh sách dài (ví dụ danh mục
 * Dân tộc/Quốc tịch — 54/30 mục, mũi tên xổ xuống mặc định của trình duyệt xấu và có thể xổ lên
 * nếu gần cuối màn hình). Luôn mở panel BÊN DƯỚI (`top-full`), giới hạn cao ~5 dòng rồi cuộn.
 * Đặt ở `shared/ui` với chủ đích tái dùng ngay — cần cùng lúc ở cả Dân tộc lẫn Quốc tịch.
 */
export function Combobox({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Gõ để tìm...',
  required = false,
}: {
  id: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  useEffect(() => {
    itemRefs.current[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function openDropdown() {
    if (disabled) return;
    setOpen(true);
    setQuery('');
  }

  function closeDropdown() {
    setOpen(false);
    setQuery('');
  }

  function selectOption(opt: ComboboxOption) {
    onChange(opt.value);
    closeDropdown();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlighted];
      if (opt) selectOption(opt);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    } else if (e.key === 'Tab') {
      closeDropdown();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        required={required}
        disabled={disabled}
        placeholder={open ? placeholder : undefined}
        value={open ? query : (selected?.label ?? '')}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md border border-slate-300 py-2 pl-3 pr-9 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-500"
      />

      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => (open ? closeDropdown() : (openDropdown(), containerRef.current?.querySelector('input')?.focus()))}
        aria-hidden="true"
        className="absolute right-0 top-0 flex h-full w-8 items-center justify-center rounded-r-md text-slate-400 transition-colors hover:text-blue-600 disabled:opacity-50"
      >
        <CaretDown size={13} weight="bold" className={`transition-transform duration-150 ${open ? 'rotate-180 text-blue-600' : ''}`} />
      </button>

      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          style={{ maxHeight: ROW_HEIGHT_PX * VISIBLE_ROWS + 8 }}
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-y-auto rounded-md border border-slate-300 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">Không tìm thấy</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt.value}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="option"
                aria-selected={opt.value === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(opt);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex h-9 cursor-pointer items-center px-3 text-sm ${
                  i === highlighted ? 'bg-blue-50 text-blue-700' : 'text-slate-900'
                } ${opt.value === value ? 'font-semibold' : ''}`}
              >
                {opt.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
