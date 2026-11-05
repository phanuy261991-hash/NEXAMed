import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * Trang báo cáo "Bác sĩ" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): Hiệu suất theo bác sĩ, Cơ cấu kê đơn và chỉ định, Giờ làm việc và lượt khám. Quyền xem: `doctor_report.read`
 * (mặc định chỉ quản lý phòng khám — bác sĩ KHÔNG xem trang này, chủ dự án chốt 05/11/2026; số của chính bác sĩ đã có ở Tổng quan bác sĩ). Máy chủ tính mọi số, web chỉ hiển thị.
 * "Lượt khám" = lượt đã hoàn tất của bác sĩ trong kỳ (theo ngày tiếp nhận giờ Việt Nam); lượt chưa gán bác sĩ không thuộc về ai nên không có trong báo cáo.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int();
const money = z.number().int();
const percent = z.number().nullable();

export const doctorReportQuerySchema = withReportScope({ from: isoDate, to: isoDate, departmentId: z.string().uuid().optional() });
export type DoctorReportQuery = z.infer<typeof doctorReportQuerySchema>;

const headerFields = {
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  branchCount: count,
};

const doctorIdentity = {
  doctorId: z.string().uuid(),
  doctorName: z.string(),
  departmentId: z.string().uuid().nullable(),
  /** Tên Khoa của bác sĩ; rỗng khi bác sĩ chưa gán Khoa. */
  departmentName: z.string(),
};

// ---- Hiệu suất theo bác sĩ ----

export const doctorPerformanceRowSchema = z.object({
  ...doctorIdentity,
  rank: count,
  visits: count,
  /** Số phút khám trung bình một lượt (`completed_at − started_at`); `null` khi chưa đo được lượt nào. */
  avgMinutes: count.nullable(),
  /** Doanh thu GHI NHẬN của các lượt bác sĩ đã khám: `dueAmount` sau chiết khấu, theo ngày khám. */
  revenue: money,
  revenuePerVisit: money.nullable(),
  /** Tỉ lệ lượt có chỉ định cận lâm sàng / có thuốc / có hẹn tái khám (trên số lượt khám). */
  clsPercent: percent,
  drugPercent: percent,
  followUpPercent: percent,
});
export type DoctorPerformanceRow = z.infer<typeof doctorPerformanceRowSchema>;

export const doctorPerformanceReportSchema = z.object({
  ...headerFields,
  rows: z.array(doctorPerformanceRowSchema),
  totals: z.object({
    doctorCount: count,
    visits: count,
    visitsPerDoctor: count.nullable(),
    avgMinutes: count.nullable(),
    revenue: money,
    revenuePerVisit: money.nullable(),
    clsPercent: percent,
    drugPercent: percent,
    followUpPercent: percent,
  }),
});
export type DoctorPerformanceReport = z.infer<typeof doctorPerformanceReportSchema>;

// ---- Cơ cấu kê đơn và chỉ định ----

export const doctorOrderMixRowSchema = z.object({
  ...doctorIdentity,
  visits: count,
  withPrescription: count,
  prescriptionItems: count,
  /** Số dòng thuốc trung bình trên một đơn (lượt có thuốc), một chữ số thập phân; `null` khi chưa có đơn. */
  itemsPerPrescription: z.number().nullable(),
  withCls: count,
  clsInHouse: count,
  clsExternal: count,
  withFollowUp: count,
});
export type DoctorOrderMixRow = z.infer<typeof doctorOrderMixRowSchema>;

export const doctorTopItemSchema = z.object({ name: z.string(), count, doctorCount: count });
export type DoctorTopItem = z.infer<typeof doctorTopItemSchema>;

export const doctorOrderMixReportSchema = z.object({
  ...headerFields,
  rows: z.array(doctorOrderMixRowSchema),
  totals: z.object({
    visits: count,
    withPrescription: count,
    prescriptionItems: count,
    itemsPerPrescription: z.number().nullable(),
    withCls: count,
    clsInHouse: count,
    clsExternal: count,
    withFollowUp: count,
  }),
  /** 10 thuốc được kê nhiều dòng nhất và 10 chỉ định cận lâm sàng nhiều nhất trong kỳ. */
  topDrugs: z.array(doctorTopItemSchema),
  topOrders: z.array(doctorTopItemSchema),
});
export type DoctorOrderMixReport = z.infer<typeof doctorOrderMixReportSchema>;

// ---- Giờ làm việc và lượt khám ----

export const doctorHoursRowSchema = z.object({
  ...doctorIdentity,
  /** Số ngày có ca đã xếp và tổng phút của các ca đó (theo Lịch làm việc, trừ giờ nghỉ giữa ca). */
  scheduledDays: count,
  scheduledMinutes: count,
  /** Đơn xin nghỉ ĐÃ DUYỆT trong kỳ: số ngày và tổng phút nghỉ. */
  leaveDays: count,
  leaveMinutes: count,
  /** Số ngày thực tế có khám, số lượt và số phút khám thực tế. */
  activeDays: count,
  visits: count,
  visitsPerActiveDay: z.number().nullable(),
  consultMinutes: count,
  /** Phút khám trên phút ca đã xếp; `null` khi bác sĩ không có ca nào được xếp trong kỳ. */
  utilizationPercent: percent,
});
export type DoctorHoursRow = z.infer<typeof doctorHoursRowSchema>;

export const doctorHoursReportSchema = z.object({
  ...headerFields,
  rows: z.array(doctorHoursRowSchema),
  totals: z.object({
    doctorCount: count,
    scheduledDays: count,
    scheduledMinutes: count,
    leaveDays: count,
    leaveMinutes: count,
    activeDays: count,
    visits: count,
    consultMinutes: count,
    utilizationPercent: percent,
  }),
});
export type DoctorHoursReport = z.infer<typeof doctorHoursReportSchema>;

/** Số dịch vụ/thuốc tối đa ở hai danh sách "nhiều nhất". */
export const DOCTOR_TOP_LIST_SIZE = 10;
