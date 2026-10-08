import { useEffect, useState, type FormEvent } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { useSpecimenCollection } from './specimen-tube.queries';

/**
 * "Huỷ xác nhận đã lấy mẫu" (mockup 13d, menu ⋯ của dòng "Đã lấy mẫu"; docs/DECISIONS.md #220): trả các ống đã lấy của dòng về "Chờ lấy mẫu". Bắt buộc nhập lý do (ghi vào nhật ký);
 * API chỉ cho khi chưa có kết quả nào (kể cả bản nháp). Enter gửi, Esc đóng.
 */
export function SpecimenUncollectDialog({ tubeIds, orderNo, onClose, onDone }: { tubeIds: string[]; orderNo: string; onClose: () => void; onDone: () => void }) {
  const api = useSpecimenCollection();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 2) {
      setError('Nhập lý do huỷ xác nhận (ít nhất 2 ký tự).');
      return;
    }
    setError(null);
    try {
      await api.uncollect.mutateAsync({ tubeIds, reason: trimmed });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không huỷ được xác nhận. Thử lại sau.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Huỷ xác nhận đã lấy mẫu">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader icon={ArrowCounterClockwise} title="Huỷ xác nhận đã lấy mẫu" subtitle={`Phiếu ${orderNo}`} onClose={onClose} />
        <p className="mb-3 text-sm text-slate-600">Phiếu quay về tab “Chờ lấy mẫu”. Chỉ làm được khi chưa nhập kết quả (kể cả bản nháp).</p>
        <label htmlFor="un-reason" className="mb-1 block text-sm font-semibold text-slate-800">
          Lý do <span className="text-rose-600">*</span>
        </label>
        <input
          id="un-reason"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ví dụ: Bấm nhầm"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Thôi
          </Button>
          <Button type="submit" variant="danger" loading={api.uncollect.isPending}>
            Huỷ xác nhận
          </Button>
        </div>
      </form>
    </div>
  );
}
