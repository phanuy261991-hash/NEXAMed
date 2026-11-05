import { z } from 'zod';
import { withReportScope } from './branch';
import { revenueGroupSchema } from './report-dashboard';

/**
 * Trang báo cáo "Doanh thu" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): Theo kỳ, Theo nhóm và dịch vụ, Theo phương thức, Phiếu chưa thu, Theo thu ngân và chốt ca.
 * Quyền xem: `revenue_report.read` (mặc định chỉ quản lý phòng khám). Máy chủ tính mọi số, web chỉ hiển thị. Ngày `YYYY-MM-DD` theo lịch Việt Nam; tiền là số nguyên đồng.
 * GHI NHẬN = `dueAmount` sau chiết khấu của phiếu chưa huỷ theo ngày khám; THỰC THU = thu trừ hoàn theo ngày thu (hai cột không bao giờ trộn).
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int();
const count = z.number().int();
const percent = z.number().nullable();

export type RevenueGroupCode = z.infer<typeof revenueGroupSchema>;

export const revenueGroupBySchema = z.enum(['day', 'week', 'month', 'quarter']);
export type RevenueGroupByCode = z.infer<typeof revenueGroupBySchema>;

export const revenuePeriodQuerySchema = withReportScope({ from: isoDate, to: isoDate });
export type RevenuePeriodQuery = z.infer<typeof revenuePeriodQuerySchema>;

export const revenueByPeriodQuerySchema = withReportScope({ from: isoDate, to: isoDate, groupBy: revenueGroupBySchema.default('month') });
export type RevenueByPeriodQuery = z.infer<typeof revenueByPeriodQuerySchema>;

const headerFields = {
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  /** Số chi nhánh trong phạm vi đã đọc. */
  branchCount: count,
};

const groupAmountsSchema = z.object({ EXAM: money, PARACLINICAL: money, DRUG: money, PACKAGE: money });

// ---- Theo kỳ ----

export const revenuePeriodRowSchema = z.object({
  /** Ngày đầu của khoảng gom. */
  key: isoDate,
  label: z.string(),
  byGroup: groupAmountsSchema,
  recognized: money,
  discount: money,
  refunded: money,
  collected: money,
  /** Thực thu = thu trừ hoàn. */
  net: money,
  /** % thay đổi Thực thu so với khoảng liền trước; `null` ở khoảng đầu hoặc khi khoảng trước bằng 0. */
  netDeltaPercent: percent,
});
export type RevenuePeriodRowDto = z.infer<typeof revenuePeriodRowSchema>;

export const revenueByPeriodReportSchema = z.object({
  ...headerFields,
  groupBy: revenueGroupBySchema,
  rows: z.array(revenuePeriodRowSchema),
  totals: z.object({ byGroup: groupAmountsSchema, recognized: money, discount: money, refunded: money, collected: money, net: money }),
});
export type RevenueByPeriodReport = z.infer<typeof revenueByPeriodReportSchema>;

// ---- Theo nhóm và dịch vụ ----

export const revenueServiceRowSchema = z.object({
  group: revenueGroupSchema,
  code: z.string(),
  name: z.string(),
  quantity: count,
  invoiceCount: count,
  amount: money,
  /** Tỉ trọng trên tổng ghi nhận của các dòng dịch vụ. */
  sharePercent: percent,
});
export type RevenueServiceRow = z.infer<typeof revenueServiceRowSchema>;

export const revenueByServiceReportSchema = z.object({
  ...headerFields,
  totalAmount: money,
  groups: z.array(z.object({ group: revenueGroupSchema, quantity: count, amount: money, sharePercent: percent })),
  rows: z.array(revenueServiceRowSchema),
  /** Tổng số dịch vụ khác nhau; lớn hơn `rows.length` khi danh sách bị cắt. */
  rowTotal: count,
});
export type RevenueByServiceReport = z.infer<typeof revenueByServiceReportSchema>;

// ---- Theo phương thức ----

export const revenueMethodRowSchema = z.object({
  methodCode: z.string(),
  methodName: z.string(),
  paymentCount: count,
  collected: money,
  refundCount: count,
  refunded: money,
  net: money,
  /** Tỉ trọng của Thực thu phương thức này trên tổng thực thu. */
  sharePercent: percent,
});
export type RevenueMethodRow = z.infer<typeof revenueMethodRowSchema>;

export const revenueByMethodReportSchema = z.object({
  ...headerFields,
  rows: z.array(revenueMethodRowSchema),
  totals: z.object({ paymentCount: count, collected: money, refundCount: count, refunded: money, net: money }),
});
export type RevenueByMethodReport = z.infer<typeof revenueByMethodReportSchema>;

// ---- Phiếu chưa thu ----

export const revenueUnpaidRowSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNo: z.string(),
  invoiceType: z.enum(['SERVICE', 'DRUG', 'PARACLINICAL']),
  patientCode: z.string(),
  patientName: z.string(),
  /** Ngày khám. */
  date: isoDate,
  /** Số ngày từ ngày khám đến hôm nay (0 = hôm nay). */
  ageDays: count,
  branchId: z.string().uuid(),
  branchName: z.string(),
  /** Số phải thu (`dueAmount` sau chiết khấu). */
  amount: money,
});
export type RevenueUnpaidRow = z.infer<typeof revenueUnpaidRowSchema>;

export const REVENUE_UNPAID_ROW_LIMIT = 2000;

export const revenueUnpaidReportSchema = z.object({
  ...headerFields,
  totalCount: count,
  totalAmount: money,
  /** Số ngày của phiếu cũ nhất; `null` khi không có phiếu nào. */
  oldestAgeDays: count.nullable(),
  /** Phân nhóm theo tuổi phiếu. */
  aging: z.array(z.object({ label: z.string(), invoiceCount: count, amount: money })),
  rows: z.array(revenueUnpaidRowSchema),
});
export type RevenueUnpaidReport = z.infer<typeof revenueUnpaidReportSchema>;

// ---- Theo thu ngân và chốt ca ----

export const revenueCashierRowSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  shiftCount: count,
  paymentCount: count,
  collected: money,
  refunded: money,
  net: money,
  /** Tổng chênh lệch kiểm đếm (kiểm đếm − dự kiến) của các ca đã chốt. */
  discrepancy: money,
  /** Số ca đã chốt có chênh lệch khác 0. */
  discrepancyShiftCount: count,
});
export type RevenueCashierRow = z.infer<typeof revenueCashierRowSchema>;

export const revenueShiftRowSchema = z.object({
  shiftNo: z.string(),
  label: z.string(),
  cashierName: z.string(),
  branchId: z.string().uuid(),
  branchName: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  status: z.enum(['OPEN', 'CLOSED']),
  expectedCash: money.nullable(),
  countedCash: money.nullable(),
  /** `countedCash − expectedCash`; `null` khi ca chưa chốt hoặc chưa kiểm đếm. */
  discrepancy: money.nullable(),
});
export type RevenueShiftRow = z.infer<typeof revenueShiftRowSchema>;

export const REVENUE_SHIFT_ROW_LIMIT = 1000;

export const revenueByCashierReportSchema = z.object({
  ...headerFields,
  cashiers: z.array(revenueCashierRowSchema),
  totals: z.object({ shiftCount: count, collected: money, refunded: money, net: money, discrepancy: money, discrepancyShiftCount: count }),
  shifts: z.array(revenueShiftRowSchema),
  shiftTotal: count,
});
export type RevenueByCashierReport = z.infer<typeof revenueByCashierReportSchema>;

/** Số ngày tối đa một lần xem (cùng giới hạn các báo cáo điều hành). */
export const REVENUE_MAX_RANGE_DAYS = 366;
