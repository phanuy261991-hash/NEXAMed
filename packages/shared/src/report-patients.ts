import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * Trang báo cáo "Bệnh nhân" (docs/DECISIONS.md #287, danh mục báo cáo đã duyệt 05/11/2026): Bệnh nhân mới và cũ, Tuổi giới và địa bàn, Bệnh nhân không quay lại. Quyền xem:
 * `patient_report.read` (mặc định chỉ quản lý phòng khám). Máy chủ tính mọi số, web chỉ hiển thị. "Lượt khám" = lượt đã tiếp nhận (chờ khám, đang khám, hoàn tất) theo ngày tiếp nhận giờ
 * Việt Nam; "bệnh nhân mới" = lượt khám ĐẦU TIÊN của bệnh nhân (ở bất kỳ chi nhánh nào của công ty) rơi vào kỳ.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int();
const percent = z.number().nullable();

export const patientReportQuerySchema = withReportScope({ from: isoDate, to: isoDate });
export type PatientReportQuery = z.infer<typeof patientReportQuerySchema>;

const headerFields = {
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  branchCount: count,
};

// ---- Bệnh nhân mới và cũ ----

export const patientFrequencyBucketSchema = z.object({ key: z.string(), label: z.string(), patients: count });
export type PatientFrequencyBucket = z.infer<typeof patientFrequencyBucketSchema>;

export const patientMonthRowSchema = z.object({
  /** `YYYY-MM` theo lịch Việt Nam. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  patients: count,
  newPatients: count,
  returningPatients: count,
  visits: count,
});
export type PatientMonthRow = z.infer<typeof patientMonthRowSchema>;

export const patientNewReturningReportSchema = z.object({
  ...headerFields,
  summary: z.object({
    patients: count,
    newPatients: count,
    returningPatients: count,
    visits: count,
    /** Số lượt khám trung bình một bệnh nhân (một chữ số thập phân); `null` khi chưa có bệnh nhân nào. */
    visitsPerPatient: z.number().nullable(),
    /** Bệnh nhân cũ trên tổng bệnh nhân có khám trong kỳ. */
    returningPercent: percent,
  }),
  /** Số bệnh nhân theo số lượt khám TRONG kỳ: 1, 2, 3, từ 4 lượt. */
  frequency: z.array(patientFrequencyBucketSchema),
  /** Bệnh nhân cũ theo khoảng thời gian từ lượt khám liền trước đến lượt đầu tiên của kỳ. */
  gap: z.array(patientFrequencyBucketSchema),
  byMonth: z.array(patientMonthRowSchema),
});
export type PatientNewReturningReport = z.infer<typeof patientNewReturningReportSchema>;

// ---- Tuổi, giới và địa bàn ----

export const patientAgeBandRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  male: count,
  female: count,
  other: count,
  total: count,
});
export type PatientAgeBandRow = z.infer<typeof patientAgeBandRowSchema>;

export const patientPlaceRowSchema = z.object({
  code: z.string(),
  name: z.string(),
  /** Tên tỉnh/thành của phường/xã; rỗng ở bảng tỉnh/thành. */
  provinceName: z.string(),
  patients: count,
});
export type PatientPlaceRow = z.infer<typeof patientPlaceRowSchema>;

export const patientDemographicsReportSchema = z.object({
  ...headerFields,
  /** Bệnh nhân có ít nhất một lượt khám trong kỳ. */
  patients: count,
  genders: z.object({ male: count, female: count, other: count }),
  /** Tuổi tính đến ngày cuối kỳ; bệnh nhân chưa có ngày sinh hợp lệ nằm ở `unknownAge`. */
  ageBands: z.array(patientAgeBandRowSchema),
  unknownAge: count,
  provinces: z.array(patientPlaceRowSchema),
  wards: z.array(patientPlaceRowSchema),
  /** Số bệnh nhân chưa ghi tỉnh/thành. */
  unknownProvince: count,
});
export type PatientDemographicsReport = z.infer<typeof patientDemographicsReportSchema>;

// ---- Bệnh nhân không quay lại ----

export const patientNotReturningRowSchema = z.object({
  patientId: z.string().uuid(),
  patientCode: z.string(),
  patientName: z.string(),
  phone: z.string(),
  /** Lượt khám đã hẹn tái khám. */
  encounterId: z.string().uuid(),
  visitDate: isoDate,
  dueDate: isoDate,
  /** Số ngày đã quá hẹn tính đến hôm nay (giờ Việt Nam). */
  overdueDays: count,
  doctorName: z.string().nullable(),
  branchName: z.string(),
  reminderCount: count,
  /** `REACHED` | `NO_ANSWER` | `CALL_BACK_LATER` | `NOT_RETURNING`; `null` = chưa nhắc lần nào. */
  lastReminderResult: z.string().nullable(),
});
export type PatientNotReturningRow = z.infer<typeof patientNotReturningRowSchema>;

export const patientNotReturningReportSchema = z.object({
  ...headerFields,
  summary: z.object({
    patients: count,
    /** Trong đó đã được nhắc ít nhất một lần. */
    reminded: count,
    /** Trong đó đã ghi "Bệnh nhân không tái khám". */
    markedNotReturning: count,
    avgOverdueDays: z.number().nullable(),
  }),
  /** Quá hạn lâu nhất trước, tối đa `PATIENT_NOT_RETURNING_LIST_LIMIT` dòng. */
  items: z.array(patientNotReturningRowSchema),
  /** Tổng số bệnh nhân khớp (có thể lớn hơn số dòng trả về). */
  totalCount: count,
});
export type PatientNotReturningReport = z.infer<typeof patientNotReturningReportSchema>;

/** Số dòng tối đa của danh sách "Bệnh nhân không quay lại" (cả màn hình lẫn Excel). */
export const PATIENT_NOT_RETURNING_LIST_LIMIT = 500;
