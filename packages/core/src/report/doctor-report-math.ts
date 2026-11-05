import { roundPercent } from './operations-report-math';

/**
 * Phép tính thuần của trang báo cáo "Bác sĩ" (docs/DECISIONS.md #287) — không biết gì về DB hay HTTP. Máy chủ nạp số đếm thô theo bác sĩ, các hàm ở đây ghép thành dòng báo cáo, xếp hạng và dòng cộng.
 */
export interface DoctorStatRaw {
  doctorId: string;
  doctorName: string;
  departmentId: string | null;
  departmentName: string;
  visits: number;
  /** Số lượt đo được thời gian khám (có cả giờ bắt đầu và hoàn tất) và tổng phút của chúng. */
  measured: number;
  sumMinutes: number;
  withCls: number;
  clsInHouse: number;
  clsExternal: number;
  withPrescription: number;
  prescriptionItems: number;
  withFollowUp: number;
  activeDays: number;
}

const average = (sum: number, n: number): number | null => (n <= 0 ? null : Math.round(sum / n));

export interface DoctorPerformanceOut {
  doctorId: string;
  doctorName: string;
  departmentId: string | null;
  departmentName: string;
  rank: number;
  visits: number;
  avgMinutes: number | null;
  revenue: number;
  revenuePerVisit: number | null;
  clsPercent: number | null;
  drugPercent: number | null;
  followUpPercent: number | null;
}

export interface DoctorPerformanceSummary {
  rows: DoctorPerformanceOut[];
  totals: {
    doctorCount: number;
    visits: number;
    visitsPerDoctor: number | null;
    avgMinutes: number | null;
    revenue: number;
    revenuePerVisit: number | null;
    clsPercent: number | null;
    drugPercent: number | null;
    followUpPercent: number | null;
  };
}

/** Hiệu suất theo bác sĩ: xếp theo doanh thu sinh ra giảm dần, bằng nhau thì theo số lượt rồi theo tên. Bác sĩ không có lượt nào không xuất hiện. */
export function summarizeDoctorPerformance(stats: readonly DoctorStatRaw[], revenueByDoctor: ReadonlyMap<string, number>): DoctorPerformanceSummary {
  const present = stats.filter((s) => s.visits > 0);
  const sorted = [...present].sort((a, b) => (revenueByDoctor.get(b.doctorId) ?? 0) - (revenueByDoctor.get(a.doctorId) ?? 0) || b.visits - a.visits || a.doctorName.localeCompare(b.doctorName, 'vi'));
  const rows: DoctorPerformanceOut[] = sorted.map((s, i) => {
    const revenue = revenueByDoctor.get(s.doctorId) ?? 0;
    return {
      doctorId: s.doctorId,
      doctorName: s.doctorName,
      departmentId: s.departmentId,
      departmentName: s.departmentName,
      rank: i + 1,
      visits: s.visits,
      avgMinutes: average(s.sumMinutes, s.measured),
      revenue,
      revenuePerVisit: average(revenue, s.visits),
      clsPercent: roundPercent(s.withCls, s.visits),
      drugPercent: roundPercent(s.withPrescription, s.visits),
      followUpPercent: roundPercent(s.withFollowUp, s.visits),
    };
  });
  const sum = (f: (s: DoctorStatRaw) => number) => present.reduce((acc, s) => acc + f(s), 0);
  const visits = sum((s) => s.visits);
  const revenue = rows.reduce((acc, r) => acc + r.revenue, 0);
  return {
    rows,
    totals: {
      doctorCount: present.length,
      visits,
      visitsPerDoctor: average(visits, present.length),
      avgMinutes: average(sum((s) => s.sumMinutes), sum((s) => s.measured)),
      revenue,
      revenuePerVisit: average(revenue, visits),
      clsPercent: roundPercent(sum((s) => s.withCls), visits),
      drugPercent: roundPercent(sum((s) => s.withPrescription), visits),
      followUpPercent: roundPercent(sum((s) => s.withFollowUp), visits),
    },
  };
}

/** Số dòng thuốc trung bình trên một đơn, một chữ số thập phân; `null` khi chưa có đơn. */
export function itemsPerPrescription(items: number, prescriptions: number): number | null {
  return prescriptions <= 0 ? null : Math.round((items / prescriptions) * 10) / 10;
}

export interface DoctorOrderMixOut {
  doctorId: string;
  doctorName: string;
  departmentId: string | null;
  departmentName: string;
  visits: number;
  withPrescription: number;
  prescriptionItems: number;
  itemsPerPrescription: number | null;
  withCls: number;
  clsInHouse: number;
  clsExternal: number;
  withFollowUp: number;
}

/** Cơ cấu kê đơn và chỉ định: xếp theo số lượt giảm dần, bằng nhau thì theo tên. */
export function summarizeDoctorOrderMix(stats: readonly DoctorStatRaw[]): { rows: DoctorOrderMixOut[]; totals: Omit<DoctorOrderMixOut, 'doctorId' | 'doctorName' | 'departmentId' | 'departmentName'> } {
  const present = stats.filter((s) => s.visits > 0).sort((a, b) => b.visits - a.visits || a.doctorName.localeCompare(b.doctorName, 'vi'));
  const rows = present.map((s) => ({
    doctorId: s.doctorId,
    doctorName: s.doctorName,
    departmentId: s.departmentId,
    departmentName: s.departmentName,
    visits: s.visits,
    withPrescription: s.withPrescription,
    prescriptionItems: s.prescriptionItems,
    itemsPerPrescription: itemsPerPrescription(s.prescriptionItems, s.withPrescription),
    withCls: s.withCls,
    clsInHouse: s.clsInHouse,
    clsExternal: s.clsExternal,
    withFollowUp: s.withFollowUp,
  }));
  const sum = (f: (r: DoctorOrderMixOut) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  const withPrescription = sum((r) => r.withPrescription);
  const prescriptionItems = sum((r) => r.prescriptionItems);
  return {
    rows,
    totals: {
      visits: sum((r) => r.visits),
      withPrescription,
      prescriptionItems,
      itemsPerPrescription: itemsPerPrescription(prescriptionItems, withPrescription),
      withCls: sum((r) => r.withCls),
      clsInHouse: sum((r) => r.clsInHouse),
      clsExternal: sum((r) => r.clsExternal),
      withFollowUp: sum((r) => r.withFollowUp),
    },
  };
}

export interface DoctorHoursInput {
  doctorId: string;
  doctorName: string;
  departmentId: string | null;
  departmentName: string;
  scheduledDays: number;
  scheduledMinutes: number;
  leaveDays: number;
  leaveMinutes: number;
  activeDays: number;
  visits: number;
  consultMinutes: number;
}

export interface DoctorHoursOut extends DoctorHoursInput {
  visitsPerActiveDay: number | null;
  utilizationPercent: number | null;
}

/** Giờ làm việc và lượt khám: lượt/ngày làm = lượt ÷ ngày có khám (một chữ số thập phân); tỉ lệ sử dụng = phút khám ÷ phút ca đã xếp (`null` khi không có ca nào). Xếp theo tên. */
export function summarizeDoctorHours(inputs: readonly DoctorHoursInput[]): { rows: DoctorHoursOut[]; totals: { doctorCount: number; scheduledDays: number; scheduledMinutes: number; leaveDays: number; leaveMinutes: number; activeDays: number; visits: number; consultMinutes: number; utilizationPercent: number | null } } {
  const rows: DoctorHoursOut[] = [...inputs]
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'vi'))
    .map((r) => ({
      ...r,
      visitsPerActiveDay: r.activeDays <= 0 ? null : Math.round((r.visits / r.activeDays) * 10) / 10,
      utilizationPercent: roundPercent(r.consultMinutes, r.scheduledMinutes),
    }));
  const sum = (f: (r: DoctorHoursOut) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  const scheduledMinutes = sum((r) => r.scheduledMinutes);
  return {
    rows,
    totals: {
      doctorCount: rows.length,
      scheduledDays: sum((r) => r.scheduledDays),
      scheduledMinutes,
      leaveDays: sum((r) => r.leaveDays),
      leaveMinutes: sum((r) => r.leaveMinutes),
      activeDays: sum((r) => r.activeDays),
      visits: sum((r) => r.visits),
      consultMinutes: sum((r) => r.consultMinutes),
      // Chỉ tính phút khám của bác sĩ CÓ ca đã xếp, để tổng không bị phình bởi người khám không theo ca.
      utilizationPercent: roundPercent(rows.filter((r) => r.scheduledMinutes > 0).reduce((acc, r) => acc + r.consultMinutes, 0), scheduledMinutes),
    },
  };
}

/** Số phút của một ca "HH:mm"–"HH:mm" trừ giờ nghỉ; ca qua đêm (giờ kết thúc nhỏ hơn giờ bắt đầu) cộng thêm 24 giờ. `standardWorkMinutes` (nếu đã đặt) được ưu tiên. */
export function shiftWorkMinutes(startTime: string, endTime: string, restMinutes: number | null, standardWorkMinutes: number | null): number {
  if (standardWorkMinutes !== null) return Math.max(0, standardWorkMinutes);
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  let span = toMinutes(endTime) - toMinutes(startTime);
  if (span < 0) span += 24 * 60;
  return Math.max(0, span - (restMinutes ?? 0));
}
