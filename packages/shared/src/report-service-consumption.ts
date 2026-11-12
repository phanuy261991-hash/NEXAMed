import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * Báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, mockup màn 9): chi phí vốn của vật tư/thuốc đã ghi tiêu hao cho từng lượt dịch vụ. Quyền `service_consumption.report`
 * (mặc định chỉ quản lý phòng khám vì có giá vốn). Máy chủ tính mọi số, web chỉ hiển thị. Ngày `YYYY-MM-DD` theo lịch Việt Nam; tiền là số nguyên đồng.
 * Từ #297 bổ sung 4 có thêm DOANH THU (ghi nhận sau chiết khấu, theo dòng hoá đơn của lượt dịch vụ) và LÃI GỘP DỊCH VỤ = doanh thu trừ chi phí tiêu hao, chỉ tính trên các lượt đã ghi tiêu hao; KHÔNG phải báo cáo lãi lỗ toàn diện (không nhân sự, mặt bằng, khấu hao) và không thu thêm tiền khách. Phiếu đã đảo không tính.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int();
const count = z.number().int();
/** Phần trăm một chữ số thập phân; `null` khi không tính được (doanh thu không dương). */
const percent = z.number().nullable();

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
  /** Doanh thu ghi nhận của các lượt có ghi tiêu hao, lãi gộp dịch vụ (doanh thu trừ chi phí vốn, có thể âm) và biên lãi gộp. */
  totalRevenue: money,
  totalMargin: money,
  marginPercent: percent,
  /** Danh sách dịch vụ có ghi tiêu hao trong kỳ (bỏ lọc dịch vụ/bác sĩ) cho ô chọn "Dịch vụ". */
  serviceOptions: z.array(z.object({ key: z.string(), name: z.string() })),
};

export const serviceConsumptionByServiceRowSchema = z.object({
  key: z.string(),
  name: z.string(),
  visitCount: count,
  cost: money,
  averageCost: money.nullable(),
  revenue: money,
  margin: money,
  marginPercent: percent,
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
  /** Doanh thu ghi nhận của lượt (0 khi phiếu đã hoàn tiền/huỷ), lãi gộp lượt (có thể âm) và cờ phiếu đã hoàn tiền/huỷ. */
  revenue: money,
  margin: money,
  refunded: z.boolean(),
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

// ---- Tab "Theo vật tư" (#297 bổ sung 4) ----

export const serviceConsumptionByItemRowSchema = z.object({
  /** Id mặt hàng (`drug.id`). */
  key: z.string(),
  name: z.string(),
  /** Thuốc hay vật tư y tế. */
  itemType: z.enum(['MEDICINE', 'SUPPLY']),
  /** Tên tối đa 2 dịch vụ dùng nhiều mặt hàng này nhất, và số dịch vụ khác nhau đã dùng. */
  serviceNames: z.array(z.string()),
  serviceCount: count,
  /** Tổng số lượng theo đơn vị cơ sở của mặt hàng và tên đơn vị (rỗng khi mặt hàng chưa khai đơn vị). */
  quantity: count,
  unitName: z.string(),
  /** Giá vốn trung bình mỗi đơn vị (chi phí chia số lượng, làm tròn nửa lên); `null` khi số lượng 0. */
  averageUnitCost: money.nullable(),
  cost: money,
  /** Tỉ trọng trên tổng chi phí, một chữ số thập phân; `null` khi tổng chi phí không dương. */
  sharePercent: percent,
});
export type ServiceConsumptionByItemRow = z.infer<typeof serviceConsumptionByItemRowSchema>;

export const serviceConsumptionByItemReportSchema = z.object({
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  branchCount: count,
  totalCost: money,
  /** Số mặt hàng đã dùng, trong đó bao nhiêu thuốc/vật tư. */
  itemCount: count,
  medicineCount: count,
  supplyCount: count,
  /** Mặt hàng tốn nhất (đứng đầu bảng); `null` khi chưa có mặt hàng nào. */
  topItem: z.object({ name: z.string(), sharePercent: percent }).nullable(),
  serviceOptions: z.array(z.object({ key: z.string(), name: z.string() })),
  rows: z.array(serviceConsumptionByItemRowSchema),
});
export type ServiceConsumptionByItemReport = z.infer<typeof serviceConsumptionByItemReportSchema>;

// ---- Tab "Theo chi nhánh" (#297 bổ sung 4) ----

export const serviceConsumptionByBranchRowSchema = z.object({
  branchId: z.string(),
  branchName: z.string(),
  visitCount: count,
  revenue: money,
  cost: money,
  averageCost: money.nullable(),
  margin: money,
  marginPercent: percent,
});
export type ServiceConsumptionByBranchRow = z.infer<typeof serviceConsumptionByBranchRowSchema>;

export const serviceConsumptionByBranchReportSchema = z.object({
  ...headerFields,
  rows: z.array(serviceConsumptionByBranchRowSchema),
});
export type ServiceConsumptionByBranchReport = z.infer<typeof serviceConsumptionByBranchReportSchema>;
