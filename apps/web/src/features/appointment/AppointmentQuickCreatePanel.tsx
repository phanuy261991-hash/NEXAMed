import { useEffect, useRef, useState } from 'react';
import { WarningCircle, X } from '@phosphor-icons/react';
import type { AppointmentSource, AppointmentSummary, DoctorOption } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { APPOINTMENT_SPAM_CANCELLED_THRESHOLD } from './appointment-status';

const DURATION_OPTIONS = [15, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} phút` }));
import { useAppointmentPhoneLookupQuery, useCreateAppointmentMutation } from './appointment.queries';
import { formatDateLabel, minutesToLabel, toMinutes, vnDateTimeToIso, vnTimeOfDayMinutes } from './schedule-grid.utils';

const SOURCE_OPTIONS: { value: AppointmentSource; label: string }[] = [
  { value: 'phone', label: 'Điện thoại' },
  { value: 'online', label: 'Online' },
  { value: 'walk_in', label: 'Walk-in' },
];

function findBusyUntilLabel(doctorId: string, time: string, durationMinutes: number, dayAppointments: AppointmentSummary[]): string | null {
  const start = toMinutes(time);
  const end = start + durationMinutes;
  let busyUntil: number | null = null;
  for (const a of dayAppointments) {
    if (a.doctorId !== doctorId || a.status === 'CANCELLED') continue;
    const aStart = vnTimeOfDayMinutes(a.scheduledAt);
    const aEnd = aStart + a.durationMinutes;
    if (start < aEnd && end > aStart) {
      busyUntil = busyUntil === null ? aEnd : Math.max(busyUntil, aEnd);
    }
  }
  return busyUntil === null ? null : minutesToLabel(busyUntil);
}

/**
 * Đặt lịch nhanh (docs/DECISIONS.md #032 — "lead capture", đổi từ S2-09) — ngày/giờ/bác sĩ điền
 * sẵn từ ô lưới đã chọn (hoặc mặc định khi mở từ nút "+ Đặt lịch"). Gợi ý bác sĩ trống/bận theo
 * giờ vừa chọn — đối chiếu với `dayAppointments` đã có sẵn trong bộ nhớ (từ
 * `useAppointmentsByDateQuery` của trang cha), KHÔNG gọi API mới. KHÔNG tạo/gắn hồ sơ `patient`
 * lúc đặt — chỉ ghi nhận Tên/SĐT/lý do khám trực tiếp, việc tạo hồ sơ chuyển sang lúc Tiếp nhận
 * (Sprint 3, chưa xây).
 */
export function AppointmentQuickCreatePanel({
  open,
  onClose,
  date,
  initialDoctorId,
  initialTime,
  doctors,
  dayAppointments,
  defaultDurationMinutes,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  initialDoctorId: string | null;
  initialTime: string;
  doctors: DoctorOption[];
  dayAppointments: AppointmentSummary[];
  defaultDurationMinutes: number;
}) {
  const [time, setTime] = useState(initialTime);
  const [durationMinutes, setDurationMinutes] = useState(defaultDurationMinutes);
  const [doctorId, setDoctorId] = useState<string | null>(initialDoctorId);
  const [source, setSource] = useState<AppointmentSource>('phone');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [reason, setReason] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<AppointmentSummary | null>(null);
  // Chỉ tự điền tên MỘT LẦN cho mỗi lần gõ SĐT mới — nếu lễ tân đã tự sửa tên (khác gợi ý) thì
  // không ghi đè lại nữa dù query lookup chạy lại (StrictMode/refetch).
  const lastAutoFilledPhone = useRef<string | null>(null);

  const createMutation = useCreateAppointmentMutation();
  const phoneLookup = useAppointmentPhoneLookupQuery(phone);

  useEffect(() => {
    if (!open) return;
    setTime(initialTime);
    setDurationMinutes(defaultDurationMinutes);
    setDoctorId(initialDoctorId);
    setSource('phone');
    setPhone('');
    setFullName('');
    setReason('');
    setSubmitError(null);
    setConfirmedBooking(null);
    lastAutoFilledPhone.current = null;
  }, [open, initialTime, initialDoctorId, defaultDurationMinutes]);

  // Tự điền Họ tên khi SĐT đã từng đặt lịch — chỉ điền khi ô tên đang trống hoặc đang giữ đúng
  // gợi ý của lần tra cứu trước (tránh ghi đè tên lễ tân vừa gõ tay).
  useEffect(() => {
    const suggested = phoneLookup.data?.suggestedFullName;
    if (!suggested || lastAutoFilledPhone.current === phone) return;
    setFullName((current) => (current.trim() === '' ? suggested : current));
    lastAutoFilledPhone.current = phone;
  }, [phoneLookup.data, phone]);

  const showSpamWarning = (phoneLookup.data?.cancelledCount ?? 0) >= APPOINTMENT_SPAM_CANCELLED_THRESHOLD;

  async function handleSubmit() {
    if (!doctorId || fullName.trim() === '' || phone.trim() === '') return;
    setSubmitError(null);
    try {
      const created = await createMutation.mutateAsync({
        doctorId,
        fullName: fullName.trim(),
        phone: phone.trim(),
        reason: reason.trim() === '' ? undefined : reason.trim(),
        scheduledAt: vnDateTimeToIso(date, time),
        durationMinutes,
        source,
      });
      setConfirmedBooking(created);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  const canSubmit = Boolean(doctorId) && fullName.trim() !== '' && phone.trim().length >= 8;

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
          <h2 className="text-[15px] font-bold text-slate-900">Đặt lịch nhanh</h2>
          <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-slate-600">
            <X size={17} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2.5">
              <div className="flex-1">
                <label htmlFor="quick-create-time" className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Giờ hẹn
                </label>
                <input
                  id="quick-create-time"
                  type="time"
                  value={time}
                  step={900}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="quick-create-duration" className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Thời lượng
                </label>
                <Combobox
                  id="quick-create-duration"
                  value={String(durationMinutes)}
                  onChange={(v) => setDurationMinutes(Number(v))}
                  options={DURATION_OPTIONS}
                />
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Bác sĩ — trống/bận theo giờ vừa chọn</span>
              <div className="flex flex-col gap-1.5">
                {doctors.map((d) => {
                  const busyUntil = findBusyUntilLabel(d.id, time, durationMinutes, dayAppointments);
                  const active = doctorId === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDoctorId(d.id)}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-left ${
                        active ? 'border-blue-600 bg-blue-50' : 'border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-sm font-semibold text-slate-900">{d.fullName}</span>
                      {busyUntil ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-700">Bận tới {busyUntil}</span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">Trống</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="quick-create-phone" className="mb-1.5 block text-xs font-semibold text-slate-600">
                Số điện thoại <span className="text-rose-500">*</span>
              </label>
              <input
                id="quick-create-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Nhập số điện thoại khách hàng…"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {showSpamWarning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                <span>
                  Số điện thoại này đã đặt và huỷ {phoneLookup.data?.cancelledCount} lần trước đó — cân nhắc trước khi đặt lịch (vẫn có thể tiếp tục).
                </span>
              </div>
            )}

            <div>
              <label htmlFor="quick-create-fullname" className="mb-1.5 block text-xs font-semibold text-slate-600">
                Họ tên <span className="text-rose-500">*</span>
              </label>
              <input
                id="quick-create-fullname"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Họ tên khách hàng"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label htmlFor="quick-create-reason" className="mb-1.5 block text-xs font-semibold text-slate-600">
                Lý do khám
              </label>
              <textarea
                id="quick-create-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Không bắt buộc"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Nguồn đặt lịch</span>
              <div className="flex gap-1.5">
                {SOURCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSource(opt.value)}
                    className={`flex-1 rounded-md border px-2 py-2 text-center text-xs font-semibold ${
                      source === opt.value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
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
          date={date}
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
          với mã số là: <span className="font-mono font-semibold text-blue-700">{appointment.bookingCode}</span>
        </p>
        <Button type="button" className="w-full" onClick={onConfirm}>
          Xác nhận
        </Button>
      </div>
    </div>
  );
}
