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

/** Phân loại kiểm soát đặc biệt (Thông tư 20/2017/TT-BYT, docs/DECISIONS.md #151) — CỐ ĐỊNH theo
 * pháp luật, chỉ có ý nghĩa khi `itemType==='MEDICINE'`. */
export const drugControlTypeSchema = z.enum(['NORMAL', 'TOXIC', 'NARCOTIC', 'PSYCHOTROPIC', 'PRECURSOR']);
export type DrugControlType = z.infer<typeof drugControlTypeSchema>;

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
 * `factorToUnitBelow` = hệ số quy đổi ra bậc NGAY DƯỚI (xem `computeUnitConversion`, @nexamed/core).
 * `sellPrice` — giá bán RIÊNG của bậc này, CHỈ bắt buộc khi `unitPricingEnabled=true` ở `drug`
 * (validate ở `checkUnitPricingRequired` dưới, không phải ở đây vì cần biết `unitPricingEnabled`
 * của object cha). */
export const drugUnitInputSchema = z.object({
  unitCode: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  factorToUnitBelow: z.number().int().positive(),
  sellPrice: z.number().int().nonnegative().nullable().optional(),
});
export type DrugUnitInput = z.infer<typeof drugUnitInputSchema>;

/** Bắt buộc nhập đủ giá bán (đơn vị nhỏ nhất + MỌI bậc quy đổi) khi bật "Giá theo từng đơn vị cụ
 * thể" (mở rộng GĐ1, chủ dự án yêu cầu trực tiếp) — mặc định TẮT thì không bắt buộc gì thêm, giá
 * mỗi bậc suy ra theo tỷ lệ quy đổi từ `defaultSellPrice`. */
function checkUnitPricingRequired(
  data: { unitPricingEnabled?: boolean; defaultSellPrice?: number | null; units?: DrugUnitInput[] },
  ctx: z.RefinementCtx,
): void {
  if (!data.unitPricingEnabled) return;
  if (data.defaultSellPrice === undefined || data.defaultSellPrice === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Bắt buộc nhập giá bán cho đơn vị nhỏ nhất khi bật "Giá theo từng đơn vị cụ thể".',
      path: ['defaultSellPrice'],
    });
  }
  (data.units ?? []).forEach((u, i) => {
    if (u.sellPrice === undefined || u.sellPrice === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bắt buộc nhập giá bán cho đơn vị này khi bật "Giá theo từng đơn vị cụ thể".',
        path: ['units', i, 'sellPrice'],
      });
    }
  });
}

/** Rà soát đối chiếu tài liệu quy chuẩn quản lý kho thuốc/VTYT (docs/DECISIONS.md #151) — các
 * trường tài liệu đánh dấu "Bắt buộc" cho thuốc (Nhóm thuốc/Đường dùng/Hoạt chất) CHỈ bắt buộc khi
 * `itemType==='MEDICINE'` (Vật tư y tế không có các khái niệm này). Chỉ kiểm khi trường tương ứng
 * THỰC SỰ có mặt trong payload (undefined = không đổi) — cùng cách nới lỏng `checkUnitPricingRequired`
 * đang làm cho update một phần. */
function checkMedicineRequiredFields(
  data: {
    itemType?: DrugItemType;
    drugGroupCode?: string | null;
    routeCode?: string | null;
    ingredients?: DrugIngredientInput[];
    registrationNumber?: string | null;
    dosageForm?: string | null;
    countryOfOrigin?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (data.itemType !== 'MEDICINE') return;
  if (!data.drugGroupCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bắt buộc chọn Nhóm thuốc.', path: ['drugGroupCode'] });
  }
  if (!data.routeCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bắt buộc chọn Đường dùng.', path: ['routeCode'] });
  }
  if (data.ingredients !== undefined && data.ingredients.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Thuốc phải có ít nhất một Hoạt chất & hàm lượng.', path: ['ingredients'] });
  }
  if (!data.registrationNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bắt buộc nhập Số đăng ký lưu hành.', path: ['registrationNumber'] });
  }
  if (!data.dosageForm) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bắt buộc nhập Dạng bào chế.', path: ['dosageForm'] });
  }
  if (!data.countryOfOrigin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bắt buộc nhập Nước sản xuất.', path: ['countryOfOrigin'] });
  }
}

export const createDrugRequestSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    itemType: drugItemTypeSchema,
    isBatchManaged: z.boolean().default(true),
    // Bắt buộc ở tầng Zod cho mặt hàng TẠO MỚI (dù cột DB nullable — dữ liệu trước GĐ1 không có) —
    // cùng cách "bắt buộc ở ứng dụng, nullable ở DB" đã áp dụng cho reception_type_code/exam_form_code.
    baseUnitCode: z.string().min(1),
    // Bắt buộc (rà soát #151 đối chiếu tài liệu quy chuẩn — "Giá bán theo ĐVT cơ sở" Bắt buộc cho
    // cả Thuốc lẫn Vật tư y tế).
    defaultSellPrice: z.number().int().nonnegative(),
    // Mặc định TẮT — xem `checkUnitPricingRequired`.
    unitPricingEnabled: z.boolean().default(false),
    // Bắt buộc khi itemType==='MEDICINE' — xem `checkMedicineRequiredFields`.
    drugGroupCode: z.string().min(1).optional(),
    routeCode: z.string().min(1).optional(),
    nationalCode: z.string().min(1).optional(),
    // Cột cũ (S4-03, text tự do) — vẫn nhận cho tương thích ngược, KHÔNG còn hiện trên form nhập
    // liệu mới (mở rộng #151 chuyển sang danh mục qua `manufacturerCode`).
    manufacturer: z.string().min(1).optional(),
    // Bắt buộc cho CẢ Thuốc lẫn Vật tư y tế (đúng phạm vi cũ của `manufacturer`) — mã tham chiếu
    // reference_catalog category MANUFACTURER, có "thêm nhanh" ngay tại ô chọn.
    manufacturerCode: z.string().min(1),
    minStockAlert: z.number().int().nonnegative().optional(),
    maxStockAlert: z.number().int().nonnegative().optional(),
    // Phân loại kiểm soát đặc biệt + Rx/OTC (docs/DECISIONS.md #151) — có default an toàn, không ép
    // người dùng chọn. CHỈ có ý nghĩa khi itemType==='MEDICINE' (service ép NORMAL/true cho SUPPLY).
    controlType: drugControlTypeSchema.default('NORMAL'),
    isPrescriptionOnly: z.boolean().default(true),
    // Mở rộng #151 (rà soát chi tiết theo tài liệu quy chuẩn) — CHỈ có ý nghĩa với MEDICINE, bắt
    // buộc qua `checkMedicineRequiredFields` (3 dòng dưới), còn lại tùy chọn. `dosageForm`/
    // `countryOfOrigin`/`storageConditions` là MÃ tham chiếu reference_catalog (Combobox
    // `allowCreate`), không phải text tự do.
    registrationNumber: z.string().min(1).optional(),
    dosageForm: z.string().min(1).optional(),
    countryOfOrigin: z.string().min(1).optional(),
    defaultDosage: z.string().min(1).optional(),
    usageInstruction: z.string().min(1).optional(),
    contraindications: z.string().min(1).optional(),
    storageConditions: z.string().min(1).optional(),
    storageLocation: z.string().min(1).optional(),
    barcode: z.string().min(1).optional(),
    // "Quy cách đóng gói" (đảo ngược hoãn #151, chốt 17/09/2026) — web tự ghép gợi ý từ Bảng quy
    // đổi lúc field còn trống, sau đó là text tự do hoàn toàn (đóng gói phức tạp không diễn tả hết
    // bằng bảng quy đổi thuần số, vd "Hộp 1 lọ bột pha tiêm + 1 ống nước cất 5ml").
    packagingSpec: z.string().min(1).optional(),
    // Vật tư y tế KHÔNG có hoạt chất/hàm lượng (yêu cầu chủ dự án) — validate ở service, không ở đây
    // (Zod không biết được itemType đã xác nhận đúng trước khi tới schema này).
    ingredients: z.array(drugIngredientInputSchema).default([]),
    units: z.array(drugUnitInputSchema).default([]),
    // Cột cũ (S4-03) — vẫn nhận được cho tương thích ngược, KHÔNG còn hiện trên form nhập liệu mới.
    activeIngredient: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
    concentration: z.string().min(1).optional(),
  })
  .superRefine(checkUnitPricingRequired)
  .superRefine(checkMedicineRequiredFields);
export type CreateDrugRequest = z.infer<typeof createDrugRequestSchema>;

export const updateDrugRequestSchema = z
  .object({
    code: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    itemType: drugItemTypeSchema.optional(),
    isBatchManaged: z.boolean().optional(),
    baseUnitCode: z.string().min(1).nullable().optional(),
    defaultSellPrice: z.number().int().nonnegative().nullable().optional(),
    unitPricingEnabled: z.boolean().optional(),
    drugGroupCode: z.string().min(1).nullable().optional(),
    routeCode: z.string().min(1).nullable().optional(),
    nationalCode: z.string().min(1).nullable().optional(),
    manufacturer: z.string().min(1).nullable().optional(),
    manufacturerCode: z.string().min(1).nullable().optional(),
    minStockAlert: z.number().int().nonnegative().nullable().optional(),
    maxStockAlert: z.number().int().nonnegative().nullable().optional(),
    controlType: drugControlTypeSchema.optional(),
    isPrescriptionOnly: z.boolean().optional(),
    registrationNumber: z.string().min(1).nullable().optional(),
    dosageForm: z.string().min(1).nullable().optional(),
    countryOfOrigin: z.string().min(1).nullable().optional(),
    defaultDosage: z.string().min(1).nullable().optional(),
    usageInstruction: z.string().min(1).nullable().optional(),
    contraindications: z.string().min(1).nullable().optional(),
    storageConditions: z.string().min(1).nullable().optional(),
    storageLocation: z.string().min(1).nullable().optional(),
    barcode: z.string().min(1).nullable().optional(),
    packagingSpec: z.string().min(1).nullable().optional(),
    ingredients: z.array(drugIngredientInputSchema).optional(),
    units: z.array(drugUnitInputSchema).optional(),
    activeIngredient: z.string().min(1).nullable().optional(),
    unit: z.string().min(1).nullable().optional(),
    concentration: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .superRefine(checkUnitPricingRequired)
  .superRefine(checkMedicineRequiredFields);
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
  unitPricingEnabled: z.boolean(),
  drugGroupCode: z.string().nullable(),
  routeCode: z.string().nullable(),
  nationalCode: z.string().nullable(),
  manufacturer: z.string().nullable(),
  manufacturerCode: z.string().nullable(),
  minStockAlert: z.number().int().nullable(),
  maxStockAlert: z.number().int().nullable(),
  controlType: drugControlTypeSchema,
  isPrescriptionOnly: z.boolean(),
  registrationNumber: z.string().nullable(),
  dosageForm: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  defaultDosage: z.string().nullable(),
  usageInstruction: z.string().nullable(),
  contraindications: z.string().nullable(),
  storageConditions: z.string().nullable(),
  storageLocation: z.string().nullable(),
  barcode: z.string().nullable(),
  packagingSpec: z.string().nullable(),
  // Kho Thuốc GĐ2 — cache "giá nhập gần nhất" theo đơn vị CƠ SỞ, chỉ cập nhật khi Duyệt phiếu nhập
  // receiptType=PURCHASE (packages/shared/src/inventory.ts).
  lastPurchaseUnitCost: z.number().int().nullable(),
  lastPurchaseAt: z.string().nullable(),
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
  /**
   * Kho Thuốc GĐ3 (#163) — lọc CHỈ hàng OTC (`isPrescriptionOnly=false`) cho khu vực "+ Thêm hàng
   * không theo đơn" ở `DispensePrescriptionDialog.tsx`. `undefined` = không lọc theo cột này (mọi
   * nơi dùng khác giữ nguyên hành vi cũ).
   */
  prescriptionOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
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
