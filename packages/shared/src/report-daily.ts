import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * "Báo cáo ngày" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026). Máy chủ tính MỌI số, web chỉ hiển thị. Chỉ có HÔM NAY hoặc HÔM QUA (giờ Việt Nam) — chủ dự án chốt.
 * Phạm vi chi nhánh dùng chung bộ chọn của Báo cáo dòng tiền/Sổ quỹ (#235): `current` (mặc định), `all`, `pick`; hai loại sau cần quyền `company_report.read`.
 * Tiền là số nguyên đồng; thời điểm là ISO UTC.
 */
export const DAILY_REPORT_DAYS = ['today', 'yesterday'] as const;
export const dailyReportDaySchema = z.enum(DAILY_REPORT_DAYS);
export type DailyReportDay = z.infer<typeof dailyReportDaySchema>;

export const dailyReportQuerySchema = withReportScope({ day: dailyReportDaySchema.optional().default('today') });
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;

const count = z.number().int();

export const dailyVisitsSchema = z.object({
  received: count,
  newCount: count,
  returnCount: count,
  completed: count,
  stillOpen: count,
  cancelled: count,
  noShow: count,
});
export type DailyVisitsDto = z.infer<typeof dailyVisitsSchema>;

export const dailyMethodTotalSchema = z.object({ methodCode: z.string(), methodName: z.string(), paymentCount: count, amount: z.number().int() });

export const dailyCollectionSchema = z.object({
  byMethod: z.array(dailyMethodTotalSchema),
  collectedCount: count,
  collectedAmount: z.number().int(),
  refundedCount: count,
  refundedAmount: z.number().int(),
  netAmount: z.number().int(),
});

export const dailyRecognizedSchema = z.object({
  total: z.number().int(),
  byGroup: z.object({ EXAM: z.number().int(), PARACLINICAL: z.number().int(), DRUG: z.number().int(), PACKAGE: z.number().int() }),
});

export const dailyShiftSchema = z.object({
  shiftNo: z.string(),
  label: z.string(),
  cashierName: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  status: z.enum(['OPEN', 'CLOSED']),
  expectedCash: z.number().int().nullable(),
  countedCash: z.number().int().nullable(),
  discrepancy: z.number().int().nullable(),
});

const unpaidSchema = z.object({ invoiceCount: count, amount: z.number().int() });
const counterVouchersSchema = z.object({ incomeAmount: z.number().int(), expenseAmount: z.number().int() });

export const dailyBranchReportSchema = z.object({
  branchId: z.string().uuid(),
  branchName: z.string(),
  visits: dailyVisitsSchema,
  collection: dailyCollectionSchema,
  recognized: dailyRecognizedSchema,
  unpaid: unpaidSchema,
  shifts: z.array(dailyShiftSchema),
  counterVouchers: counterVouchersSchema,
});
export type DailyBranchReportDto = z.infer<typeof dailyBranchReportSchema>;

export const dailyReportSchema = z.object({
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  /** Ngày của báo cáo, `YYYY-MM-DD` theo lịch Việt Nam. */
  date: z.string(),
  /** Mỗi chi nhánh trong phạm vi một phần tử (chi nhánh đang làm việc đứng đầu). Phạm vi một chi nhánh: đúng một phần tử. */
  branches: z.array(dailyBranchReportSchema),
  totals: z.object({
    visits: dailyVisitsSchema,
    collection: dailyCollectionSchema,
    recognized: dailyRecognizedSchema,
    unpaid: unpaidSchema,
    counterVouchers: counterVouchersSchema,
    /** Tổng chênh lệch kiểm đếm của các ca đã chốt (âm = thiếu tiền). */
    shiftDiscrepancy: z.number().int(),
  }),
});
export type DailyReport = z.infer<typeof dailyReportSchema>;
