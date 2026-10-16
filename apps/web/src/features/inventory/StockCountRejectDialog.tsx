import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { useRejectStockCountMutation } from './inventory.queries';

/** Từ chối phiếu kiểm kê (lý do bắt buộc, chỉ Nháp→Duyệt/Từ chối, #170) — lớp mỏng quanh `ReasonConfirmDialog` dùng chung (trước đây là bản sao riêng; `.claude/docs/ui-guidelines.md` mục 15b). */
export function StockCountRejectDialog({
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
  const mutation = useRejectStockCountMutation();

  return (
    <ReasonConfirmDialog
      title="Từ chối phiếu kiểm kê"
      rows={[{ label: 'Phiếu', value: countNo }]}
      note="Không đụng tồn kho."
      confirmLabel="Xác nhận từ chối"
      confirmVariant="danger"
      onConfirm={(reason) => mutation.mutateAsync({ id: countId, body: { reason, version } })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
