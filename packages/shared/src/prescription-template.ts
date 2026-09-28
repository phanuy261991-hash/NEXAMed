import { z } from 'zod';

/**
 * "Đơn thuốc mẫu" (Kho Thuốc GĐ5, trải nghiệm kê đơn) — cụm nhiều dòng thuốc lưu sẵn (kèm liều/tần
 * suất/số ngày/số lượng/hướng dẫn), bấm chọn 1 mẫu là chèn CẢ CỤM vào đơn đang kê rồi sửa tiếp
 * từng dòng như bình thường — không tự động ký/lưu. Dùng CHUNG toàn tenant (mọi bác sĩ đều thấy và
 * dùng được mẫu của nhau) — đơn giản hoá có chủ đích: v1 chưa có yêu cầu tách riêng theo từng bác
 * sĩ, thêm `createdBy`-scoping sau nếu phát sinh nhu cầu thật. Thuộc module `drug` (đúng
 * `.claude/docs/architecture.md`: Kho Thuốc GĐ5 mở rộng module `drug`).
 */
const prescriptionTemplateItemInputSchema = z.object({
  drugId: z.string().uuid(),
  dose: z.string().min(1),
  frequency: z.string().min(1),
  durationDays: z.number().int().positive(),
  quantity: z.number().int().positive(),
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
