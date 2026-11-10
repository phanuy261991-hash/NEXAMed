import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { DownloadSimple, FilePdf } from '@phosphor-icons/react';
import type { LabPartnerSentRow, ReceiveLabPartnerResultResponse } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { formatShortDateTimeVn, toVnDateAndTime, vnDateAndTimeToIso } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';
import { DateInput } from '../../shared/ui/DateInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { TimeInput } from '../../shared/ui/TimeInput';
import { useAuthStore } from '../auth/auth.store';
import { validatePdfFile } from './lab-partner-send-model';
import { useReceiveLabPartnerResultMutation, useRejectLabPartnerItemMutation } from './lab-partner.queries';

const inputClassName = 'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const formatSize = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Hộp "Nhận kết quả từ đối tác" (mockup màn 4, docs/DECISIONS.md #291): MỘT tệp PDF gắn cho nhiều dịch vụ của cùng đối tác. Chỉ liệt kê mẫu "Đã gửi" của đối tác đó; tích mẫu nào là kết quả của tệp này.
 * Giờ nhận chưa sửa thì không gửi (máy chủ lấy bây giờ). "Đối tác không nhận mẫu…" áp cho các mẫu đang tích (lý do bắt buộc, mẫu về "Chờ gửi").
 * Ghi nợ đối tác xảy ra ngay lúc lưu, đúng giá đã chụp lúc gửi.
 */
export function LabPartnerReceiveDialog({
  rows,
  initialSelectedIds,
  costVisible,
  onClose,
  onDone,
  onRejected,
}: {
  rows: LabPartnerSentRow[];
  initialSelectedIds: ReadonlySet<string>;
  costVisible: boolean;
  onClose: () => void;
  onDone: (result: ReceiveLabPartnerResultResponse) => void;
  onRejected: (count: number) => void;
}) {
  const receive = useReceiveLabPartnerResultMutation();
  const rejectMutation = useRejectLabPartnerItemMutation();
  const userName = useAuthStore((s) => s.user?.fullName ?? '');
  const first = rows.find((r) => initialSelectedIds.has(r.itemId)) ?? rows[0];
  const supplierId = first?.supplierId ?? '';
  const partnerRows = useMemo(() => rows.filter((r) => r.supplierId === supplierId), [rows, supplierId]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(partnerRows.filter((r) => initialSelectedIds.has(r.itemId)).map((r) => r.itemId)));
  const [file, setFile] = useState<File | null>(null);
  const [{ date, time }, setWhen] = useState(() => toVnDateAndTime());
  const [whenTouched, setWhenTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !rejecting) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, rejecting]);

  const grid = costVisible ? '34px 110px minmax(150px,1.3fr) minmax(170px,1.4fr) 120px 110px' : '34px 110px minmax(150px,1.3fr) minmax(170px,1.4fr) 120px';
  const allChecked = partnerRows.length > 0 && partnerRows.every((r) => checked.has(r.itemId));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    const problem = validatePdfFile(f);
    if (problem) {
      setFile(null);
      setError(problem);
      return;
    }
    setError(null);
    setFile(f);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (receive.isPending) return;
    if (!file) {
      setError('Chọn tệp PDF kết quả của đối tác.');
      return;
    }
    if (checked.size === 0) {
      setError('Tích ít nhất một mẫu mà tệp này là kết quả.');
      return;
    }
    const receivedAt = whenTouched ? vnDateAndTimeToIso(date, time) : null;
    if (whenTouched && receivedAt === null) {
      setError('Nhập đủ ngày và giờ nhận.');
      return;
    }
    if (receivedAt && new Date(receivedAt).getTime() > Date.now() + 60_000) {
      setError('Giờ nhận không được ở tương lai.');
      return;
    }
    setError(null);
    try {
      onDone(await receive.mutateAsync({ file, data: { itemIds: [...checked], ...(receivedAt ? { receivedAt } : {}) } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được kết quả. Tệp và lựa chọn của bạn vẫn còn, thử lại sau.');
    }
  }

  async function rejectChecked(reason: string) {
    for (const id of checked) await rejectMutation.mutateAsync({ itemId: id, body: { reason } });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Nhận kết quả từ đối tác">
      <form onSubmit={(e) => void handleSubmit(e)} className="my-6 w-full max-w-205 rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader icon={DownloadSimple} title="Nhận kết quả từ đối tác" subtitle={first?.supplierName} onClose={onClose} />

        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Tệp PDF kết quả" onChange={(e) => pickFile(e.target.files?.[0])} />
        <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3">
          <FilePdf size={32} weight="fill" className="flex-none text-rose-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {file ? (
              <>
                <div className="truncate font-semibold text-slate-900" title={file.name}>
                  {file.name}
                </div>
                <div className="text-xs text-slate-500">{formatSize(file.size)}</div>
              </>
            ) : (
              <div className="text-sm text-slate-600">Chưa chọn tệp. Chỉ nhận PDF, tối đa 10 MB.</div>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
            {file ? 'Chọn tệp khác' : 'Chọn tệp PDF'}
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="lr-date" className="mb-1 block text-sm font-semibold text-slate-800">
              Nhận lúc <span className="text-rose-500">*</span>
            </label>
            <DateInput
              id="lr-date"
              value={date}
              onChange={(v) => {
                setWhenTouched(true);
                setWhen((w) => ({ ...w, date: v }));
              }}
              required
            />
          </div>
          <div>
            <label htmlFor="lr-time" className="mb-1 block text-sm font-semibold text-slate-800">
              Giờ nhận <span className="text-rose-500">*</span>
            </label>
            <TimeInput
              id="lr-time"
              className={inputClassName}
              value={time}
              onChange={(v) => {
                setWhenTouched(true);
                setWhen((w) => ({ ...w, time: v }));
              }}
              required
            />
          </div>
          <div>
            <label htmlFor="lr-user" className="mb-1 block text-sm font-semibold text-slate-800">
              Người nhận
            </label>
            <input id="lr-user" readOnly value={userName} className={`${inputClassName} bg-slate-50 text-slate-800`} />
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1 text-sm font-semibold text-slate-800">Tệp này là kết quả của</div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <div style={{ minWidth: costVisible ? 700 : 600 }}>
              <div role="row" className="grid gap-x-2 border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-semibold uppercase tracking-wide text-slate-800" style={{ gridTemplateColumns: grid }}>
                <div role="columnheader" className="px-1 py-2.5">
                  <SelectionCheckbox checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(partnerRows.map((r) => r.itemId)))} ariaLabel="Chọn tất cả mẫu của đối tác" />
                </div>
                <div role="columnheader" className="px-1 py-2.5">
                  Mã ống
                </div>
                <div role="columnheader" className="px-1 py-2.5">
                  Bệnh nhân
                </div>
                <div role="columnheader" className="px-1 py-2.5">
                  Dịch vụ
                </div>
                <div role="columnheader" className="px-1 py-2.5">
                  Gửi lúc
                </div>
                {costVisible && (
                  <div role="columnheader" className="px-1 py-2.5">
                    Giá trả
                  </div>
                )}
              </div>
              <div role="table" aria-label="Các mẫu đã gửi cho đối tác">
                {partnerRows.map((row) => (
                  <div key={row.itemId} role="row" className="grid items-center gap-x-2 border-b border-slate-100 text-sm" style={{ gridTemplateColumns: grid }}>
                    <div className="px-1 py-2 text-center">
                      <SelectionCheckbox checked={checked.has(row.itemId)} onChange={() => toggle(row.itemId)} ariaLabel={`Chọn mẫu ${row.tubeSid ?? row.orderNo}`} />
                    </div>
                    <div className="px-1 py-2 text-center font-semibold tabular-nums text-slate-800">{row.tubeSid ?? row.orderNo}</div>
                    <div className="min-w-0 px-1 py-2 text-left">
                      <div className="truncate font-semibold text-slate-900" title={row.patientName}>
                        {row.patientName}
                      </div>
                      <div className="text-[11.5px] text-slate-500">{row.patientCode}</div>
                    </div>
                    <div className="min-w-0 truncate px-1 py-2 text-left" title={row.serviceName}>
                      {row.serviceName}
                    </div>
                    <div className="px-1 py-2 text-center tabular-nums text-slate-700">{formatShortDateTimeVn(row.sentAt)}</div>
                    {costVisible && <div className="px-1 py-2 text-right font-semibold tabular-nums text-slate-900">{row.unitCost !== null ? formatVnd(row.unitCost) : '—'}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2.5">
          <Button type="button" variant="danger" disabled={checked.size === 0} onClick={() => setRejecting(true)}>
            Đối tác không nhận mẫu…
          </Button>
          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={receive.isPending} disabled={checked.size === 0}>
              Lưu kết quả ({checked.size})
            </Button>
          </div>
        </div>
      </form>

      {rejecting && (
        <ReasonConfirmDialog
          title="Đối tác không nhận mẫu"
          rows={[
            { label: 'Đối tác', value: first?.supplierName ?? '' },
            { label: 'Số mẫu', value: String(checked.size) },
          ]}
          note="Mẫu về “Chờ gửi” để chọn đối tác khác. Lần gửi này không tính tiền."
          confirmLabel="Trả về chờ gửi"
          confirmVariant="danger"
          onConfirm={rejectChecked}
          onDone={() => {
            const count = checked.size;
            setRejecting(false);
            onRejected(count);
          }}
          onClose={() => setRejecting(false)}
        />
      )}
    </div>
  );
}
