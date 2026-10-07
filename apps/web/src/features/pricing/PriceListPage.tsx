import { useState } from 'react';
import { Eye, Plus, Tag } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { GeneralPriceList, PriceListStatus, PriceListSummary } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useHasPermission } from '../auth/usePermission';
import { formatDateVn, PRICE_LIST_STATUS_META } from './pricing-labels';
import { PriceLookupPanel } from './PriceLookupPanel';
import { usePriceListsQuery } from './pricing.queries';

// Tổng cột cố định + tên tối thiểu 140px ≈ 760px — vừa khung còn lại sau khung "Tra thử giá" 360px ở màn 1440px (mã BG dài 12 ký tự cần ≥128px).
const GRID_COLUMNS = '128px minmax(140px,1fr) 176px 64px 72px 116px 64px';
const TABLE_MIN_WIDTH_PX = 760;
const ROW_HEIGHT_PX = 60;

type StatusFilter = PriceListStatus | 'ALL';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'ACTIVE', label: 'Đang áp dụng' },
  { key: 'UPCOMING', label: 'Sắp áp dụng' },
  { key: 'EXPIRED', label: 'Đã hết hạn' },
  { key: 'STOPPED', label: 'Đã ngừng' },
];

/**
 * "Bảng giá" (`/admin/price-lists`, Cận lâm sàng GĐ2, docs/DECISIONS.md #212, mockup màn 10) — danh sách bảng giá có thời hạn kèm
 * dòng "Bảng giá chung" ảo (BG0000, ưu tiên 0) luôn ở đầu, và khung "Tra thử giá" bên phải. Bảng giá chung KHÔNG có bản ghi riêng:
 * nó là giá nhập trực tiếp trên từng mặt hàng nên mặt hàng mới tự có mặt, không bao giờ lệch hai nguồn giá.
 */
export function PriceListPage() {
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Bảng giá' }]);
  const navigate = useNavigate();
  const canCreate = useHasPermission('price_list', 'create');
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const query = usePriceListsQuery({ status: filter === 'ALL' ? undefined : filter });
  const counts = query.data?.counts;
  const items = query.data?.items ?? [];
  const showGeneral = filter === 'ALL';

  const countOf = (key: StatusFilter) => (counts === undefined ? undefined : key === 'ALL' ? counts.all : counts[key]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 pb-5 pt-4">
      <h1 className="sr-only">Bảng giá</h1>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc bảng giá theo trạng thái">
          {FILTERS.filter((f) => f.key !== 'STOPPED' || (counts?.STOPPED ?? 0) > 0 || filter === 'STOPPED').map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold ${
                  active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.label} {countOf(f.key) ?? ''}
              </button>
            );
          })}
        </div>
        {canCreate && (
          <Button type="button" onClick={() => navigate('/admin/price-lists/new')}>
            <Plus size={15} weight="bold" aria-hidden="true" />
            Tạo bảng giá
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {query.isError && <ErrorBanner message="Không tải được danh sách bảng giá." onRetry={() => query.refetch()} />}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="scroll-hover min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
                <div
                  role="row"
                  className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-bold uppercase tracking-wide text-slate-800"
                  style={{ gridTemplateColumns: GRID_COLUMNS }}
                >
                  {['Mã', 'Tên bảng giá', 'Hiệu lực', 'Ưu tiên', 'Mặt hàng', 'Trạng thái', 'Thao tác'].map((h) => (
                    <div key={h} role="columnheader" className="px-2 py-3">
                      {h}
                    </div>
                  ))}
                </div>

                <div role="table" aria-label="Danh sách bảng giá" className="scroll-hover min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                  {query.isLoading && (
                    <div className="space-y-2 p-3">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  )}
                  {query.data && showGeneral && <GeneralRow general={query.data.general} />}
                  {!query.isLoading && items.length === 0 && !query.isError && (
                    <div className="p-6">
                      <EmptyState
                        icon={Tag}
                        title={filter === 'ALL' ? 'Chưa có bảng giá có thời hạn nào' : 'Không có bảng giá nào ở trạng thái này'}
                        description={
                          filter === 'ALL'
                            ? 'Tạo bảng giá để áp giá khuyến mại hoặc giá ưu đãi theo khoảng ngày. Chưa có bảng nào thì hệ thống dùng Bảng giá chung.'
                            : 'Chọn trạng thái khác để xem các bảng giá còn lại.'
                        }
                        action={
                          canCreate && filter === 'ALL' ? (
                            <Button type="button" onClick={() => navigate('/admin/price-lists/new')}>
                              <Plus size={15} weight="bold" aria-hidden="true" />
                              Tạo bảng giá
                            </Button>
                          ) : undefined
                        }
                      />
                    </div>
                  )}
                  {items.map((item) => (
                    <PriceListRow key={item.id} item={item} onView={() => navigate(`/admin/price-lists/${item.id}`)} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Bảng giá có thời hạn được ưu tiên hơn giá mặc định; độ ưu tiên (số) cao thắng. Hết hạn thì tự quay về bảng có ưu tiên thấp hơn, cuối cùng là Bảng giá chung.
          </p>
        </div>

        <PriceLookupPanel />
      </div>
    </div>
  );
}

function GeneralRow({ general }: { general: GeneralPriceList }) {
  return (
    <div role="row" className="grid items-center border-b border-slate-200 bg-slate-50 text-center text-sm" style={{ gridTemplateColumns: GRID_COLUMNS, height: ROW_HEIGHT_PX }}>
      <div role="cell" className="px-2 font-semibold text-slate-800">
        {general.code}
      </div>
      <div role="cell" className="min-w-0 px-2.5 text-left">
        <div className="truncate font-semibold text-slate-900">{general.name}</div>
        <div className="truncate text-xs text-slate-500">Giá nhập trực tiếp trên dịch vụ, thuốc, vật tư — tự thêm khi tạo mặt hàng mới</div>
      </div>
      <div role="cell" className="px-2 font-medium text-slate-600">
        Không thời hạn
      </div>
      <div role="cell" className="px-2 font-bold text-slate-900">
        {general.priority}
      </div>
      <div role="cell" className="px-2 font-medium text-slate-600">
        {general.itemCount}
      </div>
      <div role="cell" className="px-2">
        <StatusBadge tone="info">Mặc định</StatusBadge>
      </div>
      <div role="cell" />
    </div>
  );
}

function PriceListRow({ item, onView }: { item: PriceListSummary; onView: () => void }) {
  const status = PRICE_LIST_STATUS_META[item.status];
  return (
    <div role="row" className="grid items-center border-b border-slate-200 text-center text-sm" style={{ gridTemplateColumns: GRID_COLUMNS, height: ROW_HEIGHT_PX }}>
      <div role="cell" className="px-2 font-semibold text-slate-800">
        {item.code}
      </div>
      <div role="cell" className="min-w-0 px-2.5 text-left">
        <div className="truncate font-semibold text-slate-900" title={item.name}>
          {item.name}
        </div>
        {item.description && <div className="truncate text-xs text-slate-500">{item.description}</div>}
      </div>
      <div role="cell" className="px-2 text-[13px] font-medium text-slate-600">
        {formatDateVn(item.effectiveFrom)} – {formatDateVn(item.effectiveTo)}
      </div>
      <div role="cell" className="px-2 font-bold text-slate-900">
        {item.priority}
      </div>
      <div role="cell" className="px-2 font-medium text-slate-600">
        {item.itemCount}
      </div>
      <div role="cell" className="px-2">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <div role="cell" className="flex items-center justify-center px-2">
        <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={onView} />
      </div>
    </div>
  );
}
