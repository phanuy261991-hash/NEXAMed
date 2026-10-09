import { z } from 'zod';

/**
 * "Mẫu lời dặn" (docs/DECISIONS.md #222) — nội dung lời dặn lưu sẵn, dùng CHUNG toàn phòng khám (đúng khuôn "Đơn thuốc mẫu"). Bấm chọn một hoặc nhiều mẫu ở ô "Lời dặn bác sĩ"
 * thì nội dung được NỐI vào cuối ô (ô trống thì điền thẳng) rồi bác sĩ vẫn sửa tay được — mẫu không gắn với chẩn đoán nào, không tự lưu/ký.
 */
export const adviceTemplateNameSchema = z.string().trim().min(1, 'Nhập tên mẫu.').max(120, 'Tên mẫu tối đa 120 ký tự.');
export const adviceTemplateContentSchema = z.string().trim().min(1, 'Nhập nội dung lời dặn.').max(2000, 'Nội dung tối đa 2.000 ký tự.');

export const createAdviceTemplateRequestSchema = z.object({
  name: adviceTemplateNameSchema,
  content: adviceTemplateContentSchema,
});
export type CreateAdviceTemplateRequest = z.infer<typeof createAdviceTemplateRequestSchema>;

export const updateAdviceTemplateRequestSchema = z.object({
  name: adviceTemplateNameSchema.optional(),
  content: adviceTemplateContentSchema.optional(),
  /** "Ẩn" mẫu = `isActive=false`, cùng khuôn `drug`/`prescription_template` — không xoá cứng. */
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateAdviceTemplateRequest = z.infer<typeof updateAdviceTemplateRequestSchema>;

export const adviceTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  content: z.string(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type AdviceTemplate = z.infer<typeof adviceTemplateSchema>;

export const listAdviceTemplatesResponseSchema = z.object({ items: z.array(adviceTemplateSchema) });
export type ListAdviceTemplatesResponse = z.infer<typeof listAdviceTemplatesResponseSchema>;

/** Union `boolean|'true'|'false'` — KHÔNG dùng `z.coerce.boolean()` (chuỗi `"false"` từ query vẫn thành `true`, bug đã biết #160). */
export const listAdviceTemplatesQuerySchema = z.object({
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});
export type ListAdviceTemplatesQuery = z.infer<typeof listAdviceTemplatesQuerySchema>;
