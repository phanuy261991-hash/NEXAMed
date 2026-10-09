import { useState } from 'react';
import { Flask } from '@phosphor-icons/react';
import type { ClinicalOrderItemView } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { useHasPermission } from '../auth/usePermission';
import { groupOfServiceKind, type ParaclinicalGroup } from '../paraclinical-result/paraclinical-group';
import { ParaclinicalResultViewDialog } from '../paraclinical-result/ParaclinicalResultViewDialog';
import { resultStatusOf, selectResultItems } from './clinical-order-results';
import { useClinicalOrderQuery } from './clinical-order.queries';

const GRID = 'grid grid-cols-[104px_minmax(0,1fr)_150px_150px_110px] items-center';

/**
 * Nội dung tab "Kết quả cận lâm sàng" của màn khám (tách khỏi tab "Chỉ định cận lâm sàng", #221): bảng Mã | Dịch vụ | Trạng thái | Trả lúc | Thao tác cho MỌI dịch vụ làm tại phòng khám
 * (kể cả dòng mới chỉ định — "Chờ thực hiện"). Nút "Xem" mở hộp thoại chỉ-xem đúng phiếu kết quả — chỉ hiện khi đã có kết quả đã duyệt VÀ actor có quyền Xem của nhóm tương ứng
 * (`lab_result.read` / `imaging_result.read`, bác sĩ có sẵn). Có đủ trạng thái tải / lỗi / trống.
 */
export function ClinicalOrderResultsTab({ encounterId }: { encounterId: string }) {
  const query = useClinicalOrderQuery(encounterId);
  if (query.isPending) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (query.isError) return <ErrorBanner message="Không tải được kết quả cận lâm sàng." onRetry={() => void query.refetch()} />;
  const items = query.data.order?.items ?? [];
  if (selectResultItems(items).length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-slate-400">
        <Flask size={30} weight="light" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-600">Chưa có chỉ định cận lâm sàng tại phòng khám.</p>
        <p className="text-xs">Chỉ định ở tab "Chỉ định cận lâm sàng"; kết quả sẽ hiện ở đây khi có.</p>
      </div>
    );
  }
  return <ClinicalOrderResultsBlock items={items} />;
}

export function ClinicalOrderResultsBlock({ items, bare = false }: { items: ClinicalOrderItemView[]; bare?: boolean }) {
  const canViewLab = useHasPermission('lab_result', 'read');
  const canViewImaging = useHasPermission('imaging_result', 'read');
  const [viewing, setViewing] = useState<{ group: ParaclinicalGroup; itemId: string } | null>(null);

  const rows = selectResultItems(items);

  function canView(group: ParaclinicalGroup): boolean {
    return group === 'lab' ? canViewLab : canViewImaging;
  }

  return (
    <section className={bare ? 'overflow-hidden' : 'overflow-hidden rounded-lg border border-slate-200 bg-white'} aria-label="Kết quả cận lâm sàng của lượt khám">
      {!bare && <h3 className="border-b border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13.5px] font-bold text-slate-900">Kết quả cận lâm sàng của lượt khám</h3>}
      <div role="table" aria-label="Kết quả cận lâm sàng của lượt khám">
        <div role="row" className={`${GRID} border-b-2 border-blue-600 bg-slate-100 text-center text-[10.5px] font-bold uppercase tracking-wide text-slate-800`}>
          <div role="columnheader" className="px-1.5 py-2.5">Mã</div>
          <div role="columnheader" className="px-1.5 py-2.5">Dịch vụ</div>
          <div role="columnheader" className="px-1.5 py-2.5">Trạng thái</div>
          <div role="columnheader" className="px-1.5 py-2.5">Trả lúc</div>
          <div role="columnheader" className="px-1.5 py-2.5">Thao tác</div>
        </div>
        {rows.map((item) => {
          const status = resultStatusOf(item);
          const group = item.serviceKind ? groupOfServiceKind(item.serviceKind) : null;
          const viewable = item.resultReturnedAt !== null && group !== null && canView(group);
          return (
            <div key={item.id} role="row" className={`${GRID} h-[52px] border-b border-slate-100 text-center text-[13px] last:border-b-0`}>
              <div role="cell" className="font-semibold text-slate-800">{item.code ?? '—'}</div>
              <div role="cell" className="min-w-0 truncate pl-2.5 text-left font-medium text-slate-900" title={item.name}>{item.name}</div>
              <div role="cell">
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </div>
              <div role="cell" className={item.resultReturnedAt ? 'font-medium text-slate-600' : 'text-slate-400'}>
                {item.resultReturnedAt ? formatShortDateTimeVn(item.resultReturnedAt) : '—'}
              </div>
              <div role="cell">
                {viewable && group ? (
                  <Button type="button" variant="secondary" className="px-3 py-1" onClick={() => setViewing({ group, itemId: item.id })}>
                    Xem
                  </Button>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {viewing && <ParaclinicalResultViewDialog group={viewing.group} itemId={viewing.itemId} onClose={() => setViewing(null)} />}
    </section>
  );
}
