import { useEffect, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { useDrugsQuery } from '../drug/drug.queries';
import type { ConsumptionPickItem } from './consumption-model';

/**
 * Ô tìm chọn vật tư/thuốc cho định mức và ghi tiêu hao (#297 GĐ4). Khác ô chọn của màn Kê đơn: KHÔNG lọc `sellableOnly` — hàng "Chỉ dùng nội bộ"
 * (không bán) vẫn dùng làm vật tư tiêu hao. Enter chọn kết quả đang tô sáng và KHÔNG gửi form chứa nó (ui-guidelines mục 4.4).
 */
export function ConsumptionItemPicker({
  id,
  excludeDrugIds,
  onPick,
  disabled,
  label,
  placeholder = 'Gõ tên hoặc mã vật tư / thuốc để thêm',
}: {
  id: string;
  /** Mặt hàng đã có dòng — ẩn khỏi kết quả để không chọn trùng. */
  excludeDrugIds: string[];
  onPick: (item: ConsumptionPickItem) => void;
  disabled?: boolean;
  /** Nhãn ẩn cho trình đọc màn hình. */
  label: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query, 300);
  // Kết quả chỉ ứng với từ khoá đã ổn định: lúc đang gõ (từ khoá chưa kịp truyền sang máy chủ) KHÔNG cho Enter chọn nhầm kết quả của từ khoá trước.
  const settled = query === debounced;
  const searching = debounced.trim() !== '';
  const search = useDrugsQuery({ q: debounced.trim() || undefined });
  const results = searching ? (search.data?.items ?? []).filter((d) => !excludeDrugIds.includes(d.id)).slice(0, 8) : [];

  useEffect(() => {
    setActive(0);
  }, [debounced, search.dataUpdatedAt]);

  function choose(index: number) {
    const d = results[index];
    if (!d) return;
    onPick({ id: d.id, code: d.code, name: d.name, itemType: d.itemType, baseUnitCode: d.baseUnitCode });
    setQuery('');
    setActive(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // Luôn chặn: Enter trong form chứa ô này không được lưu cả form.
      e.preventDefault();
      if (settled) choose(active);
    } else if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  }

  return (
    <div className="relative">
      <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        id={id}
        type="search"
        aria-label={label}
        disabled={disabled}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
      />
      {searching && settled && search.isError && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1">
          <ErrorBanner message="Không tải được danh sách vật tư / thuốc. Kiểm tra kết nối rồi gõ lại." />
        </div>
      )}
      {searching && settled && !search.isError && !search.isFetching && (
        <ul role="listbox" aria-label="Kết quả tìm vật tư / thuốc" className="scroll-hover absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Không tìm thấy, hoặc đã có trong danh sách.</li>}
          {results.map((d, index) => (
            <li key={d.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onClick={() => choose(index)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${index === active ? 'bg-brand-teal-tint' : 'hover:bg-slate-50'}`}
              >
                <span className="min-w-0 truncate font-semibold text-slate-900">{d.name}</span>
                <span className="flex-none text-xs font-semibold text-slate-500">
                  {d.code} · {d.itemType === 'SUPPLY' ? 'Vật tư' : 'Thuốc'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
