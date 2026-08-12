import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Clock, Warning, X } from '@phosphor-icons/react';
import type { AppointmentSummary, DoctorOption } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { APPOINTMENT_SOURCE_LABEL, APPOINTMENT_STATUS_META, isAppointmentLate } from './appointment-status';

const DURATION_OPTIONS = [15, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} phút` }));
import { useCancelAppointmentMutation, useCheckinAppointmentMutation, useRescheduleAppointmentMutation } from './appointment.queries';
import { minutesToLabel, vnDateTimeToIso, vnTimeOfDayMinutes } from './schedule-grid.utils';

/**
 * Chi tiết một lịch hẹn — xem, đổi/dời lịch (`PATCH .../reschedule`, S2-09), huỷ có lý do
 * (`POST .../cancel`, S2-06). Chỉ `SCHEDULED` mới sửa/huỷ được qua đây (khớp điều kiện backend
 * `AppointmentNotCancellableError` dùng chung cho cả hai thao tác).
 */
export function AppointmentDetailPanel({
  appointment,
  onClose,
  date,
  doctors,
  defaultDurationMinutes,
}: {
  appointment: AppointmentSummary | null;
  onClose: () => void;
  date: string;
  doctors: DoctorOption[];
  defaultDurationMinutes: number;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [cancelReason, setCancelReason] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editDuration, setEditDuration] = useState(defaultDurationMinutes);
  const [editDoctorId, setEditDoctorId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkinDone, setCheckinDone] = useState(false);

  const cancelMutation = useCancelAppointmentMutation();
  const rescheduleMutation = useRescheduleAppointmentMutation();
  const checkinMutation = useCheckinAppointmentMutation();

  const doctorNameById = useMemo(() => new Map(doctors.map((d) => [d.id, d.fullName])), [doctors]);

  useEffect(() => {
    if (!appointment) return;
    setMode('view');
    setCancelReason('');
    setError(null);
    setCheckinDone(false);
    setEditTime(minutesToLabel(vnTimeOfDayMinutes(appointment.scheduledAt)));
    setEditDuration(appointment.durationMinutes);
    setEditDoctorId(appointment.doctorId);
  }, [appointment]);

  if (!appointment) return null;

  const open = appointment !== null;
  const meta = APPOINTMENT_STATUS_META[appointment.status];
  const editable = appointment.status === 'SCHEDULED';
  const late = isAppointmentLate(appointment.status, appointment.scheduledAt);

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

  /**
   * Check-in (docs/DECISIONS.md #032) — chuyển thẳng SCHEDULED → CONVERTED, chưa tạo `encounter`
   * (Tiếp nhận thật là việc Sprint 3, đã chốt với chủ dự án). Không đóng panel ngay — hiện thông
   * báo đã ghi nhận trước, người dùng tự đóng.
   */
  async function handleCheckin() {
    if (!appointment) return;
    setError(null);
    try {
      await checkinMutation.mutateAsync({ id: appointment.id, body: { version: appointment.version } });
      setCheckinDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleSaveReschedule() {
    if (!appointment) return;
    setError(null);
    try {
      await rescheduleMutation.mutateAsync({
        id: appointment.id,
        body: {
          doctorId: editDoctorId,
          scheduledAt: vnDateTimeToIso(date, editTime),
          durationMinutes: editDuration,
          version: appointment.version,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

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
          <h2 className="text-[15px] font-bold text-slate-900">{mode === 'edit' ? 'Sửa lịch hẹn' : 'Chi tiết lịch hẹn'}</h2>
          <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-slate-600">
            <X size={17} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'view' ? (
            <div className="flex flex-col gap-4">
              <div className="divide-y divide-slate-100 text-sm">
                <Row label="Mã đặt lịch" value={<span className="font-mono">{appointment.bookingCode}</span>} />
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
                  value={<span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.bg} ${meta.text}`}>{meta.label}</span>}
                />
              </div>

              {late && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <Clock size={16} weight="bold" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  Bệnh nhân chưa đến, đã quá giờ hẹn hơn 60 phút — cân nhắc đổi lịch hoặc đánh dấu không đến.
                </div>
              )}

              {editable ? (
                <div>
                  <label htmlFor="cancel-reason" className="mb-1.5 block text-xs font-semibold text-slate-600">
                    Lý do huỷ (bắt buộc nếu huỷ lịch)
                  </label>
                  <textarea
                    id="cancel-reason"
                    rows={3}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Ví dụ: bệnh nhân xin đổi giờ khác"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  Lịch hẹn ở trạng thái này không thể sửa/huỷ qua đây.
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">Khách hàng</span>
                <div className="text-sm font-semibold text-slate-900">{appointment.fullName} (không đổi khi sửa lịch)</div>
              </div>
              <div>
                <label htmlFor="edit-doctor" className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Bác sĩ
                </label>
                <Combobox
                  id="edit-doctor"
                  value={editDoctorId}
                  onChange={setEditDoctorId}
                  options={doctors.map((d) => ({ value: d.id, label: d.fullName }))}
                />
              </div>
              <div className="flex gap-2.5">
                <div className="flex-1">
                  <label htmlFor="edit-time" className="mb-1.5 block text-xs font-semibold text-slate-600">
                    Giờ bắt đầu
                  </label>
                  <input
                    id="edit-time"
                    type="time"
                    step={900}
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="edit-duration" className="mb-1.5 block text-xs font-semibold text-slate-600">
                    Thời lượng
                  </label>
                  <Combobox
                    id="edit-duration"
                    value={String(editDuration)}
                    onChange={(v) => setEditDuration(Number(v))}
                    options={DURATION_OPTIONS}
                  />
                </div>
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
          {mode === 'view' ? (
            editable && (
              <>
                <Button type="button" loading={checkinMutation.isPending} onClick={() => void handleCheckin()}>
                  Check-in
                </Button>
                <div className="flex gap-2.5">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('edit')}>
                    Sửa lịch hẹn
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="flex-1"
                    disabled={!cancelReason.trim()}
                    loading={cancelMutation.isPending}
                    onClick={() => void handleCancel()}
                  >
                    Huỷ lịch hẹn
                  </Button>
                </div>
              </>
            )
          ) : (
            <div className="flex gap-2.5">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('view')}>
                Huỷ bỏ sửa
              </Button>
              <Button type="button" className="flex-1" loading={rescheduleMutation.isPending} onClick={() => void handleSaveReschedule()}>
                Lưu thay đổi
              </Button>
            </div>
          )}
        </div>
      </div>

      {checkinDone && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-emerald-600">
              <CheckCircle size={22} weight="fill" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-900">Đã ghi nhận khách đến</h3>
            </div>
            <p className="mb-5 text-sm text-slate-700">
              Lịch hẹn của <span className="font-semibold">{appointment.fullName}</span> đã chuyển sang trạng thái "Đã chuyển khám". Màn hình Tiếp
              nhận đầy đủ (tạo hồ sơ khám) sẽ có ở giai đoạn sau.
            </p>
            <Button type="button" className="w-full" onClick={onClose}>
              Đóng
            </Button>
          </div>
        </div>
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
