import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * Báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, mockup màn 9): chi phí vốn của vật tư/thuốc đã ghi tiêu hao cho từng lượt dịch vụ. Quyền `service_consumption.report`
 * (mặc định chỉ quản lý phòng khám vì có giá vốn). Máy chủ tính mọi số, web chỉ hiển thị. Ngày `YYYY-MM-DD` theo lịch Việt Nam; tiền là số nguyên đồng.
 * KHÔNG phải báo cáo lãi lỗ: chi phí này không trừ vào lãi gộp và không thu thêm tiền khách. Phiếu đã đảo không tính.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int();
const count = z.number().int();

export const SERVICE_CONSUMPTION_REPORT_ROW_LIMIT = 1000;
export const SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT = 2000;
/** Tối đa bao nhiêu ngày một lần xem (như các báo cáo điều hành khác). */
export const SERVICE_CONSUMPTION_REPORT_MAX_RANGE_DAYS = 366;

/**
 * Khoá dịch vụ để lọc: `EXAM_TYPE:<mã dịch vụ khám>` hoặc `TECHNICAL_SERVICE:<id dịch vụ kỹ thuật>`. Bỏ trống = mọi dịch vụ.
 */
export const serviceConsumptionServiceKeySchema = z.string().max(120).regex(/^(EXAM_TYPE|TECHNICAL_SERVICE):.+$/, 'Dịch vụ không hợp lệ.');

export const serviceConsumptionReportQuerySchema = withReportScope({
  from: isoDate,
  to: isoDate,
  serviceKey: serviceConsumptionServiceKeySchema.optional(),
  /** Bác sĩ phụ trách lượt khám. */
  doctorId: z.string().uuid().optional(),
});
export type ServiceConsumptionReportQuery = z.infer<typeof serviceConsumptionReportQuerySchema>;

const headerFields = {
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  /** Số chi nhánh trong phạm vi đã đọc. */
  branchCount: count,
  /** Ba ô tổng đầu trang. `averageCost` là `null` khi chưa có lượt nào. */
  totalCost: money,
  visitCount: count,
  averageCost: money.nullable(),
  /** Danh sách dịch vụ có ghi tiêu hao trong kỳ (bỏ lọc dịch vụ/bác sĩ) cho ô chọn "Dịch vụ". */
  serviceOptions: z.array(z.object({ key: z.string(), name: z.string() })),
};

export const serviceConsumptionByServiceRowSchema = z.object({
  key: z.string(),
  name: z.string(),
  visitCount: count,
  cost: money,
  averageCost: money.nullable(),
  /** Tên tối đa 2 mặt hàng tốn nhiều nhất của dịch vụ. */
  topItems: z.array(z.string()),
});
export type ServiceConsumptionByServiceRow = z.infer<typeof serviceConsumptionByServiceRowSchema>;

export const serviceConsumptionByServiceReportSchema = z.object({
  ...headerFields,
  serviceCount: count,
  rows: z.array(serviceConsumptionByServiceRowSchema),
});
export type ServiceConsumptionByServiceReport = z.infer<typeof serviceConsumptionByServiceReportSchema>;

export const serviceConsumptionByCustomerEntrySchema = z.object({
  /** Thời điểm ghi (ISO UTC). */
  occurredAt: z.string(),
  patientCode: z.string(),
  patientName: z.string(),
  serviceName: z.string(),
  /** Vật tư/thuốc đã dùng, dạng "Ống EDTA ×1, Kim 21G ×1". */
  itemsText: z.string(),
  doctorName: z.string().nullable(),
  performerName: z.string().nullable(),
  cost: money,
  /** Tên chi nhánh — web chỉ hiện cột này khi `branchCount > 1`. */
  branchName: z.string(),
});
export type ServiceConsumptionByCustomerEntry = z.infer<typeof serviceConsumptionByCustomerEntrySchema>;

export const serviceConsumptionByCustomerReportSchema = z.object({
  ...headerFields,
  /** Tổng số lượt khớp bộ lọc (có thể lớn hơn số dòng trả về — xem `SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT`). */
  entryCount: count,
  entries: z.array(serviceConsumptionByCustomerEntrySchema),
});
export type ServiceConsumptionByCustomerReport = z.infer<typeof serviceConsumptionByCustomerReportSchema>;
