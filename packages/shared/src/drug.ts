import { z } from 'zod';

/**
 * Danh mục Thuốc & Vật tư y tế (Sprint 4 S4-03, mở rộng Giai đoạn 1 của Kho Thuốc & Vật tư y tế —
 * docs/DECISIONS.md #146) — theo TENANT (phòng khám tự nhập), khác `reference_catalog`/
 * `allergen_catalog` toàn hệ thống. GĐ1 vẫn CHỈ ghi nhận danh mục — chưa có tồn kho/nhập-xuất
 * (GĐ2-3, chưa xây); `defaultSellPrice`/`minStockAlert`/`maxStockAlert` mới chỉ LƯU, chưa có logic
 * nào đọc lại (tồn kho thật + cảnh báo dưới định mức là GĐ2/GĐ4).
 *
 * `unit`/`activeIngredient`/`concentration` (cột cũ, S4-03) GIỮ NGUYÊN làm dữ liệu cũ — không xoá,
 * không bắt buộc với hồ sơ tạo trước GĐ1. Từ GĐ1, đơn vị/hoạt chất CÓ CẤU TRÚC lưu ở `units[]`/
 * `ingredients[]` (bulk-replace mỗi lần Lưu, đúng khuôn `exam_type_price`/`diagnosis`).
 */
export const drugItemTypeSchema = z.enum(['MEDICINE', 'SUPPLY']);
export type DrugItemType = z.infer<typeof drugItemTypeSchema>;

/** 1 dòng "Hoạt chất & hàm lượng" — `activeIngredientCode` tham chiếu `reference_catalog` category
 * `ACTIVE_INGREDIENT` (không FK thật, cùng cách mọi cột khác tham chiếu bảng đa-category này).
 * `strengthValue` là số nguyên ×1000 (đúng tiền lệ `vital_sign` — cấm decimal cho số liệu y tế). */
export const drugIngredientInputSchema = z.object({
  activeIngredientCode: z.string().min(1),
  strengthValue: z.number().int().nonnegative(),
  strengthUnitCode: z.string().min(1),
});
export type DrugIngredientInput = z.infer<typeof drugIngredientInputSchema>;

/** 1 bậc trong chuỗi quy đổi đơn vị — `sortOrder` 0 = bậc ngay trên đơn vị nhỏ nhất,
 * `factorToUnitBelow` = hệ số quy đổi ra bậc NGAY DƯỚI (xem `computeUnitConversion`, @nexamed/core). */
export const drugUnitInputSchema = z.object({
  unitCode: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  factorToUnitBelow: z.number().int().positive(),
});
export type DrugUnitInput = z.infer<typeof drugUnitInputSchema>;

export const createDrugRequestSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  itemType: drugItemTypeSchema,
  isBatchManaged: z.boolean().default(true),
  // Bắt buộc ở tầng Zod cho mặt hàng TẠO MỚI (dù cột DB nullable — dữ liệu trước GĐ1 không có) —
  // cùng cách "bắt buộc ở ứng dụng, nullable ở DB" đã áp dụng cho reception_type_code/exam_form_code.
  baseUnitCode: z.string().min(1),
  defaultSellPrice: z.number().int().nonnegative().optional(),
  drugGroupCode: z.string().min(1).optional(),
  routeCode: z.string().min(1).optional(),
  nationalCode: z.string().min(1).optional(),
  manufacturer: z.string().min(1).optional(),
  minStockAlert: z.number().int().nonnegative().optional(),
  maxStockAlert: z.number().int().nonnegative().optional(),
  // Vật tư y tế KHÔNG có hoạt chất/hàm lượng (yêu cầu chủ dự án) — validate ở service, không ở đây
  // (Zod không biết được itemType đã xác nhận đúng trước khi tới schema này).
  ingredients: z.array(drugIngredientInputSchema).default([]),
  units: z.array(drugUnitInputSchema).default([]),
  // Cột cũ (S4-03) — vẫn nhận được cho tương thích ngược, KHÔNG còn hiện trên form nhập liệu mới.
  activeIngredient: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  concentration: z.string().min(1).optional(),
});
export type CreateDrugRequest = z.infer<typeof createDrugRequestSchema>;

export const updateDrugRequestSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  itemType: drugItemTypeSchema.optional(),
  isBatchManaged: z.boolean().optional(),
  baseUnitCode: z.string().min(1).nullable().optional(),
  defaultSellPrice: z.number().int().nonnegative().nullable().optional(),
  drugGroupCode: z.string().min(1).nullable().optional(),
  routeCode: z.string().min(1).nullable().optional(),
  nationalCode: z.string().min(1).nullable().optional(),
  manufacturer: z.string().min(1).nullable().optional(),
  minStockAlert: z.number().int().nonnegative().nullable().optional(),
  maxStockAlert: z.number().int().nonnegative().nullable().optional(),
  ingredients: z.array(drugIngredientInputSchema).optional(),
  units: z.array(drugUnitInputSchema).optional(),
  activeIngredient: z.string().min(1).nullable().optional(),
  unit: z.string().min(1).nullable().optional(),
  concentration: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateDrugRequest = z.infer<typeof updateDrugRequestSchema>;

export const drugIngredientItemSchema = drugIngredientInputSchema.and(z.object({ id: z.string().uuid() }));
export type DrugIngredientItem = z.infer<typeof drugIngredientItemSchema>;

export const drugUnitItemSchema = drugUnitInputSchema.and(z.object({ id: z.string().uuid() }));
export type DrugUnitItem = z.infer<typeof drugUnitItemSchema>;

export const drugSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  itemType: drugItemTypeSchema,
  isBatchManaged: z.boolean(),
  baseUnitCode: z.string().nullable(),
  defaultSellPrice: z.number().int().nullable(),
  drugGroupCode: z.string().nullable(),
  routeCode: z.string().nullable(),
  nationalCode: z.string().nullable(),
  manufacturer: z.string().nullable(),
  minStockAlert: z.number().int().nullable(),
  maxStockAlert: z.number().int().nullable(),
  ingredients: z.array(drugIngredientItemSchema),
  units: z.array(drugUnitItemSchema),
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
  itemType: drugItemTypeSchema.optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(false)
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});
export type ListDrugsQuery = z.infer<typeof listDrugsQuerySchema>;

export const listDrugsResponseSchema = z.object({ items: z.array(drugSummarySchema) });
export type ListDrugsResponse = z.infer<typeof listDrugsResponseSchema>;

// ============ Nhà cung cấp (docs/DECISIONS.md #146, GĐ1) ============
// `code` KHÔNG nhận từ client — server tự sinh (formatShortSequentialCode, tiền tố "NCC").
export const createSupplierRequestSchema = z.object({
  name: z.string().min(1),
  taxCode: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  contactName: z.string().min(1).optional(),
});
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;

export const updateSupplierRequestSchema = z.object({
  name: z.string().min(1).optional(),
  taxCode: z.string().min(1).nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  address: z.string().min(1).nullable().optional(),
  contactName: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;

export const supplierSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  taxCode: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  contactName: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type SupplierSummary = z.infer<typeof supplierSummarySchema>;

export const listSuppliersResponseSchema = z.object({ items: z.array(supplierSummarySchema) });
export type ListSuppliersResponse = z.infer<typeof listSuppliersResponseSchema>;

// ============ Kho (docs/DECISIONS.md #146, GĐ1) ============
// `code` KHÔNG nhận từ client — server tự sinh (formatShortSequentialCode, tiền tố "KH").
export const createWarehouseRequestSchema = z.object({
  name: z.string().min(1),
  departmentId: z.string().uuid().optional(),
  isDefault: z.boolean().optional(),
});
export type CreateWarehouseRequest = z.infer<typeof createWarehouseRequestSchema>;

export const updateWarehouseRequestSchema = z.object({
  name: z.string().min(1).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateWarehouseRequest = z.infer<typeof updateWarehouseRequestSchema>;

export const warehouseSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type WarehouseSummary = z.infer<typeof warehouseSummarySchema>;

export const listWarehousesResponseSchema = z.object({ items: z.array(warehouseSummarySchema) });
export type ListWarehousesResponse = z.infer<typeof listWarehousesResponseSchema>;
