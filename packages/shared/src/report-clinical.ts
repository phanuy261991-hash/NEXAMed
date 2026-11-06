import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * Trang báo cáo "Chuyên môn" (docs/DECISIONS.md #287, danh mục báo cáo đã duyệt 05/11/2026): Cơ cấu chẩn đoán ICD-10, Dịch vụ đã dùng (dẫn sang báo cáo Doanh thu "Theo nhóm và dịch vụ" — cùng
 * số liệu, không làm trùng) và Cận lâm sàng. Quyền xem: `clinical_report.read` (mặc định chỉ quản lý phòng khám). Máy chủ tính mọi số, web chỉ hiển thị. "Lượt khám" = lượt đã HOÀN TẤT theo
 * ngày tiếp nhận giờ Việt Nam. Chẩn đoán lấy mã CHÍNH (`PRIMARY`) hiện hành của lượt khám (bản đã đính chính thay bản gốc).
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int();
const percent = z.number().nullable();

export const clinicalReportQuerySchema = withReportScope({ from: isoDate, to: isoDate });
export type ClinicalReportQuery = z.infer<typeof clinicalReportQuerySchema>;

const headerFields = {
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  branchCount: count,
};

// ---- Cơ cấu chẩn đoán ICD-10 ----

export const clinicalDiagnosisRowSchema = z.object({
  code: z.string(),
  /** Tên tiếng Việt trong danh mục ICD-10 của Bộ Y tế; rỗng khi mã không còn trong danh mục. */
  name: z.string(),
  visits: count,
  patients: count,
  /** Lượt khám mang mã này trên số lượt đã hoàn tất có chẩn đoán chính. */
  percent: percent,
});
export type ClinicalDiagnosisRow = z.infer<typeof clinicalDiagnosisRowSchema>;

export const clinicalChapterRowSchema = z.object({
  chapterCode: z.string(),
  chapterName: z.string(),
  visits: count,
  percent: percent,
});
export type ClinicalChapterRow = z.infer<typeof clinicalChapterRowSchema>;

export const clinicalDiagnosisReportSchema = z.object({
  ...headerFields,
  summary: z.object({
    /** Lượt đã hoàn tất trong kỳ. */
    completedVisits: count,
    /** Trong đó có chẩn đoán chính. */
    withDiagnosis: count,
    withoutDiagnosis: count,
    distinctCodes: count,
    /** Mã chẩn đoán nhiều nhất; `null` khi chưa có lượt nào có chẩn đoán. */
    topCode: z.string().nullable(),
    topCodeName: z.string(),
  }),
  /** Tối đa `CLINICAL_DIAGNOSIS_LIST_LIMIT` mã nhiều lượt nhất. */
  rows: z.array(clinicalDiagnosisRowSchema),
  /** Tối đa `CLINICAL_CHAPTER_LIST_LIMIT` chương ICD-10 nhiều lượt nhất. */
  chapters: z.array(clinicalChapterRowSchema),
});
export type ClinicalDiagnosisReport = z.infer<typeof clinicalDiagnosisReportSchema>;

export const CLINICAL_DIAGNOSIS_LIST_LIMIT = 50;
export const CLINICAL_CHAPTER_LIST_LIMIT = 10;

// ---- Cận lâm sàng ----

/** Nhóm dịch vụ: `OTHER` = chỉ định ngoài ghi tên tự do (không thuộc danh mục dịch vụ kỹ thuật). */
export const clinicalServiceKindSchema = z.enum(['LAB', 'IMAGING', 'FUNCTIONAL', 'OTHER']);
export type ClinicalServiceKind = z.infer<typeof clinicalServiceKindSchema>;

export const clinicalKindRowSchema = z.object({
  kind: clinicalServiceKindSchema,
  /** Số chỉ định (không tính dòng đã huỷ), tại phòng khám và ra ngoài. */
  ordered: count,
  inHouse: count,
  external: count,
  /** Chỉ định tại phòng khám đã được bác sĩ duyệt trả kết quả (thời gian trả tính đến lần duyệt đầu tiên). */
  completed: count,
  /** Số phút trung bình từ lúc chỉ định đến lúc trả kết quả; `null` khi chưa đo được. */
  avgMinutes: count.nullable(),
  /** Trả muộn (so với thời gian trả kết quả đặt ở dịch vụ) + đang chờ đã quá hạn. */
  overdue: count,
});
export type ClinicalKindRow = z.infer<typeof clinicalKindRowSchema>;

export const clinicalTopServiceRowSchema = z.object({
  name: z.string(),
  kind: clinicalServiceKindSchema,
  ordered: count,
  completed: count,
  avgMinutes: count.nullable(),
  overdue: count,
});
export type ClinicalTopServiceRow = z.infer<typeof clinicalTopServiceRowSchema>;

export const clinicalOverdueRowSchema = z.object({
  orderItemId: z.string().uuid(),
  encounterId: z.string().uuid(),
  patientCode: z.string(),
  patientName: z.string(),
  serviceName: z.string(),
  kind: clinicalServiceKindSchema,
  branchName: z.string(),
  orderedAt: z.string(),
  /** Thời gian trả kết quả đặt ở dịch vụ (phút). */
  turnaroundMinutes: count,
  /** Số phút đã chờ tính đến lúc xem báo cáo. */
  waitedMinutes: count,
});
export type ClinicalOverdueRow = z.infer<typeof clinicalOverdueRowSchema>;

export const clinicalParaclinicalReportSchema = z.object({
  ...headerFields,
  summary: z.object({
    ordered: count,
    inHouse: count,
    external: count,
    completed: count,
    /** Chỉ định tại phòng khám chưa trả kết quả. */
    pending: count,
    avgMinutes: count.nullable(),
    /** Đã trả muộn + đang chờ quá hạn (chỉ tính dịch vụ có đặt thời gian trả kết quả). */
    overdue: count,
    overdueOpen: count,
    lateCompleted: count,
  }),
  byKind: z.array(clinicalKindRowSchema),
  /** Tối đa `CLINICAL_TOP_SERVICE_LIMIT` dịch vụ được chỉ định nhiều nhất. */
  topServices: z.array(clinicalTopServiceRowSchema),
  /** Chỉ định đang chờ đã quá hạn, chờ lâu nhất trước, tối đa `CLINICAL_OVERDUE_LIST_LIMIT` dòng. */
  overdueItems: z.array(clinicalOverdueRowSchema),
});
export type ClinicalParaclinicalReport = z.infer<typeof clinicalParaclinicalReportSchema>;

export const CLINICAL_TOP_SERVICE_LIMIT = 15;
export const CLINICAL_OVERDUE_LIST_LIMIT = 50;
