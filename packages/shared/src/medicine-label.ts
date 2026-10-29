import { z } from 'zod';
import { doseModeSchema } from './prescription';

/**
 * "Nhãn dán bì thuốc" in từ màn Phát thuốc (docs/DECISIONS.md #267, mockup đã chốt 28/10/2026).
 * `GET /inventory/issues/:id/medicine-labels` trả dữ liệu THÔ in lên nhãn của MỘT phiếu xuất kho: web ghép câu dặn và định dạng (xem `apps/web/src/features/inventory/medicine-label.ts`),
 * vì cách ghép phụ thuộc đơn vị hiển thị (bảng đơn vị tính ở web) và bản mẫu in. Số lượng là số THỰC PHÁT (tổng các dòng phiếu cùng một dòng đơn), không phải số đã kê.
 */
export const medicineLabelBatchSchema = z.object({
  batchNo: z.string(),
  /** `YYYY-MM-DD`, `null` nếu lô không khai hạn dùng. */
  expiryDate: z.string().nullable(),
});
export type MedicineLabelBatch = z.infer<typeof medicineLabelBatchSchema>;

export const medicineLabelItemSchema = z.object({
  /** Khoá ổn định của dòng nhãn: id dòng đơn thuốc, hoặc id dòng phiếu đầu tiên nếu là hàng không theo đơn. */
  key: z.string(),
  /** `null` = hàng khách mua thêm không theo đơn (nhãn chỉ có tên và số lượng, không câu dặn). */
  prescriptionItemId: z.string().uuid().nullable(),
  drugId: z.string().uuid(),
  drugName: z.string(),
  activeIngredient: z.string().nullable(),
  concentration: z.string().nullable(),
  /** Tổng số lượng THỰC PHÁT theo đơn vị nhỏ nhất của thuốc. */
  quantity: z.number().int(),
  /** Đơn vị nhỏ nhất (`drug.baseUnitCode`); `null` với thuốc cũ chưa khai. */
  unitCode: z.string().nullable(),
  doseMorning: z.number(),
  doseNoon: z.number(),
  doseAfternoon: z.number(),
  doseEvening: z.number(),
  durationDays: z.number().int().nullable(),
  /** Kiểu kê của dòng đơn (#267); hàng không theo đơn luôn "SCHEDULED" với 4 liều = 0. */
  doseMode: doseModeSchema,
  /** Liều mỗi lần của kiểu "Khi cần" (#267). */
  singleDose: z.number().nullable(),
  /** Đơn vị liều (ml...) đã chụp trên dòng đơn; `null` = liều tính theo chính đơn vị nhỏ nhất. */
  doseUnitName: z.string().nullable(),
  instruction: z.string().nullable(),
  /** Các lô đã xuất cho dòng này (rỗng với thuốc không quản lý theo lô). */
  batches: z.array(medicineLabelBatchSchema),
});
export type MedicineLabelItem = z.infer<typeof medicineLabelItemSchema>;

export const medicineLabelsResponseSchema = z.object({
  issueId: z.string().uuid(),
  issueNo: z.string(),
  /** Thời điểm phát thuốc (ISO). */
  issuedAt: z.string(),
  /** `null` với phiếu không gắn đơn thuốc nào (xuất nội bộ, trả NCC...) — những phiếu này không có nhãn. */
  patient: z.object({ fullName: z.string(), patientCode: z.string(), birthYear: z.number().int().nullable() }).nullable(),
  items: z.array(medicineLabelItemSchema),
});
export type MedicineLabelsResponse = z.infer<typeof medicineLabelsResponseSchema>;
