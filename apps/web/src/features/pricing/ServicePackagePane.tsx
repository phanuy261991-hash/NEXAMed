import { useState } from 'react';
import { Eye, MagnifyingGlass, Package, PencilSimple, Plus } from '@phosphor-icons/react';
import type { ServicePackageSummary } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { formatVnd } from '../../shared/format/currency';
import { useHasPermission } from '../auth/usePermission';
import { formatDateVn, PRICE_LIST_STATUS_META, SERVICE_PACKAGE_PRICING_MODE_LABELS } from './pricing-labels';
import { useServicePackagesQuery } from './pricing.queries';
import { ServicePackageFormDialog } from './ServicePackageFormDialog';

const GRID_COLUMNS = '112px minmax(180px,1fr) 190px 72px 120px 120px 168px 100px 76px';
const TABLE_MIN_WIDTH_PX = 1100;
const ROW_HEIGHT_PX = 60;

type DialogState = { mode: 'create' } | { mode: 'view' | 'edit'; id: string } | null;

/**
 * Pill "Gói dịch vụ" của "Danh mục cận lâm sàng" (Cận lâm sàng GĐ2, docs/DECISIONS.md #212, mockup màn 4). Danh sách gói kèm kiểu
 * giá, số dịch vụ, giá gói, tổng giá lẻ và hiệu lực. GĐ2 chỉ quản lý danh mục gói — đưa gói vào chỉ định/hoá đơn là việc của GĐ3.
 */
export function ServicePackagePane() {
  const canCreate = useHasPermission('service_package', 'create');
  const canUpdate = useHasPermission('service_package', 'update');
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 300);
  const [dialog, setDialog] = useState<DialogState>(null);

  const query = useServicePackagesQuery({ search: search === '' ? undefined : search, includeInactive: true });
  const items = query.data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            aria-label="Tìm gói dịch vụ"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Tìm theo mã hoặc tên gói…"
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        {canCreate && (
          <Button type="button" onClick={() => setDialog({ mode: 'create' })}>
            <Plus size={15} weight="bold" aria-hidden="true" />
            Thêm gói dịch vụ
          </Button>
        )}
      </div>

      {query.isError && <ErrorBanner message="Không tải được danh sách gói dịch vụ." onRetry={() => query.refetch()} />}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="scroll-hover min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
            <div
              role="row"
              className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-bold uppercase tracking-wide text-slate-800"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
            >
              {['Mã', 'Tên gói', 'Cách tính giá', 'Số DV', 'Giá gói', 'Tổng giá lẻ', 'Hiệu lực', 'Trạng thái', 'Thao tác'].map((h) => (
                <div key={h} role="columnheader" className="px-2 py-3">
                  {h}
                </div>
              ))}
            </div>

            <div role="table" aria-label="Danh sách gói dịch vụ" className="scroll-hover min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              {query.isLoading && (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              )}
              {!query.isLoading && items.length === 0 && !query.isError && (
                <div className="p-6">
                  <EmptyState
                    icon={Package}
                    title={search !== '' ? 'Không tìm thấy gói nào' : 'Chưa có gói dịch vụ nào'}
                    description={search !== '' ? 'Thử từ khoá khác.' : 'Gộp Dịch vụ khám và Dịch vụ kỹ thuật thành một gói giá để bác sĩ chỉ định nhanh.'}
                    action={
                      canCreate && search === '' ? (
                        <Button type="button" onClick={() => setDialog({ mode: 'create' })}>
                          <Plus size={15} weight="bold" aria-hidden="true" />
                          Thêm gói dịch vụ
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              )}
              {items.map((item) => (
                <PackageRow
                  key={item.id}
                  item={item}
                  canUpdate={canUpdate}
                  onView={() => setDialog({ mode: 'view', id: item.id })}
                  onEdit={() => setDialog({ mode: 'edit', id: item.id })}
                />
              ))}
            </div>
          </div>
        </div>
        {items.length > 0 && <div className="flex-shrink-0 border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-400">{items.length} gói dịch vụ</div>}
      </div>

      {dialog && (
        <ServicePackageFormDialog
          key={dialog.mode === 'create' ? 'new' : `${dialog.mode}-${dialog.id}`}
          mode={dialog.mode}
          packageId={dialog.mode === 'create' ? null : dialog.id}
          onClose={() => setDialog(null)}
          onSwitchToEdit={(id) => setDialog({ mode: 'edit', id })}
        />
      )}
    </div>
  );
}

function PackageRow({ item, canUpdate, onView, onEdit }: { item: ServicePackageSummary; canUpdate: boolean; onView: () => void; onEdit: () => void }) {
  const status = PRICE_LIST_STATUS_META[item.status];
  return (
    <div role="row" className="grid items-center border-b border-slate-200 text-center text-sm" style={{ gridTemplateColumns: GRID_COLUMNS, height: ROW_HEIGHT_PX }}>
      <div role="cell" className="px-2 font-semibold text-slate-800">
        {item.code}
      </div>
      <div role="cell" className="min-w-0 truncate px-2.5 text-left font-medium text-slate-900" title={item.name}>
        {item.name}
      </div>
      <div role="cell" className="px-2 text-[13px] font-medium text-slate-600">
        {SERVICE_PACKAGE_PRICING_MODE_LABELS[item.pricingMode]}
      </div>
      <div role="cell" className="px-2 font-medium text-slate-600">
        {item.itemCount}
      </div>
      <div role="cell" className="px-2.5 text-right font-semibold tabular-nums text-slate-900">
        {item.price === null ? <span className="font-normal text-slate-400">—</span> : formatVnd(item.price)}
      </div>
      <div role="cell" className="px-2.5 text-right font-medium tabular-nums text-slate-600">
        {formatVnd(item.retailTotal)}
        {item.unpricedItemCount > 0 && <span className="ml-1 text-[11px] font-semibold text-amber-600" title={`${item.unpricedItemCount} dịch vụ chưa có giá`}>!</span>}
      </div>
      <div role="cell" className="px-2 text-[13px] font-medium text-slate-600">
        {formatDateVn(item.effectiveFrom)} – {item.effectiveTo ? formatDateVn(item.effectiveTo) : 'không giới hạn'}
      </div>
      <div role="cell" className="px-2">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <div role="cell" className="flex items-center justify-center gap-1.5 px-2">
        <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={onView} />
        {canUpdate && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={onEdit} />}
      </div>
    </div>
  );
}
