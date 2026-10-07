import { z } from 'zod';
import { invoiceStatusSchema, invoiceTypeSchema } from './billing';

/**
 * Cận lâm sàng GĐ3 — Chỉ định của bác sĩ (docs/DECISIONS.md #212). Mỗi lượt khám có đúng 1 PHIẾU chỉ định còn hiệu lực; bác sĩ
 * thêm/bớt dòng bằng 1 request "Lưu chỉ định" (thay TOÀN BỘ danh sách mong muốn, server so khớp theo `id`).
 *
 * 2 đường chỉ định (đúng khuôn "Kê thuốc tự do" #192):
 * - `IN_HOUSE` "Làm tại phòng khám": có giá, sinh dòng hoá đơn, vào hàng đợi cận lâm sàng (GĐ4).
 * - `EXTERNAL` "Chỉ định ra ngoài": không giá, không hàng đợi, chỉ in phiếu; cho phép tên tự do ngoài danh mục.
 * Gói dịch vụ ("+ Thêm theo gói") hoá đơn ghi ĐÚNG 1 dòng "gói" (giá chốt lúc chỉ định); dịch vụ con vẫn hiện trong phiếu/hàng đợi/kết quả nhưng
 * không tính tiền riêng.
 */
export const clinicalOrderPerformanceSchema = z.enum(['IN_HOUSE', 'EXTERNAL']);
export type ClinicalOrderPerformance = z.infer<typeof clinicalOrderPerformanceSchema>;

export const clinicalOrderItemKindSchema = z.enum(['TECHNICAL_SERVICE', 'EXAM_TYPE', 'FREE_TEXT']);
export type ClinicalOrderItemKind = z.infer<typeof clinicalOrderItemKindSchema>;

/** GĐ4 mở rộng thêm các trạng thái lấy mẫu/thực hiện/có kết quả/đã duyệt. */
export const clinicalOrderItemStatusSchema = z.enum(['ORDERED', 'CANCELLED', 'IN_PROGRESS', 'RESULTED', 'COMPLETED']);
export type ClinicalOrderItemStatus = z.infer<typeof clinicalOrderItemStatusSchema>;

export const clinicalOrderItemInputSchema = z
  .object({
    /** Id của dòng ĐÃ LƯU muốn giữ lại; bỏ trống = dòng mới. Dòng đã lưu mà không có trong danh sách gửi lên sẽ bị gỡ khỏi phiếu. */
    id: z.string().uuid().optional(),
    performance: clinicalOrderPerformanceSchema,
    /** Dịch vụ kỹ thuật trong danh mục — bắt buộc khi không dùng tên tự do. */
    technicalServiceId: z.string().uuid().optional(),
    /** Tên tự do ngoài danh mục — CHỈ cho `EXTERNAL`. */
    freeTextName: z.string().trim().min(1).max(200).optional(),
    quantity: z.number().int().min(1).max(999).default(1),
    /** "Lưu ý cho người bệnh" — in trên phiếu, dùng cho chỉ định ra ngoài. */
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.technicalServiceId === undefined) === (v.freeTextName === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['technicalServiceId'], message: 'Chọn một dịch vụ trong danh mục hoặc nhập tên tự do (chỉ một trong hai)' });
    }
    if (v.freeTextName !== undefined && v.performance !== 'EXTERNAL') {
      ctx.addIssue({ code: 'custom', path: ['freeTextName'], message: 'Tên tự do chỉ dùng cho chỉ định ra ngoài' });
    }
  });
export type ClinicalOrderItemInput = z.infer<typeof clinicalOrderItemInputSchema>;

export const clinicalOrderPackageInputSchema = z.object({
  /** Id của gói ĐÃ LƯU muốn giữ nguyên (giữ giá đã chốt); bỏ trống = gói mới (server chốt giá lúc lưu). */
  id: z.string().uuid().optional(),
  servicePackageId: z.string().uuid(),
});
export type ClinicalOrderPackageInput = z.infer<typeof clinicalOrderPackageInputSchema>;

export const saveClinicalOrderRequestSchema = z.object({
  items: z.array(clinicalOrderItemInputSchema).max(100),
  packages: z.array(clinicalOrderPackageInputSchema).max(20).default([]),
});
export type SaveClinicalOrderRequest = z.infer<typeof saveClinicalOrderRequestSchema>;

export const clinicalOrderItemViewSchema = z.object({
  id: z.string().uuid(),
  itemKind: clinicalOrderItemKindSchema,
  technicalServiceId: z.string().uuid().nullable(),
  examTypeCode: z.string().nullable(),
  /** Mã dịch vụ lúc chỉ định (snapshot); dòng tự do không có. */
  code: z.string().nullable(),
  name: z.string(),
  performance: clinicalOrderPerformanceSchema,
  quantity: z.number().int(),
  /** Đơn giá chốt — chỉ dòng tại phòng khám LẺ; ra ngoài/thuộc gói = `null`. */
  unitPrice: z.number().int().nonnegative().nullable(),
  lineTotal: z.number().int().nonnegative().nullable(),
  /** Gói chứa dòng này (không tính tiền riêng) — `null` nếu lẻ. */
  packageId: z.string().uuid().nullable(),
  /** Tên Khoa/Phòng thực hiện (Nơi thực hiện) của dịch vụ; `null` nếu chưa khai/ra ngoài. */
  placeName: z.string().nullable(),
  note: z.string().nullable(),
  status: clinicalOrderItemStatusSchema,
  /** Có gỡ/đổi số lượng được không: còn `ORDERED` và dòng hoá đơn tương ứng chưa thu tiền. */
  editable: z.boolean(),
});
export type ClinicalOrderItemView = z.infer<typeof clinicalOrderItemViewSchema>;

export const clinicalOrderPackageViewSchema = z.object({
  id: z.string().uuid(),
  servicePackageId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  unitPrice: z.number().int().nonnegative(),
  editable: z.boolean(),
});
export type ClinicalOrderPackageView = z.infer<typeof clinicalOrderPackageViewSchema>;

export const clinicalOrderInvoiceRefSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNo: z.string(),
  invoiceType: invoiceTypeSchema,
  status: invoiceStatusSchema,
});
export type ClinicalOrderInvoiceRef = z.infer<typeof clinicalOrderInvoiceRefSchema>;

export const clinicalOrderDetailSchema = z.object({
  id: z.string().uuid(),
  orderNo: z.string(),
  encounterId: z.string().uuid(),
  version: z.number().int(),
  createdAt: z.string(),
  items: z.array(clinicalOrderItemViewSchema),
  packages: z.array(clinicalOrderPackageViewSchema),
  /** Tạm tính tiền các dịch vụ tại phòng khám (dòng lẻ + gói), CHƯA trừ chiết khấu hoá đơn. */
  inHouseTotal: z.number().int().nonnegative(),
  /** Hoá đơn đang chứa tiền chỉ định (có thể nhiều nếu một phần đã thu rồi chỉ định thêm). */
  invoices: z.array(clinicalOrderInvoiceRefSchema),
});
export type ClinicalOrderDetail = z.infer<typeof clinicalOrderDetailSchema>;

export const getClinicalOrderResponseSchema = z.object({ order: clinicalOrderDetailSchema.nullable() });
export type GetClinicalOrderResponse = z.infer<typeof getClinicalOrderResponseSchema>;
