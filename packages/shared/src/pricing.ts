import { z } from 'zod';
import { discountTypeSchema } from './billing';

/**
 * Cận lâm sàng GĐ2 — Gói dịch vụ + Bảng giá có thời hạn (docs/DECISIONS.md #212).
 *
 * - **Gói dịch vụ**: Dịch vụ khám + Dịch vụ kỹ thuật (KHÔNG thuốc/vật tư). Giá cố định, hoặc tổng giá lẻ trừ chiết khấu.
 * - **Bảng giá có thời hạn**: khoảng ngày cố định, độ ưu tiên số (CAO THẮNG), 1 bảng trộn đủ 5 loại mặt hàng; mỗi dòng
 *   chọn "Giảm %" hoặc "Giá mới". "Bảng giá chung" = giá nhập trực tiếp trên từng mặt hàng (ưu tiên 0) — KHÔNG lưu bản sao.
 * - Hàm tính giá thuần nằm ở `@nexamed/core` `pricing/resolve-effective-price.ts`; web KHÔNG import `core` nên mọi con số
 *   "giá áp dụng" đều do API tính và trả về.
 */

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD');

// ---------------------------------------------------------------------------------------------
// Gói dịch vụ
// ---------------------------------------------------------------------------------------------

export const servicePackagePricingModeSchema = z.enum(['FIXED', 'SUM_MINUS_DISCOUNT']);
export type ServicePackagePricingMode = z.infer<typeof servicePackagePricingModeSchema>;

export const SERVICE_PACKAGE_PRICING_MODE_LABELS: Record<ServicePackagePricingMode, string> = {
  FIXED: 'Giá cố định cho cả gói',
  SUM_MINUS_DISCOUNT: 'Tổng dịch vụ con trừ chiết khấu',
};

export const servicePackageItemKindSchema = z.enum(['EXAM_TYPE', 'TECHNICAL_SERVICE']);
export type ServicePackageItemKind = z.infer<typeof servicePackageItemKindSchema>;

export const servicePackageItemInputSchema = z
  .object({
    itemKind: servicePackageItemKindSchema,
    /** Mã dịch vụ khám (`reference_catalog` category EXAM_TYPE) — bắt buộc khi `itemKind='EXAM_TYPE'`. */
    examTypeCode: z.string().min(1).optional(),
    /** Dịch vụ kỹ thuật — bắt buộc khi `itemKind='TECHNICAL_SERVICE'`. */
    technicalServiceId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(999).default(1),
  })
  .superRefine((v, ctx) => {
    if (v.itemKind === 'EXAM_TYPE' && (v.examTypeCode === undefined || v.technicalServiceId !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['examTypeCode'], message: 'Dịch vụ khám phải có mã dịch vụ khám' });
    }
    if (v.itemKind === 'TECHNICAL_SERVICE' && (v.technicalServiceId === undefined || v.examTypeCode !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['technicalServiceId'], message: 'Dịch vụ kỹ thuật phải chọn dịch vụ kỹ thuật' });
    }
  });
export type ServicePackageItemInput = z.infer<typeof servicePackageItemInputSchema>;

const servicePackageFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  pricingMode: servicePackagePricingModeSchema,
  /** Giá cố định (đồng) — bắt buộc khi `pricingMode='FIXED'`, bị bỏ qua khi `SUM_MINUS_DISCOUNT`. */
  fixedPrice: z.number().int().nonnegative().optional(),
  /** Chiết khấu — chỉ khi `SUM_MINUS_DISCOUNT`; đi cặp (loại + giá trị) hoặc bỏ trống cả hai. */
  discountType: discountTypeSchema.optional(),
  discountValue: z.number().int().nonnegative().optional(),
  effectiveFrom: dateOnlySchema,
  effectiveTo: dateOnlySchema.optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

function refineServicePackage(
  v: {
    pricingMode?: ServicePackagePricingMode;
    fixedPrice?: number;
    discountType?: z.infer<typeof discountTypeSchema>;
    discountValue?: number;
    effectiveFrom?: string;
    effectiveTo?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (v.effectiveFrom !== undefined && v.effectiveTo !== undefined && v.effectiveTo < v.effectiveFrom) {
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Ngày kết thúc phải sau hoặc bằng Ngày hiệu lực' });
  }
  if (v.pricingMode === 'FIXED' && v.fixedPrice === undefined) {
    ctx.addIssue({ code: 'custom', path: ['fixedPrice'], message: 'Giá cố định bắt buộc nhập' });
  }
  if (v.pricingMode === 'SUM_MINUS_DISCOUNT') {
    if ((v.discountType === undefined) !== (v.discountValue === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Chiết khấu phải có cả loại và giá trị' });
    }
    if (v.discountType === 'PERCENT' && v.discountValue !== undefined && v.discountValue > 100) {
      ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Chiết khấu phần trăm tối đa 100' });
    }
  }
}

export const createServicePackageRequestSchema = servicePackageFieldsSchema
  .extend({ items: z.array(servicePackageItemInputSchema).min(1, 'Gói phải có ít nhất 1 dịch vụ').max(200) })
  .superRefine(refineServicePackage);
export type CreateServicePackageRequest = z.infer<typeof createServicePackageRequestSchema>;

/** Sửa gói — `items` thay TOÀN BỘ danh sách dịch vụ con khi có (bulk-replace, đúng khuôn `prices` của dịch vụ kỹ thuật). */
export const updateServicePackageRequestSchema = z
  .object({
    version: z.number().int().positive(),
    name: servicePackageFieldsSchema.shape.name.optional(),
    pricingMode: servicePackagePricingModeSchema.optional(),
    fixedPrice: servicePackageFieldsSchema.shape.fixedPrice.nullable().optional(),
    discountType: discountTypeSchema.nullable().optional(),
    discountValue: servicePackageFieldsSchema.shape.discountValue.nullable().optional(),
    effectiveFrom: dateOnlySchema.optional(),
    effectiveTo: dateOnlySchema.nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    items: z.array(servicePackageItemInputSchema).min(1, 'Gói phải có ít nhất 1 dịch vụ').max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.effectiveFrom !== undefined && v.effectiveTo !== undefined && v.effectiveTo !== null && v.effectiveTo < v.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Ngày kết thúc phải sau hoặc bằng Ngày hiệu lực' });
    }
  });
export type UpdateServicePackageRequest = z.infer<typeof updateServicePackageRequestSchema>;

export const listServicePackagesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** `true` = CHỈ gói đang dùng được hôm nay (đang bật + trong khoảng hiệu lực) — dùng cho bộ chọn lúc chỉ định (GĐ3). */
  orderableOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListServicePackagesQuery = z.infer<typeof listServicePackagesQuerySchema>;

export const servicePackageStatusSchema = z.enum(['ACTIVE', 'UPCOMING', 'EXPIRED', 'STOPPED']);
export type ServicePackageStatus = z.infer<typeof servicePackageStatusSchema>;

export const servicePackageItemViewSchema = z.object({
  id: z.string().uuid(),
  itemKind: servicePackageItemKindSchema,
  /** Mã dịch vụ khám hoặc mã dịch vụ kỹ thuật. */
  code: z.string(),
  name: z.string(),
  /** Nhóm hiển thị: tên nhóm dịch vụ kỹ thuật; dịch vụ khám = "Khám bệnh". */
  groupName: z.string().nullable(),
  technicalServiceId: z.string().uuid().nullable(),
  examTypeCode: z.string().nullable(),
  quantity: z.number().int(),
  /** Giá lẻ 1 đơn vị đang hiệu lực hôm nay (theo Loại giá đầu tiên có giá); `null` = chưa có giá. */
  unitPrice: z.number().int().nonnegative().nullable(),
});
export type ServicePackageItemView = z.infer<typeof servicePackageItemViewSchema>;

export const servicePackageSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  pricingMode: servicePackagePricingModeSchema,
  fixedPrice: z.number().int().nonnegative().nullable(),
  discountType: discountTypeSchema.nullable(),
  discountValue: z.number().int().nonnegative().nullable(),
  effectiveFrom: dateOnlySchema,
  effectiveTo: dateOnlySchema.nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
  status: servicePackageStatusSchema,
  itemCount: z.number().int().nonnegative(),
  /** Tổng giá lẻ các dịch vụ con CÓ giá. */
  retailTotal: z.number().int().nonnegative(),
  unpricedItemCount: z.number().int().nonnegative(),
  /** Giá gói tính theo cách đã chọn (CHƯA áp bảng giá có thời hạn); `null` = chưa tính được. */
  price: z.number().int().nonnegative().nullable(),
  /** Khách lợi so với mua lẻ — `null` khi chưa có giá gói. Có thể âm nếu gói đắt hơn mua lẻ. */
  saving: z.number().int().nullable(),
});
export type ServicePackageSummary = z.infer<typeof servicePackageSummarySchema>;

export const servicePackageDetailSchema = servicePackageSummarySchema.extend({ items: z.array(servicePackageItemViewSchema) });
export type ServicePackageDetail = z.infer<typeof servicePackageDetailSchema>;

export const listServicePackagesResponseSchema = z.object({ items: z.array(servicePackageSummarySchema) });
export type ListServicePackagesResponse = z.infer<typeof listServicePackagesResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Bảng giá có thời hạn
// ---------------------------------------------------------------------------------------------

export const priceListItemKindSchema = z.enum(['EXAM_TYPE', 'TECHNICAL_SERVICE', 'PACKAGE', 'DRUG', 'MEDICAL_SUPPLY']);
export type PriceListItemKind = z.infer<typeof priceListItemKindSchema>;

export const PRICE_LIST_ITEM_KIND_LABELS: Record<PriceListItemKind, string> = {
  EXAM_TYPE: 'Dịch vụ khám',
  TECHNICAL_SERVICE: 'Dịch vụ kỹ thuật',
  PACKAGE: 'Gói dịch vụ',
  DRUG: 'Thuốc',
  MEDICAL_SUPPLY: 'Vật tư y tế',
};

export const priceListLineModeSchema = z.enum(['PERCENT_OFF', 'NEW_PRICE']);
export type PriceListLineMode = z.infer<typeof priceListLineModeSchema>;

export const priceListStatusSchema = z.enum(['ACTIVE', 'UPCOMING', 'EXPIRED', 'STOPPED']);
export type PriceListStatus = z.infer<typeof priceListStatusSchema>;

export const PRICE_LIST_STATUS_LABELS: Record<PriceListStatus, string> = {
  ACTIVE: 'Đang áp dụng',
  UPCOMING: 'Sắp áp dụng',
  EXPIRED: 'Đã hết hạn',
  STOPPED: 'Đã ngừng',
};

/**
 * Một dòng bảng giá. `itemKind` quyết định tham chiếu nào bắt buộc: EXAM_TYPE → `examTypeCode`; TECHNICAL_SERVICE →
 * `technicalServiceId`; PACKAGE → `servicePackageId`; DRUG/MEDICAL_SUPPLY → `drugId` (loại phải khớp `drug.item_type`).
 * `priceTypeCode` trống = mọi Loại giá (dịch vụ), `unitCode` trống = mọi bậc đơn vị (thuốc/vật tư) — chỉ hợp lệ với
 * "Giảm %"; "Giá mới" bắt buộc chỉ định (gói thì không có cả hai: tính trọn gói).
 */
export const priceListLineInputSchema = z
  .object({
    itemKind: priceListItemKindSchema,
    examTypeCode: z.string().min(1).optional(),
    technicalServiceId: z.string().uuid().optional(),
    servicePackageId: z.string().uuid().optional(),
    drugId: z.string().uuid().optional(),
    priceTypeCode: z.string().min(1).optional(),
    unitCode: z.string().min(1).optional(),
    mode: priceListLineModeSchema,
    /** PERCENT_OFF: % nguyên 1-100. NEW_PRICE: số tiền đồng ≥ 0. */
    value: z.number().int().nonnegative(),
  })
  .superRefine((v, ctx) => {
    const refs = {
      EXAM_TYPE: v.examTypeCode,
      TECHNICAL_SERVICE: v.technicalServiceId,
      PACKAGE: v.servicePackageId,
      DRUG: v.drugId,
      MEDICAL_SUPPLY: v.drugId,
    } as const;
    const provided = [v.examTypeCode, v.technicalServiceId, v.servicePackageId, v.drugId].filter((x) => x !== undefined).length;
    if (refs[v.itemKind] === undefined || provided !== 1) {
      ctx.addIssue({ code: 'custom', path: ['itemKind'], message: 'Mặt hàng không khớp với loại đã chọn' });
    }
    if (v.mode === 'PERCENT_OFF' && (v.value < 1 || v.value > 100)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Phần trăm giảm phải từ 1 đến 100' });
    }
    if (v.mode === 'PERCENT_OFF' && v.unitCode !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['unitCode'], message: '"Giảm %" áp cho mọi bậc đơn vị' });
    }
    const isService = v.itemKind === 'EXAM_TYPE' || v.itemKind === 'TECHNICAL_SERVICE';
    const isStock = v.itemKind === 'DRUG' || v.itemKind === 'MEDICAL_SUPPLY';
    if (isService && v.unitCode !== undefined) ctx.addIssue({ code: 'custom', path: ['unitCode'], message: 'Dịch vụ không có bậc đơn vị' });
    if (isStock && v.priceTypeCode !== undefined) ctx.addIssue({ code: 'custom', path: ['priceTypeCode'], message: 'Thuốc/vật tư không có Loại giá dịch vụ' });
    if (v.itemKind === 'PACKAGE' && (v.priceTypeCode !== undefined || v.unitCode !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['priceTypeCode'], message: 'Gói dịch vụ tính trọn gói' });
    }
    if (v.mode === 'NEW_PRICE' && isService && v.priceTypeCode === undefined) {
      ctx.addIssue({ code: 'custom', path: ['priceTypeCode'], message: '"Giá mới" phải chọn Loại giá dịch vụ' });
    }
    if (v.mode === 'NEW_PRICE' && isStock && v.unitCode === undefined) {
      ctx.addIssue({ code: 'custom', path: ['unitCode'], message: '"Giá mới" phải chọn đơn vị' });
    }
  });
export type PriceListLineInput = z.infer<typeof priceListLineInputSchema>;

const priceListFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  effectiveFrom: dateOnlySchema,
  effectiveTo: dateOnlySchema,
  /** Độ ưu tiên 1-999999, CAO THẮNG. 0 dành riêng cho Bảng giá chung (giá nhập trên mặt hàng). */
  priority: z.number().int().min(1).max(999_999),
});

export const createPriceListRequestSchema = priceListFieldsSchema
  .extend({ lines: z.array(priceListLineInputSchema).max(5000).default([]) })
  .refine((v) => v.effectiveTo >= v.effectiveFrom, { message: 'Ngày kết thúc phải sau hoặc bằng Ngày bắt đầu', path: ['effectiveTo'] });
export type CreatePriceListRequest = z.infer<typeof createPriceListRequestSchema>;

/** Sửa bảng giá — `lines` thay TOÀN BỘ các dòng khi có (bulk-replace). `isActive=false` = "Ngừng bảng giá". */
export const updatePriceListRequestSchema = z
  .object({
    version: z.number().int().positive(),
    name: priceListFieldsSchema.shape.name.optional(),
    description: priceListFieldsSchema.shape.description.nullable().optional(),
    effectiveFrom: dateOnlySchema.optional(),
    effectiveTo: dateOnlySchema.optional(),
    priority: priceListFieldsSchema.shape.priority.optional(),
    isActive: z.boolean().optional(),
    lines: z.array(priceListLineInputSchema).max(5000).optional(),
  })
  .refine((v) => v.effectiveFrom === undefined || v.effectiveTo === undefined || v.effectiveTo >= v.effectiveFrom, {
    message: 'Ngày kết thúc phải sau hoặc bằng Ngày bắt đầu',
    path: ['effectiveTo'],
  });
export type UpdatePriceListRequest = z.infer<typeof updatePriceListRequestSchema>;

export const listPriceListsQuerySchema = z.object({
  status: priceListStatusSchema.optional(),
  search: z.string().trim().min(1).optional(),
});
export type ListPriceListsQuery = z.infer<typeof listPriceListsQuerySchema>;

export const priceListSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  effectiveFrom: dateOnlySchema,
  effectiveTo: dateOnlySchema,
  priority: z.number().int(),
  isActive: z.boolean(),
  version: z.number().int(),
  status: priceListStatusSchema,
  itemCount: z.number().int().nonnegative(),
});
export type PriceListSummary = z.infer<typeof priceListSummarySchema>;

/** Dòng "Bảng giá chung" ảo — luôn đứng đầu danh sách, không sửa/xoá được (là giá nhập trên từng mặt hàng). */
export const generalPriceListSchema = z.object({
  code: z.string(),
  name: z.string(),
  priority: z.literal(0),
  itemCount: z.number().int().nonnegative(),
});
export type GeneralPriceList = z.infer<typeof generalPriceListSchema>;

export const listPriceListsResponseSchema = z.object({
  general: generalPriceListSchema,
  items: z.array(priceListSummarySchema),
  counts: z.object({
    all: z.number().int().nonnegative(),
    ACTIVE: z.number().int().nonnegative(),
    UPCOMING: z.number().int().nonnegative(),
    EXPIRED: z.number().int().nonnegative(),
    STOPPED: z.number().int().nonnegative(),
  }),
});
export type ListPriceListsResponse = z.infer<typeof listPriceListsResponseSchema>;

/** Một "mức giá" của mặt hàng: Loại giá (dịch vụ) hoặc Bậc đơn vị (thuốc/vật tư); gói chỉ có 1 mức "Trọn gói". */
export const priceableScopeSchema = z.object({
  priceTypeCode: z.string().nullable(),
  unitCode: z.string().nullable(),
  /** Giá mặc định hôm nay của mức này; `null` = chưa có giá. */
  amount: z.number().int().nonnegative().nullable(),
});
export type PriceableScope = z.infer<typeof priceableScopeSchema>;

export const priceListLineViewSchema = z.object({
  id: z.string().uuid(),
  itemKind: priceListItemKindSchema,
  examTypeCode: z.string().nullable(),
  technicalServiceId: z.string().uuid().nullable(),
  servicePackageId: z.string().uuid().nullable(),
  drugId: z.string().uuid().nullable(),
  /** Mã hiển thị của mặt hàng (mã dịch vụ khám/kỹ thuật/gói/thuốc). */
  code: z.string(),
  name: z.string(),
  priceTypeCode: z.string().nullable(),
  unitCode: z.string().nullable(),
  mode: priceListLineModeSchema,
  value: z.number().int().nonnegative(),
  /** Giá mặc định của đúng Loại giá/Đơn vị (hoặc mức đầu tiên khi "mọi ..."); `null` = mặt hàng chưa có giá. */
  baseAmount: z.number().int().nonnegative().nullable(),
  /** Giá áp dụng nếu dòng này thắng (làm tròn về 1 đồng). */
  finalAmount: z.number().int().nonnegative().nullable(),
  /** Mọi mức giá (Loại giá/Bậc đơn vị) của mặt hàng hôm nay — để UI đổi phạm vi dòng mà không phải gọi lại. Rỗng khi mặt hàng không còn. */
  scopes: z.array(priceableScopeSchema),
  /** Mặt hàng đã bị xoá/ẩn khỏi danh mục — dòng vẫn giữ để xem, UI cảnh báo. */
  itemMissing: z.boolean(),
});
export type PriceListLineView = z.infer<typeof priceListLineViewSchema>;

export const priceListDetailSchema = priceListSummarySchema.extend({ lines: z.array(priceListLineViewSchema) });
export type PriceListDetail = z.infer<typeof priceListDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Tìm mặt hàng để thêm vào bảng giá / tra thử giá
// ---------------------------------------------------------------------------------------------

export const searchPriceableItemsQuerySchema = z.object({
  q: z.string().trim().min(1),
  kind: priceListItemKindSchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 20 : Math.min(50, Math.max(1, Number(v) || 20)))),
});
export type SearchPriceableItemsQuery = z.infer<typeof searchPriceableItemsQuerySchema>;

export const priceableItemSchema = z.object({
  itemKind: priceListItemKindSchema,
  /** `examTypeCode` (dịch vụ khám) hoặc id (uuid) của dịch vụ kỹ thuật/gói/thuốc/vật tư. */
  ref: z.string(),
  code: z.string(),
  name: z.string(),
  /** Nhóm hiển thị: dịch vụ khám = "Khám bệnh"; dịch vụ kỹ thuật = tên Nhóm dịch vụ; còn lại null. */
  groupName: z.string().nullable(),
  scopes: z.array(priceableScopeSchema),
});
export type PriceableItem = z.infer<typeof priceableItemSchema>;

export const searchPriceableItemsResponseSchema = z.object({ items: z.array(priceableItemSchema) });
export type SearchPriceableItemsResponse = z.infer<typeof searchPriceableItemsResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Tính giá áp dụng (Tiếp nhận dùng cho Dịch vụ khám; "Tra thử giá" dùng cho mọi loại)
// ---------------------------------------------------------------------------------------------

export const resolvePriceItemSchema = z.object({
  itemKind: priceListItemKindSchema,
  ref: z.string().min(1),
  priceTypeCode: z.string().min(1).optional(),
  unitCode: z.string().min(1).optional(),
});
export type ResolvePriceItem = z.infer<typeof resolvePriceItemSchema>;

export const resolvePricesRequestSchema = z.object({
  /** Ngày áp giá (ngày tiếp nhận / ngày lập phiếu), yyyy-mm-dd giờ Việt Nam. */
  date: dateOnlySchema,
  items: z.array(resolvePriceItemSchema).min(1).max(100),
});
export type ResolvePricesRequest = z.infer<typeof resolvePricesRequestSchema>;

export const appliedPriceListSchema = z.object({
  priceListId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  priority: z.number().int(),
  mode: priceListLineModeSchema,
  value: z.number().int().nonnegative(),
});
export type AppliedPriceList = z.infer<typeof appliedPriceListSchema>;

export const resolvedPriceSchema = z.object({
  baseAmount: z.number().int().nonnegative().nullable(),
  /** Giá cuối cùng; `null` khi mặt hàng chưa có giá. */
  amount: z.number().int().nonnegative().nullable(),
  /** Bảng giá có thời hạn đã thắng; `null` = dùng giá mặc định (Bảng giá chung). */
  applied: appliedPriceListSchema.nullable(),
});
export type ResolvedPrice = z.infer<typeof resolvedPriceSchema>;

export const resolvePricesResponseSchema = z.object({ items: z.array(resolvedPriceSchema) });
export type ResolvePricesResponse = z.infer<typeof resolvePricesResponseSchema>;

/** `GET /price-lists/lookup` — "Tra thử giá": mọi bảng chứa mặt hàng này vào ngày đã chọn, bảng nào thắng, bảng nào bị đè. */
export const lookupPriceQuerySchema = z.object({
  itemKind: priceListItemKindSchema,
  ref: z.string().min(1),
  date: dateOnlySchema,
  priceTypeCode: z.string().min(1).optional(),
  unitCode: z.string().min(1).optional(),
});
export type LookupPriceQuery = z.infer<typeof lookupPriceQuerySchema>;

export const lookupPriceEntrySchema = z.object({
  /** `null` = Bảng giá chung (giá nhập trên mặt hàng). */
  priceListId: z.string().uuid().nullable(),
  code: z.string(),
  name: z.string(),
  priority: z.number().int(),
  mode: priceListLineModeSchema.nullable(),
  value: z.number().int().nonnegative().nullable(),
  /** Giá nếu bảng này được áp. */
  amount: z.number().int().nonnegative().nullable(),
  /** Bảng này đang hiệu lực đúng ngày tra không (bảng chung luôn true). */
  inEffect: z.boolean(),
  /** Bảng thắng ở ngày tra. */
  isApplied: z.boolean(),
});
export type LookupPriceEntry = z.infer<typeof lookupPriceEntrySchema>;

export const lookupPriceResponseSchema = z.object({
  item: z.object({ itemKind: priceListItemKindSchema, ref: z.string(), code: z.string(), name: z.string() }),
  date: dateOnlySchema,
  /** Mức giá đã dùng để tra (Loại giá/Đơn vị đầu tiên có giá nếu người dùng không chọn). */
  scope: priceableScopeSchema,
  /** Các mức giá có thể chọn tra (mặt hàng nhiều Loại giá/Bậc đơn vị). */
  scopes: z.array(priceableScopeSchema),
  entries: z.array(lookupPriceEntrySchema),
  result: resolvedPriceSchema,
});
export type LookupPriceResponse = z.infer<typeof lookupPriceResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Thêm hàng loạt vào bảng giá: theo nhóm + nhập Excel (docs/DECISIONS.md #212, yêu cầu chủ dự án 07/10/2026)
// ---------------------------------------------------------------------------------------------

/** Một nhóm mặt hàng chọn được ở hộp thoại "Thêm theo nhóm". `code = null` nghĩa là "Chưa phân nhóm" (dịch vụ kỹ thuật/thuốc/vật tư) hoặc "tất cả" (dịch vụ khám/gói — không có nhóm). */
export const priceableGroupSchema = z.object({
  kind: priceListItemKindSchema,
  code: z.string().nullable(),
  name: z.string(),
  itemCount: z.number().int().nonnegative(),
});
export type PriceableGroup = z.infer<typeof priceableGroupSchema>;

export const listPriceableGroupsResponseSchema = z.object({ groups: z.array(priceableGroupSchema) });
export type ListPriceableGroupsResponse = z.infer<typeof listPriceableGroupsResponseSchema>;

export const itemsByGroupsRequestSchema = z.object({
  groups: z.array(z.object({ kind: priceListItemKindSchema, code: z.string().nullable() })).min(1).max(200),
});
export type ItemsByGroupsRequest = z.infer<typeof itemsByGroupsRequestSchema>;

/** Dòng hợp lệ của file Excel đã đối chiếu với danh mục — web gộp vào danh sách đang soạn (file thắng dòng đã có của cùng mặt hàng). */
export const priceListImportRowSchema = z.object({
  rowNumber: z.number().int(),
  item: priceableItemSchema,
  priceTypeCode: z.string().nullable(),
  unitCode: z.string().nullable(),
  mode: priceListLineModeSchema,
  value: z.number().int().nonnegative(),
});
export type PriceListImportRow = z.infer<typeof priceListImportRowSchema>;

export const priceListImportErrorSchema = z.object({ rowNumber: z.number().int(), message: z.string() });
export type PriceListImportError = z.infer<typeof priceListImportErrorSchema>;

export const priceListImportPreviewResponseSchema = z.object({
  rows: z.array(priceListImportRowSchema),
  errors: z.array(priceListImportErrorSchema),
  /** Số dòng ví dụ (mã bắt đầu bằng "VD-") đã tự bỏ qua. */
  exampleRowCount: z.number().int().nonnegative(),
});
export type PriceListImportPreviewResponse = z.infer<typeof priceListImportPreviewResponseSchema>;

export const PRICE_LIST_IMPORT_MAX_ROWS = 5000;
export const PRICE_LIST_IMPORT_EXAMPLE_CODE_PREFIX = 'VD-';
