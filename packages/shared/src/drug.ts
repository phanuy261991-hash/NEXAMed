import { z } from 'zod';

/**
 * Danh mục thuốc (Sprint 4, S4-03) — theo TENANT (phòng khám tự nhập, PRD mục 8: "v1 có thể dùng
 * danh mục do phòng khám tự nhập"), khác `reference_catalog`/`allergen_catalog` toàn hệ thống. Chỉ
 * "Trường hợp A" đã chốt (`docs/DECISIONS.md` 2026-08-25): ghi nhận + tìm kiếm để kê đơn, KHÔNG
 * tồn kho/giá bán — xem `docs/product/future-modules-reference.md` mục 2.2.1 cho v2.1.
 */
export const createDrugRequestSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  activeIngredient: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  concentration: z.string().min(1).optional(),
});
export type CreateDrugRequest = z.infer<typeof createDrugRequestSchema>;

export const updateDrugRequestSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  activeIngredient: z.string().min(1).nullable().optional(),
  unit: z.string().min(1).nullable().optional(),
  concentration: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateDrugRequest = z.infer<typeof updateDrugRequestSchema>;

export const drugSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  activeIngredient: z.string().nullable(),
  unit: z.string().nullable(),
  concentration: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type DrugSummary = z.infer<typeof drugSummarySchema>;

/** `q` — tìm theo tên/hoạt chất/mã, không dấu (tái dùng `stripVietnameseDiacritics` ở service, cùng khuôn `patient`/`icd10`). */
export const listDrugsQuerySchema = z.object({
  q: z.string().min(1).max(100).optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(false)
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});
export type ListDrugsQuery = z.infer<typeof listDrugsQuerySchema>;

export const listDrugsResponseSchema = z.object({ items: z.array(drugSummarySchema) });
export type ListDrugsResponse = z.infer<typeof listDrugsResponseSchema>;
