import { z } from 'zod';
import { prescriptionDosePeriodsSchema } from './prescription';

/**
 * "Đơn thuốc mẫu" (Kho Thuốc GĐ5, trải nghiệm kê đơn) — cụm nhiều dòng thuốc lưu sẵn (kèm liều theo
 * buổi Sáng/Trưa/Chiều/Tối/số ngày/hướng dẫn, đúng khuôn `prescription.ts` #196), bấm chọn 1 mẫu là chèn CẢ CỤM vào đơn đang kê rồi sửa tiếp
 * từng dòng như bình thường — không tự động ký/lưu. Dùng CHUNG toàn tenant (mọi bác sĩ đều thấy và
 * dùng được mẫu của nhau) — đơn giản hoá có chủ đích: v1 chưa có yêu cầu tách riêng theo từng bác
 * sĩ, thêm `createdBy`-scoping sau nếu phát sinh nhu cầu thật. Thuộc module `drug` (đúng
 * `.claude/docs/architecture.md`: Kho Thuốc GĐ5 mở rộng module `drug`).
 */
const prescriptionTemplateItemInputSchema = z.object({
  drugId: z.string().uuid(),
  ...prescriptionDosePeriodsSchema.shape,
  durationDays: z.number().int().positive(),
  instruction: z.string().optional(),
});
export type PrescriptionTemplateItemInput = z.infer<typeof prescriptionTemplateItemInputSchema>;

export const createPrescriptionTemplateRequestSchema = z.object({
  name: z.string().min(1),
  items: z.array(prescriptionTemplateItemInputSchema).min(1),
});
export type CreatePrescriptionTemplateRequest = z.infer<typeof createPrescriptionTemplateRequestSchema>;

export const updatePrescriptionTemplateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  items: z.array(prescriptionTemplateItemInputSchema).min(1).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdatePrescriptionTemplateRequest = z.infer<typeof updatePrescriptionTemplateRequestSchema>;

export const prescriptionTemplateItemSchema = prescriptionTemplateItemInputSchema.extend({
  id: z.string().uuid(),
  drugName: z.string(),
  /** Tính từ 4 buổi × `durationDays` lúc lưu (docs/DECISIONS.md #196), giống `prescriptionItemSchema`. */
  quantity: z.number().int(),
  /** Đơn vị nhỏ nhất của thuốc — CHỈ hiển thị, đúng khuôn `prescriptionItemSchema.unitCode`. */
  unitCode: z.string().nullable(),
});
export type PrescriptionTemplateItem = z.infer<typeof prescriptionTemplateItemSchema>;

export const prescriptionTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  items: z.array(prescriptionTemplateItemSchema),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type PrescriptionTemplate = z.infer<typeof prescriptionTemplateSchema>;

export const listPrescriptionTemplatesResponseSchema = z.object({ items: z.array(prescriptionTemplateSchema) });
export type ListPrescriptionTemplatesResponse = z.infer<typeof listPrescriptionTemplatesResponseSchema>;

/** `includeInactive` (docs/DECISIONS.md #196) — trang quản lý "Đơn thuốc mẫu" trong Quản trị (xem
 * cả mẫu đã "Xoá"). Popup chọn mẫu lúc kê đơn không truyền — mặc định `false`, chỉ thấy mẫu đang
 * dùng. Union `boolean|'true'|'false'` — KHÔNG dùng `z.coerce.boolean()` (bug đã biết #160: chuỗi
 * `"false"` từ query string vẫn bị coi là `true`), đúng khuôn `belowMinOnly` ở `inventory.ts`. */
export const listPrescriptionTemplatesQuerySchema = z.object({
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(false)
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});
export type ListPrescriptionTemplatesQuery = z.infer<typeof listPrescriptionTemplatesQuerySchema>;
