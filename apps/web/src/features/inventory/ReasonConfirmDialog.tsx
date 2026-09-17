import { useState, type FormEvent } from 'react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { useRejectStockReceiptMutation, useVoidStockReceiptMutation } from './inventory.queries';

/**
 * Popup xác nhận Từ chối/Huỷ phiếu nhập kho — lý do bắt buộc, đúng khuôn
 * `shared/ui/CancelEncounterDialog.tsx` (mục 4.4 Enter-to-submit). Dùng chung 2 hành động (không
 * tách 2 component riêng) vì hình dạng hoàn toàn giống nhau, chỉ khác API gọi + văn bản.
 */
export function ReasonConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmVariant,
  receiptId,
  version,
  action,
  onDone,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant: 'danger' | 'primary';
  receiptId: string;
  version: number;
  action: 'reject' | 'void';
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rejectMutation = useRejectStockReceiptMutation();
  const voidMutation = useVoidStockReceiptMutation();
  const pending = action === 'reject' ? rejectMutation.isPending : voidMutation.isPending;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return;
    try {
      if (action === 'reject') {
        await rejectMutation.mutateAsync({ id: receiptId, body: { reason, version } });
      } else {
        await voidMutation.mutateAsync({ id: receiptId, body: { reason, version } });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thao tác thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="reason-confirm-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="reason-confirm-title" className="text-sm font-semibold text-slate-900">
            {title}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">{description}</p>

          <div className="mt-3.5">
            <label htmlFor="reason-confirm-text" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="reason-confirm-text"
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
            <Button type="submit" variant={confirmVariant} loading={pending} disabled={!reason.trim()}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
