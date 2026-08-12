import { z } from 'zod';

/**
 * Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch — đảo ngược docs/DECISIONS.md #034 phần
 * `ethnicity`/`nationality`; `occupation` vẫn text tự do, không đổi). Quản lý được qua API bởi
 * `clinic_admin` (`reference_catalog.manage`), mọi vai trò lâm sàng đọc được (`reference_catalog.read`).
 * Xem `.claude/docs/data-model.md` mục `reference_catalog`.
 */
export const referenceCatalogCategorySchema = z.enum(['ETHNICITY', 'NATIONALITY']);
export type ReferenceCatalogCategory = z.infer<typeof referenceCatalogCategorySchema>;

export const referenceCatalogItemSchema = z.object({
  id: z.string().uuid(),
  category: referenceCatalogCategorySchema,
  code: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type ReferenceCatalogItem = z.infer<typeof referenceCatalogItemSchema>;

export const listReferenceCatalogResponseSchema = z.object({
  items: z.array(referenceCatalogItemSchema),
});
export type ListReferenceCatalogResponse = z.infer<typeof listReferenceCatalogResponseSchema>;

export const createReferenceCatalogRequestSchema = z.object({
  category: referenceCatalogCategorySchema,
  code: z.string().min(1),
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
});
export type CreateReferenceCatalogRequest = z.infer<typeof createReferenceCatalogRequestSchema>;

export const updateReferenceCatalogRequestSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateReferenceCatalogRequest = z.infer<typeof updateReferenceCatalogRequestSchema>;
