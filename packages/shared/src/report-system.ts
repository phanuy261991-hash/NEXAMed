import { z } from 'zod';
import { withReportScope } from './branch';
import { revenueGroupSchema } from './report-dashboard';

/**
 * Trang báo cáo "Toàn hệ thống" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): So sánh chi nhánh, Xếp hạng, Tổng hợp tháng, Khám chéo chi nhánh. Quyền xem: `company_report.read`
 * ("Xem báo cáo toàn công ty", #235) — cũng là quyền để chọn phạm vi gộp nhiều chi nhánh. Máy chủ tính mọi số, web chỉ hiển thị. Ngày `YYYY-MM-DD` theo lịch Việt Nam; tiền là số nguyên đồng.
 * Dữ liệu theo CHI NHÁNH; bệnh nhân dùng chung cả công ty (Khám chéo chi nhánh) nên báo cáo đó KHÔNG hiện tiền theo bệnh nhân (hướng chi nhánh #231).
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int();
const count = z.number().int();
const percent = z.number().nullable();

/** Số dòng tối đa của mỗi bảng xếp hạng và của danh sách bệnh nhân khám chéo. */
export const SYSTEM_RANKING_LIMIT = 20;
export const SYSTEM_CROSS_ROW_LIMIT = 500;
export const SYSTEM_MAX_RANGE_DAYS = 366;
/** Số tháng của dải xu hướng ở tab Tổng hợp tháng. */
export const SYSTEM_TREND_MONTHS = 6;

export const systemPeriodQuerySchema = withReportScope({ from: isoDate, to: isoDate });
export type SystemPeriodQuery = z.infer<typeof systemPeriodQuerySchema>;

export const systemMonthlyQuerySchema = withReportScope({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export type SystemMonthlyQuery = z.infer<typeof systemMonthlyQuerySchema>;

const headerFields = {
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  /** Số chi nhánh trong phạm vi đã đọc. */
  branchCount: count,
};

const branchRef = z.object({ branchId: z.string().uuid(), branchName: z.string() });

const kpiWithPreviousSchema = z.object({
  value: money,
  previous: money,
  /** % thay đổi so với kỳ trước (một chữ số thập phân); `null` khi kỳ trước bằng 0. */
  percent: percent,
  direction: z.enum(['up', 'down', 'flat']),
});
export type SystemKpi = z.infer<typeof kpiWithPreviousSchema>;

// ---- So sánh chi nhánh ----

export const systemBranchRowSchema = branchRef.extend({
  visits: count,
  newPatients: count,
  /** Doanh thu ghi nhận (`dueAmount` sau chiết khấu, theo ngày khám). */
  recognized: money,
  /** Thực thu (thu trừ hoàn, theo ngày thu). */
  collected: money,
  /** Phiếu chưa thu của lượt khám trong kỳ. */
  unpaidAmount: money,
  unpaidCount: count,
  /** Phút chờ trung bình từ tiếp nhận đến vào khám; `null` khi chưa đo được. */
  averageWaitMinutes: percent,
  /** Tỉ lệ hẹn tái khám đã đến trong số hẹn đã đến hoặc quá hạn; `null` khi không có hẹn nào. */
  followUpArrivalPercent: percent,
  /** Lãi gộp của riêng thuốc và vật tư. */
  drugMargin: money,
});
export type SystemBranchRow = z.infer<typeof systemBranchRowSchema>;

export const systemAlertSchema = branchRef.extend({
  kind: z.enum(['OPEN_SHIFTS', 'OVERDUE_UNPAID', 'EXPIRING_BATCHES', 'LONG_WAIT']),
  text: z.string(),
  count: count,
});
export type SystemAlertDto = z.infer<typeof systemAlertSchema>;

export const systemOverviewReportSchema = z.object({
  ...headerFields,
  /** Kỳ so sánh (tháng liền trước khi kỳ tròn tháng, không thì khoảng cùng độ dài liền trước). */
  previousFrom: isoDate,
  previousTo: isoDate,
  kpis: z.object({ recognized: kpiWithPreviousSchema, collected: kpiWithPreviousSchema, visits: kpiWithPreviousSchema, newPatients: kpiWithPreviousSchema, unpaidAmount: money, unpaidCount: count }),
  rows: z.array(systemBranchRowSchema),
  totals: z.object({
    visits: count,
    newPatients: count,
    recognized: money,
    collected: money,
    unpaidAmount: money,
    unpaidCount: count,
    averageWaitMinutes: percent,
    followUpArrivalPercent: percent,
    drugMargin: money,
  }),
  /** Thực thu từng ngày của từng chi nhánh: `dates` là mọi ngày của kỳ, mỗi chuỗi có đúng bấy nhiêu giá trị. */
  daily: z.object({ dates: z.array(isoDate), series: z.array(branchRef.extend({ values: z.array(money) })) }),
  /** Cơ cấu thực thu theo nhóm. */
  groups: z.array(z.object({ group: revenueGroupSchema, amount: money, sharePercent: percent })),
  groupTotal: money,
  alerts: z.array(systemAlertSchema),
});
export type SystemOverviewReport = z.infer<typeof systemOverviewReportSchema>;

// ---- Xếp hạng ----

export const systemRankRowSchema = z.object({
  key: z.string(),
  name: z.string(),
  subtitle: z.string(),
  quantity: count,
  total: money,
  /** Giá trị của từng chi nhánh, đúng thứ tự `branches`. */
  byBranch: z.array(money),
});
export type SystemRankRow = z.infer<typeof systemRankRowSchema>;

export const systemRankingReportSchema = z.object({
  ...headerFields,
  branches: z.array(branchRef),
  /** Dịch vụ khám, cận lâm sàng, gói — xếp theo doanh thu ghi nhận; số lượng là số lượng đã dùng. */
  services: z.array(systemRankRowSchema),
  /** Bác sĩ — xếp theo doanh thu sinh ra; số lượng là lượt khám đã hoàn tất. */
  doctors: z.array(systemRankRowSchema),
  /** Thuốc và vật tư — xếp theo lãi gộp; số lượng là số lượng bán ròng (đơn vị cơ sở). */
  drugs: z.array(systemRankRowSchema),
});
export type SystemRankingReport = z.infer<typeof systemRankingReportSchema>;

// ---- Tổng hợp tháng ----

const monthMetrics = z.object({ visits: count, newPatients: count, recognized: money, collected: money, drugMargin: money });
export type SystemMonthMetrics = z.infer<typeof monthMetrics>;

export const systemMonthlyReportSchema = z.object({
  ...headerFields,
  /** Tháng đang xem `YYYY-MM` và tháng liền trước dùng để so sánh. */
  month: z.string(),
  previousMonth: z.string(),
  kpis: z.object({ recognized: kpiWithPreviousSchema, collected: kpiWithPreviousSchema, visits: kpiWithPreviousSchema, newPatients: kpiWithPreviousSchema, drugMargin: kpiWithPreviousSchema }),
  rows: z.array(branchRef.extend({ current: monthMetrics, previous: monthMetrics })),
  groups: z.array(z.object({ group: revenueGroupSchema, amount: money, sharePercent: percent })),
  groupTotal: money,
  /** Sáu tháng gần nhất kết thúc ở tháng đang xem, cũ nhất trước (toàn phạm vi, không gồm lãi gộp). */
  trend: z.array(z.object({ month: z.string(), visits: count, newPatients: count, recognized: money, collected: money })),
});
export type SystemMonthlyReport = z.infer<typeof systemMonthlyReportSchema>;

// ---- Khám chéo chi nhánh ----

export const systemCrossPatientSchema = z.object({
  patientId: z.string().uuid(),
  patientCode: z.string(),
  patientName: z.string(),
  branchCount: count,
  visitCount: count,
  /** Ngày khám gần nhất `YYYY-MM-DD`. */
  lastVisitDate: isoDate,
  /** Số lượt ở từng chi nhánh, nhiều lượt nhất trước. */
  branches: z.array(z.object({ branchName: z.string(), visits: count })),
});
export type SystemCrossPatient = z.infer<typeof systemCrossPatientSchema>;

export const systemCrossReportSchema = z.object({
  ...headerFields,
  totals: z.object({
    /** Bệnh nhân khác nhau có lượt khám trong phạm vi. */
    patientCount: count,
    /** Bệnh nhân khám ở từ hai chi nhánh trở lên. */
    crossPatientCount: count,
    crossPercent: percent,
    /** Tổng số lượt khám của các bệnh nhân khám chéo. */
    crossVisits: count,
  }),
  /** Mỗi cặp chi nhánh: số bệnh nhân khám ở cả hai. */
  pairs: z.array(z.object({ branchAId: z.string().uuid(), branchAName: z.string(), branchBId: z.string().uuid(), branchBName: z.string(), patientCount: count })),
  rows: z.array(systemCrossPatientSchema),
  /** Tổng số bệnh nhân khám chéo; lớn hơn `rows.length` khi danh sách bị cắt. */
  rowTotal: count,
});
export type SystemCrossReport = z.infer<typeof systemCrossReportSchema>;

/** Nhãn nhóm doanh thu dùng chung web và Excel. */
export const SYSTEM_GROUP_LABEL: Record<z.infer<typeof revenueGroupSchema>, string> = { EXAM: 'Khám bệnh', PARACLINICAL: 'Cận lâm sàng', DRUG: 'Thuốc và vật tư', PACKAGE: 'Gói dịch vụ' };
