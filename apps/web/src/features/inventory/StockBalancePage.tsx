import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChartBar, Eye, Warning } from '@phosphor-icons/react';
import type { StockBalanceStatus, StockExpiryWarningItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Combobox } from '../../shared/ui/Combobox';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { DRUG_MANAGE_PERMISSIONS } from '../auth/admin-permissions';
import { useHasAnyPermission } from '../auth/usePermission';
import { useUnitNameByCode, unitLabel } from '../drug/useUnitNameByCode';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useStockBalancesQuery, useStockExpiryWarningsQuery } from './inventory.queries';

type ViewMode = 'byitem' | 'expiry';

const BALANCE_STATUS_META: Record<StockBalanceStatus, { label: string; tone: StatusBadgeTone }> = {
  NORMAL: { label: 'Bình thường', tone: 'success' },
  LOW: { label: 'Sắp hết', tone: 'warning' },
  HIGH: { label: 'Vượt định mức', tone: 'warning' },
  OUT: { label: 'Hết hàng', tone: 'danger' },
};

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function expiryLabel(item: StockExpiryWarningItem): string {
  if (item.status === 'EXPIRED') return `${formatDateShort(item.expiryDate)} · đã quá ${Math.abs(item.daysUntilExpiry)} ngày`;
  return `${formatDateShort(item.expiryDate)} · còn ${item.daysUntilExpiry} ngày`;
}

/**
 * "Tồn kho" — Kho Thuốc GĐ2 (docs/DECISIONS.md #146, mockup precious-humming-goblet.md). 2 view:
 * "Theo mặt hàng" (mặc định) và "Cảnh báo hạn dùng", chuyển bằng tab pill đúng mockup.
 */
export function StockBalancePage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Tồn kho' }]);
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<ViewMode>(searchParams.get('view') === 'expiry' ? 'expiry' : 'byitem');
  const [warehouseId, setWarehouseId] = useState('');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [belowMinOnly, setBelowMinOnly] = useState(false);

  const warehousesQuery = useWarehousesQuery();
  const balancesQuery = useStockBalancesQuery({ warehouseId: warehouseId || undefined, q: debouncedQ.trim() || undefined, belowMinOnly });
  const expiryQuery = useStockExpiryWarningsQuery(warehouseId || undefined);

  const expiringSoonCount = expiryQuery.data?.expiringSoonCount ?? 0;
  const expiredCount = expiryQuery.data?.expiredCount ?? 0;
  const balanceItems = useMemo(() => balancesQuery.data?.items ?? [], [balancesQuery.data]);

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Tồn kho</h1>

      {(expiringSoonCount > 0 || expiredCount > 0) && (
        <div className="flex flex-shrink-0 items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <Warning size={20} weight="fill" className="mt-0.5 flex-shrink-0 text-amber-500" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900">
              {expiringSoonCount > 0 && <span className="font-bold">{expiringSoonCount} lô</span>}
              {expiringSoonCount > 0 && ' sắp hết hạn trong 30 ngày tới'}
              {expiringSoonCount > 0 && expiredCount > 0 && ' · '}
              {expiredCount > 0 && <span className="font-bold text-rose-700">{expiredCount} lô</span>}
              {expiredCount > 0 && ' đã hết hạn'}
            </p>
            <p className="text-xs font-medium text-amber-700">Ngưỡng cảnh báo hiện cố định 30 ngày.</p>
          </div>
        </div>
      )}

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
          {(
            [
              ['byitem', 'Theo mặt hàng'],
              ['expiry', 'Cảnh báo hạn dùng'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-semibold ${view === value ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo mã, tên thuốc/vật tư..."
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <Combobox
          id="balance-warehouse"
          value={warehouseId}
          onChange={setWarehouseId}
          options={[{ value: '', label: 'Kho: Tất cả' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
        />
        {view === 'byitem' && (
          <label className="ml-1 flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={belowMinOnly} onChange={(e) => setBelowMinOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            Chỉ hiện dưới định mức tồn
          </label>
        )}
      </div>

      {view === 'byitem' && (
        <BalanceByItemTable
          isPending={balancesQuery.isPending}
          isError={balancesQuery.isError}
          error={balancesQuery.error}
          onRetry={() => void balancesQuery.refetch()}
          items={balanceItems}
        />
      )}
      {view === 'expiry' && (
        <ExpiryWarningTable
          isPending={expiryQuery.isPending}
          isError={expiryQuery.isError}
          error={expiryQuery.error}
          onRetry={() => void expiryQuery.refetch()}
          items={expiryQuery.data?.items ?? []}
        />
      )}
    </div>
  );
}

function BalanceByItemTable({
  isPending,
  isError,
  error,
  onRetry,
  items,
}: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  items: { drugId: string; drugCode: string; drugName: string; itemType: string; warehouseName: string; unitCode: string | null; quantityOnHand: number; minStockAlert: number | null; maxStockAlert: number | null; status: StockBalanceStatus }[];
}) {
  const unitNameByCode = useUnitNameByCode();
  const navigate = useNavigate();
  // Chỉ hiện nút "Xem" cho ai vào được `/admin/catalog-pharmacy` (route đó gate bằng
  // DRUG_MANAGE_PERMISSIONS) — bác sĩ/điều dưỡng chỉ có `drug.read` sẽ bị chặn route nếu bấm vào,
  // nên ẩn hẳn nút cho các vai trò đó (không phải chỉ đổi màu chữ).
  const canOpenDrugDetail = useHasAnyPermission(DRUG_MANAGE_PERMISSIONS);
  if (isError) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Không tải được tồn kho.'} onRetry={onRetry} />;
  if (isPending) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (items.length === 0) return <EmptyState icon={ChartBar} title="Chưa có tồn kho" description="Duyệt phiếu nhập kho để bắt đầu ghi nhận tồn." />;

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div role="table" aria-label="Tồn kho theo mặt hàng" className="scroll-hover h-full overflow-x-auto">
        <div className="flex h-full flex-col" style={{ minWidth: 900 }}>
          <div role="row" style={{ gridTemplateColumns: '110px 1.6fr 110px 1fr 90px 130px 150px 130px 90px' }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
            <div role="columnheader" className="py-2.5 text-center">Mã</div>
            <div role="columnheader" className="py-2.5 text-left">Tên thuốc / vật tư</div>
            <div role="columnheader" className="py-2.5 text-center">Loại</div>
            <div role="columnheader" className="py-2.5 text-center">Kho</div>
            <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
            <div role="columnheader" className="py-2.5 text-center">Tồn hiện tại</div>
            <div role="columnheader" className="py-2.5 text-center">Định mức</div>
            <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
            <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
          </div>
          <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
            {items.map((item) => (
              <div key={`${item.drugId}-${item.warehouseName}`} role="row" style={{ gridTemplateColumns: '110px 1.6fr 110px 1fr 90px 130px 150px 130px 90px', minHeight: 56 }} className="grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50">
                <div role="cell" className="text-center font-bold text-slate-800">{item.drugCode}</div>
                <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900">{item.drugName}</div>
                <div role="cell" className="text-center">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.itemType === 'MEDICINE' ? 'bg-slate-100 text-slate-700' : 'bg-sky-100 text-sky-700'}`}>
                    {item.itemType === 'MEDICINE' ? 'Thuốc' : 'Vật tư'}
                  </span>
                </div>
                <div role="cell" className="truncate text-center font-medium text-slate-700">{item.warehouseName}</div>
                <div role="cell" className="text-center font-medium text-slate-700">{item.unitCode ? unitLabel(unitNameByCode, item.unitCode) : '—'}</div>
                <div role="cell" className={`text-center text-base font-bold ${item.status === 'OUT' ? 'text-rose-600' : item.status === 'LOW' || item.status === 'HIGH' ? 'text-amber-600' : 'text-slate-900'}`}>
                  {item.quantityOnHand.toLocaleString('vi-VN')}
                </div>
                <div role="cell" className="text-center font-medium text-slate-500">
                  {item.minStockAlert !== null || item.maxStockAlert !== null ? `${item.minStockAlert ?? 0} – ${item.maxStockAlert ?? '∞'}` : '—'}
                </div>
                <div role="cell" className="text-center">
                  <StatusBadge tone={BALANCE_STATUS_META[item.status].tone}>{BALANCE_STATUS_META[item.status].label}</StatusBadge>
                </div>
                <div role="cell" className="flex items-center justify-center">
                  {canOpenDrugDetail && (
                    <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/admin/catalog-pharmacy?drugId=${item.drugId}&tab=batches`)} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpiryWarningTable({
  isPending,
  isError,
  error,
  onRetry,
  items,
}: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  items: StockExpiryWarningItem[];
}) {
  if (isError) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Không tải được cảnh báo hạn dùng.'} onRetry={onRetry} />;
  if (isPending) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (items.length === 0) return <EmptyState icon={Warning} title="Không có lô nào sắp/đã hết hạn" description="Mọi lô còn hạn dùng xa hơn 30 ngày." />;

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div role="table" aria-label="Cảnh báo hạn dùng" className="scroll-hover h-full overflow-x-auto">
        <div className="flex h-full flex-col" style={{ minWidth: 900 }}>
          <div role="row" style={{ gridTemplateColumns: '130px 1.6fr 130px 1fr 100px 140px' }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
            <div role="columnheader" className="py-2.5 text-center">Số lô</div>
            <div role="columnheader" className="py-2.5 text-left">Thuốc / vật tư</div>
            <div role="columnheader" className="py-2.5 text-center">Kho</div>
            <div role="columnheader" className="py-2.5 text-center">Hạn dùng</div>
            <div role="columnheader" className="py-2.5 text-center">Tồn</div>
            <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
          </div>
          <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
            {items.map((item) => (
              <div key={item.batchId} role="row" style={{ gridTemplateColumns: '130px 1.6fr 130px 1fr 100px 140px', minHeight: 56 }} className="grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50">
                <div role="cell" className="text-center font-semibold text-slate-800">{item.batchNo}</div>
                <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900">{item.drugName}</div>
                <div role="cell" className="truncate text-center font-medium text-slate-700">{item.warehouseName}</div>
                <div role="cell" className={`text-center font-semibold ${item.status === 'EXPIRED' ? 'text-rose-600' : 'text-amber-600'}`}>{expiryLabel(item)}</div>
                <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{item.quantityOnHand.toLocaleString('vi-VN')}</div>
                <div role="cell" className="text-center">
                  <StatusBadge tone={item.status === 'EXPIRED' ? 'danger' : 'warning'}>{item.status === 'EXPIRED' ? 'Đã hết hạn' : 'Sắp hết hạn'}</StatusBadge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
