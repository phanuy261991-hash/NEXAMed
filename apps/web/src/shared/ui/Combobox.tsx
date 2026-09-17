import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';

export interface ComboboxOption {
  value: string;
  label: string;
  /**
   * Icon nhỏ đứng trước `label` (ví dụ cờ quốc gia cho Đơn vị tiền tệ, `ClinicInfoPane.tsx`) —
   * tuỳ chọn, không ảnh hưởng các Combobox khác không truyền field này. Chỉ hiện được ở danh sách
   * xổ xuống VÀ ở ô đã đóng khi có lựa chọn (không hiện lúc đang gõ tìm — ô lúc đó hiện text query
   * thô) — ô input là `<input type="text">` thuần nên icon luôn là 1 phần tử `absolute` ĐÈ LÊN,
   * không nhúng được vào bên trong giá trị text của input.
   */
  icon?: ReactNode;
}

/**
 * Hồ sơ cũ lưu giá trị tự do (trước khi trường đổi sang danh mục cố định) hoặc mục danh mục đã bị
 * ẩn/xoá sau khi hồ sơ đã lưu — giá trị đó sẽ không khớp `value` nào trong `options` hiện tại.
 * Chèn thêm 1 option giữ nguyên giá trị cũ (label = value = giá trị cũ) để không mất dữ liệu/
 * không tự xoá khi mở form sửa. Dùng chung cho mọi Combobox theo mã (ethnicity/nationality —
 * docs/DECISIONS.md #037, province/ward — #038), tách ra sau khi lặp lại lần thứ hai theo
 * CLAUDE.md.
 */
export function withLegacyValueOption(options: ComboboxOption[], currentValue: string): ComboboxOption[] {
  if (currentValue === '' || options.some((o) => o.value === currentValue)) {
    return options;
  }
  return [{ value: currentValue, label: currentValue }, ...options];
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
  allowCreate = false,
  onCreateOption,
  className = '',
}: {
  id: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
  /**
   * "Thêm nhanh" (mở rộng #151, chủ dự án yêu cầu trực tiếp) — khi gõ không khớp CHÍNH XÁC (không
   * phân biệt hoa/thường) tên bất kỳ mục nào, hiện thêm dòng "+ Thêm mới: '...'" ở cuối danh sách.
   * Bấm/Enter vào dòng đó gọi `onCreateOption` (bắt buộc kèm `allowCreate`) rồi tự chọn luôn mục
   * vừa tạo. Mặc định `false` — không đổi hành vi ~20+ nơi đang dùng `Combobox` hiện có.
   */
  allowCreate?: boolean;
  onCreateOption?: (name: string) => Promise<ComboboxOption>;
  /** Tuỳ chỉnh bề rộng/khoảng cách container (ví dụ `min-w-[220px]`) — component tự chiếm `w-full`
   * bên trong, dùng khi nơi gọi không đủ ép rộng qua wrapper cha (thay `<select>` cần `min-width`). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [creating, setCreating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const selected = options.find((o) => o.value === value) ?? null;

  const [createError, setCreateError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  const trimmedQuery = query.trim();
  const showCreateRow = allowCreate && trimmedQuery !== '' && !options.some((o) => o.label.toLowerCase() === trimmedQuery.toLowerCase());
  const totalRows = filtered.length + (showCreateRow ? 1 : 0);

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
    setCreateError(null);
  }

  function selectOption(opt: ComboboxOption) {
    onChange(opt.value);
    closeDropdown();
  }

  async function handleCreate() {
    if (!onCreateOption || creating || trimmedQuery === '') return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await onCreateOption(trimmedQuery);
      onChange(created.value);
      closeDropdown();
    } catch {
      setCreateError('Không tạo được mục mới, thử lại.');
    } finally {
      setCreating(false);
    }
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
      setHighlighted((h) => Math.min(h + 1, totalRows - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted < filtered.length) {
        const opt = filtered[highlighted];
        if (opt) selectOption(opt);
      } else if (showCreateRow) {
        void handleCreate();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    } else if (e.key === 'Tab') {
      closeDropdown();
    }
  }

  // Chỉ hiện icon ở ô ĐÃ ĐÓNG (đang hiện `selected.label`) — lúc mở/đang gõ, input hiện text query
  // thô, gắn icon đè lên sẽ đè cả lên ký tự đầu người dùng đang gõ.
  const showLeadingIcon = !open && Boolean(selected?.icon);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {showLeadingIcon && (
        <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 items-center">
          {selected!.icon}
        </span>
      )}
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
        className={`w-full rounded-md border border-slate-300 py-2 ${showLeadingIcon ? 'pl-8' : 'pl-3'} pr-9 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800`}
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
          {filtered.length === 0 && !showCreateRow ? (
            <li className="px-3 py-2 text-sm text-slate-400">Không tìm thấy</li>
          ) : (
            <>
              {filtered.map((opt, i) => (
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
                  {opt.icon && (
                    <span aria-hidden="true" className="mr-2 flex shrink-0 items-center">
                      {opt.icon}
                    </span>
                  )}
                  {opt.label}
                </li>
              ))}
              {showCreateRow && (
                <li
                  ref={(el) => {
                    itemRefs.current[filtered.length] = el;
                  }}
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleCreate();
                  }}
                  onMouseEnter={() => setHighlighted(filtered.length)}
                  className={`flex h-9 cursor-pointer items-center gap-1.5 border-t border-slate-100 px-3 text-sm font-semibold ${
                    filtered.length === highlighted ? 'bg-blue-50 text-blue-700' : 'text-blue-600'
                  }`}
                >
                  {creating ? 'Đang thêm...' : `+ Thêm mới: "${trimmedQuery}"`}
                </li>
              )}
            </>
          )}
          {createError && <li className="px-3 py-1.5 text-xs font-medium text-rose-600">{createError}</li>}
        </ul>
      )}
    </div>
  );
}
