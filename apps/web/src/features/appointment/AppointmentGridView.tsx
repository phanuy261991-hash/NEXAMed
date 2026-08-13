import { useEffect, useMemo, useState } from 'react';
import { Clock } from '@phosphor-icons/react';
import type { AppointmentSummary, BusinessHours, DoctorOption } from '@nexamed/shared';
import { EmptyState } from '../../shared/ui/EmptyState';
import { APPOINTMENT_SOURCE_LABEL, APPOINTMENT_STATUS_META, isAppointmentLate } from './appointment-status';
import {
  GRID_STEP_MINUTES,
  ROW_HEIGHT_PX,
  generateSlotLabels,
  getVietnamTodayDateString,
  minutesToLabel,
  resolveDayHours,
  toMinutes,
  vietnamNowMinutes,
  vnTimeOfDayMinutes,
} from './schedule-grid.utils';

const TIME_COL_WIDTH = 64;
const DOCTOR_COL_MIN_WIDTH = 180;

function initials(fullName: string): string {
  return fullName
    .split(' ')
    .filter((w) => /^[\p{L}]/u.test(w))
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/**
 * Chế độ lưới (S2-09, APP-01) — cột = bác sĩ, hàng = khung giờ (bước 30 phút, đã chốt qua mockup).
 * Cột sinh động theo `doctors` (không hard-code số lượng), tự cuộn ngang khi nhiều bác sĩ
 * (`overflow-x-auto` trên khung ngoài). Exclusion constraint C2 ở DB đảm bảo một bác sĩ không bao
 * giờ có 2 lịch hẹn `SCHEDULED` chồng giờ, nên không cần xử lý thẻ chồng nhau trong cùng cột.
 */
export function AppointmentGridView({
  date,
  appointments,
  doctors,
  businessHours,
  onSlotClick,
  onCardClick,
}: {
  date: string;
  appointments: AppointmentSummary[];
  doctors: DoctorOption[];
  businessHours: BusinessHours | null;
  onSlotClick: (doctorId: string, time: string) => void;
  onCardClick: (appointment: AppointmentSummary) => void;
}) {
  const range = useMemo(() => resolveDayHours(businessHours, date), [businessHours, date]);
  const slots = useMemo(() => (range ? generateSlotLabels(range) : []), [range]);
  const totalHeight = slots.length * ROW_HEIGHT_PX;
  const isToday = date === getVietnamTodayDateString();

  const [nowMinutes, setNowMinutes] = useState(() => vietnamNowMinutes());
  useEffect(() => {
    if (!isToday) return;
    const timer = setInterval(() => setNowMinutes(vietnamNowMinutes()), 60_000);
    return () => clearInterval(timer);
  }, [isToday]);

  const byDoctor = useMemo(() => {
    const map = new Map<string, AppointmentSummary[]>();
    for (const a of appointments) {
      const list = map.get(a.doctorId) ?? [];
      list.push(a);
      map.set(a.doctorId, list);
    }
    return map;
  }, [appointments]);

  if (!range) {
    return (
      <EmptyState
        icon={Clock}
        title="Phòng khám không làm việc ngày này"
        description="Theo cấu hình giờ làm việc hiện tại. Chọn ngày khác hoặc cập nhật cấu hình ở Quản trị."
      />
    );
  }

  if (doctors.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="Chưa có bác sĩ nào"
        description="Vào Quản trị để tạo tài khoản và gán vai trò bác sĩ trước khi đặt lịch."
      />
    );
  }

  const startMin = toMinutes(range.open);
  const nowTop = isToday && nowMinutes >= startMin && nowMinutes < toMinutes(range.close) ? ((nowMinutes - startMin) / GRID_STEP_MINUTES) * ROW_HEIGHT_PX : null;

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <div
        className="grid"
        style={{ gridTemplateColumns: `${TIME_COL_WIDTH}px repeat(${doctors.length}, minmax(${DOCTOR_COL_MIN_WIDTH}px, 1fr))`, minWidth: TIME_COL_WIDTH + doctors.length * DOCTOR_COL_MIN_WIDTH }}
      >
        {/* Header — mỗi ô là 1 grid item riêng ở hàng 1 (không bọc div spanning, để tự thẳng
            hàng với thân bảng ở hàng 2 mà không cần grid-cols-subgrid). */}
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white" />
        {doctors.map((d) => (
          <div
            key={d.id}
            className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-r border-slate-200 bg-white px-3.5 py-2.5 last:border-r-0"
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-600">
              {initials(d.fullName)}
            </div>
            <div className="truncate text-[13.5px] font-semibold text-slate-900">{d.fullName}</div>
          </div>
        ))}

        {/* Cột giờ */}
        <div className="relative border-r border-slate-200" style={{ height: totalHeight }}>
          {slots.map((label, i) => (
            <div
              key={label}
              className="absolute right-2 text-right text-[11.5px] font-semibold text-slate-400"
              style={{ top: i * ROW_HEIGHT_PX + 4 }}
            >
              {label}
            </div>
          ))}
          {/* Nhãn giờ đóng cửa (biên dưới) — mỗi nhãn ở trên chỉ đánh dấu ĐẦU 1 khung 30 phút, nên
              hàng cuối ("16:30") trông như lưới dừng ở đó dù thực chất khung đó kéo dài tới đúng
              giờ đóng cửa. Thêm nhãn biên `range.close` ngay dưới hàng cuối để xác nhận trực quan
              lưới đã hiển thị đủ tới giờ đóng cửa thật (phát hiện thật lúc chủ dự án xem trên màn
              hình: "chỉ hiển thị đến 16h30 trong khi giờ làm việc là 7h30-17h"). */}
          <div
            className="absolute right-2 text-right text-[11.5px] font-semibold text-slate-400"
            style={{ top: totalHeight - 6 }}
          >
            {range.close}
          </div>
          {/* Chấm + nhãn giờ của đường kẻ "bây giờ" — phần đường kẻ nằm trong từng cột bác sĩ bên
              dưới (mỗi cột tự vẽ đoạn ngang cùng toạ độ `top`, ghép lại thành một đường liền mạch
              qua các cột — tránh đặt overlay làm 1 grid item riêng chồng lên hàng 2: item chiếm
              trọn `grid-row: 2` khiến thuật toán auto-placement né toàn bộ hàng 2, đẩy các cột
              giờ/bác sĩ auto-placed xuống hàng 3, lỗi hiển thị thật đã gặp — "trống" toàn bộ thân
              bảng dù DOM/chiều cao vẫn đúng). */}
          {nowTop !== null && (
            <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }}>
              <span className="absolute right-0 top-1/2 h-2 w-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-600 ring-2 ring-white" />
              <span className="absolute -top-2.5 left-0.5 whitespace-nowrap rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {minutesToLabel(nowMinutes)}
              </span>
            </div>
          )}
        </div>

        {/* Cột bác sĩ */}
        {doctors.map((doctor) => {
          const doctorAppointments = byDoctor.get(doctor.id) ?? [];
          const occupied = doctorAppointments.map((a) => {
            const start = (vnTimeOfDayMinutes(a.scheduledAt) - startMin) / GRID_STEP_MINUTES;
            return { start, end: start + a.durationMinutes / GRID_STEP_MINUTES, appointment: a };
          });

          return (
            <div
              key={doctor.id}
              className="relative border-r border-slate-200 last:border-r-0"
              style={{
                height: totalHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent ${ROW_HEIGHT_PX - 1}px, #e2e8f0 ${ROW_HEIGHT_PX - 1}px, #e2e8f0 ${ROW_HEIGHT_PX}px)`,
              }}
            >
              {slots.map((label, i) => {
                const row = i;
                const isOccupied = occupied.some((o) => row >= o.start && row < o.end);
                if (isOccupied) return null;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onSlotClick(doctor.id, label)}
                    aria-label={`Đặt lịch ${label} với ${doctor.fullName}`}
                    className="group absolute left-0.5 right-0.5 rounded-md hover:bg-blue-50 hover:outline hover:outline-1 hover:outline-dashed hover:outline-blue-200"
                    style={{ top: i * ROW_HEIGHT_PX, height: ROW_HEIGHT_PX - 2 }}
                  >
                    <span className="hidden items-center justify-center text-lg font-bold text-blue-600 group-hover:flex">+</span>
                  </button>
                );
              })}

              {occupied.map(({ start, appointment: a }) => {
                const late = isAppointmentLate(a.status, a.scheduledAt);
                const meta = APPOINTMENT_STATUS_META[a.status];
                const showSource = a.durationMinutes >= GRID_STEP_MINUTES;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onCardClick(a)}
                    className={`absolute left-0.5 right-0.5 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left shadow-sm hover:shadow-md ${
                      late ? 'border-amber-500 bg-amber-50' : `${meta.border} ${meta.bg}`
                    } ${a.status === 'CANCELLED' ? 'opacity-60 line-through' : ''}`}
                    style={{ top: start * ROW_HEIGHT_PX + 2, height: (a.durationMinutes / GRID_STEP_MINUTES) * ROW_HEIGHT_PX - 4 }}
                  >
                    <div className={`flex items-center gap-1 text-[10.5px] font-bold tabular-nums ${late ? 'text-amber-700' : meta.text}`}>
                      {late && <Clock size={10} weight="bold" aria-hidden="true" />}
                      {minutesToLabel(vnTimeOfDayMinutes(a.scheduledAt))}–{minutesToLabel(vnTimeOfDayMinutes(a.scheduledAt) + a.durationMinutes)}
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-900">{a.fullName}</div>
                    {showSource && <div className="truncate text-[10px] text-slate-500">{APPOINTMENT_SOURCE_LABEL[a.source]}</div>}
                  </button>
                );
              })}

              {/* Đoạn đường kẻ "bây giờ" thuộc cột này — mỗi cột tự vẽ đoạn ngang cùng toạ độ
                  `top` (đều tính từ cùng gốc `startMin`), ghép lại thành một đường liền mạch qua
                  hết các cột. Chấm + nhãn giờ đặt một lần duy nhất ở cột giờ bên trái (xem trên). */}
              {nowTop !== null && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-[1.5px] border-dashed border-rose-500"
                  style={{ top: nowTop }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
