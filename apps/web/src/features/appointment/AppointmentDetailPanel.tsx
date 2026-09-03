import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Warning, X } from '@phosphor-icons/react';
import type { AppointmentSummary, DoctorOption } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { TimeInput } from '../../shared/ui/TimeInput';
import { useAuthStore } from '../auth/auth.store';
import type { ReceptionIntakeCheckinContext } from '../reception/ReceptionIntakeForm';
import { APPOINTMENT_SOURCE_LABEL, APPOINTMENT_STATUS_META, getNoShowCountdownTier, isAppointmentLate, noShowCountdownTierMeta } from './appointment-status';
/** Khớp `encounter.create` (packages/core/src/rbac/permissions.ts) — nút Tiếp nhận chỉ hiện đúng nơi có quyền, backend vẫn là lớp chặn thật. */
const CHECK_IN_ROLES = ['receptionist', 'clinic_admin'];
const DURATION_OPTIONS = [15, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} phút` }));
import {
  useAppointmentsByDateQuery,
  useCancelAppointmentMutation,
  useEditAppointmentMutation,
  useMarkNoShowMutation,
  useRescheduleAppointmentMutation,
} from './appointment.queries';
import { DoctorAvailabilityList } from './DoctorAvailabilityList';
import { formatDateLabel, getVietnamTodayDateString, isoToVietnamDateString, minutesToLabel, vnDateTimeToIso, vnTimeOfDayMinutes } from './schedule-grid.utils';

/**
 * Chi tiết một lịch hẹn — xem; hai thao tác đổi giờ TÁCH BIỆT và tồn tại song song (yêu cầu chủ dự
 * án 2026-08-18): **Sửa lịch** (`PATCH .../{id}`) đổi giờ/bác sĩ/thời lượng TẠI CHỖ, cùng id, chỉ
 * trong NGÀY hiện có; **Dời lịch** (`POST .../reschedule`) tạo lịch MỚI cho ngày khác, lịch cũ
 * chuyển `RESCHEDULED`. Ngoài ra: huỷ có lý do (`POST .../cancel`, S2-06), tiếp nhận (điều hướng
 * sang `/reception/new`, thay popup cũ). Chỉ `SCHEDULED` mới sửa/dời/huỷ/tiếp nhận được qua đây
 * (khớp điều kiện backend `APPOINTMENT_NOT_CANCELLABLE` dùng chung cho cả bốn thao tác).
 */
export function AppointmentDetailPanel({
  appointment,
  onClose,
  doctors,
  noShowThresholdMinutes,
  noShowAutoEnabled,
}: {
  appointment: AppointmentSummary | null;
  onClose: () => void;
  doctors: DoctorOption[];
  noShowThresholdMinutes: number;
  noShowAutoEnabled: boolean;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'reschedule'>('view');
  const [cancelReason, setCancelReason] = useState('');
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);
  const [editTime, setEditTime] = useState('');
  const [editDuration, setEditDuration] = useState(15);
  const [editDoctorId, setEditDoctorId] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState(getVietnamTodayDateString());
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleDoctorId, setRescheduleDoctorId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rescheduleResult, setRescheduleResult] = useState<AppointmentSummary | null>(null);

  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const canCheckIn = currentUser?.roles.some((r) => CHECK_IN_ROLES.includes(r)) ?? false;

  const cancelMutation = useCancelAppointmentMutation();
  const editMutation = useEditAppointmentMutation();
  const rescheduleMutation = useRescheduleAppointmentMutation();
  const noShowMutation = useMarkNoShowMutation();
  // "Sửa lịch": bác sĩ trống/bận trong ĐÚNG ngày của lịch hẹn hiện có (không đổi ngày được ở đây).
  const editDayQuery = useAppointmentsByDateQuery(appointment ? isoToVietnamDateString(appointment.scheduledAt) : getVietnamTodayDateString());
  // "Dời lịch": bác sĩ trống/bận theo NGÀY ĐANG DỜI TỚI — có thể khác ngày lịch hẹn gốc, tải riêng.
  const rescheduleDayQuery = useAppointmentsByDateQuery(rescheduleDate);

  const doctorNameById = useMemo(() => new Map(doctors.map((d) => [d.id, d.displayName ?? d.fullName])), [doctors]);

  useEffect(() => {
    if (!appointment) return;
    setMode('view');
    setCancelReason('');
    setConfirmingNoShow(false);
    setError(null);
    setEditTime(minutesToLabel(vnTimeOfDayMinutes(appointment.scheduledAt)));
    setEditDuration(appointment.durationMinutes);
    setEditDoctorId(appointment.doctorId);
    setRescheduleDate(isoToVietnamDateString(appointment.scheduledAt));
    setRescheduleTime(minutesToLabel(vnTimeOfDayMinutes(appointment.scheduledAt)));
    setRescheduleDoctorId(appointment.doctorId);
    setRescheduleResult(null);
  }, [appointment]);

  if (!appointment) return null;

  const open = appointment !== null;
  const meta = APPOINTMENT_STATUS_META[appointment.status];
  const editable = appointment.status === 'SCHEDULED';
  const late = isAppointmentLate(appointment.status, appointment.scheduledAt, noShowThresholdMinutes);
  const countdownTier = getNoShowCountdownTier(appointment.status, appointment.scheduledAt, noShowThresholdMinutes, noShowAutoEnabled);
  const countdown = countdownTier ? noShowCountdownTierMeta(countdownTier) : null;
  const appointmentDate = isoToVietnamDateString(appointment.scheduledAt);

  async function handleCancel() {
    if (!appointment || !cancelReason.trim()) return;
    setError(null);
    try {
      await cancelMutation.mutateAsync({ id: appointment.id, body: { cancelReason, version: appointment.version } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleMarkNoShow() {
    if (!appointment) return;
    setError(null);
    try {
      await noShowMutation.mutateAsync({ id: appointment.id, body: { version: appointment.version } });
      setConfirmingNoShow(false);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleSaveEdit() {
    if (!appointment || !editDoctorId || !editTime) return;
    setError(null);
    try {
      await editMutation.mutateAsync({
        id: appointment.id,
        body: {
          doctorId: editDoctorId,
          scheduledAt: vnDateTimeToIso(appointmentDate, editTime),
          durationMinutes: editDuration,
          version: appointment.version,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleReschedule() {
    if (!appointment || !rescheduleDoctorId || !rescheduleDate || !rescheduleTime) return;
    setError(null);
    try {
      const result = await rescheduleMutation.mutateAsync({
        id: appointment.id,
        body: {
          doctorId: rescheduleDoctorId,
          scheduledAt: vnDateTimeToIso(rescheduleDate, rescheduleTime),
          version: appointment.version,
        },
      });
      setRescheduleResult(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  function handleCheckIn() {
    if (!appointment) return;
    const context: ReceptionIntakeCheckinContext = {
      appointmentId: appointment.id,
      appointmentVersion: appointment.version,
      doctorId: appointment.doctorId,
      doctorName: doctorNameById.get(appointment.doctorId) ?? '—',
      fullName: appointment.fullName,
      phone: appointment.phone,
      reason: appointment.reason ?? undefined,
    };
    navigate('/reception/new', { state: { checkin: context } });
  }

  const panelTitle = mode === 'edit' ? 'Sửa lịch hẹn' : mode === 'reschedule' ? 'Dời lịch hẹn' : 'Chi tiết lịch hẹn';

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/35 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-[380px] flex-col bg-white shadow-2xl transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3.5">
          <h2 className="text-[15px] font-bold text-slate-900">{panelTitle}</h2>
          <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-slate-600">
            <X size={17} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'view' && (
            <div className="flex flex-col gap-4">
              <div className="divide-y divide-slate-100 text-sm">
                <Row label="Mã đặt lịch" value={<span className="font-semibold">{appointment.bookingCode}</span>} />
                <Row label="Họ tên" value={appointment.fullName} />
                <Row label="Số điện thoại" value={appointment.phone} />
                {appointment.reason && <Row label="Lý do khám" value={appointment.reason} />}
                <Row label="Bác sĩ" value={doctorNameById.get(appointment.doctorId) ?? '—'} />
                <Row
                  label="Thời gian"
                  value={`${minutesToLabel(vnTimeOfDayMinutes(appointment.scheduledAt))} – ${minutesToLabel(
                    vnTimeOfDayMinutes(appointment.scheduledAt) + appointment.durationMinutes,
                  )}`}
                />
                <Row label="Nguồn" value={APPOINTMENT_SOURCE_LABEL[appointment.source]} />
                <Row
                  label="Trạng thái"
                  value={
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badgeBg} ${meta.badgeText}`}>
                      {meta.label}
                      {appointment.status === 'NO_SHOW' && appointment.noShowAutoMarked && <span className="font-normal"> (tự động)</span>}
                    </span>
                  }
                />
              </div>

              {late && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <Clock size={16} weight="bold" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  Bệnh nhân chưa đến, đã quá giờ hẹn hơn {noShowThresholdMinutes} phút — cân nhắc đổi lịch hoặc đánh dấu không đến.
                </div>
              )}

              {!late && countdown && (
                <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${countdown.border} ${countdown.bg} ${countdown.text}`}>
                  <Clock size={16} weight="bold" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {countdown.label} sẽ tự động chuyển &quot;Không đến&quot; nếu bệnh nhân chưa tiếp nhận.
                </div>
              )}

              {editable ? (
                <div>
                  <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Lý do huỷ (bắt buộc nếu huỷ lịch)
                  </label>
                  <textarea
                    id="cancel-reason"
                    rows={3}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Ví dụ: bệnh nhân xin đổi giờ khác"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  Lịch hẹn ở trạng thái này không thể thao tác qua đây.
                </div>
              )}
            </div>
          )}

          {mode === 'edit' && (
            <div className="flex flex-col gap-4">
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">Khách hàng</span>
                <div className="text-sm font-semibold text-slate-900">{appointment.fullName} (không đổi khi sửa lịch)</div>
              </div>
              <div className="flex gap-2.5">
                <div className="flex-1">
                  <label htmlFor="edit-time" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Giờ bắt đầu
                  </label>
                  <TimeInput
                    id="edit-time"
                    value={editTime}
                    onChange={setEditTime}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="edit-duration" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Thời lượng
                  </label>
                  <Combobox id="edit-duration" value={String(editDuration)} onChange={(v) => setEditDuration(Number(v))} options={DURATION_OPTIONS} />
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Bác sĩ — trống/bận trong ngày {formatDateLabel(appointmentDate)}
                  {editDayQuery.isFetching && <span className="ml-1.5 font-normal text-slate-400">(đang tải…)</span>}
                </span>
                <DoctorAvailabilityList
                  doctors={doctors}
                  selectedDoctorId={editDoctorId}
                  onSelect={setEditDoctorId}
                  time={editTime}
                  durationMinutes={editDuration}
                  dayAppointments={editDayQuery.data?.items ?? []}
                  excludeAppointmentId={appointment.id}
                />
              </div>
            </div>
          )}

          {mode === 'reschedule' && (
            <div className="flex flex-col gap-4">
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">Khách hàng</span>
                <div className="text-sm font-semibold text-slate-900">{appointment.fullName} (không đổi khi dời lịch)</div>
              </div>
              <div className="flex gap-2.5">
                <div className="flex-1">
                  <label htmlFor="reschedule-date" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Dời đến ngày
                  </label>
                  <input
                    id="reschedule-date"
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => e.target.value && setRescheduleDate(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="reschedule-time" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Giờ
                  </label>
                  <TimeInput
                    id="reschedule-time"
                    value={rescheduleTime}
                    onChange={setRescheduleTime}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Bác sĩ — trống/bận trong ngày đã chọn
                  {rescheduleDayQuery.isFetching && <span className="ml-1.5 font-normal text-slate-400">(đang tải…)</span>}
                </span>
                <DoctorAvailabilityList
                  doctors={doctors}
                  selectedDoctorId={rescheduleDoctorId}
                  onSelect={setRescheduleDoctorId}
                  time={rescheduleTime}
                  durationMinutes={appointment.durationMinutes}
                  dayAppointments={rescheduleDayQuery.data?.items ?? []}
                  excludeAppointmentId={appointment.id}
                />
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-600">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-col gap-2.5 border-t border-slate-200 px-4 py-3.5">
          {mode === 'view' &&
            editable && (
              <>
                {canCheckIn && (
                  <Button type="button" className="w-full" onClick={handleCheckIn}>
                    Tiếp nhận
                  </Button>
                )}
                <div className="flex gap-2.5">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('edit')}>
                    Sửa lịch
                  </Button>
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('reschedule')}>
                    Dời lịch
                  </Button>
                </div>
                <Button type="button" variant="secondary" className="w-full" onClick={() => setConfirmingNoShow(true)}>
                  Đánh dấu Không đến
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="w-full"
                  disabled={!cancelReason.trim()}
                  loading={cancelMutation.isPending}
                  onClick={() => void handleCancel()}
                >
                  Huỷ lịch hẹn
                </Button>
              </>
            )}

          {mode === 'edit' && (
            <div className="flex gap-2.5">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('view')}>
                Huỷ bỏ
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!editDoctorId || !editTime}
                loading={editMutation.isPending}
                onClick={() => void handleSaveEdit()}
              >
                Lưu
              </Button>
            </div>
          )}

          {mode === 'reschedule' && (
            <div className="flex gap-2.5">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('view')}>
                Huỷ bỏ
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!rescheduleDoctorId || !rescheduleDate || !rescheduleTime}
                loading={rescheduleMutation.isPending}
                onClick={() => void handleReschedule()}
              >
                Lưu
              </Button>
            </div>
          )}
        </div>
      </div>

      {rescheduleResult && (
        <RescheduleConfirmDialog
          oldBookingCode={appointment.bookingCode}
          newAppointment={rescheduleResult}
          onConfirm={() => {
            setRescheduleResult(null);
            onClose();
          }}
        />
      )}

      {confirmingNoShow && (
        <MarkNoShowConfirmDialog
          fullName={appointment.fullName}
          loading={noShowMutation.isPending}
          onConfirm={() => void handleMarkNoShow()}
          onClose={() => setConfirmingNoShow(false)}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

/**
 * Xác nhận đánh dấu "Không đến" thủ công (S5-07, APP-05) — không cần lý do (khác huỷ lịch), cùng
 * khuôn `ReleaseEncounterDialog.tsx` (chỉ 1 nơi dùng, đặt cục bộ tại đây theo CLAUDE.md "trùng lần
 * hai mới trích xuất").
 */
function MarkNoShowConfirmDialog({
  fullName,
  loading,
  onConfirm,
  onClose,
}: {
  fullName: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 px-4" role="dialog" aria-modal="true" aria-labelledby="mark-no-show-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
        <h3 id="mark-no-show-title" className="text-base font-bold text-slate-900">
          Đánh dấu Không đến?
        </h3>
        <p className="mt-1.5 text-sm text-slate-600">
          Lịch hẹn của <span className="font-semibold text-slate-800">{fullName}</span> sẽ chuyển sang trạng thái{' '}
          <span className="font-semibold">Không đến</span>.
        </p>
        <div className="mt-4 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button type="button" loading={loading} onClick={onConfirm}>
            Xác nhận
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Xác nhận sau khi dời lịch thành công — cùng khuôn `BookingConfirmDialog`
 * (`AppointmentQuickCreatePanel.tsx`, nội dung đã chốt với chủ dự án cho đặt lịch mới). Đặt cục bộ
 * trong file này — chỉ một nơi dùng, chưa đủ lý do tách `shared/ui` (CLAUDE.md: trùng lặp lần hai
 * mới trích xuất; nội dung/ngữ cảnh 2 dialog khác nhau nên không gộp chung component).
 */
function RescheduleConfirmDialog({
  oldBookingCode,
  newAppointment,
  onConfirm,
}: {
  oldBookingCode: string;
  newAppointment: AppointmentSummary;
  onConfirm: () => void;
}) {
  const timeLabel = minutesToLabel(vnTimeOfDayMinutes(newAppointment.scheduledAt));
  const dateLabel = formatDateLabel(isoToVietnamDateString(newAppointment.scheduledAt));
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
        <h3 className="mb-2 text-base font-bold text-slate-900">Dời lịch thành công</h3>
        <p className="mb-5 text-sm text-slate-700">
          Lịch hẹn <span className="font-semibold">{oldBookingCode}</span> đã chuyển sang trạng thái{' '}
          <span className="font-semibold">Đã dời lịch</span>. Lịch mới vào lúc{' '}
          <span className="font-semibold">
            {timeLabel} · {dateLabel}
          </span>{' '}
          với mã số: <span className="font-semibold text-blue-700 tracking-wide">{newAppointment.bookingCode}</span>
        </p>
        <Button type="button" className="w-full" onClick={onConfirm}>
          Xác nhận
        </Button>
      </div>
    </div>
  );
}