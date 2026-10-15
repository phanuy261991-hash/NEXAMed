import { z } from 'zod';
import { paraclinicalLookupStatusSchema, paraclinicalValueFlagSchema } from './paraclinical-result';

// ---------------------------------------------------------------------------------------------
// Tab "Kết quả cận lâm sàng" ở Hồ sơ bệnh nhân (docs/DECISIONS.md #234, mockup đã duyệt 14/10/2026): kết quả ĐÃ DUYỆT theo BỆNH NHÂN (không theo chi nhánh đang làm việc —
// kết quả đi theo người bệnh, như tab Lịch sử khám) + diễn biến từng chỉ số xét nghiệm qua các lần đo. Mỗi nhóm (Xét nghiệm / CĐHA & Thăm dò chức năng) có quyền riêng
// (`lab_result.read` / `imaging_result.read`).
// ---------------------------------------------------------------------------------------------

export const listPatientParaclinicalResultsQuerySchema = z.object({
  /** Khoảng ngày DUYỆT kết quả (giờ Việt Nam, YYYY-MM-DD, gồm cả hai đầu); bỏ trống = tất cả. */
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
  status: paraclinicalLookupStatusSchema.optional(),
  /** Chỉ kết quả xét nghiệm có chỉ số bất thường (bỏ qua với CĐHA/thăm dò). */
  abnormalOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Con trỏ phân trang (chuỗi mờ do máy chủ cấp). */
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListPatientParaclinicalResultsQuery = z.infer<typeof listPatientParaclinicalResultsQuerySchema>;

/** Một chỉ số bất thường của dòng kết quả xét nghiệm ("Glucose 7,1 mmol/L" kèm cờ cao/thấp). */
export const patientParaclinicalAbnormalSchema = z.object({
  label: z.string(),
  valueText: z.string(),
  unit: z.string().nullable(),
  flag: paraclinicalValueFlagSchema,
});
export type PatientParaclinicalAbnormal = z.infer<typeof patientParaclinicalAbnormalSchema>;

export const patientParaclinicalResultRowSchema = z.object({
  /** Id dòng chỉ định — tham số mở/in kết quả. */
  itemId: z.string().uuid(),
  orderNo: z.string(),
  encounterId: z.string().uuid(),
  encounterNo: z.string().nullable(),
  serviceName: z.string(),
  /** Tên nhóm dịch vụ (SINH HOÁ, SIÊU ÂM...) — chữ nhỏ dưới tên dịch vụ; `null` nếu chưa phân nhóm. */
  categoryName: z.string().nullable(),
  /** Lúc duyệt (ký) kết quả. */
  signedAt: z.string(),
  signedByName: z.string().nullable(),
  doctorName: z.string().nullable(),
  status: paraclinicalLookupStatusSchema,
  /** Xét nghiệm: các chỉ số vượt khoảng tham chiếu (rỗng = không có). CĐHA: luôn rỗng. */
  abnormals: z.array(patientParaclinicalAbnormalSchema),
  /** Xét nghiệm: số chỉ số đã đánh giá được (có khoảng tham chiếu + có giá trị). */
  evaluatedCount: z.number().int().nonnegative(),
  /** CĐHA/thăm dò: kết luận (cắt ngắn ở máy chủ); xét nghiệm: `null`. */
  conclusionText: z.string().nullable(),
  imageCount: z.number().int().nonnegative(),
  branchId: z.string().uuid(),
  branchName: z.string().nullable(),
  /** Kết quả của chi nhánh KHÁC chi nhánh đang làm việc — dòng nền xanh nhạt ở giao diện. */
  isOtherBranch: z.boolean(),
});
export type PatientParaclinicalResultRow = z.infer<typeof patientParaclinicalResultRowSchema>;

/** Dải số: tính trên TOÀN BỘ kết quả đã duyệt của nhóm (không phụ thuộc bộ lọc đang chọn). */
export const patientParaclinicalSummarySchema = z.object({
  totalApproved: z.number().int().nonnegative(),
  firstSignedAt: z.string().nullable(),
  latestSignedAt: z.string().nullable(),
  latestServiceNames: z.array(z.string()),
  /** Số kết quả xét nghiệm có chỉ số bất thường (0 với CĐHA). */
  abnormalResults: z.number().int().nonnegative(),
  /** Số chỉ số dạng số có từ 3 lần đo trở lên (0 với CĐHA). */
  trackableIndicators: z.number().int().nonnegative(),
  /** CĐHA: số kết quả theo từng loại dịch vụ (SIÊU ÂM, X-QUANG, THĂM DÒ CN...), nhiều nhất trước; xét nghiệm: rỗng. */
  byCategory: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })),
});
export type PatientParaclinicalSummary = z.infer<typeof patientParaclinicalSummarySchema>;

export const listPatientParaclinicalResultsResponseSchema = z.object({
  items: z.array(patientParaclinicalResultRowSchema),
  nextCursor: z.string().nullable(),
  summary: patientParaclinicalSummarySchema,
  /** Công ty có từ 2 chi nhánh hoạt động trở lên — giao diện chỉ hiện cột Chi nhánh khi `true`. */
  multiBranch: z.boolean(),
});
export type ListPatientParaclinicalResultsResponse = z.infer<typeof listPatientParaclinicalResultsResponseSchema>;

// ---- Diễn biến chỉ số (chỉ xét nghiệm, chỉ chỉ số dạng số) ----

/** Một chỉ số theo dõi được: gộp theo MÃ chỉ số + ĐƠN VỊ (đổi đơn vị giữa các lần đo thì thành hai mục riêng, không quy đổi). */
export const patientIndicatorSummarySchema = z.object({
  code: z.string(),
  unit: z.string().nullable(),
  name: z.string(),
  groupName: z.string().nullable(),
  measureCount: z.number().int().positive(),
  latestValue: z.number(),
  latestValueText: z.string(),
  latestFlag: paraclinicalValueFlagSchema.nullable(),
  latestSignedAt: z.string(),
});
export type PatientIndicatorSummary = z.infer<typeof patientIndicatorSummarySchema>;

export const listPatientIndicatorsResponseSchema = z.object({ items: z.array(patientIndicatorSummarySchema) });
export type ListPatientIndicatorsResponse = z.infer<typeof listPatientIndicatorsResponseSchema>;

export const patientIndicatorTrendQuerySchema = z.object({
  code: z.string().trim().min(1).max(100),
  /** Bỏ trống = các lần đo không ghi đơn vị. */
  unit: z.string().trim().max(50).optional(),
});
export type PatientIndicatorTrendQuery = z.infer<typeof patientIndicatorTrendQuerySchema>;

export const patientIndicatorPointSchema = z.object({
  itemId: z.string().uuid(),
  orderNo: z.string(),
  signedAt: z.string(),
  value: z.number(),
  valueText: z.string(),
  flag: paraclinicalValueFlagSchema.nullable(),
  /** Khoảng tham chiếu ĐÃ ÁP cho lần đo này (chụp lúc duyệt) — thay đổi theo tuổi/giới nên ghi riêng từng lần. */
  referenceText: z.string(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  branchName: z.string().nullable(),
  isOtherBranch: z.boolean(),
});
export type PatientIndicatorPoint = z.infer<typeof patientIndicatorPointSchema>;

export const patientIndicatorTrendResponseSchema = z.object({
  code: z.string(),
  unit: z.string().nullable(),
  name: z.string(),
  /** Cũ → mới (giao diện đảo lại khi liệt kê bảng). */
  points: z.array(patientIndicatorPointSchema),
  multiBranch: z.boolean(),
});
export type PatientIndicatorTrendResponse = z.infer<typeof patientIndicatorTrendResponseSchema>;
