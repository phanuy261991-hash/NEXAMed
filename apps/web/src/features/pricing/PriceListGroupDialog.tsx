import { useMemo, useState } from 'react';
import { Stack } from '@phosphor-icons/react';
import type { PriceableGroup, PriceableItem, PriceListItemKind } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Skeleton } from '../../shared/ui/Skeleton';
import { PRICE_LIST_ITEM_KINDS, PRICE_LIST_ITEM_KIND_LABELS } from './pricing-labels';
import { listPriceableItemsByGroups } from './pricing.api';
import { usePriceableGroupsQuery } from './pricing.queries';

const groupKey = (g: Pick<PriceableGroup, 'kind' | 'code'>): string => `${g.kind}|${g.code ?? ''}`;

/**
 * Hộp thoại "Thêm theo nhóm" của bảng giá (docs/DECISIONS.md #212, yêu cầu chủ dự án 07/10/2026): chọn MỘT hoặc NHIỀU nhóm (theo từng loại mặt hàng) rồi đưa
 * toàn bộ mặt hàng của các nhóm đó vào danh sách đang soạn — mỗi dòng mới mang "Giảm %" theo ô phần trăm ở đây. Mặt hàng đã có trong danh sách bị bỏ qua.
 * Nhận dữ liệu qua props (không biết gì về trang bảng giá) để tái dùng cho bảng giá/gói khác sau này.
 */
export function PriceListGroupDialog({
  existingKeys,
  defaultPercent,
  onAdd,
  onClose,
}: {
  /** Khoá `<loại>:<ref>` của các mặt hàng ĐÃ có trong danh sách (thuốc và vật tư dùng chung khoá `DRUG`). */
  existingKeys: ReadonlySet<string>;
  defaultPercent: string;
  onAdd: (items: PriceableItem[], percent: number) => void;
  onClose: () => void;
}) {
  const groupsQuery = usePriceableGroupsQuery(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [percent, setPercent] = useState(defaultPercent);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupsQuery.data?.groups ?? [], [groupsQuery.data]);
  const byKind = useMemo(() => {
    const map = new Map<PriceListItemKind, PriceableGroup[]>();
    for (const g of groups) map.set(g.kind, [...(map.get(g.kind) ?? []), g]);
    return map;
  }, [groups]);

  const selectedGroups = groups.filter((g) => selected.has(groupKey(g)));
  const totalItems = selectedGroups.reduce((sum, g) => sum + g.itemCount, 0);
  const percentNumber = Number(percent);
  const percentValid = Number.isInteger(percentNumber) && percentNumber >= 1 && percentNumber <= 100;

  function toggle(g: PriceableGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = groupKey(g);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleKind(kindGroups: PriceableGroup[]) {
    const allOn = kindGroups.every((g) => selected.has(groupKey(g)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const g of kindGroups) {
        if (allOn) next.delete(groupKey(g));
        else next.add(groupKey(g));
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedGroups.length === 0 || !percentValid) return;
    setAdding(true);
    setError(null);
    try {
      const res = await listPriceableItemsByGroups({ groups: selectedGroups.map((g) => ({ kind: g.kind, code: g.code })) });
      const fresh = res.items.filter((i) => !existingKeys.has(`${i.itemKind === 'MEDICAL_SUPPLY' ? 'DRUG' : i.itemKind}:${i.ref}`));
      onAdd(fresh, percentNumber);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được mặt hàng của các nhóm đã chọn. Thử lại sau.');
      setAdding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-labelledby="pl-group-title">
      <form onSubmit={handleSubmit} className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex-shrink-0 px-6 pt-5">
          <ModalHeader icon={Stack} title="Thêm theo nhóm" subtitle="Chọn một hoặc nhiều nhóm" onClose={onClose} />
          <h2 id="pl-group-title" className="sr-only">
            Thêm mặt hàng theo nhóm vào bảng giá
          </h2>
        </div>

        <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {groupsQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {groupsQuery.isError && <ErrorBanner message="Không tải được danh sách nhóm." onRetry={() => groupsQuery.refetch()} />}
          {groupsQuery.data && groups.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Chưa có mặt hàng nào trong danh mục để thêm.</p>}

          <div className="flex flex-col gap-5">
            {PRICE_LIST_ITEM_KINDS.filter((k) => byKind.has(k)).map((kind) => {
              const kindGroups = byKind.get(kind)!;
              const onCount = kindGroups.filter((g) => selected.has(groupKey(g))).length;
              return (
                <section key={kind} aria-label={PRICE_LIST_ITEM_KIND_LABELS[kind]}>
                  <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-1.5">
                    <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-700">{PRICE_LIST_ITEM_KIND_LABELS[kind]}</h3>
                    <button type="button" onClick={() => toggleKind(kindGroups)} className="text-[13px] font-semibold text-blue-600 hover:text-blue-700">
                      {onCount === kindGroups.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                    {kindGroups.map((g) => {
                      const key = groupKey(g);
                      return (
                        <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                          <SelectionCheckbox checked={selected.has(key)} onChange={() => toggle(g)} ariaLabel={`Chọn nhóm ${g.name}`} />
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-900" title={g.name}>
                            {g.name}
                          </span>
                          <span className="flex-none text-xs font-semibold text-slate-500">{g.itemCount}</span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          {error && (
            <div className="mt-4">
              <ErrorBanner message={error} />
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <label htmlFor="pl-group-percent" className="text-sm font-semibold text-slate-800">
              Giảm % cho các dòng thêm
            </label>
            <input
              id="pl-group-percent"
              inputMode="numeric"
              value={percent}
              onChange={(e) => setPercent(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-right text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <span className="text-[13px] font-semibold text-slate-600">%</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">{selectedGroups.length === 0 ? 'Chưa chọn nhóm nào' : `${selectedGroups.length} nhóm · tối đa ${totalItems} mặt hàng`}</span>
            <Button type="button" variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={adding} disabled={selectedGroups.length === 0 || !percentValid}>
              Thêm vào bảng giá
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
