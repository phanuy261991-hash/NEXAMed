import { useState, type FormEvent } from 'react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { useRejectStockTransferMutation } from './inventory.queries';

/**
 * Popup xác nhận Từ chối phiếu điều chuyển kho — lý do bắt buộc, đúng khuôn
 * `StockCountRejectDialog.tsx` (chỉ Nháp→Duyệt xuất/Từ chối, KHÔNG có nhánh Huỷ như `stock_receipt`
 * — "Điều chuyển kho" không hỗ trợ Huỷ sau khi đã Duyệt xuất, docs/DECISIONS.md #170).
 */
export function StockTransferRejectDialog({
  transferId,
  transferNo,
  version,
  onDone,
  onClose,
}: {
  transferId: string;
  transferNo: string;
  version: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rejectMutation = useRejectStockTransferMutation();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return;
    try {
      await rejectMutation.mutateAsync({ id: transferId, body: { reason, version } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thao tác thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="transfer-reject-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="transfer-reject-title" className="text-sm font-semibold text-slate-900">
            Từ chối phiếu điều chuyển kho?
          </p>
          <p className="mt-1.5 text-xs text-slate-500">Phiếu {transferNo} sẽ chuyển sang trạng thái Từ chối, không xuất kho.</p>

          <div className="mt-3.5">
            <label htmlFor="transfer-reject-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="transfer-reject-reason"
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
            <Button type="submit" variant="danger" loading={rejectMutation.isPending} disabled={!reason.trim()}>
              Xác nhận từ chối
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
