import { z } from 'zod';

/**
 * Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống (theo sáp nhập hành chính 2025, mã Bộ Nội
 * vụ) — read-only lúc chạy, giống `icd10_catalog` (không có endpoint create/update/delete, không
 * `tenant_id`, không `is_active`/`version`). Dùng để điền `patient.address_json.province`/`.ward`
 * (lưu `code`, không lưu `name` — cùng cách `reference_catalog` đã làm cho ethnicity/nationality).
 * Xem `.claude/docs/data-model.md` mục `province`/`ward`.
 */
export const provinceItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
});
export type ProvinceItem = z.infer<typeof provinceItemSchema>;

export const wardItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  provinceCode: z.string(),
  sortOrder: z.number().int(),
});
export type WardItem = z.infer<typeof wardItemSchema>;

export const listProvincesResponseSchema = z.object({
  items: z.array(provinceItemSchema),
});
export type ListProvincesResponse = z.infer<typeof listProvincesResponseSchema>;

/**
 * `provinceCode` bỏ trống → trả toàn bộ ~3321 phường/xã (dùng để dựng bảng tra code→tên hiển thị
 * ở màn hình danh sách bệnh nhân, xem `formatAddressLine`); có `provinceCode` → cascading lúc
 * chọn trong form (chỉ phường/xã thuộc đúng tỉnh).
 */
export const listWardsQuerySchema = z.object({
  provinceCode: z.string().min(1).optional(),
});
export type ListWardsQuery = z.infer<typeof listWardsQuerySchema>;

export const listWardsResponseSchema = z.object({
  items: z.array(wardItemSchema),
});
export type ListWardsResponse = z.infer<typeof listWardsResponseSchema>;
