import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import type { ComboboxOption } from './Combobox';

/**
 * Dropdown chọn NHIỀU giá trị (khác `Combobox` — chọn đúng 1 giá trị, mục 4.1b) — dùng cho các
 * trường bản chất nhiều-chọn (ví dụ Vai trò của một tài khoản, mở rộng ADM-01). Ô đóng hiện danh
 * sách nhãn đã chọn nối bằng dấu phẩy; mở ra là danh sách checkbox, không tự đóng sau mỗi lần
 * chọn (khác `Combobox` đóng ngay sau khi chọn 1 giá trị). Cùng ngôn ngữ thị giác với `Combobox`
 * (viền, mũi tên, panel `top-full`) để đồng nhất toàn app.
 */
export function MultiSelectCombobox({
  id,
  values,
  options,
  onChange,
  disabled = false,
  placeholder = 'Chọn...',
}: {
  id: string;
  values: string[];
  options: ComboboxOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabels = useMemo(
    () => options.filter((o) => values.includes(o.value)).map((o) => o.label),
    [options, values],
  );

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

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md border border-slate-300 py-2 pl-3 pr-9 text-left text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
      >
        <span className={`truncate ${selectedLabels.length === 0 ? 'font-normal text-slate-400' : ''}`}>
          {selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder}
        </span>
      </button>

      <div className="pointer-events-none absolute right-0 top-0 flex h-full w-8 items-center justify-center text-slate-400">
        <CaretDown size={13} weight="bold" className={`transition-transform duration-150 ${open ? 'rotate-180 text-blue-600' : ''}`} />
      </div>

      {open && (
        <ul
          role="listbox"
          aria-multiselectable="true"
          style={{ maxHeight: 220 }}
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-y-auto rounded-md border border-slate-300 bg-white py-1 shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">Không có lựa chọn nào</li>
          ) : (
            options.map((opt) => {
              const checked = values.includes(opt.value);
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(opt.value)}
                  className={`flex h-9 cursor-pointer items-center gap-2 px-3 text-sm ${checked ? 'bg-blue-50 text-blue-700' : 'text-slate-900'}`}
                >
                  <input type="checkbox" checked={checked} readOnly className="pointer-events-none" />
                  {opt.label}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}