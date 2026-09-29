import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useAllowFreeTextPrescriptionEnabledQuery, usePharmacyStockTrackingEnabledQuery } from '../clinic/clinic.queries';
import { useStockOnHandSummaryQuery } from '../inventory/inventory.queries';
import { useDrugsQuery } from '../drug/drug.queries';

/**
 * Ô tìm nhanh chọn thuốc để kê đơn — đúng khuôn `Icd10DiagnosisPicker.tsx` (ô tìm + danh sách kết
 * quả render dưới, không dropdown overlay tuyệt đối). Tái dùng `useDrugsQuery` (đã dùng cho trang
 * quản trị "Danh mục thuốc") — chưa đủ 2 nơi dùng cho RIÊNG component chọn thuốc này để tách
 * `shared/ui`, đúng quy tắc "trùng lặp lần 2 mới trích xuất".
 *
 * Kho Thuốc GĐ5 — mở rộng: tìm KHÔNG DẤU + GÕ TẮT (cả 2 đã xử lý ở backend, `q` chung một tham số),
 * điều hướng bàn phím (↑/↓ duyệt kết quả, Enter chọn, Escape đóng), và badge tồn kho (CHỈ hiện khi
 * tenant bật "Có kho thuốc" — `pharmacyStockTrackingEnabled`, mặc định bật).
 */
export interface DrugPickerHandle {
  /** Đưa focus về ô tìm thuốc — dùng khi Enter ở dòng cuối (Hướng dẫn dùng) của một dòng thuốc
   * trong `PrescriptionPanel.tsx`, đúng phạm vi "điều hướng bàn phím toàn bộ dòng kê đơn". */
  focus: () => void;
}

export const DrugPicker = forwardRef<DrugPickerHandle, {
  /** Thuốc đã thêm vào đơn rồi — ẩn khỏi kết quả để không chọn trùng. */
  excludeDrugIds: (string | null)[];
  onSelect: (item: { drugId: string; drugName: string; unitCode: string | null }) => void;
  /** "Kê thuốc tự do, không qua danh mục" (mở rộng Kho Thuốc GĐ5) — thêm 1 dòng có tên tự do (không
   * `drugId`) vào đơn. Chỉ gọi được khi tenant bật `allowFreeTextPrescriptionEnabled` (component tự
   * đọc công tắc, ẩn hẳn tuỳ chọn khi tắt). */
  onAddFreeText: (name: string) => void;
  /** "Đơn thuốc mẫu" (docs/DECISIONS.md #196) LUÔN yêu cầu `drugId` thật (schema
   * `prescription_template_item` không có nhánh tự do) — ép ẩn tuỳ chọn "ngoài danh mục" ở đây dù
   * tenant đang bật `allowFreeTextPrescriptionEnabled` cho việc kê đơn thường. */
  disableFreeText?: boolean;
}>(function DrugPicker({ excludeDrugIds, onSelect, onAddFreeText, disableFreeText = false }, ref) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);
  const debounced = useDebouncedValue(query, 300);
  const isSearching = debounced.trim() !== '';
  const searchQuery = useDrugsQuery({ q: debounced.trim() || undefined });

  const results = (searchQuery.data?.items ?? []).filter((item) => !excludeDrugIds.includes(item.id));

  const allowFreeTextQuery = useAllowFreeTextPrescriptionEnabledQuery();
  // "Tuỳ chọn ảo" cuối danh sách — dùng CHUNG cơ chế điều hướng bàn phím với kết quả thật
  // (activeIndex === results.length nghĩa là đang chọn dòng này).
  const canAddFreeText = !disableFreeText && (allowFreeTextQuery.data?.enabled ?? false) && debounced.trim() !== '';
  const totalOptions = results.length + (canAddFreeText ? 1 : 0);

  // Kết quả đổi (gõ tiếp/xoá bớt) → luôn về đầu danh sách, tránh giữ activeIndex trỏ lệch thuốc.
  useEffect(() => {
    setActiveIndex(0);
  }, [debounced, searchQuery.dataUpdatedAt]);

  const stockTrackingQuery = usePharmacyStockTrackingEnabledQuery();
  const showStock = stockTrackingQuery.data?.enabled ?? true;
  const onHandQuery = useStockOnHandSummaryQuery(
    results.map((r) => r.id),
    showStock,
  );
  const onHandByDrugId = onHandQuery.data?.onHandByDrugId ?? {};

  function handleSelect(id: string, name: string, unitCode: string | null) {
    onSelect({ drugId: id, drugName: name, unitCode });
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
  }

  function handleSelectFreeText() {
    const name = debounced.trim();
    if (!name) return;
    onAddFreeText(name);
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isSearching || totalOptions === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, totalOptions - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Không nằm trong <form> nào ở PrescriptionPanel.tsx, nhưng vẫn chặn nổi bọt để nhất quán
      // với Combobox/MultiSelectCombobox (mục 4.4 ui-guidelines.md).
      e.preventDefault();
      if (activeIndex < results.length) {
        const item = results[activeIndex];
        if (item) handleSelect(item.id, item.name, item.baseUnitCode);
      } else if (canAddFreeText) {
        handleSelectFreeText();
      }
    } else if (e.key === 'Escape') {
      setQuery('');
    }
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
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Gõ tên thuốc, mã, hoạt chất, mã vạch hoặc gõ tắt..."
          maxLength={200}
          role="combobox"
          aria-expanded={isSearching}
          aria-activedescendant={
            isSearching && results[activeIndex]
              ? `drug-picker-option-${results[activeIndex].id}`
              : isSearching && canAddFreeText && activeIndex === results.length
                ? 'drug-picker-option-free-text'
                : undefined
          }
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
        <div role="listbox" className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto scroll-hover">
          {results.length === 0 && !canAddFreeText && <p className="px-1 py-2 text-xs text-slate-400">Không tìm thấy thuốc nào khớp trong danh mục.</p>}
          {results.map((item, index) => {
            const onHand = onHandByDrugId[item.id];
            const active = index === activeIndex;
            return (
              <button
                key={item.id}
                id={`drug-picker-option-${item.id}`}
                role="option"
                aria-selected={active}
                type="button"
                onClick={() => handleSelect(item.id, item.name, item.baseUnitCode)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left ${
                  active ? 'border-brand-teal bg-brand-teal-tint' : 'border-slate-200 hover:border-blue-400 hover:bg-brand-teal-tint'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm text-slate-900">
                    <span className="font-bold">{item.name}</span>
                    {item.concentration && <span className="text-slate-500"> · {item.concentration}</span>}
                  </div>
                  {item.activeIngredient && <div className="mt-0.5 text-xs text-slate-500">Hoạt chất: {item.activeIngredient}</div>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {item.shortcutCode && (
                    <span className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">
                      gõ tắt: {item.shortcutCode}
                    </span>
                  )}
                  {showStock && onHand !== undefined && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${onHand > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    >
                      {onHand > 0 ? `Tồn ${onHand}` : 'Hết hàng'}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {canAddFreeText && (
            <button
              id="drug-picker-option-free-text"
              role="option"
              aria-selected={activeIndex === results.length}
              type="button"
              onClick={handleSelectFreeText}
              onMouseEnter={() => setActiveIndex(results.length)}
              className={`flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left ${
                activeIndex === results.length ? 'border-brand-teal bg-brand-teal-tint' : 'border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint'
              }`}
            >
              <Plus size={14} weight="bold" className="shrink-0 text-blue-600" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-800">
                Thêm &quot;{debounced.trim()}&quot; vào đơn <span className="font-normal text-slate-500">(ngoài danh mục)</span>
              </span>
            </button>
          )}
          {totalOptions > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-1 pt-1.5 text-[11px] font-medium text-slate-500">
              <span>
                <kbd className="rounded border border-slate-300 border-b-2 bg-white px-1.5 py-0.5 font-bold text-slate-700">↑</kbd>{' '}
                <kbd className="rounded border border-slate-300 border-b-2 bg-white px-1.5 py-0.5 font-bold text-slate-700">↓</kbd> di chuyển
              </span>
              <span>
                <kbd className="rounded border border-slate-300 border-b-2 bg-white px-1.5 py-0.5 font-bold text-slate-700">Enter</kbd> thêm vào đơn
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
