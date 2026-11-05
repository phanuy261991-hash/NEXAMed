import { z } from 'zod';
import { withReportScope } from './branch';

/**
 * Trang báo cáo "Thuốc và vật tư" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): Đã phát, Lãi gộp, Kiểm soát đặc biệt (3 tab mới) cùng 4 báo cáo kho đã có (Nhập-Xuất-Tồn, Tồn kho và hạn dùng,
 * Hao hụt điều chuyển, Công nợ nhà cung cấp — giữ nguyên trang và quyền cũ, chỉ là tab điều hướng). Quyền xem 3 tab mới: `pharmacy_report.read` (mặc định chỉ quản lý phòng khám vì có giá vốn).
 * Máy chủ tính mọi số, web chỉ hiển thị. Ngày `YYYY-MM-DD` theo lịch Việt Nam; tiền là số nguyên đồng; số lượng theo ĐƠN VỊ CƠ SỞ của mặt hàng.
 * LÃI GỘP = tiền bán (sau chiết khấu, trừ phần hoàn) trừ giá vốn thẻ kho — chỉ của thuốc/vật tư, KHÔNG phải lãi lỗ toàn diện.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int();
const count = z.number().int();
const percent = z.number().nullable();

export const PHARMACY_ROW_LIMIT = 1000;
export const PHARMACY_CONTROLLED_ENTRY_LIMIT = 2000;
/** Tối đa bao nhiêu ngày một lần xem (như các báo cáo điều hành khác). */
export const PHARMACY_MAX_RANGE_DAYS = 366;

export const pharmacyItemFilterSchema = z.enum(['ALL', 'MEDICINE', 'SUPPLY']);
export type PharmacyItemFilterCode = z.infer<typeof pharmacyItemFilterSchema>;

export const pharmacyItemTypeSchema = z.enum(['MEDICINE', 'SUPPLY']);

export const pharmacyReportQuerySchema = withReportScope({ from: isoDate, to: isoDate, itemType: pharmacyItemFilterSchema.default('ALL') });
export type PharmacyReportQuery = z.infer<typeof pharmacyReportQuerySchema>;

export const controlledTypeFilterSchema = z.enum(['ALL', 'NARCOTIC', 'PSYCHOTROPIC', 'PRECURSOR', 'TOXIC']);
export type ControlledTypeFilterCode = z.infer<typeof controlledTypeFilterSchema>;

export const controlledTypeSchema = z.enum(['NARCOTIC', 'PSYCHOTROPIC', 'PRECURSOR', 'TOXIC']);
export type ControlledTypeCode = z.infer<typeof controlledTypeSchema>;

export const controlledReportQuerySchema = withReportScope({ from: isoDate, to: isoDate, controlType: controlledTypeFilterSchema.default('ALL') });
export type ControlledReportQuery = z.infer<typeof controlledReportQuerySchema>;

const headerFields = {
  /** Thời điểm chụp số (ISO UTC) — web ghi "Số lúc HH:MM". */
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  /** Số chi nhánh trong phạm vi đã đọc. */
  branchCount: count,
};

// ---- Đã phát ----

export const pharmacyDispensedRowSchema = z.object({
  drugId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  itemType: pharmacyItemTypeSchema,
  /** Tên đơn vị cơ sở (rỗng khi mặt hàng chưa khai). */
  unitName: z.string(),
  /** Số lượng đã xuất theo phiếu xuất kho bán theo đơn, đơn vị cơ sở. */
  quantity: count,
  /** Phần khách trả lại (hoàn tiền một phần theo dòng thuốc). */
  returnedQuantity: count,
  /** Thực phát = đã xuất trừ khách trả lại. */
  netQuantity: count,
  /** Số phiếu xuất kho có mặt hàng này. */
  issueCount: count,
  /** Giá trị theo giá bán của thực phát (trước chiết khấu). */
  amount: money,
});
export type PharmacyDispensedRow = z.infer<typeof pharmacyDispensedRowSchema>;

export const pharmacyDispensedReportSchema = z.object({
  ...headerFields,
  itemType: pharmacyItemFilterSchema,
  /** Số phiếu xuất kho khác nhau trong kỳ (theo bộ lọc Loại). */
  issueCount: count,
  itemCount: count,
  /** Giá trị thực phát và giá trị khách trả lại, theo giá bán. */
  amount: money,
  returnedAmount: money,
  /** Xếp theo giá trị thực phát giảm dần, cắt còn `PHARMACY_ROW_LIMIT` dòng; `itemCount` luôn là tổng. */
  rows: z.array(pharmacyDispensedRowSchema),
});
export type PharmacyDispensedReport = z.infer<typeof pharmacyDispensedReportSchema>;

// ---- Lãi gộp ----

export const pharmacyMarginRowSchema = z.object({
  drugId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  itemType: pharmacyItemTypeSchema,
  unitName: z.string(),
  /** Số lượng bán ròng (đã trừ phần khách trả lại), đơn vị cơ sở. */
  quantity: count,
  sell: money,
  cost: money,
  margin: money,
  /** Biên lãi gộp = lãi gộp ÷ tiền bán (%); `null` khi tiền bán không dương. */
  marginPercent: percent,
});
export type PharmacyMarginRow = z.infer<typeof pharmacyMarginRowSchema>;

export const pharmacyMarginReportSchema = z.object({
  ...headerFields,
  itemType: pharmacyItemFilterSchema,
  totals: z.object({ sell: money, cost: money, margin: money, marginPercent: percent, itemCount: count }),
  /** Xếp theo lãi gộp giảm dần, cắt còn `PHARMACY_ROW_LIMIT` dòng; `totals` luôn tính trên tất cả. */
  rows: z.array(pharmacyMarginRowSchema),
});
export type PharmacyMarginReport = z.infer<typeof pharmacyMarginReportSchema>;

// ---- Kiểm soát đặc biệt ----

export const pharmacyControlledRowSchema = z.object({
  drugId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  controlType: controlledTypeSchema,
  unitName: z.string(),
  openingQuantity: count,
  /** Tổng số tăng trong kỳ (nhập kho, trả lại, kiểm kê dư, đảo phiếu xuất). */
  receivedQuantity: count,
  /** Phát cho người bệnh theo phiếu xuất bán theo đơn. */
  dispensedQuantity: count,
  /** Các lần giảm khác (xuất nội bộ, trả NCC, huỷ, điều chuyển, kiểm kê thiếu). */
  otherOutQuantity: count,
  closingQuantity: count,
});
export type PharmacyControlledRow = z.infer<typeof pharmacyControlledRowSchema>;

export const pharmacyControlledEntrySchema = z.object({
  /** Ngày phát `YYYY-MM-DD` (giờ Việt Nam). */
  date: isoDate,
  issueNo: z.string(),
  drugCode: z.string(),
  drugName: z.string(),
  controlType: controlledTypeSchema,
  unitName: z.string(),
  quantity: count,
  patientCode: z.string(),
  patientName: z.string(),
  branchName: z.string(),
});
export type PharmacyControlledEntry = z.infer<typeof pharmacyControlledEntrySchema>;

export const pharmacyControlledReportSchema = z.object({
  ...headerFields,
  controlType: controlledTypeFilterSchema,
  itemCount: count,
  entryCount: count,
  rows: z.array(pharmacyControlledRowSchema),
  /** Chi tiết từng lượt phát, mới nhất trước, cắt còn `PHARMACY_CONTROLLED_ENTRY_LIMIT` dòng; `entryCount` luôn là tổng. */
  entries: z.array(pharmacyControlledEntrySchema),
});
export type PharmacyControlledReport = z.infer<typeof pharmacyControlledReportSchema>;

/** Nhãn hiển thị dùng chung web và Excel — một nơi để màn hình, bản in và Excel không lệch nhau. */
export const PHARMACY_ITEM_TYPE_LABEL: Record<z.infer<typeof pharmacyItemTypeSchema>, string> = { MEDICINE: 'Thuốc', SUPPLY: 'Vật tư' };
export const CONTROLLED_TYPE_LABEL: Record<ControlledTypeCode, string> = { NARCOTIC: 'Gây nghiện', PSYCHOTROPIC: 'Hướng thần', PRECURSOR: 'Tiền chất', TOXIC: 'Độc' };
