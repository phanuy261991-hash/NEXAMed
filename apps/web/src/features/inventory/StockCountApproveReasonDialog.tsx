import { useState, type FormEvent } from 'react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { useApproveStockCountMutation } from './inventory.queries';

/**
 * Popup xác nhận Duyệt phiếu kiểm kê CÓ chênh lệch — lý do bắt buộc (rà soát lỗ hổng quy trình
 * 22/09/2026, `docs/DECISIONS.md` #171). CHỈ mở khi backend từ chối Duyệt "trơn" (không kèm lý do)
 * bằng lỗi `STOCK_COUNT_APPROVAL_REASON_REQUIRED` — server là nguồn xác định DUY NHẤT có chênh lệch
 * hay không (đọc tồn kho SỐNG lúc Duyệt), không đoán trước ở client. Phiếu khớp hoàn toàn duyệt
 * thẳng, không qua dialog này.
 */
export function StockCountApproveReasonDialog({
  countId,
  countNo,
  version,
  onDone,
  onClose,
}: {
  countId: string;
  countNo: string;
  version: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const approveMutation = useApproveStockCountMutation();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return;
    try {
      await approveMutation.mutateAsync({ id: countId, body: { version, reason } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Duyệt phiếu thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="count-approve-reason-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="count-approve-reason-title" className="text-sm font-semibold text-slate-900">
            Duyệt phiếu kiểm kê có chênh lệch?
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Phiếu {countNo} có dòng dư/thiếu — Duyệt sẽ tự động điều chỉnh tồn kho ngay. Vui lòng nhập lý do chênh lệch trước khi tiếp tục.
          </p>

          <div className="mt-3.5">
            <label htmlFor="count-approve-reason-text" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="count-approve-reason-text"
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
            <Button type="submit" loading={approveMutation.isPending} disabled={!reason.trim()}>
              Xác nhận duyệt
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
