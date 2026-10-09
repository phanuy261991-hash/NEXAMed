import { useEffect, useState, type FormEvent } from 'react';
import { CalendarX, Warning } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Textarea } from '../../shared/ui/Textarea';
import { useAuthStore } from '../auth/auth.store';
import { useWorkShiftAssignmentsQuery } from '../work-shift-assignment/work-shift-assignment.queries';
import { useCreateLeaveRequestMutation, useCreateLeaveRequestOnBehalfMutation, useLeaveRequestMyImpactQuery } from './leave-request.queries';

const ALL_DAY = 'ALL_DAY';
const WEEKDAY_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** "Thứ Tư, 14/10/2026" — `YYYY-MM-DD` là ngày lịch (không đổi múi giờ). */
function formatLongDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const weekday = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  return `${WEEKDAY_LONG[weekday]}, ${d}/${m}/${y}`;
}

/**
 * Hộp "Xin nghỉ" ("Đơn xin nghỉ", #224, mockup đã duyệt màn 1) — chọn ca (hoặc "Cả ngày") + lý do
 * bắt buộc. Hai chế độ cùng 1 component (đúng quy tắc dùng chung của CLAUDE.md): xin cho CHÍNH MÌNH
 * (ngày + ca cố định theo ô vừa bấm, có dải cảnh báo "N lịch hẹn") và "Ghi nghỉ hộ nhân viên" (chọn
 * nhân viên + ngày, duyệt luôn — truyền `onBehalfUsers`). Ca lấy từ ca ĐÃ ĐĂNG KÝ của người nghỉ
 * đúng ngày đó (nghỉ chỉ áp trên ca đã đăng ký).
 */
export function LeaveRequestDialog({
  date: fixedDate,
  initialShiftId = null,
  onBehalfUsers,
  onClose,
  onDone,
}: {
  /** Chế độ xin cho mình: ngày cố định. Chế độ ghi hộ: ngày khởi tạo, vẫn chọn lại được. */
  date: string;
  initialShiftId?: string | null;
  /** Có giá trị = chế độ "Ghi nghỉ hộ nhân viên". */
  onBehalfUsers?: { value: string; label: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const onBehalf = onBehalfUsers !== undefined;
  const ownUserId = useAuthStore((s) => s.user?.id) ?? '';
  const [userId, setUserId] = useState(onBehalf ? '' : ownUserId);
  const [date, setDate] = useState(fixedDate);
  const [choice, setChoice] = useState<string>(initialShiftId ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateLeaveRequestMutation();
  const onBehalfMutation = useCreateLeaveRequestOnBehalfMutation();
  const pending = createMutation.isPending || onBehalfMutation.isPending;

  const canQueryShifts = userId !== '' && date !== '';
  const assignmentsQuery = useWorkShiftAssignmentsQuery(date, date, userId || undefined, canQueryShifts);
  const shifts = (assignmentsQuery.data?.items ?? [])
    .filter((i) => i.userId === userId && i.workDate === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Chọn mặc định: ca vừa bấm nếu còn đăng ký, không thì ca đầu tiên; đổi người/ngày thì chọn lại.
  useEffect(() => {
    if (shifts.length === 0) {
      if (choice !== '') setChoice('');
      return;
    }
    const valid = choice === ALL_DAY || shifts.some((s) => s.workShiftId === choice);
    if (!valid) setChoice(shifts.some((s) => s.workShiftId === initialShiftId) ? (initialShiftId as string) : (shifts[0]?.workShiftId ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentsQuery.data, userId, date]);

  const impactQuery = useLeaveRequestMyImpactQuery(date, choice === ALL_DAY ? null : choice, !onBehalf && choice !== '');
  const impactCount = impactQuery.data?.affectedAppointmentCount ?? 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim() || choice === '') return;
    const body = { leaveDate: date, workShiftId: choice === ALL_DAY ? null : choice, reason: reason.trim() };
    try {
      if (onBehalf) await onBehalfMutation.mutateAsync({ ...body, userId });
      else await createMutation.mutateAsync(body);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gửi đơn thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="leave-request-title">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader
          icon={CalendarX}
          title={onBehalf ? 'Ghi nghỉ hộ' : 'Xin nghỉ'}
          subtitle={onBehalf ? undefined : formatLongDate(date)}
          onClose={onClose}
        />
        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          {onBehalf && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="leave-user" className="mb-1 block text-sm font-semibold text-slate-800">
                  Nhân viên <span className="text-rose-500">*</span>
                </label>
                <Combobox id="leave-user" value={userId} onChange={setUserId} options={onBehalfUsers} placeholder="Chọn nhân viên..." required />
              </div>
              <div>
                <label htmlFor="leave-date" className="mb-1 block text-sm font-semibold text-slate-800">
                  Ngày nghỉ <span className="text-rose-500">*</span>
                </label>
                <DateInput id="leave-date" value={date} onChange={setDate} required />
              </div>
            </div>
          )}

          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-slate-800">
              Nghỉ ca nào <span className="text-rose-500">*</span>
            </legend>
            {shifts.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm font-medium text-slate-500">
                {canQueryShifts && !assignmentsQuery.isPending ? 'Ngày này chưa đăng ký ca nên chưa xin nghỉ được.' : 'Chọn nhân viên và ngày để xem ca đã đăng ký.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                  ...shifts.map((s) => ({ id: s.workShiftId, name: s.workShiftName, hint: `${s.startTime} – ${s.endTime}` })),
                  { id: ALL_DAY, name: 'Cả ngày', hint: 'mọi ca đã đăng ký' },
                ].map((opt) => {
                  const selected = choice === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer flex-col rounded-md border px-3 py-2 transition-colors ${
                        selected ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 text-slate-800 hover:border-blue-400 hover:bg-brand-teal-tint'
                      }`}
                    >
                      <input type="radio" name="leave-shift" className="sr-only" checked={selected} onChange={() => setChoice(opt.id)} />
                      <span className="text-sm font-semibold">{opt.name}</span>
                      <span className={`text-xs ${selected ? 'opacity-90' : 'text-slate-500'}`}>{opt.hint}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <Textarea id="leave-reason" label="Lý do" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />

          {!onBehalf && impactCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Bạn đang có <strong>{impactCount} lịch hẹn</strong> trong khung giờ này. Khi đơn được duyệt, lễ tân sẽ liên hệ bệnh nhân để chuyển bác sĩ hoặc dời lịch.
              </span>
            </div>
          )}

          <p className="text-xs text-slate-500">
            {onBehalf
              ? 'Ghi nghỉ hộ được duyệt luôn. Ca đã đăng ký vẫn giữ nguyên.'
              : 'Đơn gửi tới người duyệt. Ca đã đăng ký vẫn giữ nguyên; bạn rút đơn được khi chưa duyệt.'}
          </p>

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={pending} disabled={!reason.trim() || choice === '' || (onBehalf && userId === '')}>
              {onBehalf ? 'Ghi nghỉ' : 'Gửi đơn xin nghỉ'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
