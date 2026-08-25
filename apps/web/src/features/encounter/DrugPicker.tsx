import { useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDrugsQuery } from '../drug/drug.queries';

/**
 * Ô tìm nhanh chọn thuốc để kê đơn — đúng khuôn `Icd10DiagnosisPicker.tsx` (ô tìm + danh sách kết
 * quả render dưới, không dropdown overlay tuyệt đối). Tái dùng `useDrugsQuery` (đã dùng cho trang
 * quản trị "Danh mục thuốc") — chưa đủ 2 nơi dùng cho RIÊNG component chọn thuốc này để tách
 * `shared/ui`, đúng quy tắc "trùng lặp lần 2 mới trích xuất".
 */
export function DrugPicker({
  excludeDrugIds,
  onSelect,
}: {
  /** Thuốc đã thêm vào đơn rồi — ẩn khỏi kết quả để không chọn trùng. */
  excludeDrugIds: string[];
  onSelect: (item: { drugId: string; drugName: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);
  const isSearching = debounced.trim() !== '';
  const searchQuery = useDrugsQuery({ q: debounced.trim() || undefined });

  const results = (searchQuery.data?.items ?? []).filter((item) => !excludeDrugIds.includes(item.id));

  function handleSelect(id: string, name: string) {
    onSelect({ drugId: id, drugName: name });
    setQuery('');
  }

  return (
    <div>
      <div className="relative">
        <MagnifyingGlass
          size={15}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Gõ tên thuốc, mã hoặc hoạt chất..."
          className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {isSearching && searchQuery.isError && (
        <div className="mt-2">
          <ErrorBanner message="Không tìm được kết quả." onRetry={() => void searchQuery.refetch()} />
        </div>
      )}

      {isSearching && searchQuery.isLoading && (
        <div className="mt-2 space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {isSearching && searchQuery.isSuccess && (
        <div className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto scroll-hover">
          {results.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">Không tìm thấy thuốc nào khớp trong danh mục.</p>}
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id, item.name)}
              className="rounded-md border border-slate-200 px-3 py-2 text-left hover:border-blue-400 hover:bg-brand-teal-tint"
            >
              <div className="text-sm text-slate-900">
                <span className="font-bold">{item.name}</span>
                {item.concentration && <span className="text-slate-500"> · {item.concentration}</span>}
              </div>
              {item.activeIngredient && <div className="mt-0.5 text-xs text-slate-500">Hoạt chất: {item.activeIngredient}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
