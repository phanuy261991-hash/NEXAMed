import { useState, type FormEvent } from 'react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { useVoidStockIssueMutation } from './inventory.queries';

/**
 * Popup xác nhận Huỷ phiếu xuất kho đã xuất — lý do bắt buộc, đúng khuôn `ReasonConfirmDialog.tsx`
 * (`stock_receipt`)/`StockCountRejectDialog.tsx`. Dùng ở `StockIssueListPage.tsx` (rà soát 22/09/2026
 * phát hiện `voidStockIssue` đã có sẵn ở backend từ GĐ3 #163 nhưng chưa có nơi nào trong web gọi
 * tới — quyền dùng `stock_issue.create`, đúng `StockIssueController.voidIssue()`).
 */
export function StockIssueVoidDialog({
  issueId,
  issueNo,
  version,
  onDone,
  onClose,
}: {
  issueId: string;
  issueNo: string;
  version: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const voidMutation = useVoidStockIssueMutation();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return;
    try {
      await voidMutation.mutateAsync({ id: issueId, body: { reason, version } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Huỷ phiếu thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="issue-void-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="issue-void-title" className="text-sm font-semibold text-slate-900">
            Huỷ phiếu xuất kho?
          </p>
          <p className="mt-1.5 text-xs text-slate-500">Phiếu {issueNo} sẽ bị huỷ — tồn kho đã trừ từ phiếu này sẽ được cộng trả lại.</p>

          <div className="mt-3.5">
            <label htmlFor="issue-void-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="issue-void-reason"
              rows={2}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant="danger" loading={voidMutation.isPending} disabled={!reason.trim()}>
              Xác nhận huỷ
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
