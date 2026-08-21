import { z } from 'zod';

/**
 * Danh mục "Dị nguyên" (docs/DECISIONS.md #069) — 2 cấp: `AllergenGroup` (Nhóm dị nguyên) chứa
 * nhiều `Allergen` (Dị nguyên). Toàn hệ thống, không tenant_id (giống `reference_catalog`). `code`
 * của CẢ HAI đều server tự sinh — request tạo/sửa KHÔNG có field `code` (khác `reference_catalog`,
 * nơi client vẫn được tự nhập). `AllergenGroup.code` tồn tại trong DB nhưng KHÔNG hiển thị ở UI
 * cột trái (chỉ `Allergen.code` hiện trên bảng, xem `AllergenPane.tsx`).
 */
export const allergenGroupSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});
export type AllergenGroupSummary = z.infer<typeof allergenGroupSummarySchema>;

export const listAllergenGroupsResponseSchema = z.object({
  items: z.array(allergenGroupSummarySchema),
});
export type ListAllergenGroupsResponse = z.infer<typeof listAllergenGroupsResponseSchema>;

export const createAllergenGroupRequestSchema = z.object({
  name: z.string().min(1),
});
export type CreateAllergenGroupRequest = z.infer<typeof createAllergenGroupRequestSchema>;

export const updateAllergenGroupRequestSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAllergenGroupRequest = z.infer<typeof updateAllergenGroupRequestSchema>;

/** `allergenGroupName` denormalized (join ở tầng service) — tránh N+1 khi web hiện bảng, đúng khuôn `departmentTypeName`. */
export const allergenItemSchema = z.object({
  id: z.string().uuid(),
  allergenGroupId: z.string().uuid(),
  allergenGroupName: z.string(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});
export type AllergenItem = z.infer<typeof allergenItemSchema>;

export const listAllergensResponseSchema = z.object({
  items: z.array(allergenItemSchema),
});
export type ListAllergensResponse = z.infer<typeof listAllergensResponseSchema>;

export const createAllergenRequestSchema = z.object({
  allergenGroupId: z.string().uuid(),
  name: z.string().min(1),
});
export type CreateAllergenRequest = z.infer<typeof createAllergenRequestSchema>;

export const updateAllergenRequestSchema = z.object({
  allergenGroupId: z.string().uuid().optional(),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAllergenRequest = z.infer<typeof updateAllergenRequestSchema>;
