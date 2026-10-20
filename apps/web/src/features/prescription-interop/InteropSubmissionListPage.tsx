import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, PaperPlaneTilt, Prohibit, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import type { InteropSubmissionRow, InteropSubmissionStatus } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { PrescriptionKindChip } from '../../shared/ui/PrescriptionKindChip';
import { PrescriptionNationalCode } from '../../shared/ui/PrescriptionNationalCode';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateTimeVn } from '../../shared/format/time';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useHasPermission } from '../auth/usePermission';
import { SUBMISSION_STATUS_LABEL, SUBMISSION_STATUS_TONE } from './interop-info-view';
import {
  useInteropSubmissionsQuery,
  usePrescriptionInteropStatusQuery,
  useRetryInteropSubmissionMutation,
  useSendInteropSubmissionMutation,
} from './prescription-interop.queries';

const PAGE_SIZE = 30;
function daysAgoDateString(days: number): string {
  const [y, m, d] = getVietnamTodayDateString().split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

type Notice = { tone: 'success' | 'warning' | 'danger'; text: string };

/**
 * "Đơn thuốc liên thông" (docs/DECISIONS.md #242 GĐ3, mockup 8c) — hàng chờ gửi đơn thuốc lên cổng Đơn thuốc quốc gia của chi nhánh đang làm việc: mã đơn, bác sĩ ký, dữ liệu đủ/thiếu,
 * trạng thái gửi (Chờ gửi/Đã gửi/Lỗi/Đính chính chưa gửi), "Gửi ngay", "Gửi lại", xem lỗi cổng nguyên văn. Bảng KHÔNG hiện tên bệnh nhân. Công tắc "Có liên thông" tắt thì trang không dùng được.
 */
export function InteropSubmissionListPage() {
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Đơn thuốc liên thông' }]);
  const navigate = useNavigate();
  const statusQuery = usePrescriptionInteropStatusQuery();
  const enabled = statusQuery.data?.enabled === true;
  const canAct = useHasPermission('prescription', 'sign');

  const [status, setStatus] = useState<InteropSubmissionStatus | ''>('');
  const [dateFrom, setDateFrom] = useState(daysAgoDateString(30));
  const [dateTo, setDateTo] = useState(getVietnamTodayDateString());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [detail, setDetail] = useState<InteropSubmissionRow | null>(null);
  const [errorDialog, setErrorDialog] = useState<InteropSubmissionRow | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const listQuery = useInteropSubmissionsQuery({ status: status || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, limit, offset: 0 }, enabled);
  const sendMutation = useSendInteropSubmissionMutation();
  const retryMutation = useRetryInteropSubmissionMutation();
  const busyId = sendMutation.isPending ? sendMutation.variables : retryMutation.isPending ? retryMutation.variables : null;

  const items = listQuery.data?.items ?? [];
  const sendEnabled = listQuery.data?.sendEnabled === true;

  function act(row: InteropSubmissionRow, mode: 'send' | 'retry') {
    setNotice(null);
    const mutation = mode === 'retry' ? retryMutation : sendMutation;
    mutation.mutate(row.id, {
      onSuccess: (result) => {
        setNotice({ tone: result.outcome === 'SENT' ? 'success' : result.outcome === 'REJECTED' ? 'danger' : 'warning', text: `${row.nationalCode}: ${result.message}` });
        setErrorDialog(null);
      },
      onError: (err) => setNotice({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Không gửi được. Thử lại sau.' }),
    });
  }

  if (statusQuery.isSuccess && !enabled) {
    return (
      <div className="p-3">
        <h1 className="sr-only">Đơn thuốc liên thông</h1>
        <EmptyState icon={Prohibit} title="Liên thông đơn thuốc đang tắt" description='Bật "Có liên thông" ở Cấu hình hệ thống, mục "Liên thông đơn thuốc", để đơn ký xong được xếp vào hàng chờ gửi.' />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Đơn thuốc liên thông</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <Combobox
          id="interop-filter-status"
          value={status}
          onChange={(v) => {
            setStatus(v as InteropSubmissionStatus | '');
            setLimit(PAGE_SIZE);
          }}
          options={[{ value: '', label: 'Mọi trạng thái' }, ...(['PENDING', 'SENT', 'FAILED', 'AMENDED'] as const).map((s) => ({ value: s, label: SUBMISSION_STATUS_LABEL[s] }))]}
        />
        <div className="flex items-center gap-1.5">
          <DateInput id="interop-date-from" value={dateFrom} onChange={(v) => { setDateFrom(v); setLimit(PAGE_SIZE); }} dense />
          <span className="text-xs text-slate-400">đến</span>
          <DateInput id="interop-date-to" value={dateTo} onChange={(v) => { setDateTo(v); setLimit(PAGE_SIZE); }} dense />
        </div>
      </div>

      {listQuery.isSuccess && !sendEnabled && (
        <div role="status" className="flex flex-shrink-0 items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Chưa bật gửi đơn lên cổng đơn thuốc quốc gia. Đơn ký xong được xếp vào hàng chờ; chưa có đơn nào được gửi đi. Bật và kiểm tra kết nối ở Cấu hình hệ thống, &quot;Liên thông đơn thuốc&quot;.
          </span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`flex flex-shrink-0 items-start gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold ${
            notice.tone === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : notice.tone === 'danger' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-xs font-semibold underline">
            Đóng
          </button>
        </div>
      )}

      {listQuery.isError && <ErrorBanner message="Không tải được hàng chờ đơn thuốc liên thông." onRetry={() => void listQuery.refetch()} />}

      {listQuery.isPending && enabled && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={UploadSimple} title="Chưa có đơn nào trong hàng chờ" description="Đơn thuốc ký xong (khi đang bật liên thông và chế độ mã đơn Chuẩn Bộ Y tế) sẽ xuất hiện ở đây." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="scroll-hover h-full overflow-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                  <th className="px-4 py-2.5 text-center">Mã đơn</th>
                  <th className="px-4 py-2.5 text-left">Bác sĩ</th>
                  <th className="px-4 py-2.5 text-center">Thời điểm ký</th>
                  <th className="px-4 py-2.5 text-center">Dữ liệu</th>
                  <th className="px-4 py-2.5 text-center">Trạng thái gửi</th>
                  <th className="w-36 px-4 py-2.5 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-slate-200 last:border-0">
                    <td className="px-4 py-2 text-center">
                      <span className="inline-flex items-center gap-2">
                        <PrescriptionKindChip kind={row.kind} />
                        <PrescriptionNationalCode code={row.nationalCode} />
                      </span>
                    </td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{row.doctorName ?? '—'}</td>
                    <td className="px-4 py-2 text-center text-slate-600">{formatDateTimeVn(row.signedAt)}</td>
                    <td className="px-4 py-2 text-center">
                      {row.missingCount === null ? <span className="text-slate-400">—</span> : row.missingCount === 0 ? <StatusBadge tone="success">Đủ</StatusBadge> : <StatusBadge tone="warning">Thiếu {row.missingCount} mục</StatusBadge>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge tone={SUBMISSION_STATUS_TONE[row.status]}>{SUBMISSION_STATUS_LABEL[row.status]}</StatusBadge>
                      {row.status === 'SENT' && row.sentAt && <p className="mt-0.5 text-xs text-slate-500">cổng nhận {formatDateTimeVn(row.sentAt)}</p>}
                      {row.status === 'FAILED' && <p className="mt-0.5 text-xs text-slate-500">thử {row.attempts}/{row.maxRetries} lần</p>}
                      {row.status === 'PENDING' && row.attempts > 0 && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          thử {row.attempts}/{row.maxRetries} lần{row.nextAttemptAt ? ` · thử lại ${formatDateTimeVn(row.nextAttemptAt)}` : ''}
                        </p>
                      )}
                      {row.status === 'PENDING' && row.attempts === 0 && row.errors.length > 0 && (
                        <p className="mx-auto mt-0.5 max-w-[240px] truncate text-xs text-slate-500" title={row.errors[0]}>
                          {row.errors[0]}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => setDetail(row)} />
                        {row.status === 'FAILED' && <RowActionButton icon={WarningCircle} label="Xem lỗi" tone="danger" onClick={() => setErrorDialog(row)} />}
                        {canAct && (row.status === 'PENDING' || row.status === 'FAILED') && (
                          <RowActionButton
                            icon={PaperPlaneTilt}
                            label={!sendEnabled ? 'Bật "Gửi đơn lên cổng" ở Cấu hình hệ thống để dùng' : row.status === 'FAILED' ? 'Gửi lại' : 'Gửi ngay'}
                            tone="primary"
                            disabled={!sendEnabled || busyId === row.id}
                            onClick={() => act(row, row.status === 'FAILED' ? 'retry' : 'send')}
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listQuery.data && listQuery.data.total > items.length && (
              <div className="flex items-center justify-center gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
                Đang xem {items.length} trên tổng số {listQuery.data.total} đơn
                <Button type="button" variant="secondary" onClick={() => setLimit((v) => v + PAGE_SIZE)} loading={listQuery.isFetching}>
                  Xem thêm
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {detail && <SubmissionDetailDialog row={detail} onClose={() => setDetail(null)} onOpenEncounter={() => navigate(`/encounters/${detail.encounterId}`)} />}
      {errorDialog && (
        <SubmissionErrorDialog
          row={errorDialog}
          canRetry={canAct && sendEnabled}
          retrying={busyId === errorDialog.id}
          onClose={() => setErrorDialog(null)}
          onOpenEncounter={() => navigate(`/encounters/${errorDialog.encounterId}`)}
          onRetry={() => act(errorDialog, 'retry')}
        />
      )}
    </div>
  );
}

function DialogShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">{children}</div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] border-b border-slate-100 py-2 text-sm last:border-b-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/** Nút "Xem": thông tin gửi + các mục dữ liệu còn thiếu (để biết bổ sung gì ở màn kê đơn). */
function SubmissionDetailDialog({ row, onClose, onOpenEncounter }: { row: InteropSubmissionRow; onClose: () => void; onOpenEncounter: () => void }) {
  const blocking = row.missing.filter((p) => p.required);
  const reminders = row.missing.filter((p) => !p.required);
  return (
    <DialogShell label="Chi tiết đơn thuốc liên thông">
      <ModalHeader icon={UploadSimple} title="Đơn thuốc liên thông" subtitle={row.nationalCode} onClose={onClose} />
      <dl>
        <InfoRow label="Bác sĩ ký">{row.doctorName ?? '—'}</InfoRow>
        <InfoRow label="Thời điểm ký">{formatDateTimeVn(row.signedAt)}</InfoRow>
        <InfoRow label="Trạng thái gửi">{SUBMISSION_STATUS_LABEL[row.status]}</InfoRow>
        {row.attempts > 0 && (
          <InfoRow label="Số lần thử">
            {row.attempts}/{row.maxRetries}
            {row.lastAttemptAt ? ` · lần cuối ${formatDateTimeVn(row.lastAttemptAt)}` : ''}
          </InfoRow>
        )}
        {row.sentAt && <InfoRow label="Cổng nhận lúc">{formatDateTimeVn(row.sentAt)}</InfoRow>}
      </dl>
      {row.status === 'AMENDED' && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Đơn đã được đính chính sau khi gửi. Tài liệu cổng không có thao tác sửa hoặc huỷ đơn đã gửi nên hệ thống không tự gửi lại bản mới.
        </p>
      )}
      {(row.status === 'PENDING' || row.status === 'FAILED') && (
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-semibold text-slate-800">{blocking.length === 0 ? 'Dữ liệu đã đủ để gửi' : `Còn thiếu ${blocking.length} mục`}</p>
          {blocking.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {blocking.map((p, i) => (
                <li key={`${p.code}-${i}`}>{p.message}</li>
              ))}
            </ul>
          )}
          {reminders.length > 0 && <p className="mt-2 text-xs text-slate-500">{reminders.map((p) => p.message).join(' ')}</p>}
          {blocking.length > 0 && <p className="mt-2 text-xs text-slate-500">Bổ sung ở màn kê đơn (khối &quot;Thông tin liên thông&quot;) rồi đơn sẽ được gửi.</p>}
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Đóng
        </Button>
        <Button type="button" onClick={onOpenEncounter}>
          Mở lượt khám
        </Button>
      </div>
    </DialogShell>
  );
}

/** Nút "Xem lỗi": nguyên văn nội dung cổng trả (`danh_sach_cac_loi`), đánh số. */
function SubmissionErrorDialog({
  row,
  canRetry,
  retrying,
  onClose,
  onOpenEncounter,
  onRetry,
}: {
  row: InteropSubmissionRow;
  canRetry: boolean;
  retrying: boolean;
  onClose: () => void;
  onOpenEncounter: () => void;
  onRetry: () => void;
}) {
  return (
    <DialogShell label="Lỗi gửi đơn">
      <ModalHeader icon={WarningCircle} tone="danger" title="Lỗi gửi đơn" onClose={onClose} />
      <dl>
        <InfoRow label="Mã đơn">
          <PrescriptionNationalCode code={row.nationalCode} />
        </InfoRow>
        <InfoRow label="Lần thử cuối">
          {row.lastAttemptAt ? formatDateTimeVn(row.lastAttemptAt) : '—'} · {row.attempts}/{row.maxRetries} lần{row.lastHttpStatus ? ` · cổng trả ${row.lastHttpStatus}` : ''}
        </InfoRow>
      </dl>
      <p className="mb-1.5 mt-4 text-sm font-semibold text-slate-800">Cổng báo các lỗi sau (nguyên văn)</p>
      <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
        {row.errors.length === 0 ? (
          <p>Cổng không nêu nội dung lỗi.</p>
        ) : (
          <ol className="space-y-1">
            {row.errors.map((message, i) => (
              <li key={i}>
                {i + 1}. {message}
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">Lỗi dữ liệu thì dừng thử lại. Bổ sung ô còn thiếu ở màn kê đơn rồi bấm &quot;Gửi lại&quot;; lỗi mạng thì hệ thống tự thử lại.</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Đóng
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenEncounter}>
          Mở lượt khám
        </Button>
        {canRetry && (
          <Button type="button" onClick={onRetry} loading={retrying}>
            Gửi lại
          </Button>
        )}
      </div>
    </DialogShell>
  );
}
