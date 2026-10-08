import { useState } from 'react';
import { ArrowsClockwise, Warning } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Textarea } from '../../shared/ui/Textarea';

/**
 * Hộp thoại "Đính chính" kết quả cận lâm sàng đã duyệt (docs/DECISIONS.md #215). Người có quyền Nhập của nhóm đề nghị kèm LÝ DO BẮT BUỘC (Thông tư 46/2018/TT-BYT); kết quả quay lại
 * "Đang thực hiện" để sửa rồi gửi duyệt, bác sĩ có quyền Duyệt ký lại. Bản đã duyệt cũ được giữ lại, không bị xoá. Là form riêng (không đặt trong `<form>` của trang).
 */
export function AmendResultDialog({ onSubmit, onClose }: { onSubmit: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = reason.trim().length < 5;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không mở được đính chính. Thử lại sau.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="amend-result-title">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader icon={ArrowsClockwise} title="Đính chính kết quả đã duyệt" subtitle="Bản đã duyệt được giữ lại" onClose={onClose} />
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3.5">
          <p id="amend-result-title" className="sr-only">
            Đính chính kết quả đã duyệt
          </p>
          <p className="text-sm leading-relaxed text-slate-600">
            Kết quả sẽ quay lại <strong className="text-slate-900">"Đang thực hiện"</strong> để sửa chỗ sai rồi gửi duyệt. Trong lúc đính chính, kết quả cũ chưa được dùng; bác sĩ có quyền duyệt sẽ ký lại. Bản đã duyệt
            trước đó vẫn được lưu, xem lại được trong nhật ký hoạt động.
          </p>
          <Textarea id="amend-result-reason" label="Lý do đính chính" required rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: nhập nhầm chỉ số glucose" autoFocus />
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
              <Warning size={15} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Huỷ
            </Button>
            <Button type="submit" loading={busy} disabled={tooShort}>
              Mở đính chính
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Xác nhận huỷ đính chính: bỏ bản đang soạn, khôi phục kết quả đã duyệt trước đó. Không phải form nhập liệu nên cố ý bắt bấm chuột (ui-guidelines 4.4). */
export function CancelAmendmentDialog({ onConfirm, onClose }: { onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không huỷ được đính chính. Thử lại sau.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-amend-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <p id="cancel-amend-title" className="text-sm font-semibold text-slate-900">
          Huỷ đính chính?
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">Các thay đổi đang soạn sẽ bị bỏ và kết quả đã duyệt trước đó được khôi phục nguyên vẹn.</p>
        {error && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
            <Warning size={15} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Quay lại
          </Button>
          <Button type="button" variant="danger" loading={busy} onClick={() => void confirm()}>
            Huỷ đính chính
          </Button>
        </div>
      </div>
    </div>
  );
}
