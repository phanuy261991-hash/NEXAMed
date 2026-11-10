import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react';
import type { LabPartnerPendingRow, SendLabPartnerSamplesResponse } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { toVnDateAndTime, vnDateAndTimeToIso } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { TimeInput } from '../../shared/ui/TimeInput';
import { useAuthStore } from '../auth/auth.store';
import { ReportPrintAction } from '../../shared/print/ReportPrintAction';
import { buildDeliverySlipSpec } from './lab-partner-send-model';
import { useSendLabPartnerSamplesMutation } from './lab-partner.queries';
import { defaultOptionOf, initialPartnerId, keepEligible, optionFor, partnerChoicesOf, totalCost, validateSentAt } from './lab-partner-send-model';

const inputClassName = 'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/**
 * Hộp "Gửi mẫu đi" (mockup màn 3, docs/DECISIONS.md #291): chọn MỘT đối tác cho cả đợt, mỗi mẫu hiện ĐÚNG giá của cặp (dịch vụ × đối tác) đã chọn.
 * Dòng mà đối tác đang chọn chưa có giá thì bị khoá và nói rõ lý do. Giờ gửi mặc định là bây giờ, sửa được khi ghi bù. Enter gửi, Esc đóng.
 * Giá trả là giá vốn: cột giá chỉ hiện khi `costVisible`.
 */
export function LabPartnerSendDialog({
  rows,
  initialSelectedIds,
  costVisible,
  onClose,
  onDone,
}: {
  rows: LabPartnerPendingRow[];
  initialSelectedIds: ReadonlySet<string>;
  costVisible: boolean;
  onClose: () => void;
  onDone: (result: SendLabPartnerSamplesResponse) => void;
}) {
  const send = useSendLabPartnerSamplesMutation();
  const userName = useAuthStore((s) => s.user?.fullName ?? '');
  const choices = useMemo(() => partnerChoicesOf(rows), [rows]);
  const [supplierId, setSupplierId] = useState(() =>
    initialPartnerId(
      rows.filter((r) => initialSelectedIds.has(r.itemId)),
      choices,
    ),
  );
  const [checked, setChecked] = useState<Set<string>>(() => keepEligible(rows, initialSelectedIds, supplierId));
  const [{ date, time }, setWhen] = useState(() => toVnDateAndTime());
  // Chưa sửa ngày/giờ thì KHÔNG gửi `sentAt` — máy chủ lấy đúng "bây giờ" (ô giờ chỉ chính xác tới phút nên có thể sớm hơn giờ lấy mẫu vài giây).
  const [whenTouched, setWhenTouched] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const partnerName = choices.find((c) => c.supplierId === supplierId)?.supplierName ?? '';
  const total = costVisible ? totalCost(rows, checked, supplierId) : null;
  const deliverySlip = useMemo(
    () => buildDeliverySlipSpec({ partnerName, sentAtText: `${date.split('-').reverse().join('/')} ${time}`, senderName: userName, note, rows: rows.filter((r) => checked.has(r.itemId)) }),
    [partnerName, date, time, userName, note, rows, checked],
  );
  const grid = costVisible ? '34px 110px minmax(150px,1.3fr) minmax(170px,1.4fr) 120px 120px' : '34px 110px minmax(150px,1.3fr) minmax(170px,1.4fr) 120px';

  function changePartner(next: string) {
    setSupplierId(next);
    setChecked((prev) => keepEligible(rows, prev, next));
    setError(null);
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (send.isPending) return;
    if (supplierId === '') {
      setError('Chọn đối tác nhận mẫu.');
      return;
    }
    if (checked.size === 0) {
      setError('Tích ít nhất một mẫu để gửi.');
      return;
    }
    const sentAt = whenTouched ? vnDateAndTimeToIso(date, time) : undefined;
    if (whenTouched) {
      const problem = validateSentAt(sentAt ?? null, rows, checked);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError(null);
    try {
      const result = await send.mutateAsync({ supplierId, itemIds: [...checked], ...(sentAt ? { sentAt } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      onDone(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không gửi được mẫu. Dữ liệu bạn chọn vẫn còn, thử lại sau.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Gửi mẫu đi">
      <form onSubmit={handleSubmit} className="my-6 w-full max-w-[820px] rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader icon={PaperPlaneTiltIcon} title="Gửi mẫu đi" subtitle={partnerName || undefined} onClose={onClose} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor="lp-partner" className="mb-1 block text-sm font-semibold text-slate-800">
              Đối tác nhận mẫu <span className="text-rose-500">*</span>
            </label>
            <Combobox id="lp-partner" value={supplierId} onChange={changePartner} options={choices.map((c) => ({ value: c.supplierId, label: c.supplierName }))} placeholder="Chọn đối tác" required />
          </div>
          <div>
            <label htmlFor="lp-date" className="mb-1 block text-sm font-semibold text-slate-800">
              Gửi lúc <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2">
              <DateInput
                id="lp-date"
                value={date}
                onChange={(v) => {
                  setWhenTouched(true);
                  setWhen((w) => ({ ...w, date: v }));
                }}
                required
              />
              <TimeInput
                id="lp-time"
                className={inputClassName}
                value={time}
                onChange={(v) => {
                  setWhenTouched(true);
                  setWhen((w) => ({ ...w, time: v }));
                }}
                required
              />
            </div>
          </div>
          <div>
            <label htmlFor="lp-user" className="mb-1 block text-sm font-semibold text-slate-800">
              Người gửi
            </label>
            <input id="lp-user" readOnly value={userName} className={`${inputClassName} bg-slate-50 text-slate-800`} />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <div style={{ minWidth: costVisible ? 700 : 600 }}>
            <div role="row" className="grid gap-x-2 border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-semibold uppercase tracking-wide text-slate-800" style={{ gridTemplateColumns: grid }}>
              <div role="columnheader" className="px-1 py-2.5" />
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
                Loại mẫu
              </div>
              {costVisible && (
                <div role="columnheader" className="px-1 py-2.5">
                  Giá trả
                </div>
              )}
            </div>
            <div role="table" aria-label="Các mẫu chờ gửi">
              {rows.map((row) => {
                const opt = optionFor(row, supplierId);
                const own = defaultOptionOf(row);
                const eligible = opt !== undefined;
                return (
                  <div key={row.itemId} role="row" className={`grid items-center gap-x-2 border-b border-slate-100 text-sm ${eligible ? '' : 'bg-slate-50 text-slate-400'}`} style={{ gridTemplateColumns: grid }}>
                    <div className="px-1 py-2 text-center">
                      <SelectionCheckbox checked={eligible && checked.has(row.itemId)} onChange={() => toggle(row.itemId)} ariaLabel={`Chọn mẫu ${row.tubeSid ?? row.orderNo}`} indeterminate={false} />
                    </div>
                    <div className="px-1 py-2 text-center font-semibold tabular-nums text-slate-800">{row.tubeSid ?? row.orderNo}</div>
                    <div className="min-w-0 px-1 py-2 text-left">
                      <div className="truncate font-semibold text-slate-900" title={row.patientName}>
                        {row.patientName}
                      </div>
                      <div className="text-[11.5px] text-slate-500">{row.patientCode}</div>
                    </div>
                    <div className="min-w-0 px-1 py-2 text-left">
                      <div className="truncate" title={row.serviceName}>
                        {row.serviceName}
                      </div>
                      {!eligible && (
                        <div className="text-[11.5px] font-semibold text-amber-700" title={own ? `Đối tác mặc định của dịch vụ: ${own.supplierName}` : undefined}>
                          {own ? 'Chưa có giá trả cho đối tác này' : 'Dịch vụ chưa cấu hình đối tác'}
                        </div>
                      )}
                    </div>
                    <div className="truncate px-1 py-2 text-center text-slate-700">{row.specimenName ?? '—'}</div>
                    {costVisible && <div className="px-1 py-2 text-right font-semibold tabular-nums text-slate-900">{eligible && opt.amount !== null ? formatVnd(opt.amount) : '—'}</div>}
                  </div>
                );
              })}
              {rows.length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-500">Không có mẫu nào chờ gửi.</div>}
            </div>
          </div>
        </div>
        {total !== null && (
          <p className="mt-2 text-right text-sm font-semibold text-slate-800">
            Tổng giá trả của {checked.size} mẫu đã tích: <span className="tabular-nums">{formatVnd(total)}</span>
          </p>
        )}

        <div className="mt-3">
          <label htmlFor="lp-note" className="mb-1 block text-sm font-semibold text-slate-800">
            Ghi chú (mã vận đơn, người giao)
          </label>
          <input
            id="lp-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Ví dụ: shipper đối tác lấy lúc 11h"
            className={inputClassName}
          />
        </div>

        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2.5">
          <ReportPrintAction label="In phiếu giao mẫu" disabled={checked.size === 0 || supplierId === ''} spec={deliverySlip} />
          <div className="flex gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={send.isPending} disabled={checked.size === 0 || supplierId === ''}>
            Đã gửi mẫu đi ({checked.size})
          </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
