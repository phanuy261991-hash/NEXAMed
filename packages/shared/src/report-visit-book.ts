import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * "Sổ khám bệnh" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026) — danh sách lượt khám ĐÃ HOÀN TẤT theo khoảng ngày, thay sổ giấy. Chỉ quản lý phòng khám xem
 * (`operations_report.read`, chủ dự án chốt 05/11/2026). Ngày khám = ngày tiếp nhận theo lịch Việt Nam. Phạm vi chi nhánh dùng chung bộ chọn của các báo cáo tổng hợp (#235).
 * Tiền là số nguyên đồng.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Khoảng ngày tối đa của một lần xem/xuất (ngày) — bảo vệ máy chủ; xem dài hơn thì chia nhiều lần. */
export const VISIT_BOOK_MAX_RANGE_DAYS = 366;

const filterFields = {
  from: isoDate,
  to: isoDate,
  doctorId: z.string().uuid().optional(),
  /** Mã ICD-10 của chẩn đoán CHÍNH; khớp theo tiền tố (chọn `J06` ra cả `J06.9`). */
  icd10Code: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9.]+$/)
    .optional(),
  /** Tìm theo tên (không dấu), mã bệnh nhân hoặc số điện thoại. */
  q: z.string().trim().max(100).optional(),
};

export const visitBookQuerySchema = withReportScope({
  ...filterFields,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type VisitBookQuery = z.infer<typeof visitBookQuerySchema>;

/** Bộ lọc của bản Excel (không phân trang). */
export const visitBookExportQuerySchema = withReportScope(filterFields);
export type VisitBookExportQuery = z.infer<typeof visitBookExportQuerySchema>;

export const visitBookRowSchema = z.object({
  encounterId: z.string().uuid(),
  /** Số lượt khám (`LK…`). */
  encounterNo: z.string(),
  patientId: z.string().uuid(),
  patientCode: z.string(),
  patientName: z.string(),
  /** Tuổi tròn năm tại ngày khám; `null` khi ngày sinh không hợp lệ. */
  ageYears: z.number().int().nullable(),
  gender: z.string(),
  /** Ngày khám `YYYY-MM-DD` theo lịch Việt Nam. */
  visitDate: z.string(),
  branchId: z.string().uuid(),
  branchName: z.string(),
  diagnosisCode: z.string().nullable(),
  diagnosisName: z.string().nullable(),
  doctorId: z.string().uuid().nullable(),
  doctorName: z.string().nullable(),
  /** Tên các dịch vụ (khám, cận lâm sàng, gói) đã tính tiền cho lượt khám, không lặp; thuốc và vật tư không gồm. */
  services: z.array(z.string()),
  /** Thành tiền = tổng `dueAmount` sau chiết khấu của các phiếu chưa huỷ (chưa thu + đã thu), cùng định nghĩa "Ghi nhận" của Báo cáo ngày. */
  amount: z.number().int(),
});
export type VisitBookRow = z.infer<typeof visitBookRowSchema>;

export const visitBookResponseSchema = z.object({
  items: z.array(visitBookRowSchema),
  nextCursor: z.string().nullable(),
  /** Tổng số lượt khám khớp bộ lọc (cả những dòng chưa tải). */
  total: z.number().int(),
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  /** Số chi nhánh trong phạm vi đã đọc; từ 2 trở lên web hiện cột "Chi nhánh". */
  branchCount: z.number().int(),
});
export type VisitBookResponse = z.infer<typeof visitBookResponseSchema>;
