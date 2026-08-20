import { useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useIcd10SearchQuery } from '../catalog-clinical/icd10.queries';

const GENDER_LABEL: Record<string, string> = { male: 'Chỉ nam', female: 'Chỉ nữ' };
const USAGE_LABEL: Record<string, string> = {
  limited_primary: 'Hạn chế dùng làm bệnh chính',
  not_primary: 'Không dùng làm bệnh chính',
};

/**
 * Ô tìm nhanh chọn chẩn đoán ICD-10 — chưa đủ 2 nơi dùng để tách `shared/ui` (chỉ dùng ở màn khám),
 * đúng quy tắc "trùng lặp lần 2 mới trích xuất". Tái dùng `useIcd10SearchQuery` (query hook thuần,
 * không phải domain logic backend — chấp nhận import cross-feature) từ `catalog-clinical`, kết quả
 * hiện thành danh sách bên dưới ô nhập (cùng mẫu `PatientPicker.tsx`, không dùng dropdown overlay
 * tuyệt đối — tránh phải tự xử lý click-outside).
 */
export function Icd10DiagnosisPicker({
  excludeCodes,
  onSelect,
}: {
  /** Mã đã chọn rồi — ẩn khỏi kết quả để không chọn trùng. */
  excludeCodes: string[];
  onSelect: (item: { icd10Code: string; icd10Name: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);
  const searchQuery = useIcd10SearchQuery(debounced.trim());
  const isSearching = debounced.trim() !== '';

  const results = (searchQuery.data?.items ?? []).filter((item) => !excludeCodes.includes(item.code));

  function handleSelect(code: string, name: string) {
    onSelect({ icd10Code: code, icd10Name: name });
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
          placeholder="Gõ mã ICD-10 hoặc tên bệnh (VD: E11, Tăng huyết áp...)"
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
          {results.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">Không tìm thấy mã ICD-10 nào khớp.</p>}
          {results.map((item) => (
            <button
              key={item.code}
              type="button"
              onClick={() => handleSelect(item.code, item.nameVi)}
              className="rounded-md border border-slate-200 px-3 py-2 text-left hover:border-blue-400 hover:bg-brand-teal-tint"
            >
              <div className="text-sm text-slate-900">
                <span className="font-bold">{item.code}</span> — {item.nameVi}
              </div>
              {(item.genderRestriction || item.usageRestriction) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.genderRestriction && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      {GENDER_LABEL[item.genderRestriction]}
                    </span>
                  )}
                  {item.usageRestriction && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {USAGE_LABEL[item.usageRestriction]}
                    </span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}