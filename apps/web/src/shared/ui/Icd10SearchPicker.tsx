import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { useIcd10SearchQuery } from '../../features/catalog-clinical/icd10.queries';

const GENDER_LABEL: Record<string, string> = { male: 'Chỉ nam', female: 'Chỉ nữ' };
const USAGE_LABEL: Record<string, string> = {
  limited_primary: 'Hạn chế dùng làm bệnh chính',
  not_primary: 'Không dùng làm bệnh chính',
};

export interface Icd10SearchPickerHandle {
  /** Điền sẵn nội dung tìm + đưa focus vào ô — dùng khi nơi khác (khối gợi ý từ ô Chẩn đoán) muốn chuyển sang tìm thủ công. */
  search: (text: string) => void;
}

/**
 * Ô tìm nhanh chọn mã ICD-10 — dùng chung (chuyển từ `features/encounter/Icd10DiagnosisPicker.tsx`
 * sang `shared/ui` khi có thêm 2 nơi dùng: chip "Tiền sử bản thân" + hàng ma trận "Tiền sử gia
 * đình", Sprint 5 — đúng quy tắc "trùng lặp lần 2 mới trích xuất" CLAUDE.md). Tái dùng
 * `useIcd10SearchQuery` (query hook thuần, không phải domain logic backend — chấp nhận import
 * cross-feature) từ `catalog-clinical`, kết quả hiện thành danh sách bên dưới ô nhập (cùng mẫu
 * `PatientPicker.tsx`, không dùng dropdown overlay tuyệt đối — tránh phải tự xử lý click-outside).
 */
export const Icd10SearchPicker = forwardRef<Icd10SearchPickerHandle, {
  /** Mã đã chọn rồi — ẩn khỏi kết quả để không chọn trùng. */
  excludeCodes: string[];
  onSelect: (item: { icd10Code: string; icd10Name: string }) => void;
  placeholder?: string;
  /**
   * Ô NỔI BẬT cho trường bắt buộc chính của màn hình (ví dụ "Chẩn đoán bệnh" ở màn khám) — ô cao hơn, viền
   * đậm màu thương hiệu, icon/chữ lớn hơn; danh sách kết quả giữ nguyên. Mặc định `false`: các nơi dùng
   * phụ (chip "Tiền sử bản thân", ma trận "Tiền sử gia đình") giữ ô gọn như cũ.
   */
  prominent?: boolean;
}>(function Icd10SearchPicker({ excludeCodes, onSelect, placeholder = 'Gõ mã ICD-10 hoặc tên bệnh (VD: E11, Tăng huyết áp...)', prominent = false }, ref) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      search: (text: string) => {
        setQuery(text);
        inputRef.current?.focus();
      },
    }),
    [],
  );
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
          size={prominent ? 20 : 15}
          weight={prominent ? 'bold' : 'regular'}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${prominent ? 'left-3.5 text-blue-600' : 'left-2.5 text-slate-400'}`}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className={
            prominent
              ? 'w-full rounded-lg border-2 border-blue-300 bg-white py-3 pl-11 pr-4 text-base font-medium text-slate-900 shadow-sm placeholder:font-normal placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-500/15'
              : 'w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20'
          }
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
});
