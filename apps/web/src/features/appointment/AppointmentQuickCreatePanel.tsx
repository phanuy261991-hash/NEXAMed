import { useEffect, useState } from 'react';
import { WarningCircle, X } from '@phosphor-icons/react';
import type { AppointmentSource, AppointmentSummary, DoctorOption } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatDobDisplay } from '../../shared/format/date';
import { useAuthStore } from '../auth/auth.store';
import { usePatientByPhoneQuery } from '../patient/patient.queries';
import { Button } from '../../shared/ui/Button';
import { TimeInput } from '../../shared/ui/TimeInput';
import { APPOINTMENT_SPAM_CANCELLED_THRESHOLD } from './appointment-status';
import { useAppointmentPhoneLookupQuery, useAppointmentsByDateQuery, useCreateAppointmentMutation } from './appointment.queries';
import { DoctorAvailabilityList } from './DoctorAvailabilityList';
import { formatDateLabel, minutesToLabel, vnDateTimeToIso, vnTimeOfDayMinutes } from './schedule-grid.utils';

const SOURCE_OPTIONS: { value: AppointmentSource; label: string }[] = [
  { value: 'phone', label: 'Điện thoại' },
  { value: 'online', label: 'Online' },
  { value: 'walk_in', label: 'Tự đến' },
];

/** Giá trị đã nhập BẮT BUỘC nổi bật — chốt 2026-08-14, .claude/docs/ui-guidelines.md mục 4.1c. */
const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const readOnlyInputClassName = `${inputClassName} bg-slate-50 text-slate-800`;

/**
 * Đặt lịch nhanh (docs/DECISIONS.md #032 — "lead capture") — trượt từ phải, chia 2 nhóm theo
 * Boxed Section Form Pattern (.claude/docs/ui-guidelines.md mục 9b): Thông tin hành chính +
 * Thông tin đặt lịch. Ngày hẹn giờ EDITABLE trong panel (không còn chỉ nhận từ prop cố định) —
 * panel tự tải `dayAppointments` theo ngày đang chọn (cùng query key với trang cha nên không gọi
 * API thừa khi trùng ngày đang xem).
 *
 * Tìm kiếm SĐT trong `patient` thật (không phải lịch sử đặt lịch cũ như bản trước) — khớp thì
 * KHOÁ CỨNG 3 trường định danh (SĐT/Họ tên/Mã bệnh nhân, không khoá Nguồn đặt lịch) để tránh gõ
 * sai — nhưng CHỈ để hiển thị, KHÔNG gửi `patientId` lên API (giữ đúng #032: appointment vẫn chỉ
 * lưu fullName/phone dạng tự do, việc gắn `patient_id` thật vẫn diễn ra ở bước Tiếp nhận). Không
 * tạo/gắn hồ sơ `patient` hay `encounter` nào ở bước này.
 */
export function AppointmentQuickCreatePanel({
  open,
  onClose,
  date,
  initialDoctorId,
  initialTime,
  doctors,
  defaultDurationMinutes,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  initialDoctorId: string | null;
  initialTime: string;
  doctors: DoctorOption[];
  defaultDurationMinutes: number;
}) {
  const [selectedDate, setSelectedDate] = useState(date);
  const [time, setTime] = useState(initialTime);
  const [doctorId, setDoctorId] = useState<string | null>(initialDoctorId);
  // Không đặt mặc định — bấm chọn Nguồn đặt lịch mới tô màu, tránh cảm giác "chưa bấm đã chọn"
  // (phản hồi thật của chủ dự án lúc dùng thử) và ép lễ tân thật sự xác nhận nguồn thay vì để mặc
  // định 'phone' âm thầm cho mọi lượt đặt.
  const [source, setSource] = useState<AppointmentSource | null>(null);
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [reason, setReason] = useState('');
  const [lockedPatient, setLockedPatient] = useState<{ id: string; patientCode: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<AppointmentSummary | null>(null);

  const currentUser = useAuthStore((s) => s.user);
  const createMutation = useCreateAppointmentMutation();
  const dayQuery = useAppointmentsByDateQuery(selectedDate);
  const dayAppointments = dayQuery.data?.items ?? [];
  const phoneMatches = usePatientByPhoneQuery(lockedPatient ? '' : phone);
  // Cảnh báo huỷ nhiều lần — vẫn tra theo lịch sử `appointment` (không phải `patient`), độc lập
  // với việc khớp/khoá hồ sơ bệnh nhân ở trên.
  const phoneCancelHistory = useAppointmentPhoneLookupQuery(phone);

  useEffect(() => {
    if (!open) return;
    setSelectedDate(date);
    setTime(initialTime);
    setDoctorId(initialDoctorId);
    setSource(null);
    setPhone('');
    setFullName('');
    setReason('');
    setLockedPatient(null);
    setSubmitError(null);
    setConfirmedBooking(null);
  }, [open, date, initialTime, initialDoctorId]);

  function pickPatient(p: { id: string; fullName: string; phone: string; patientCode: string }) {
    setLockedPatient({ id: p.id, patientCode: p.patientCode });
    setPhone(p.phone);
    setFullName(p.fullName);
  }

  const showSpamWarning = (phoneCancelHistory.data?.cancelledCount ?? 0) >= APPOINTMENT_SPAM_CANCELLED_THRESHOLD;

  async function handleSubmit() {
    if (!doctorId || !source || fullName.trim() === '' || phone.trim() === '') return;
    setSubmitError(null);
    try {
      const created = await createMutation.mutateAsync({
        doctorId,
        fullName: fullName.trim(),
        phone: phone.trim(),
        reason: reason.trim() === '' ? undefined : reason.trim(),
        scheduledAt: vnDateTimeToIso(selectedDate, time),
        durationMinutes: defaultDurationMinutes,
        source,
      });
      setConfirmedBooking(created);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  const canSubmit = Boolean(doctorId) && Boolean(source) && fullName.trim() !== '' && phone.trim().length >= 8;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/35 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[50vw] flex-col bg-white shadow-2xl transition-transform ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3.5">
          <h2 className="text-[15px] font-bold text-slate-900">Đặt lịch nhanh</h2>
          <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-slate-600">
            <X size={17} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-6">
            <section className="relative rounded-lg border border-slate-200 p-4 pt-6">
              <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                Thông tin hành chính
              </span>

              <div className="flex flex-col gap-3">
                {lockedPatient ? (
                  <div className="flex items-start justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{fullName}</div>
                      <div className="text-xs text-slate-500">
                        {lockedPatient.patientCode} · {phone}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLockedPatient(null)}
                      className="text-xs font-medium text-slate-400 underline hover:text-slate-600"
                    >
                      Đổi
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <label htmlFor="quick-create-phone" className="mb-1.5 block text-sm font-semibold text-slate-800">
                        Số điện thoại <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="quick-create-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Nhập số điện thoại khách hàng…"
                        className={inputClassName}
                      />
                      {phoneMatches.isSuccess && phoneMatches.data.items.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                          {phoneMatches.data.items.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => pickPatient(p)}
                              className="flex w-full flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-slate-50"
                            >
                              <span className="text-sm font-semibold text-slate-900">{p.fullName}</span>
                              <span className="text-xs text-slate-500">
                                {p.patientCode} · {p.phone} · Sinh {formatDobDisplay(p.dob)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label htmlFor="quick-create-fullname" className="mb-1.5 block text-sm font-semibold text-slate-800">
                        Họ tên <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="quick-create-fullname"
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Họ tên khách hàng"
                        className={inputClassName}
                      />
                    </div>
                  </>
                )}

                {showSpamWarning && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                    <span>
                      Số điện thoại này đã đặt và huỷ {phoneCancelHistory.data?.cancelledCount} lần trước đó — cân nhắc trước khi đặt lịch (vẫn có
                      thể tiếp tục).
                    </span>
                  </div>
                )}

                <div>
                  <span className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Nguồn đặt lịch <span className="text-rose-500">*</span>
                  </span>
                  <div className="flex gap-1.5">
                    {SOURCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSource(opt.value)}
                        className={`flex-1 rounded-md border px-2 py-2 text-center text-xs font-semibold transition-colors ${
                          source === opt.value
                            ? 'border-brand-teal bg-brand-teal text-white'
                            : 'border-slate-300 text-slate-600 hover:border-brand-teal hover:bg-brand-teal-tint'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="relative rounded-lg border border-slate-200 p-4 pt-6">
              <span className="absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                Thông tin đặt lịch
              </span>

              <div className="flex flex-col gap-3">
                <div>
                  <label htmlFor="quick-create-reason" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Lý do khám
                  </label>
                  <textarea
                    id="quick-create-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="Không bắt buộc"
                    className={inputClassName}
                  />
                </div>

                <div className="flex gap-2.5">
                  <div className="flex-1">
                    <label htmlFor="quick-create-date" className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Ngày hẹn <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="quick-create-date"
                      type="date"
                      value={selectedDate}
                      onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                      className={inputClassName}
                    />
                  </div>
                  <div className="flex-1">
                    <label htmlFor="quick-create-time" className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Giờ hẹn <span className="text-rose-500">*</span>
                    </label>
                    <TimeInput id="quick-create-time" required value={time} onChange={setTime} className={inputClassName} />
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Bác sĩ — trống/bận theo giờ vừa chọn
                    {dayQuery.isFetching && <span className="ml-1.5 font-normal text-slate-400">(đang tải…)</span>}
                  </span>
                  <DoctorAvailabilityList
                    doctors={doctors}
                    selectedDoctorId={doctorId}
                    onSelect={setDoctorId}
                    time={time}
                    durationMinutes={defaultDurationMinutes}
                    dayAppointments={dayAppointments}
                  />
                </div>
              </div>
            </section>

            <div>
              <span className="mb-1.5 block text-sm font-semibold text-slate-800">Người tạo lịch</span>
              <input
                type="text"
                readOnly
                disabled
                value={currentUser?.displayName ?? currentUser?.fullName ?? ''}
                className={readOnlyInputClassName}
              />
            </div>

            {submitError && (
              <p role="alert" className="text-sm text-rose-600">
                {submitError}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 gap-2.5 border-t border-slate-200 px-4 py-3.5">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="button" className="flex-1" disabled={!canSubmit} loading={createMutation.isPending} onClick={() => void handleSubmit()}>
            Lưu lịch hẹn
          </Button>
        </div>
      </div>

      {confirmedBooking && (
        <BookingConfirmDialog
          appointment={confirmedBooking}
          date={selectedDate}
          onConfirm={() => {
            setConfirmedBooking(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

/**
 * Hộp thoại xác nhận sau khi đặt lịch thành công (docs/DECISIONS.md #032, nội dung đã chốt với
 * chủ dự án). Đặt cục bộ trong file này — chỉ một nơi dùng, chưa đủ lý do tách `shared/ui`
 * (CLAUDE.md: trùng lặp lần hai mới trích xuất).
 */
function BookingConfirmDialog({ appointment, date, onConfirm }: { appointment: AppointmentSummary; date: string; onConfirm: () => void }) {
  const timeLabel = minutesToLabel(vnTimeOfDayMinutes(appointment.scheduledAt));
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
        <h3 className="mb-2 text-base font-bold text-slate-900">Đặt lịch thành công</h3>
        <p className="mb-5 text-sm text-slate-700">
          Đã đặt lịch thành công cho khách hàng <span className="font-semibold">{appointment.fullName}</span> vào lúc{' '}
          <span className="font-semibold">
            {timeLabel} · {formatDateLabel(date)}
          </span>{' '}
          với mã số là: <span className="font-semibold text-blue-700 tracking-wide">{appointment.bookingCode}</span>
        </p>
        <Button type="button" className="w-full" onClick={onConfirm}>
          Xác nhận
        </Button>
      </div>
    </div>
  );
}