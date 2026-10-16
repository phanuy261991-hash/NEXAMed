import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { useVoidStockIssueMutation } from './inventory.queries';

/** Huỷ phiếu xuất kho đã xuất (lý do bắt buộc; quyền `stock_issue.create`, `StockIssueController.voidIssue()`) — lớp mỏng quanh `ReasonConfirmDialog` dùng chung (trước đây là bản sao riêng; `.claude/docs/ui-guidelines.md` mục 15b). */
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
  const mutation = useVoidStockIssueMutation();

  return (
    <ReasonConfirmDialog
      title="Huỷ phiếu xuất kho"
      rows={[{ label: 'Phiếu', value: issueNo }]}
      note="Tồn kho đã trừ từ phiếu này sẽ được cộng lại."
      confirmLabel="Xác nhận huỷ"
      confirmVariant="danger"
      onConfirm={(reason) => mutation.mutateAsync({ id: issueId, body: { reason, version } })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
