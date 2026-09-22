import { useNavigate } from 'react-router-dom';
import { Archive } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useHasPermission } from '../auth/usePermission';
import { useStockIssueQuery } from './inventory.queries';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')} ${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * Xem chi tiết 1 phiếu xuất kho — CHỈ ĐỌC. Dùng cho tab "Đã phát hôm nay"
 * (`DispenseQueuePage.tsx`). Huỷ phiếu (`voidStockIssue` đã có sẵn ở backend/`inventory.queries.ts`
 * từ #163 nhưng chưa có nơi nào gọi tới) để dành cho khi chủ dự án yêu cầu riêng, không thêm ở đây.
 */
export function StockIssueDetailDialog({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const canViewInvoice = useHasPermission('invoice', 'read');
  const query = useStockIssueQuery(issueId);
  const issue = query.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Chi tiết phiếu xuất kho">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        <div className="px-5 pt-5">
          <ModalHeader
            icon={Archive}
            title={issue ? `Phiếu ${issue.issueNo}` : 'Phiếu xuất kho'}
            subtitle={issue ? `${issue.warehouseName} · Xuất ${formatDateTime(issue.occurredAt)}` : undefined}
            right={issue && <StatusBadge tone={issue.status === 'VOIDED' ? 'neutral' : 'success'}>{issue.status === 'VOIDED' ? 'Đã huỷ' : 'Đã phát'}</StatusBadge>}
            onClose={onClose}
          />
        </div>

        {query.isPending && (
          <div className="space-y-2 px-5 pb-5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        {query.isError && (
          <div className="px-5 pb-5">
            <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được chi tiết phiếu xuất kho.'} onRetry={() => void query.refetch()} />
          </div>
        )}

        {issue && (
          <div className="scroll-hover min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            <p className="mb-3 text-sm text-slate-600">
              Bệnh nhân <span className="font-semibold text-slate-900">{issue.patientFullName ?? '—'}</span>
              {issue.patientCode && <span className="text-slate-400"> ({issue.patientCode})</span>}
            </p>

            <div className="flex flex-col divide-y divide-slate-200 rounded-lg border border-slate-200">
              {issue.lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{line.drugName}</p>
                    <p className="text-xs text-slate-400">
                      {line.batchNo ? `Lô ${line.batchNo} · ` : ''}SL {line.quantity} × {formatVnd(line.sellPrice)}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums text-slate-900">{formatVnd(line.lineAmount)}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-slate-600">Tổng tiền</span>
              <span className="text-base font-bold text-slate-900">{formatVnd(issue.totalAmount)}</span>
            </div>

            {issue.note && <p className="mt-2 px-1 text-xs text-slate-500">Ghi chú: {issue.note}</p>}

            {issue.status === 'VOIDED' && (
              <div className="mt-3 rounded-md bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
                Đã huỷ bởi <span className="font-semibold">{issue.voidedByName}</span>
                {issue.voidedAt && ` lúc ${formatDateTime(issue.voidedAt)}`}
                {issue.voidReason && ` — Lý do: ${issue.voidReason}`}
              </div>
            )}
          </div>
        )}

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-4">
          {canViewInvoice && issue?.attachedInvoice && issue.encounterId && (
            <Button type="button" variant="secondary" onClick={() => navigate(`/billing/${issue.encounterId}?invoiceId=${issue.attachedInvoice!.invoiceId}`)}>
              Xem hoá đơn →
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
