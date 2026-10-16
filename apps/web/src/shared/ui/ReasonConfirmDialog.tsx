import { useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle, Prohibit, type Icon } from '@phosphor-icons/react';
import { ApiError } from '../api/client';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Hộp thoại xác nhận 1 hành động cần LÝ DO BẮT BUỘC (Từ chối/Huỷ phiếu, Từ chối đơn nghỉ, Khoá công ty...) — dựng trên `ConfirmDialog` dùng chung (gọn, ít chữ, `.claude/docs/ui-guidelines.md`
 * mục 15b). Tách khỏi mutation cụ thể: nơi gọi truyền `onConfirm(reason)`. Tiêu đề là TÊN HÀNH ĐỘNG ngắn (không hỏi "...?"); đối tượng đưa vào `rows`; hậu quả là MỘT câu `note`.
 * Bọc <form> để Enter xác nhận (mục 4.4).
 */
export function ReasonConfirmDialog({
  title,
  rows,
  note,
  confirmLabel,
  confirmVariant,
  icon,
  onConfirm,
  onDone,
  onClose,
}: {
  title: string;
  rows?: Array<{ label: string; value: ReactNode; sub?: string }>;
  note?: string;
  confirmLabel: string;
  confirmVariant: 'danger' | 'primary';
  /** Mặc định: danger → Prohibit, primary → CheckCircle. */
  icon?: Icon;
  onConfirm: (reason: string) => Promise<unknown>;
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return;
    setPending(true);
    try {
      await onConfirm(reason);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thao tác thất bại, vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <ConfirmDialog
        icon={icon ?? (confirmVariant === 'danger' ? Prohibit : CheckCircle)}
        tone={confirmVariant === 'danger' ? 'danger' : 'primary'}
        title={title}
        rows={rows}
        note={note}
        error={error}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant={confirmVariant} loading={pending} disabled={!reason.trim()}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <label htmlFor="reason-confirm-text" className="mb-1 block text-sm font-semibold text-slate-800">
          Lý do <span className="text-rose-500">*</span>
        </label>
        <textarea
          id="reason-confirm-text"
          rows={2}
          required
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </ConfirmDialog>
    </form>
  );
}
