import { z } from 'zod';

/**
 * Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch — đảo ngược docs/DECISIONS.md #034 phần
 * `ethnicity`/`nationality`). `PATIENT_SOURCE` (Nguồn khách hàng) và `EXAM_TYPE` (Loại khám) —
 * Sprint 3 phần Tiếp nhận, tái dùng nguyên module này thay vì tạo bảng riêng (cùng hình dạng:
 * danh sách tên có sắp xếp, quản lý qua Cấu hình). `RECEPTION_TYPE`/`EXAM_FORM`/`PRIORITY_REASON`/
 * `PRICE_TYPE` — thiết kế lại "Tiếp nhận bệnh nhân" (mockup đã duyệt): Loại tiếp nhận, Hình thức
 * khám, Lý do ưu tiên, Loại giá dịch vụ — cùng lý do tái dùng bảng này thay vì 4 bảng riêng, quản
 * lý qua UI (thêm/sửa/ẩn) như `PATIENT_SOURCE`/`EXAM_TYPE`. `PRICE_TYPE` là danh mục PHẲNG độc
 * lập, dùng làm "nhãn loại giá" cho bảng `exam_type_price` (docs/DECISIONS.md #079, 2026-08-26 —
 * mở rộng phạm vi v1, xem `examTypePriceItemSchema` bên dưới) — bảng giá đa mức THEO TENANT cho
 * từng dịch vụ khám (`EXAM_TYPE`), khác chính bảng `reference_catalog` này (toàn hệ thống).
 * `OCCUPATION` (Nghề nghiệp) — đảo ngược tiếp phần `occupation` của #034 (không có nguồn dữ liệu
 * chính thức như Dân tộc/Quốc tịch, không seed cứng — quản lý qua UI như `PATIENT_SOURCE`).
 * Quản lý được qua API bởi `clinic_admin` (`reference_catalog.manage`), mọi vai trò lâm sàng đọc
 * được (`reference_catalog.read`). Xem `.claude/docs/data-model.md` mục `reference_catalog`.
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
  'OCCUPATION',
  // Danh mục quản lý tài khoản nhân sự (mở rộng ADM-01) — Học vị/học hàm, Chức danh (không seed
  // cứng, giống OCCUPATION), Trạng thái làm việc/Hình thức làm việc (seed giá trị mặc định, xem
  // packages/core/src/reference-catalog/data.ts).
  'ACADEMIC_TITLE',
  'STAFF_POSITION',
  'EMPLOYMENT_STATUS',
  'EMPLOYMENT_TYPE',
  // Đơn vị tính (ví dụ "Viên", "Lọ", "Chai") — chủ dự án yêu cầu trực tiếp 2026-08-26. Mã tự
  // sinh (giống 4 category nhân sự ở trên), có thêm `description` (chỉ category này dùng).
  'UNIT',
  // Hình thức thanh toán (Thu ngân, chủ dự án yêu cầu trực tiếp 2026-08-27) — thay Postgres enum
  // cố định trước đây trên `payment.method`/`invoice.pendingPaymentMethod`. Mã tự sinh, seed sẵn
  // 2 dòng mặc định (CASH/BANK_TRANSFER, xem migration `20260827121000_seed_payment_method_catalog`).
  'PAYMENT_METHOD',
  // Loại thu chi (chủ dự án yêu cầu trực tiếp 2026-09-05) — chuẩn bị cho chức năng "Thu chi tại
  // quầy" (Sổ quỹ) sắp làm, mã tự sinh như UNIT/PAYMENT_METHOD. KHÔNG seed cứng (không có nguồn dữ
  // liệu chính thức). Có thêm `direction` (Chi tiền/Thu tiền, 2 giá trị CỐ ĐỊNH — xem
  // `referenceCatalogDirectionSchema` bên dưới), khác các category khác không có trường này.
  'INCOME_EXPENSE_TYPE',
]);
export type ReferenceCatalogCategory = z.infer<typeof referenceCatalogCategorySchema>;

/**
 * "Loại" của một mục `INCOME_EXPENSE_TYPE` — CHỈ 2 giá trị cố định, không quản lý/mở rộng được qua
 * UI (khác `code`/`name` của chính category này) — đại diện dòng tiền ra (`EXPENSE`, "Chi tiền")
 * hay vào (`INCOME`, "Thu tiền") khi mục này được chọn ở chức năng Thu chi tại quầy.
 */
export const referenceCatalogDirectionSchema = z.enum(['EXPENSE', 'INCOME']);
export type ReferenceCatalogDirection = z.infer<typeof referenceCatalogDirectionSchema>;

/**
 * 1 dòng "Đơn giá dịch vụ" (`exam_type_price`, docs/DECISIONS.md #079, 2026-08-26) — thuộc về
 * MỘT tenant + MỘT mục `reference_catalog` category `EXAM_TYPE` (`examTypeCode`). `priceTypeCode`/
 * `unitCode` là mã tham chiếu `reference_catalog` (category `PRICE_TYPE`/`UNIT`), lưu thẳng
 * string — không FK thật (cùng cách `patient.ethnicity` tham chiếu category `ETHNICITY`). Cùng
 * (examTypeCode, priceTypeCode) KHÔNG được có 2 dòng còn hiệu lực với khoảng ngày chồng lấn nhau
 * (C20, ép ở DB bằng exclusion constraint — không chỉ validate tầng ứng dụng).
 */
export const examTypePriceInputSchema = z
  .object({
    priceTypeCode: z.string().min(1),
    amount: z.number().int().nonnegative(),
    unitCode: z.string().min(1),
    /** Định dạng "YYYY-MM-DD" (không giờ — đây là ngày lịch, không phải mốc thời gian). */
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => v.effectiveTo === undefined || v.effectiveTo >= v.effectiveFrom, {
    message: 'Ngày kết thúc phải sau hoặc bằng Ngày hiệu lực',
    path: ['effectiveTo'],
  });
export type ExamTypePriceInput = z.infer<typeof examTypePriceInputSchema>;

export const examTypePriceItemSchema = examTypePriceInputSchema.and(z.object({ id: z.string().uuid() }));
export type ExamTypePriceItem = z.infer<typeof examTypePriceItemSchema>;

/**
 * `price` (đồng) — CHỈ có ý nghĩa với category `EXAM_TYPE` (giá tham khảo của loại khám), `null`
 * với các category khác. v1 chỉ LƯU để hiển thị, không tính toán/xuất hoá đơn (viện phí ngoài
 * phạm vi CLAUDE.md) — xem docs/DECISIONS.md. `unit` (Đơn vị, ví dụ "Lượt"/"Buổi") — cùng bản chất
 * `price`, chỉ có ý nghĩa với `EXAM_TYPE`. `description` (Mô tả tự do) — chỉ có ý nghĩa với
 * category `UNIT` (Đơn vị tính, 2026-08-26), cùng bản chất `price`/`unit`.
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
  /** Chỉ có ý nghĩa với category EMPLOYMENT_STATUS — xem docs/DECISIONS.md (mở rộng ADM-01). */
  deactivatesAccount: z.boolean(),
  /** Chỉ có ý nghĩa với category UNIT/ACADEMIC_TITLE/STAFF_POSITION — xem docs/DECISIONS.md. */
  description: z.string().nullable(),
  /** Chỉ có ý nghĩa với category EXAM_TYPE — danh sách đơn giá còn hiệu lực (docs/DECISIONS.md #079). */
  prices: z.array(examTypePriceItemSchema).optional(),
  /**
   * "Chốt ca" (2026-09-03) — CHỈ có ý nghĩa với category PAYMENT_METHOD: hình thức thanh toán này
   * có gộp vào đối soát đếm két tiền mặt không. Tách cột riêng thay vì so khớp cứng code='CASH' —
   * cùng lý do `deactivatesAccount` (code sửa được qua UI).
   */
  countsAsCash: z.boolean(),
  /** Chỉ có ý nghĩa với category INCOME_EXPENSE_TYPE (Loại thu chi, 2026-09-05) — xem
   * `referenceCatalogDirectionSchema`. `null` với category khác. */
  direction: referenceCatalogDirectionSchema.nullable(),
});
export type ReferenceCatalogItem = z.infer<typeof referenceCatalogItemSchema>;

export const listReferenceCatalogResponseSchema = z.object({
  items: z.array(referenceCatalogItemSchema),
});
export type ListReferenceCatalogResponse = z.infer<typeof listReferenceCatalogResponseSchema>;

export const createReferenceCatalogRequestSchema = z.object({
  category: referenceCatalogCategorySchema,
  /**
   * Tuỳ chọn — bỏ trống thì server tự sinh mã ngắn ngẫu nhiên (không nhập tay), dùng cho 4
   * category nhân sự (ACADEMIC_TITLE/STAFF_POSITION/EMPLOYMENT_STATUS/EMPLOYMENT_TYPE, mở rộng
   * ADM-01, yêu cầu chủ dự án 2026-08-20) — web chỉ ẩn ô "Mã" cho 4 category này, backend không
   * hardcode danh sách category, chỉ tự sinh khi thiếu `code` bất kể category nào.
   */
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
  price: z.number().int().nonnegative().optional(),
  unit: z.string().min(1).optional(),
  deactivatesAccount: z.boolean().optional(),
  countsAsCash: z.boolean().optional(),
  description: z.string().min(1).optional(),
  /** Chỉ category INCOME_EXPENSE_TYPE gửi field này (Loại thu chi, 2026-09-05). */
  direction: referenceCatalogDirectionSchema.optional(),
  /** Chỉ ItemFormModal của category UNIT/ACADEMIC_TITLE/STAFF_POSITION gửi field này (select "Đang
   * sử dụng"/"Ngưng sử dụng" ngay trong form, cùng mẫu RoomPane/DepartmentPane) — category khác
   * vẫn quản lý trạng thái qua action Xoá/Khôi phục riêng (deactivate/reactivate), không đổi hành
   * vi cũ. */
  isActive: z.boolean().optional(),
  /**
   * Chỉ category EXAM_TYPE gửi field này (docs/DECISIONS.md #079) — TOÀN BỘ danh sách đơn giá
   * mong muốn sau khi lưu (bulk-replace trong CÙNG transaction tạo dịch vụ, đúng khuôn `PUT
   * .../diagnoses`) — không phải "thêm thêm", bỏ trống mảng là chủ ý xoá hết đơn giá cũ.
   */
  examTypePrices: z.array(examTypePriceInputSchema).optional(),
});
export type CreateReferenceCatalogRequest = z.infer<typeof createReferenceCatalogRequestSchema>;

export const updateReferenceCatalogRequestSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  price: z.number().int().nonnegative().optional(),
  unit: z.string().min(1).optional(),
  deactivatesAccount: z.boolean().optional(),
  countsAsCash: z.boolean().optional(),
  description: z.string().min(1).optional(),
  direction: referenceCatalogDirectionSchema.optional(),
  isActive: z.boolean().optional(),
  /** Bulk-replace đơn giá, đúng ngữ nghĩa như `createReferenceCatalogRequestSchema` — `undefined`
   * (không gửi field) = không đụng tới đơn giá hiện có, mảng rỗng = xoá hết. */
  examTypePrices: z.array(examTypePriceInputSchema).optional(),
});
export type UpdateReferenceCatalogRequest = z.infer<typeof updateReferenceCatalogRequestSchema>;
