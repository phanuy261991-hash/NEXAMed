import type { ReceptionDashboard } from '@nexamed/shared';
import type { StackedBarItem } from '../../shared/ui/dashboard/StackedBarStrip';
import { visibleHours } from './dashboard-model';

/** Logic hiển thị THUẦN của Trang Tổng quan lễ tân — tách khỏi React để test được. Máy chủ đã tính mọi số; ở đây chỉ chọn chữ và đoạn dữ liệu hiển thị. */

const pad2 = (n: number) => String(n).padStart(2, '0');
const minuteLabel = (minute: number) => `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;

/** Tên bác sĩ kèm "BS." (đúng mockup); tên đã có sẵn tiền tố BS/Bác sĩ thì giữ nguyên. */
export function withDoctorTitle(name: string): string {
  return /^(BS\.?|Bác sĩ)\s/i.test(name.trim()) ? name.trim() : `BS. ${name.trim()}`;
}

/**
 * Câu cảnh báo bác sĩ nghỉ phép: "BS. A nghỉ phép từ 14:00 đến 18:00 hôm nay. 2 lịch hẹn cần đổi bác sĩ." (nghỉ cả ngày: "nghỉ phép cả ngày hôm nay"). Khung nghỉ là phút trong ngày giờ VN.
 */
export function leaveAlertSentence(alert: ReceptionDashboard['leaveAlerts'][number]): string {
  const wholeDay = alert.startMinute <= 0 && alert.endMinute >= 1440;
  const when = wholeDay ? 'nghỉ phép cả ngày hôm nay' : `nghỉ phép từ ${minuteLabel(alert.startMinute)} đến ${minuteLabel(alert.endMinute)} hôm nay`;
  return `${withDoctorTitle(alert.doctorName)} ${when}. ${alert.appointmentCount.toLocaleString('vi-VN')} lịch hẹn cần đổi bác sĩ.`;
}

/** Tổng số lịch hẹn cần đổi bác sĩ của mọi cảnh báo (nhãn liên kết "Xem N lịch hẹn"). */
export function leaveAlertsTotal(alerts: ReceptionDashboard['leaveAlerts']): number {
  return alerts.reduce((s, a) => s + a.appointmentCount, 0);
}

/** Đường dẫn mở trang Lịch hẹn ở đúng ngày và mở sẵn chi tiết một lịch (`mode`: xem để tiếp nhận / dời để đổi bác sĩ). */
export function appointmentHref(date: string, appointmentId: string, mode: 'view' | 'reschedule' = 'view'): string {
  return `/appointments?date=${date}&appointmentId=${appointmentId}${mode === 'view' ? '' : `&mode=${mode}`}`;
}

export interface HourlyAppointmentsChart {
  items: StackedBarItem[];
  /** Chỉ số cột của giờ hiện tại trong `items`; `null` nếu giờ hiện tại nằm ngoài khoảng hiển thị. */
  currentIndex: number | null;
  total: number;
}

/** Giờ hiển thị mặc định 07–18, mở rộng nếu có lịch ngoài khoảng đó (dùng lại `visibleHours`); đoạn dưới = đã đến, đoạn trên = chưa đến. */
export function buildHourlyAppointments(hourly: ReceptionDashboard['hourly'], currentHour: number): HourlyAppointmentsChart {
  const visible = visibleHours(hourly.map((h) => ({ hour: h.hour, count: h.arrived + h.notArrived })));
  const byHour = new Map(hourly.map((h) => [h.hour, h]));
  const items: StackedBarItem[] = visible.map((v) => {
    const h = byHour.get(v.hour)!;
    return {
      label: pad2(v.hour),
      segments: [
        { value: h.arrived, className: 'bg-emerald-500' },
        { value: h.notArrived, className: 'bg-amber-300' },
      ],
    };
  });
  const index = visible.findIndex((v) => v.hour === currentHour);
  return { items, currentIndex: index === -1 ? null : index, total: hourly.reduce((s, h) => s + h.arrived + h.notArrived, 0) };
}

/** "29 tuổi · BS. A" hoặc "BS. A" khi chưa có hồ sơ; `onLeave` thêm "· nghỉ phép" (hiển thị riêng tô màu). */
export function upcomingSubtitle(item: ReceptionDashboard['upcoming']['items'][number]): string {
  const doctor = withDoctorTitle(item.doctorName);
  return item.age === null ? doctor : `${item.age} tuổi · ${doctor}`;
}
