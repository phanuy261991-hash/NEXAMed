import { useMemo, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import type { LookupPriceEntry, LookupPriceQuery, PriceableItem, PriceableScope } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { DateInput } from '../../shared/ui/DateInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { formatVnd } from '../../shared/format/currency';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { describePriceRule, formatDateVn, PRICE_LIST_ITEM_KIND_LABELS } from './pricing-labels';
import { useLookupPriceQuery, usePriceableItemSearch } from './pricing.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const labelClassName = 'text-sm font-semibold text-slate-800';

/**
 * Khung "Tra thử giá" (Cận lâm sàng GĐ2, docs/DECISIONS.md #212, mockup màn 10) — chọn một mặt hàng + một ngày, xem MỌI bảng giá
 * chứa mặt hàng đó, bảng nào thắng và bảng nào bị đè, rồi giá cuối cùng. Nhiều Loại giá/Bậc đơn vị thì hiện chip chọn mức cần tra.
 */
export function PriceLookupPanel() {
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text.trim(), 250);
  const [picked, setPicked] = useState<PriceableItem | null>(null);
  const [date, setDate] = useState(getVietnamTodayDateString());
  const [query, setQuery] = useState<LookupPriceQuery | null>(null);

  const search = usePriceableItemSearch(picked ? '' : debounced, undefined);
  const results = picked ? [] : (search.data?.items ?? []).slice(0, 8);
  const lookup = useLookupPriceQuery(query);
  const priceTypeQuery = useReferenceCatalogQuery('PRICE_TYPE');
  const unitQuery = useReferenceCatalogQuery('UNIT');
  const priceTypeName = useMemo(() => new Map((priceTypeQuery.data?.items ?? []).map((i) => [i.code, i.name])), [priceTypeQuery.data]);
  const unitName = useMemo(() => new Map((unitQuery.data?.items ?? []).map((i) => [i.code, i.name])), [unitQuery.data]);

  function scopeLabel(scope: PriceableScope): string {
    const parts = [scope.priceTypeCode ? (priceTypeName.get(scope.priceTypeCode) ?? scope.priceTypeCode) : null, scope.unitCode ? (unitName.get(scope.unitCode) ?? scope.unitCode) : null].filter(
      (p): p is string => p !== null,
    );
    return parts.length > 0 ? parts.join(' · ') : 'Trọn gói';
  }

  function pick(item: PriceableItem) {
    setPicked(item);
    setText('');
    setQuery(null);
  }

  function clearPick() {
    setPicked(null);
    setQuery(null);
  }

  function submit(scope?: PriceableScope) {
    if (!picked || date === '') return;
    setQuery({
      itemKind: picked.itemKind,
      ref: picked.ref,
      date,
      ...(scope?.priceTypeCode ? { priceTypeCode: scope.priceTypeCode } : {}),
      ...(scope?.unitCode ? { unitCode: scope.unitCode } : {}),
    });
  }

  const data = lookup.data;
  return (
    <section aria-label="Tra thử giá" className="flex w-[360px] flex-shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-[14.5px] font-bold text-slate-900">Tra thử giá</h2>
        <p className="mt-0.5 text-xs text-slate-500">Xem một mặt hàng vào một ngày sẽ được tính giá nào.</p>
      </div>

      <form
        className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lk-item" className={labelClassName}>
            Mặt hàng
          </label>
          {picked ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
              <span className="min-w-0 truncate text-sm font-semibold text-slate-900" title={picked.name}>
                {picked.code} · {picked.name}
              </span>
              <button type="button" onClick={clearPick} aria-label="Chọn mặt hàng khác" className="flex-none text-slate-400 hover:text-slate-700">
                <X size={15} weight="bold" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="lk-item"
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Enter ở ô tìm CHỈ để chọn kết quả đầu — không submit form (ui-guidelines mục 4.4).
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const first = results[0];
                    if (first) pick(first);
                  }
                }}
                placeholder="Gõ tên hoặc mã mặt hàng…"
                className={`${inputClassName} pl-9`}
              />
              {results.length > 0 && (
                <ul role="listbox" aria-label="Kết quả tìm mặt hàng" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {results.map((item) => (
                    <li key={`${item.itemKind}:${item.ref}`} role="option" aria-selected={false}>
                      <button type="button" onClick={() => pick(item)} className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-slate-50">
                        <span className="truncate text-sm font-semibold text-slate-900">{item.name}</span>
                        <span className="text-xs font-semibold text-slate-500">
                          {PRICE_LIST_ITEM_KIND_LABELS[item.itemKind]} · {item.code}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] items-end gap-2.5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lk-date" className={labelClassName}>
              Ngày
            </label>
            <DateInput id="lk-date" value={date} onChange={setDate} />
          </div>
          <Button type="submit" disabled={!picked || date === ''} loading={lookup.isFetching && query !== null}>
            Tra giá
          </Button>
        </div>
      </form>

      <div className="flex flex-col px-4 py-3.5">
        {query === null && <p className="text-sm text-slate-500">Chọn mặt hàng và ngày, rồi bấm "Tra giá".</p>}
        {query !== null && lookup.isLoading && <Skeleton className="h-32 w-full" />}
        {query !== null && lookup.isError && <ErrorBanner message="Không tra được giá. Mặt hàng có thể đã bị xoá." onRetry={() => lookup.refetch()} />}
        {data && (
          <>
            {data.scopes.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Mức giá cần tra">
                {data.scopes.map((scope) => {
                  const active = scope.priceTypeCode === data.scope.priceTypeCode && scope.unitCode === data.scope.unitCode;
                  return (
                    <button
                      key={`${scope.priceTypeCode}:${scope.unitCode}`}
                      type="button"
                      onClick={() => submit(scope)}
                      aria-pressed={active}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        active ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 text-slate-700 hover:border-blue-400 hover:bg-brand-teal-tint'
                      }`}
                    >
                      {scopeLabel(scope)}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Các bảng giá chứa mặt hàng này</div>
            <ul className="mt-1.5">
              {data.entries.map((entry) => (
                <EntryRow key={entry.priceListId ?? 'general'} entry={entry} />
              ))}
            </ul>
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
              <div className="text-xs text-emerald-800">Giá được tính ngày {formatDateVn(data.date)}</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-emerald-800">{data.result.amount === null ? 'Chưa có giá' : formatVnd(data.result.amount)}</div>
              {data.result.applied && <div className="mt-0.5 text-xs font-semibold text-emerald-800">Theo bảng "{data.result.applied.name}"</div>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function EntryRow({ entry }: { entry: LookupPriceEntry }) {
  const isGeneral = entry.priceListId === null;
  const subtitle = isGeneral
    ? 'Giá nhập trên danh mục'
    : `${entry.mode && entry.value !== null ? describePriceRule(entry.mode, entry.value) : ''} · ${
        entry.isApplied ? 'đang hiệu lực ngày này' : entry.inEffect ? 'bị bảng ưu tiên cao hơn đè' : 'ngoài thời gian hiệu lực ngày này'
      }`;
  const nameTone = entry.isApplied ? 'text-emerald-700' : 'text-slate-500';
  return (
    <li className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-slate-100 py-2.5 last:border-0">
      <span className={`text-right text-[12.5px] font-bold tabular-nums ${entry.isApplied ? 'text-slate-900' : 'text-slate-400'}`}>{entry.priority}</span>
      <div className="min-w-0">
        <div className={`truncate text-[13px] font-bold ${nameTone}`} title={entry.name}>
          {entry.name}
        </div>
        <div className={`text-[11.5px] ${entry.isApplied ? 'text-slate-500' : 'text-slate-400'}`}>{subtitle}</div>
      </div>
      <span
        className={`text-sm font-bold tabular-nums ${entry.isApplied ? 'text-base text-emerald-700' : entry.inEffect ? 'text-slate-400 line-through' : 'text-slate-300'}`}
      >
        {entry.amount === null ? '—' : formatVnd(entry.amount)}
      </span>
    </li>
  );
}
