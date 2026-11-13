import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsLeftRight, ClipboardText, ShoppingCart } from '@phosphor-icons/react';
import type { StockRequestRestockItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useHasPermission } from '../auth/usePermission';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import { usePurchaseOrderOptionsQuery } from './purchase-order.queries';
import { useStockRequestRestockQuery } from './stock-request.queries';

const GRID = '36px minmax(200px,1.5fr) 80px 90px 100px minmax(150px,1fr) 140px';

/** Dòng đã chọn gửi sang form khác qua `location.state` (form đọc lại để điền sẵn). */
export interface RestockPrefillLine {
  drugId: string;
  drugCode: string;
  drugName: string;
  unitCode: string | null;
  onHand: number;
  minStock: number;
  quantity: number;
}

/**
 * Tab "Hàng cần bổ sung" của "Yêu cầu cấp hàng" (docs/DECISIONS.md #298, mockup màn 4): mặt hàng dưới mức tồn tối thiểu của kho chính chi nhánh đang làm, kèm phần các phòng ban đang chờ cấp
 * và gợi ý số cần bổ sung (sửa được). Chọn các dòng rồi đi một trong hai đường: "Xin chi nhánh chính" (chỉ khi kho có cấp trên) hoặc "Đặt NCC" (chỉ khi chi nhánh được đặt hàng riêng) — cả hai mở form
 * tương ứng đã điền sẵn các mặt hàng và số lượng đã chọn.
 */
export function StockRequestRestockTab() {
  const navigate = useNavigate();
  const query = useStockRequestRestockQuery();
  const unitNameByCode = useUnitNameByCode();
  const canCreateOrder = useHasPermission('purchase_order', 'create');
  const orderOptions = usePurchaseOrderOptionsQuery(canCreateOrder);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [qtyEdits, setQtyEdits] = useState<Record<string, string>>({});

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  // Mặc định chọn sẵn các dòng thật sự thiếu (tồn dưới mức tối thiểu hoặc đang bị chờ) — người dùng bỏ chọn dòng không cần.
  const defaultPicked = useMemo(() => new Set(items.filter((i) => i.onHand < i.minStock || i.deptWaitingQty > 0).map((i) => i.drugId)), [items]);
  const selected = picked ?? defaultPicked;
  const qtyOf = (i: StockRequestRestockItem) => qtyEdits[i.drugId] ?? String(i.suggestedQty);
  const chosen = items.filter((i) => selected.has(i.drugId) && Number(qtyOf(i)) > 0);

  function toggle(drugId: string) {
    const next = new Set(selected);
    if (next.has(drugId)) next.delete(drugId);
    else next.add(drugId);
    setPicked(next);
  }

  function toggleAll() {
    setPicked(selected.size === items.length ? new Set() : new Set(items.map((i) => i.drugId)));
  }

  function lines(): RestockPrefillLine[] {
    return chosen.map((i) => ({ drugId: i.drugId, drugCode: i.drugCode, drugName: i.drugName, unitCode: i.unitCode, onHand: i.onHand, minStock: i.minStock, quantity: Number(qtyOf(i)) }));
  }

  if (query.isPending) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được danh sách hàng cần bổ sung.'} onRetry={() => void query.refetch()} />;
  }
  const data = query.data;
  const canOrderHere = canCreateOrder && orderOptions.data?.canOrderHere === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex-shrink-0 px-1">
        {/* Dải số đúng mockup màn 4: nhãn nhỏ phía trên, số lớn phía dưới, cùng kiểu dải đếm của danh sách */}
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-4">
          {[
            { label: 'Mặt hàng dưới mức tối thiểu', value: data.stats.belowMin },
            { label: 'Đang chờ cấp cho phòng ban', value: data.stats.deptWaiting },
            { label: 'Đang chờ hàng về', value: data.stats.waitingArrival },
            { label: 'Đã xin chi nhánh chính', value: data.stats.requestedUp },
          ].map((stat, index) => (
            <div key={stat.label} className={`px-3.5 py-2 ${index > 0 ? 'sm:border-l sm:border-slate-200' : ''}`}>
              <span className="block text-[13px] font-medium text-slate-600">{stat.label}</span>
              <span className="text-xl font-semibold tabular-nums text-slate-900">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={ClipboardText} title="Không có mặt hàng nào cần bổ sung" description={`Tồn kho ${data.warehouseName ?? 'chính'} đang đủ so với mức tối thiểu.`} />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Hàng cần bổ sung" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: 960 }}>
              <div role="row" style={{ gridTemplateColumns: GRID }} className="grid flex-shrink-0 gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="flex items-center py-2.5">
                  <SelectionCheckbox checked={selected.size === items.length} indeterminate={selected.size > 0 && selected.size < items.length} onChange={toggleAll} ariaLabel="Chọn tất cả" />
                </div>
                <div role="columnheader" className="py-2.5 text-left">Mặt hàng</div>
                <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
                <div role="columnheader" className="py-2.5 text-center">Tồn kho</div>
                <div role="columnheader" className="py-2.5 text-center">Mức tối thiểu</div>
                <div role="columnheader" className="py-2.5 text-center">Phòng ban đang chờ</div>
                <div role="columnheader" className="py-2.5 text-center">Cần bổ sung (gợi ý)</div>
              </div>
              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((i) => (
                  <div key={i.drugId} role="row" style={{ gridTemplateColumns: GRID, minHeight: 56 }} className="grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm hover:bg-slate-50">
                    <div role="cell" className="flex items-center">
                      <SelectionCheckbox checked={selected.has(i.drugId)} onChange={() => toggle(i.drugId)} ariaLabel={`Chọn ${i.drugName}`} />
                    </div>
                    <div role="cell" className="min-w-0 truncate font-semibold text-slate-900" title={i.drugName}>{i.drugName}</div>
                    <div role="cell" className="text-center font-medium text-slate-600">{i.unitCode ? unitLabel(unitNameByCode, i.unitCode) : '—'}</div>
                    <div role="cell" className={`text-center font-semibold tabular-nums ${i.onHand < i.minStock ? 'text-rose-600' : 'text-slate-900'}`}>{i.onHand}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-600">{i.minStock}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-700">
                      {i.deptWaitingQty > 0 ? `${i.deptWaitingQty} (${i.deptWaitingRequestNos.join(', ')})` : '—'}
                    </div>
                    <div role="cell" className="text-center">
                      <input
                        type="number"
                        min={0}
                        value={qtyOf(i)}
                        aria-label={`Số cần bổ sung ${i.drugName}`}
                        onChange={(e) => setQtyEdits((prev) => ({ ...prev, [i.drugId]: e.target.value }))}
                        className="w-24 rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className="text-sm text-slate-700">
          Đã chọn <strong>{chosen.length} mặt hàng</strong>. Chọn đường bổ sung cho các dòng này:
        </span>
        <span className="flex flex-wrap gap-2">
          <Button type="button" disabled={chosen.length === 0 || !data.canRequestUp} title={data.canRequestUp ? undefined : 'Kho chính của chi nhánh chính không có cấp trên để xin hàng'} onClick={() => navigate('/inventory/requests/new', { state: { restockLines: lines(), requestingWarehouseId: data.warehouseId } })}>
            <ArrowsLeftRight size={16} weight="bold" aria-hidden="true" />
            Xin chi nhánh chính ({chosen.length})
          </Button>
          {canOrderHere && (
            <Button type="button" variant="secondary" disabled={chosen.length === 0} onClick={() => navigate('/inventory/purchase-orders/new', { state: { restockLines: lines(), warehouseId: data.warehouseId } })}>
              <ShoppingCart size={16} weight="bold" aria-hidden="true" />
              Đặt NCC ({chosen.length})
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
