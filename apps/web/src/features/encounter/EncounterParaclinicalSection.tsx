import { useState } from 'react';
import { Flask } from '@phosphor-icons/react';
import type { ClinicalOrderItemView } from '@nexamed/shared';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useHasPermission } from '../auth/usePermission';
import { resultStatusOf } from '../clinical-order/clinical-order-results';
import { useClinicalOrderQuery } from '../clinical-order/clinical-order.queries';
import { TECHNICAL_SERVICE_KIND_LABELS } from '../paraclinical/paraclinical-labels';
import { groupOfServiceKind, type ParaclinicalGroup } from '../paraclinical-result/paraclinical-group';
import { ParaclinicalResultViewDialog } from '../paraclinical-result/ParaclinicalResultViewDialog';

/** Mọi dịch vụ cận lâm sàng của lượt khám chưa huỷ: làm tại phòng khám (có kết quả trong hệ thống) và chỉ định ra ngoài (chỉ in phiếu, không có kết quả). */
function selectParaclinicalRows(items: ClinicalOrderItemView[]): ClinicalOrderItemView[] {
  return items.filter((i) => i.status !== 'CANCELLED' && ((i.performance === 'IN_HOUSE' && i.serviceKind !== null) || i.performance === 'EXTERNAL'));
}

/**
 * Khối "Kết quả cận lâm sàng" trong hộp "Chi tiết đợt khám" (tab "Lịch sử khám chữa bệnh", docs/DECISIONS.md #223, đúng mockup đã duyệt). Chỉ hiện khi tài khoản có quyền xem chỉ định
 * (`clinical_order.read`) và lượt khám có ít nhất 1 dịch vụ. Nút "Xem" mở đúng phiếu kết quả (hộp thoại chỉ-xem có sẵn) — chỉ khi đã có kết quả đã duyệt VÀ có quyền Xem của nhóm tương ứng
 * (`lab_result.read` / `imaging_result.read`). Dịch vụ chỉ định ra ngoài không có kết quả để xem.
 */
export function EncounterParaclinicalSection({ encounterId }: { encounterId: string }) {
  const canReadOrders = useHasPermission('clinical_order', 'read');
  const canViewLab = useHasPermission('lab_result', 'read');
  const canViewImaging = useHasPermission('imaging_result', 'read');
  const query = useClinicalOrderQuery(encounterId, canReadOrders);
  const [viewing, setViewing] = useState<{ group: ParaclinicalGroup; itemId: string } | null>(null);

  if (!canReadOrders) return null;
  const rows = selectParaclinicalRows(query.data?.order?.items ?? []);
  if (query.isSuccess && rows.length === 0) return null;

  return (
    <div className="relative rounded-lg border border-slate-200 bg-white p-5 pt-8 shadow-sm">
      <span className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
        <Flask size={12} weight="bold" aria-hidden="true" />
        Kết quả cận lâm sàng
      </span>
      {query.isPending && <Skeleton className="h-24 w-full" />}
      {query.isError && <ErrorBanner message="Không tải được kết quả cận lâm sàng." onRetry={() => void query.refetch()} />}
      {query.isSuccess && (
        <div className="scroll-hover overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                <th scope="col" className="px-3 py-2 text-center">Dịch vụ</th>
                <th scope="col" className="px-3 py-2 text-center">Nhóm</th>
                <th scope="col" className="px-3 py-2 text-center">Trạng thái</th>
                <th scope="col" className="px-3 py-2 text-center">Trả kết quả</th>
                <th scope="col" className="px-3 py-2 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((item) => {
                const outside = item.performance === 'EXTERNAL';
                const status = resultStatusOf(item);
                const group = item.serviceKind ? groupOfServiceKind(item.serviceKind) : null;
                const canView = group === 'lab' ? canViewLab : group === 'imaging' ? canViewImaging : false;
                const viewable = !outside && item.resultReturnedAt !== null && group !== null && canView;
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2.5 text-left font-medium text-slate-900">
                      {item.name}
                      {outside && <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">Ra ngoài</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center font-medium text-slate-600">{item.serviceKind ? TECHNICAL_SERVICE_KIND_LABELS[item.serviceKind] : '—'}</td>
                    <td className="px-3 py-2.5 text-center">{outside ? <StatusBadge tone="neutral">Chỉ định ra ngoài</StatusBadge> : <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}</td>
                    <td className="px-3 py-2.5 text-center font-medium tabular-nums text-slate-600">{item.resultReturnedAt && !outside ? formatShortDateTimeVn(item.resultReturnedAt) : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 text-center">
                      {viewable && group ? (
                        <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setViewing({ group, itemId: item.id })}>
                          Xem
                        </Button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {viewing && <ParaclinicalResultViewDialog group={viewing.group} itemId={viewing.itemId} onClose={() => setViewing(null)} />}
    </div>
  );
}
