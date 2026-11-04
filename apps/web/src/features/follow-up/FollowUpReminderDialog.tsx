import { useState, type FormEvent } from 'react';
import { ClipboardText } from '@phosphor-icons/react';
import type { FollowUpItem, FollowUpReminderResultKind } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Textarea } from '../../shared/ui/Textarea';
import { FOLLOW_UP_REMINDER_NOTE_MAX, FOLLOW_UP_REMINDER_RESULT_LABEL, formatDmy } from './follow-up-model';
import { useCreateFollowUpReminderMutation, useFollowUpRemindersQuery } from './follow-up.queries';

const RESULTS: FollowUpReminderResultKind[] = ['REACHED', 'NO_ANSWER', 'CALL_BACK_LATER', 'NOT_RETURNING'];

/**
 * Hộp "Ghi lần nhắc" (docs/DECISIONS.md #285, mockup đã chốt 04/11/2026): chọn kết quả liên lạc (bắt buộc, KHÔNG chọn sẵn), ghi chú tuỳ chọn, và xem các lần nhắc trước.
 * Người ghi và thời điểm do máy chủ đặt. Lưu lỗi thì giữ nguyên dữ liệu đang nhập và báo ngay trong hộp. Bọc <form> để Enter lưu (ui-guidelines 4.4; Enter trong ô ghi chú xuống dòng).
 */
export function FollowUpReminderDialog({ item, onClose }: { item: FollowUpItem; onClose: () => void }) {
  const [result, setResult] = useState<FollowUpReminderResultKind | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const history = useFollowUpRemindersQuery(item.encounterId);
  const mutation = useCreateFollowUpReminderMutation(item.encounterId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!result) return;
    setError(null);
    try {
      await mutation.mutateAsync({ result, ...(note.trim() !== '' ? { note: note.trim() } : {}) });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được lần nhắc, vui lòng thử lại.');
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <ConfirmDialog
        icon={ClipboardText}
        size="md"
        title="Ghi lần nhắc"
        rows={[{ label: 'Bệnh nhân', value: item.patientName, sub: `${item.patientCode} · hẹn ${formatDmy(item.followUpDate)}` }]}
        error={error}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!result}>
              Lưu
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Kết quả liên lạc">
            <div className="mb-2 text-sm font-semibold text-slate-800">
              Kết quả liên lạc <span className="text-rose-500">*</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {RESULTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={result === value}
                  onClick={() => setResult(value)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                    result === value ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-brand-teal-tint'
                  }`}
                >
                  {FOLLOW_UP_REMINDER_RESULT_LABEL[value]}
                </button>
              ))}
            </div>
            {result === 'NOT_RETURNING' && <p className="mt-2 text-xs text-slate-500">Hẹn này sẽ biến khỏi danh sách.</p>}
          </div>

          <Textarea
            id="follow-up-reminder-note"
            label="Ghi chú"
            rows={3}
            maxLength={FOLLOW_UP_REMINDER_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: hẹn đến sáng mai, nhờ người nhà đưa đi..."
          />

          <div>
            <div className="mb-2 text-sm font-semibold text-slate-800">Các lần nhắc trước</div>
            {history.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : history.isError ? (
              <p className="text-sm text-slate-500">Không tải được các lần nhắc trước.</p>
            ) : history.data.items.length === 0 ? (
              <p className="text-sm text-slate-500">Chưa nhắc lần nào.</p>
            ) : (
              <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 scroll-hover">
                {history.data.items.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
                    <span className="w-24 flex-none tabular-nums text-slate-500">{formatShortDateTimeVn(r.remindedAt)}</span>
                    <span className="flex-none font-semibold text-slate-900">{FOLLOW_UP_REMINDER_RESULT_LABEL[r.result]}</span>
                    <span className="min-w-0 text-slate-500">
                      · {r.byName}
                      {r.note ? ` · ${r.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </ConfirmDialog>
    </form>
  );
}
