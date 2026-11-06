import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * Trang báo cáo "Chất lượng và tuân thủ" (docs/DECISIONS.md #287/#290, danh mục báo cáo đã duyệt 05/11/2026): Lượt khám chưa hoàn tất, Liên thông đơn thuốc, Nhật ký kiểm toán (tab dẫn sang trang
 * cũ, không có route ở đây). Quyền xem: `quality_report.read` (mặc định chỉ quản lý phòng khám). Máy chủ tính mọi số, web chỉ hiển thị.
 * "Lượt khám chưa hoàn tất" là ẢNH CHỤP tình trạng đến hôm nay (không theo kỳ): chỉ lấy phạm vi chi nhánh. "Liên thông đơn thuốc" theo kỳ, tính theo NGÀY KÝ đơn (giờ Việt Nam).
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int();
const percent = z.number().nullable();

/** Ảnh chụp tình trạng hiện tại: chỉ có phạm vi chi nhánh (web có gửi kèm `from`/`to` của khung chung, bị bỏ qua). */
export const qualityIncompleteQuerySchema = withReportScope({});
export type QualityIncompleteQuery = z.infer<typeof qualityIncompleteQuerySchema>;

export const qualityInteropQuerySchema = withReportScope({ from: isoDate, to: isoDate });
export type QualityInteropQuery = z.infer<typeof qualityInteropQuerySchema>;

// ---- Lượt khám chưa hoàn tất ----

export const qualityStaleEncounterRowSchema = z.object({
  encounterId: z.string().uuid(),
  encounterNo: z.string(),
  patientCode: z.string(),
  patientName: z.string(),
  /** `CHECKED_IN` (chờ khám) hoặc `IN_CONSULTATION` (đang khám). */
  status: z.string(),
  /** Ngày tiếp nhận (giờ Việt Nam). */
  visitDate: isoDate,
  /** Số ngày đã treo tính đến hôm nay. */
  daysOpen: count,
  doctorName: z.string().nullable(),
  branchName: z.string(),
});
export type QualityStaleEncounterRow = z.infer<typeof qualityStaleEncounterRowSchema>;

export const qualityOpenShiftRowSchema = z.object({
  shiftId: z.string().uuid(),
  shiftNo: z.string(),
  cashierName: z.string(),
  /** Mốc mở ca (ISO). */
  openedAt: z.string(),
  daysOpen: count,
  branchName: z.string(),
});
export type QualityOpenShiftRow = z.infer<typeof qualityOpenShiftRowSchema>;

export const qualityIncompleteReportSchema = z.object({
  generatedAt: z.string(),
  /** Ngày hôm nay theo giờ Việt Nam — mốc "từ các ngày trước". */
  asOf: isoDate,
  branchCount: count,
  summary: z.object({
    staleEncounters: count,
    openShifts: count,
    /** Phiếu thu CHƯA THU của lượt khám từ các ngày trước (chi tiết ở báo cáo Doanh thu → Phiếu chưa thu). */
    unpaidInvoices: count,
    oldestEncounterDays: count.nullable(),
  }),
  /** Lượt chờ khám/đang khám từ các ngày trước, treo lâu nhất trước, tối đa `QUALITY_STALE_LIST_LIMIT` dòng. */
  encounters: z.array(qualityStaleEncounterRowSchema),
  /** Ca thu ngân mở từ các ngày trước mà chưa đóng, tối đa `QUALITY_SHIFT_LIST_LIMIT` dòng. */
  shifts: z.array(qualityOpenShiftRowSchema),
});
export type QualityIncompleteReport = z.infer<typeof qualityIncompleteReportSchema>;

export const QUALITY_STALE_LIST_LIMIT = 200;
export const QUALITY_SHIFT_LIST_LIMIT = 50;

// ---- Liên thông đơn thuốc ----

export const qualityInteropDoctorRowSchema = z.object({
  doctorName: z.string(),
  total: count,
  sent: count,
  pending: count,
  failed: count,
});
export type QualityInteropDoctorRow = z.infer<typeof qualityInteropDoctorRowSchema>;

export const qualityInteropProblemRowSchema = z.object({
  submissionId: z.string().uuid(),
  encounterId: z.string().uuid(),
  encounterNo: z.string(),
  patientCode: z.string(),
  patientName: z.string(),
  doctorName: z.string().nullable(),
  nationalCode: z.string(),
  /** `PENDING` (chờ gửi) hoặc `FAILED` (cổng từ chối/lỗi). */
  status: z.string(),
  attempts: count,
  lastHttpStatus: count.nullable(),
  /** Nguyên văn lỗi cổng trả hoặc lý do chưa gửi được. */
  errors: z.array(z.string()),
  signedAt: z.string(),
  nextAttemptAt: z.string().nullable(),
  branchName: z.string(),
});
export type QualityInteropProblemRow = z.infer<typeof qualityInteropProblemRowSchema>;

export const qualityInteropReportSchema = z.object({
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  branchCount: count,
  summary: z.object({
    total: count,
    /** Đã gửi (kể cả bản đính chính đã gửi lại). */
    sent: count,
    pending: count,
    failed: count,
    sentPercent: percent,
    /** Số ngày kể từ đơn CHƯA gửi được cũ nhất trong kỳ; `null` khi không có đơn nào tồn. */
    oldestUnsentDays: count.nullable(),
  }),
  byDoctor: z.array(qualityInteropDoctorRowSchema),
  /** Đơn chờ gửi hoặc bị cổng từ chối, cũ nhất trước, tối đa `QUALITY_INTEROP_LIST_LIMIT` dòng. */
  problems: z.array(qualityInteropProblemRowSchema),
  problemTotal: count,
});
export type QualityInteropReport = z.infer<typeof qualityInteropReportSchema>;

export const QUALITY_INTEROP_LIST_LIMIT = 100;
