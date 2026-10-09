import { useState, type FormEvent } from 'react';
import { ArrowsLeftRight, Warning } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Textarea } from '../../shared/ui/Textarea';
import { formatWeekdayDate } from '../work-shift-assignment/schedule-month';
import {
  useCreateShiftSwapMutation,
  useShiftSwapAssignmentCheckQuery,
  useShiftSwapColleagueAssignmentsQuery,
  useShiftSwapColleaguesQuery,
} from './shift-swap.queries';

export interface SwapSourceAssignment {
  assignmentId: string;
  workDate: string;
  workShiftName: string;
  startTime: string;
  endTime: string;
}

/**
 * Hộp "Đổi ca" ("Đổi ca", #225, mockup đã duyệt màn 5) — đổi 2 ca cho nhau: chọn đồng nghiệp rồi chọn ca của họ
 * để nhận. Ca không đổi được (có lịch hẹn/đơn nghỉ/đang có yêu cầu khác...) hiện mờ kèm lý do; ca CỦA MÌNH không
 * đổi được thì hiện dải cảnh báo và khoá nút gửi. Chỉ người nhận xác nhận — gửi xong chờ họ.
 */
export function ShiftSwapDialog({ source, onClose, onDone }: { source: SwapSourceAssignment; onClose: () => void; onDone: () => void }) {
  const [colleagueId, setColleagueId] = useState('');
  const [counterpartAssignmentId, setCounterpartAssignmentId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const checkQuery = useShiftSwapAssignmentCheckQuery(source.assignmentId);
  const colleaguesQuery = useShiftSwapColleaguesQuery();
  const candidatesQuery = useShiftSwapColleagueAssignmentsQuery(colleagueId);
  const createMutation = useCreateShiftSwapMutation();

  const ownBlockedReason = checkQuery.data && !checkQuery.data.swappable ? checkQuery.data.blockedReason : null;
  const candidates = candidatesQuery.data?.items ?? [];
  const colleagueName = colleaguesQuery.data?.items.find((c) => c.userId === colleagueId)?.fullName ?? 'đồng nghiệp';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!counterpartAssignmentId || ownBlockedReason) return;
    try {
      await createMutation.mutateAsync({ requesterAssignmentId: source.assignmentId, counterpartAssignmentId, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gửi yêu cầu thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="shift-swap-title">
      <div className="max-h-full w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader icon={ArrowsLeftRight} title="Đổi ca" subtitle="Đổi 2 ca cho nhau — chỉ người nhận xác nhận" onClose={onClose} />
        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bạn đưa ca</span>
            <div className="font-bold">
              {source.workShiftName} · {formatWeekdayDate(source.workDate)}/{source.workDate.slice(0, 4)}{' '}
              <span className="font-medium text-slate-500">
                {source.startTime} – {source.endTime}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="swap-colleague" className="mb-1 block text-sm font-semibold text-slate-800">
              Đổi với <span className="text-rose-500">*</span>
            </label>
            {colleaguesQuery.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Combobox
                id="swap-colleague"
                value={colleagueId}
                onChange={(v) => {
                  setColleagueId(v);
                  setCounterpartAssignmentId('');
                }}
                options={(colleaguesQuery.data?.items ?? []).map((c) => ({ value: c.userId, label: c.departmentName ? `${c.fullName} — ${c.departmentName}` : c.fullName }))}
                placeholder="Chọn đồng nghiệp..."
                required
              />
            )}
          </div>

          {colleagueId !== '' && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-slate-800">
                Bạn nhận ca của {colleagueName} <span className="text-rose-500">*</span>
              </legend>
              {candidatesQuery.isPending && <Skeleton className="h-16 w-full" />}
              {candidatesQuery.isSuccess && candidates.length === 0 && (
                <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm font-medium text-slate-500">Đồng nghiệp này chưa có ca nào sắp tới.</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {candidates.map((c) => {
                  const selected = counterpartAssignmentId === c.assignmentId;
                  return (
                    <label
                      key={c.assignmentId}
                      className={`flex flex-col rounded-md border px-3 py-2 transition-colors ${
                        !c.swappable
                          ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
                          : selected
                            ? 'cursor-pointer border-brand-teal bg-brand-teal text-white'
                            : 'cursor-pointer border-slate-300 text-slate-800 hover:border-blue-400 hover:bg-brand-teal-tint'
                      }`}
                    >
                      <input type="radio" name="swap-counterpart" className="sr-only" disabled={!c.swappable} checked={selected} onChange={() => setCounterpartAssignmentId(c.assignmentId)} />
                      <span className={`text-sm font-semibold ${!c.swappable ? 'text-slate-500' : ''}`}>
                        {c.workShiftName} · {formatWeekdayDate(c.workDate)}
                      </span>
                      {c.swappable ? (
                        <span className={`text-xs ${selected ? 'opacity-90' : 'text-slate-500'}`}>
                          {c.startTime} – {c.endTime}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-rose-600">{c.blockedReason}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <Textarea id="swap-note" label="Ghi chú" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />

          {ownBlockedReason && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                <strong>Ca của bạn chưa đổi được:</strong> {ownBlockedReason} Xử lý xong rồi gửi lại yêu cầu.
              </span>
            </div>
          )}
          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={createMutation.isPending} disabled={!counterpartAssignmentId || ownBlockedReason !== null}>
              Gửi yêu cầu đổi ca
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
