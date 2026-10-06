import { useMemo, useState } from 'react';
import { Eye, Flask, MagnifyingGlass, PencilSimple, Plus } from '@phosphor-icons/react';
import type { TechnicalServiceItem, TechnicalServiceKind } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { formatVnd } from '../../shared/format/currency';
import { useHasPermission } from '../auth/usePermission';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { TECHNICAL_SERVICE_KIND_LABELS } from './paraclinical-labels';
import { useTechnicalServicesQuery } from './paraclinical.queries';
import { TechnicalServiceFormDialog } from './TechnicalServiceFormDialog';

// Tổng cột cố định + tên tối thiểu 150px ≈ 890px — vừa khung 1440px (trừ sidebar + khung nhóm) để cột Trạng thái/Thao tác không bị đẩy ra ngoài.
const GRID_COLUMNS = '112px minmax(150px,1fr) 96px 112px 92px 100px 52px 96px 76px';
const TABLE_MIN_WIDTH_PX = 890;
const ROW_HEIGHT_PX = 60;

const KIND_FILTERS: { key: TechnicalServiceKind | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'LAB', label: TECHNICAL_SERVICE_KIND_LABELS.LAB },
  { key: 'IMAGING', label: TECHNICAL_SERVICE_KIND_LABELS.IMAGING },
  { key: 'FUNCTIONAL', label: TECHNICAL_SERVICE_KIND_LABELS.FUNCTIONAL },
];

type DialogState = { mode: 'create' } | { mode: 'view' | 'edit'; id: string } | null;

/**
 * Pill "Dịch vụ kỹ thuật" của "Danh mục cận lâm sàng" (Cận lâm sàng GĐ1, docs/DECISIONS.md #212, mockup màn 1) — khung
 * "Nhóm dịch vụ" bên trái (Tất cả/Xét nghiệm/CĐHA/Thăm dò chức năng kèm số lượng) + thanh tìm kiếm + bảng. Dịch vụ phòng khám
 * không tự làm hiện nhãn "Gửi ra ngoài" thay cho Nơi thực hiện.
 */
export function TechnicalServicePane() {
  const canCreate = useHasPermission('technical_service', 'create');
  const canUpdate = useHasPermission('technical_service', 'update');
  const [kind, setKind] = useState<TechnicalServiceKind | 'ALL'>('ALL');
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 300);
  const [dialog, setDialog] = useState<DialogState>(null);

  const query = useTechnicalServicesQuery({ kind: kind === 'ALL' ? undefined : kind, search: search === '' ? undefined : search, includeInactive: true });
  const categoryQuery = useReferenceCatalogQuery('TECH_SERVICE_CATEGORY');
  const specimenQuery = useReferenceCatalogQuery('SPECIMEN_TYPE');
  const categoryName = useMemo(() => new Map((categoryQuery.data?.items ?? []).map((i) => [i.code, i.name])), [categoryQuery.data]);
  const specimenName = useMemo(() => new Map((specimenQuery.data?.items ?? []).map((i) => [i.code, i.name])), [specimenQuery.data]);

  const items = query.data?.items ?? [];
  const counts = query.data?.counts;
  const countOf = (key: TechnicalServiceKind | 'ALL') => (counts === undefined ? undefined : key === 'ALL' ? counts.total : counts[key]);

  return (
    <div className="flex h-full min-h-0 gap-3.5 px-6 pb-5 pt-3.5">
      <aside aria-label="Nhóm dịch vụ" className="flex w-52 flex-shrink-0 flex-col gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <h2 className="px-2 pb-2 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-700">Nhóm dịch vụ</h2>
        {KIND_FILTERS.map((f) => {
          const active = kind === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setKind(f.key)}
              aria-pressed={active}
              className={`flex items-center justify-between rounded-md border-l-2 px-2 py-2 text-left text-[13px] ${
                active ? 'border-blue-600 bg-white font-semibold text-blue-700' : 'border-transparent text-slate-700 hover:bg-white'
              }`}
            >
              <span>{f.label}</span>
              <span className="font-semibold text-slate-500">{countOf(f.key) ?? '—'}</span>
            </button>
          );
        })}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              aria-label="Tìm dịch vụ"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Tìm theo mã, tên dịch vụ, tên viết tắt…"
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {canCreate && (
            <Button type="button" onClick={() => setDialog({ mode: 'create' })}>
              <Plus size={15} weight="bold" aria-hidden="true" />
              Thêm dịch vụ
            </Button>
          )}
        </div>

        {query.isError && <ErrorBanner message="Không tải được danh mục dịch vụ kỹ thuật." onRetry={() => query.refetch()} />}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div
                role="row"
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-bold uppercase tracking-wide text-slate-800"
                style={{ gridTemplateColumns: GRID_COLUMNS }}
              >
                {['Mã', 'Tên dịch vụ', 'Nhóm', 'Nơi thực hiện', 'Mẫu bệnh phẩm', 'Giá hiện hành', 'Chỉ số', 'Trạng thái', 'Thao tác'].map((h) => (
                  <div key={h} role="columnheader" className="px-2 py-3">
                    {h}
                  </div>
                ))}
              </div>

              <div role="table" aria-label="Danh sách dịch vụ kỹ thuật" className="scroll-hover min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {query.isLoading && (
                  <div className="space-y-2 p-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                )}
                {!query.isLoading && items.length === 0 && !query.isError && (
                  <div className="p-6">
                    <EmptyState
                      icon={Flask}
                      title={search !== '' ? 'Không tìm thấy dịch vụ nào' : 'Chưa có dịch vụ kỹ thuật nào'}
                      description={search !== '' ? 'Thử từ khoá khác hoặc bỏ lọc nhóm dịch vụ.' : 'Thêm xét nghiệm, chẩn đoán hình ảnh hoặc thăm dò chức năng để bác sĩ chỉ định.'}
                      action={
                        canCreate && search === '' ? (
                          <Button type="button" onClick={() => setDialog({ mode: 'create' })}>
                            <Plus size={15} weight="bold" aria-hidden="true" />
                            Thêm dịch vụ
                          </Button>
                        ) : undefined
                      }
                    />
                  </div>
                )}
                {items.map((item) => (
                  <ServiceRow
                    key={item.id}
                    item={item}
                    categoryName={item.categoryCode ? (categoryName.get(item.categoryCode) ?? item.categoryCode) : '—'}
                    specimenName={item.specimenTypeCode ? (specimenName.get(item.specimenTypeCode) ?? item.specimenTypeCode) : '—'}
                    canUpdate={canUpdate}
                    onView={() => setDialog({ mode: 'view', id: item.id })}
                    onEdit={() => setDialog({ mode: 'edit', id: item.id })}
                  />
                ))}
              </div>
            </div>
          </div>
          {counts !== undefined && items.length > 0 && (
            <div className="flex-shrink-0 border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-400">
              Hiển thị {items.length} / {counts.total} dịch vụ
            </div>
          )}
        </div>
      </section>

      {dialog && (
        <TechnicalServiceFormDialog
          key={dialog.mode === 'create' ? 'new' : `${dialog.mode}-${dialog.id}`}
          mode={dialog.mode}
          serviceId={dialog.mode === 'create' ? null : dialog.id}
          onClose={() => setDialog(null)}
          onSwitchToEdit={(id) => setDialog({ mode: 'edit', id })}
        />
      )}
    </div>
  );
}

function ServiceRow({
  item,
  categoryName,
  specimenName,
  canUpdate,
  onView,
  onEdit,
}: {
  item: TechnicalServiceItem;
  categoryName: string;
  specimenName: string;
  canUpdate: boolean;
  onView: () => void;
  onEdit: () => void;
}) {
  const first = item.currentPrices[0];
  const extra = item.currentPrices.length - 1;
  return (
    <div
      role="row"
      className="grid items-center border-b border-slate-200 text-center text-sm"
      style={{ gridTemplateColumns: GRID_COLUMNS, height: ROW_HEIGHT_PX }}
    >
      <div role="cell" className="px-2 font-semibold text-slate-800">
        {item.code}
      </div>
      <div role="cell" className="min-w-0 truncate px-2.5 text-left font-medium text-slate-900" title={item.name}>
        {item.name}
      </div>
      <div role="cell" className="px-2 font-medium text-slate-600">
        {categoryName}
      </div>
      <div role="cell" className="px-2 font-medium text-slate-600">
        {item.isPerformedInHouse ? (item.departmentName ?? '—') : <StatusBadge tone="warning">Gửi ra ngoài</StatusBadge>}
      </div>
      <div role="cell" className="px-2 font-medium text-slate-600">
        {specimenName}
      </div>
      <div role="cell" className="px-2.5 text-right font-semibold text-slate-900">
        {first ? (
          <>
            {formatVnd(first.amount)}
            {extra > 0 && <span className="ml-1 text-[11px] font-semibold text-slate-400">+{extra}</span>}
          </>
        ) : (
          <span className="font-normal text-slate-400">—</span>
        )}
      </div>
      <div role="cell" className="px-2 font-medium text-slate-600">
        {item.indicatorCount > 0 ? item.indicatorCount : '—'}
      </div>
      <div role="cell" className="px-2">
        <StatusBadge tone={item.isActive ? 'success' : 'neutral'}>{item.isActive ? 'Đang dùng' : 'Ngưng dùng'}</StatusBadge>
      </div>
      <div role="cell" className="flex items-center justify-center gap-1.5 px-2">
        <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={onView} />
        {canUpdate && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={onEdit} />}
      </div>
    </div>
  );
}
