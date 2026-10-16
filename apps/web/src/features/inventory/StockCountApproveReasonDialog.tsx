import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { useApproveStockCountMutation } from './inventory.queries';

/** Duyệt phiếu kiểm kê CÓ chênh lệch (lý do bắt buộc, #171) — chỉ mở khi backend trả STOCK_COUNT_APPROVAL_REASON_REQUIRED — lớp mỏng quanh `ReasonConfirmDialog` dùng chung (trước đây là bản sao riêng; `.claude/docs/ui-guidelines.md` mục 15b). */
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
  const mutation = useApproveStockCountMutation();

  return (
    <ReasonConfirmDialog
      title="Duyệt phiếu kiểm kê có chênh lệch"
      rows={[{ label: 'Phiếu', value: countNo }]}
      note="Duyệt sẽ điều chỉnh tồn kho ngay. Nhập lý do chênh lệch."
      confirmLabel="Xác nhận duyệt"
      confirmVariant="primary"
      onConfirm={(reason) => mutation.mutateAsync({ id: countId, body: { version, reason } })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
