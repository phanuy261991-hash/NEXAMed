import { useEffect, useState } from 'react';
import { ArrowSquareOut, ArrowsIn, ArrowsOut, CheckCircle } from '@phosphor-icons/react';
import type { LabPartnerDoneRow } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatDateTimeVn } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { formatWaitDuration } from '../paraclinical-result/paraclinical-result-labels';
import { useApproveLabPartnerResultMutation, useReturnLabPartnerResultMutation } from './lab-partner.queries';

/**
 * Xem và DUYỆT kết quả đối tác (mockup màn 5, docs/DECISIONS.md #291): bên trái là tệp PDF, bên phải thông tin + nhận xét/kết luận. Bác sĩ (có quyền duyệt) bấm "Duyệt kết quả" hoặc
 * "Duyệt & xem kết quả kế tiếp" (nhảy sang ca chờ duyệt kế tiếp để không phải mở lại từng ca). "Trả lại kỹ thuật viên" (sai tệp/thiếu trang) cần lý do, chỉ khi chưa duyệt.
 * Đã duyệt thì chỉ xem. Duyệt là KÝ kết quả: xem tệp rồi mới duyệt, không có duyệt hàng loạt.
 */
export function LabPartnerResultDialog({
  row,
  hasNext,
  canApprove,
  canReturn,
  onClose,
  onApproved,
  onReturned,
}: {
  row: LabPartnerDoneRow;
  hasNext: boolean;
  canApprove: boolean;
  canReturn: boolean;
  onClose: () => void;
  /** `openNext` = người dùng bấm "Duyệt & xem kết quả kế tiếp". */
  onApproved: (openNext: boolean) => void;
  onReturned: () => void;
}) {
  const approve = useApproveLabPartnerResultMutation();
  const giveBack = useReturnLabPartnerResultMutation();
  const pending = row.approval === 'PENDING';
  const [conclusion, setConclusion] = useState(row.conclusionText ?? '');
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  // "Phóng to PDF": PDF chiếm cả chiều ngang hộp, thông tin + nhận xét xuống dưới (đọc kết quả nhiều trang/chữ nhỏ).
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setConclusion(row.conclusionText ?? '');
    setError(null);
  }, [row.itemId, row.conclusionText]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !returning) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, returning]);

  async function handleApprove(openNext: boolean) {
    if (approve.isPending) return;
    setError(null);
    try {
      await approve.mutateAsync({ itemId: row.itemId, body: { conclusionText: conclusion.trim() } });
      onApproved(openNext);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không duyệt được kết quả. Nhận xét của bạn vẫn còn, thử lại sau.');
    }
  }

  const infoRow = (label: string, value: string) => (
    <div className="grid grid-cols-[130px_1fr] gap-2 border-b border-slate-100 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Kết quả của đối tác">
      <div className="my-4 w-full max-w-7xl rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader
          icon={CheckCircle}
          title={pending ? `Duyệt kết quả · ${row.patientName}` : `Kết quả · ${row.patientName}`}
          subtitle={row.approval === 'APPROVED' ? 'Đã duyệt' : 'Chờ duyệt'}
          onClose={onClose}
        />
        <div className={`grid grid-cols-1 gap-4 ${zoomed ? '' : 'lg:grid-cols-[2fr_1fr]'}`}>
          <div className="min-w-0">
            {/* `#view=FitH` cho trình đọc PDF của trình duyệt vừa bề ngang khung; bỏ ngăn thumbnail để chữ lớn hơn. */}
            <iframe title="Tệp PDF kết quả của đối tác" src={`${row.fileUrl}#view=FitH&navpanes=0`} className={`${zoomed ? 'h-[72vh]' : 'h-[68vh]'} w-full rounded-md border border-slate-300 bg-slate-100`} />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <a href={row.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
                <ArrowSquareOut size={15} aria-hidden="true" />
                Mở tệp {row.fileName} ở thẻ mới
              </a>
              <button type="button" onClick={() => setZoomed((v) => !v)} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline" aria-pressed={zoomed}>
                {zoomed ? <ArrowsIn size={15} aria-hidden="true" /> : <ArrowsOut size={15} aria-hidden="true" />}
                {zoomed ? 'Thu nhỏ PDF' : 'Phóng to PDF'}
              </button>
            </div>
          </div>
          <div className="min-w-0">
            {infoRow('Bệnh nhân', `${row.patientName} · ${row.patientCode}`)}
            {infoRow('Dịch vụ', row.serviceName)}
            {infoRow('Đối tác', row.supplierName)}
            {infoRow('Gửi lúc', formatDateTimeVn(row.sentAt))}
            {infoRow('Nhận kết quả lúc', `${formatDateTimeVn(row.receivedAt)} (${formatWaitDuration(row.sentAt, new Date(row.receivedAt).getTime())})${row.late ? ' · quá hạn' : ''}`)}
            {row.approval === 'APPROVED' && infoRow('Duyệt bởi', `${row.approvedByName ?? '—'}${row.approvedAt ? ` · ${formatDateTimeVn(row.approvedAt)}` : ''}`)}
            <div className="mt-3">
              <label htmlFor="lrd-conclusion" className="mb-1 block text-sm font-semibold text-slate-800">
                Nhận xét / Kết luận
              </label>
              <textarea
                id="lrd-conclusion"
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value)}
                readOnly={!(pending && canApprove)}
                maxLength={2000}
                rows={4}
                placeholder={pending && canApprove ? 'Ví dụ: Không có bất thường' : ''}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 read-only:bg-slate-50 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2.5">
          {pending && canReturn ? (
            <Button type="button" variant="secondary" onClick={() => setReturning(true)}>
              Trả lại kỹ thuật viên…
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2.5">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            {pending && canApprove && (
              <>
                {hasNext && (
                  <Button type="button" variant="secondary" disabled={approve.isPending} onClick={() => void handleApprove(true)}>
                    Duyệt & xem kết quả kế tiếp
                  </Button>
                )}
                <Button type="button" loading={approve.isPending} onClick={() => void handleApprove(false)}>
                  Duyệt kết quả
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {returning && (
        <ReasonConfirmDialog
          title="Trả lại kỹ thuật viên"
          rows={[
            { label: 'Bệnh nhân', value: row.patientName },
            { label: 'Dịch vụ', value: row.serviceName },
          ]}
          note="Kết quả đã nhận bị bỏ, mẫu về “Đã gửi chờ kết quả” và khoản nợ đối tác được đảo lại."
          confirmLabel="Trả lại"
          confirmVariant="danger"
          onConfirm={(reason) => giveBack.mutateAsync({ itemId: row.itemId, body: { reason } })}
          onDone={() => {
            setReturning(false);
            onReturned();
          }}
          onClose={() => setReturning(false)}
        />
      )}
    </div>
  );
}
