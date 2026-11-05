import type { DoctorDashboard } from '@nexamed/shared';
import type { StackedBarItem } from '../../shared/ui/dashboard/StackedBarStrip';
import { formatWait, visibleHours } from './dashboard-model';

/** Logic hiển thị THUẦN của Trang Tổng quan bác sĩ (#286) — tách khỏi React để test được. Máy chủ đã tính mọi số; ở đây chỉ chọn chữ và đoạn dữ liệu hiển thị. */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Dòng phụ ô "Tổng lượt của tôi": "trung bình 12 lượt/ngày"; chưa có ngày nào trước đó thì không bịa số. */
export function averagePerDayText(average: number | null): string {
  return average === null ? 'chưa có số ngày trước để so' : `trung bình ${average.toLocaleString('vi-VN')} lượt/ngày`;
}

/** Dòng phụ ô "Đang chờ tôi": "người chờ lâu nhất 14 phút"; không ai chờ thì nói rõ. */
export function longestWaitText(minutes: number | null): string {
  return minutes === null ? 'không có ai đang chờ' : `người chờ lâu nhất ${formatWait(minutes)}`;
}

/** Dòng phụ ô "Đang khám": "Nguyễn Thị Lan · 8 phút"; chưa ai đang khám thì nói rõ. */
export function inProgressText(inProgress: DoctorDashboard['inProgress']): string {
  if (inProgress.patientName === null) return 'chưa có ai đang khám';
  const extra = inProgress.count > 1 ? ` (+${inProgress.count - 1})` : '';
  return `${inProgress.patientName}${extra}${inProgress.minutes === null ? '' : ` · ${formatWait(inProgress.minutes)}`}`;
}

/** Dòng phụ ô "Đã xong": "trung bình 11 phút mỗi lượt"; chưa có lượt nào đủ giờ thì nói rõ. */
export function doneText(done: DoctorDashboard['done']): string {
  if (done.count === 0) return 'chưa có lượt nào xong';
  return done.averageMinutes === null ? 'chưa đủ giờ để tính trung bình' : `trung bình ${formatWait(done.averageMinutes)} mỗi lượt`;
}

/** "BN00188 · 52 tuổi"; chưa có ngày sinh thì chỉ mã. */
export function patientSubtitle(item: Pick<DoctorDashboard['waitingList']['items'][number], 'patientCode' | 'age'>): string {
  return item.age === null ? item.patientCode : `${item.patientCode} · ${item.age} tuổi`;
}

export interface DoctorHourlyChart {
  items: StackedBarItem[];
  /** Chỉ số cột của giờ hiện tại trong `items`; `null` nếu nằm ngoài khoảng hiển thị. */
  currentIndex: number | null;
  total: number;
  /** Giờ đông nhất (cột đậm); `null` khi chưa có lượt nào. */
  peak: { hour: number; count: number } | null;
}

/** Giờ hiển thị mặc định 07–18 (dùng lại `visibleHours`); cột giờ đông nhất tô xanh đậm, các cột khác xanh nhạt. */
export function buildDoctorHourlyChart(hourly: DoctorDashboard['hourly'], currentHour: number): DoctorHourlyChart {
  const total = hourly.reduce((s, h) => s + h.count, 0);
  const peak = hourly.reduce<{ hour: number; count: number } | null>((best, h) => (h.count > 0 && (best === null || h.count > best.count) ? h : best), null);
  const visible = visibleHours(hourly);
  const items: StackedBarItem[] = visible.map((v) => ({
    label: pad2(v.hour),
    segments: [{ value: v.count, className: peak !== null && v.hour === peak.hour ? 'bg-blue-600' : 'bg-blue-300' }],
  }));
  const index = visible.findIndex((v) => v.hour === currentHour);
  return { items, currentIndex: index === -1 ? null : index, total, peak: peak ? { hour: peak.hour, count: peak.count } : null };
}

/** "đông nhất 10:00 — 3 lượt". */
export function peakText(peak: DoctorHourlyChart['peak']): string {
  return peak === null ? '' : `đông nhất ${pad2(peak.hour)}:00 — ${peak.count.toLocaleString('vi-VN')} lượt`;
}

/** Chữ "N chỉ số ngoài khoảng" của một dòng kết quả mới (xét nghiệm có chỉ số cao/thấp/bất thường); `null` khi không có để hiện. */
export function abnormalIndicatorText(count: number): string | null {
  return count > 0 ? `${count} chỉ số ngoài khoảng` : null;
}
