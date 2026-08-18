import { z } from 'zod';

/**
 * Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch — đảo ngược docs/DECISIONS.md #034 phần
 * `ethnicity`/`nationality`; `occupation` vẫn text tự do, không đổi). `PATIENT_SOURCE` (Nguồn
 * khách hàng) và `EXAM_TYPE` (Loại khám) — Sprint 3 phần Tiếp nhận, tái dùng nguyên module này
 * thay vì tạo bảng riêng (cùng hình dạng: danh sách tên có sắp xếp, quản lý qua Cấu hình).
 * `RECEPTION_TYPE`/`EXAM_FORM`/`PRIORITY_REASON`/`PRICE_TYPE` — thiết kế lại "Tiếp nhận bệnh nhân"
 * (mockup đã duyệt): Loại tiếp nhận, Hình thức khám, Lý do ưu tiên, Loại giá dịch vụ — cùng lý do
 * tái dùng bảng này thay vì 4 bảng riêng, quản lý qua UI (thêm/sửa/ẩn) như `PATIENT_SOURCE`/
 * `EXAM_TYPE`. `PRICE_TYPE` là danh mục PHẲNG độc lập (không có bảng giá đa mức theo từng
 * `EXAM_TYPE` — việc đó là "Price Book" thật, thuộc module Viện phí v2, ngoài phạm vi v1) — chọn
 * chỉ để ghi chú, không đổi `price` đang hiển thị. Quản lý được qua API bởi `clinic_admin`
 * (`reference_catalog.manage`), mọi vai trò lâm sàng đọc được (`reference_catalog.read`). Xem
 * `.claude/docs/data-model.md` mục `reference_catalog`.
 */
export const referenceCatalogCategorySchema = z.enum([
  'ETHNICITY',
  'NATIONALITY',
  'PATIENT_SOURCE',
  'EXAM_TYPE',
  'RECEPTION_TYPE',
  'EXAM_FORM',
  'PRIORITY_REASON',
  'PRICE_TYPE',
]);
export type ReferenceCatalogCategory = z.infer<typeof referenceCatalogCategorySchema>;

/**
 * `price` (đồng) — CHỈ có ý nghĩa với category `EXAM_TYPE` (giá tham khảo của loại khám), `null`
 * với các category khác. v1 chỉ LƯU để hiển thị, không tính toán/xuất hoá đơn (viện phí ngoài
 * phạm vi CLAUDE.md) — xem docs/DECISIONS.md. `unit` (Đơn vị, ví dụ "Lượt"/"Buổi") — cùng bản chất
 * `price`, chỉ có ý nghĩa với `EXAM_TYPE`.
 */
export const referenceCatalogItemSchema = z.object({
  id: z.string().uuid(),
  category: referenceCatalogCategorySchema,
  code: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  price: z.number().int().nonnegative().nullable(),
  unit: z.string().nullable(),
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
  price: z.number().int().nonnegative().optional(),
  unit: z.string().min(1).optional(),
});
export type CreateReferenceCatalogRequest = z.infer<typeof createReferenceCatalogRequestSchema>;

export const updateReferenceCatalogRequestSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  price: z.number().int().nonnegative().optional(),
  unit: z.string().min(1).optional(),
});
export type UpdateReferenceCatalogRequest = z.infer<typeof updateReferenceCatalogRequestSchema>;
