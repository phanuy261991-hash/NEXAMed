import { useState } from 'react';
import { Eye, Warning } from '@phosphor-icons/react';
import type { SupplierDebtAdjustment } from '@nexamed/shared';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useSupplierDebtAdjustmentsQuery } from './supplier-debt.queries';
import { SupplierDebtAdjustmentDetailDialog } from './SupplierDebtAdjustmentDetailDialog';

const KIND_LABEL: Record<SupplierDebtAdjustment['kind'], string> = {
  INCREASE: 'Điều chỉnh tăng',
  DECREASE: 'Điều chỉnh giảm',
  VOID_REQUEST: 'Đề nghị huỷ',
};

const STATUS_META: Record<SupplierDebtAdjustment['status'], { label: string; tone: StatusBadgeTone }> = {
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Đã từ chối', tone: 'danger' },
};

/**
 * Badge "Có điều chỉnh" (Phần D, docs/DECISIONS.md #180/#182/#187) — đặt cạnh trạng thái phiếu ở
 * `StockReceiptFormPage.tsx`/`StockIssueFormPage.tsx`. Chỉ hiện khi có ≥1 Phiếu điều chỉnh/Đề nghị
 * huỷ gắn phiếu này (đúng 1 trong `targetReceiptId`/`targetIssueId`) — tự ẩn nếu chưa từng có.
 */
export function SupplierDebtAdjustmentBadge({ targetReceiptId, targetIssueId }: { targetReceiptId?: string; targetIssueId?: string }) {
  const query = useSupplierDebtAdjustmentsQuery({ targetReceiptId, targetIssueId });
  const [listOpen, setListOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const items = query.data?.items ?? [];
  if (items.length === 0) return null;
  const viewing = items.find((a) => a.id === viewingId) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setListOpen(true)}
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-200"
      >
        <Warning size={13} weight="fill" aria-hidden="true" />
        Có điều chỉnh ({items.length})
      </button>

      {listOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Điều chỉnh công nợ liên quan">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <ModalHeader icon={Warning} title="Điều chỉnh công nợ liên quan" onClose={() => setListOpen(false)} />
            <div className="flex flex-col gap-2">
              {items.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {a.adjustmentNo} · {KIND_LABEL[a.kind]}
                    </p>
                    <p className="text-xs text-slate-500">{a.amount !== null ? formatVnd(a.amount) : a.reason}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <StatusBadge tone={STATUS_META[a.status].tone}>{STATUS_META[a.status].label}</StatusBadge>
                    <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => setViewingId(a.id)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {viewing && <SupplierDebtAdjustmentDetailDialog adjustment={viewing} onClose={() => setViewingId(null)} />}
    </>
  );
}
