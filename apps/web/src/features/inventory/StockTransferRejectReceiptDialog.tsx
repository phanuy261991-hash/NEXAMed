import { useState, type FormEvent } from 'react';
import type { StockTransferRejectReceiptReason } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { useRejectStockTransferReceiptMutation } from './inventory.queries';
import { REJECT_RECEIPT_REASON_LABEL } from './stock-transfer-meta';

const REASON_OPTIONS = (Object.keys(REJECT_RECEIPT_REASON_LABEL) as StockTransferRejectReceiptReason[]).map((value) => ({ value, label: REJECT_RECEIPT_REASON_LABEL[value] }));

/**
 * "Từ chối nhận cả phiếu" (chi nhánh NHẬN) — Đợt 2 chi nhánh (docs/DECISIONS.md #233, mockup màn 4b-2). Khác "Từ chối" của phiếu Nháp
 * (`StockTransferRejectDialog`, bên gửi từ chối duyệt): ở đây hàng ĐÃ rời kho gửi nên phiếu chuyển sang "Từ chối nhận · đang hoàn trả" và chờ bên gửi
 * xác nhận nhận lại hàng. Không hoàn tác được. Form bọc `<form>` (Enter = xác nhận).
 */
export function StockTransferRejectReceiptDialog({
  transferId,
  transferNo,
  fromLabel,
  version,
  onDone,
  onClose,
}: {
  transferId: string;
  transferNo: string;
  /** Tên nơi gửi để hiện trong lời nhắc (vd. "Cơ sở chính"). */
  fromLabel: string;
  version: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<StockTransferRejectReceiptReason | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useRejectStockTransferReceiptMutation();
  const canSubmit = reason !== '' && note.trim() !== '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({ id: transferId, body: { version, reason, note: note.trim() } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thao tác thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="transfer-reject-receipt-title">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="transfer-reject-receipt-title" className="break-words text-sm font-semibold text-slate-900">
            Từ chối nhận cả phiếu {transferNo}?
          </p>
          <p className="mt-1.5 text-xs text-slate-600">
            Hàng <strong>không</strong> vào kho của bạn. Phiếu chuyển sang &quot;Từ chối nhận · đang hoàn trả&quot; và chờ <strong className="break-words">{fromLabel}</strong> xác nhận đã nhận lại hàng. Bước này
            không hoàn tác được.
          </p>

          <div className="mt-3.5">
            <label htmlFor="transfer-reject-receipt-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="text-rose-500">*</span>
            </label>
            <Combobox id="transfer-reject-receipt-reason" value={reason} onChange={(v) => setReason(v as StockTransferRejectReceiptReason | '')} placeholder="— Chọn lý do —" options={REASON_OPTIONS} />
          </div>

          <div className="mt-3">
            <label htmlFor="transfer-reject-receipt-note" className="mb-1 block text-sm font-semibold text-slate-800">
              Ghi chú chi tiết <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="transfer-reject-receipt-note"
              rows={3}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Vd: Hàng không đúng danh mục đã đề nghị, đề nghị gửi lại."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant="danger" loading={mutation.isPending} disabled={!canSubmit}>
              Từ chối nhận hàng
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
