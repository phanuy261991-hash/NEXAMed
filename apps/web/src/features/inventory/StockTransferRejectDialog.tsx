import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { useRejectStockTransferMutation } from './inventory.queries';

/** Từ chối phiếu điều chuyển kho (lý do bắt buộc, chỉ Nháp→Duyệt xuất/Từ chối, #170) — lớp mỏng quanh `ReasonConfirmDialog` dùng chung (trước đây là bản sao riêng; `.claude/docs/ui-guidelines.md` mục 15b). */
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
  const mutation = useRejectStockTransferMutation();

  return (
    <ReasonConfirmDialog
      title="Từ chối phiếu điều chuyển kho"
      rows={[{ label: 'Phiếu', value: transferNo }]}
      note="Không xuất kho."
      confirmLabel="Xác nhận từ chối"
      confirmVariant="danger"
      onConfirm={(reason) => mutation.mutateAsync({ id: transferId, body: { reason, version } })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
