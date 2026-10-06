import { z } from 'zod';
import { examTypePriceInputSchema } from './reference-catalog';

/**
 * Cận lâm sàng GĐ1 — Danh mục (docs/DECISIONS.md #212): Dịch vụ kỹ thuật (xét nghiệm / chẩn đoán hình ảnh /
 * thăm dò chức năng), Chỉ số xét nghiệm kèm khoảng tham chiếu theo giới tính × tuổi, và Mẫu kết quả dùng chung.
 * Đơn giá dịch vụ dùng NGUYÊN schema đơn giá của Dịch vụ khám (`examTypePriceInputSchema`, #079) vì cùng bản
 * chất: Loại giá × Đơn vị × khoảng ngày hiệu lực, chặn chồng lấn ở DB.
 */
export const technicalServiceKindSchema = z.enum(['LAB', 'IMAGING', 'FUNCTIONAL']);
export type TechnicalServiceKind = z.infer<typeof technicalServiceKindSchema>;

export const TECHNICAL_SERVICE_KIND_LABELS: Record<TechnicalServiceKind, string> = {
  LAB: 'Xét nghiệm',
  IMAGING: 'Chẩn đoán hình ảnh',
  FUNCTIONAL: 'Thăm dò chức năng',
};

/** Kiểu nhập kết quả: theo chỉ số (xét nghiệm), mô tả + kết luận (CĐHA) hoặc cả hai (thăm dò chức năng). */
export const technicalServiceResultTypeSchema = z.enum(['INDICATORS', 'NARRATIVE', 'BOTH']);
export type TechnicalServiceResultType = z.infer<typeof technicalServiceResultTypeSchema>;

/** Kiểu nhập kết quả mặc định theo loại dịch vụ — web gợi ý khi chọn loại, người dùng đổi được. */
export const DEFAULT_RESULT_TYPE_BY_KIND: Record<TechnicalServiceKind, TechnicalServiceResultType> = {
  LAB: 'INDICATORS',
  IMAGING: 'NARRATIVE',
  FUNCTIONAL: 'BOTH',
};

export const labIndicatorValueTypeSchema = z.enum(['NUMBER', 'TEXT', 'CHOICE']);
export type LabIndicatorValueType = z.infer<typeof labIndicatorValueTypeSchema>;

export const labReferenceSexSchema = z.enum(['ANY', 'MALE', 'FEMALE']);
export type LabReferenceSex = z.infer<typeof labReferenceSexSchema>;

// ---------------------------------------------------------------------------------------------
// Dịch vụ kỹ thuật
// ---------------------------------------------------------------------------------------------

export const technicalServiceIndicatorInputSchema = z.object({
  indicatorId: z.string().uuid(),
  /** Dòng "Diễn giải" in dưới chỉ số trên phiếu kết quả (theo phiếu mẫu thật). */
  interpretationText: z.string().max(2000).optional(),
});
export type TechnicalServiceIndicatorInput = z.infer<typeof technicalServiceIndicatorInputSchema>;

const technicalServiceFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  shortName: z.string().trim().max(100).optional(),
  /** Mã Bộ Y tế — tuỳ chọn, chưa tích hợp cổng nào. */
  nationalCode: z.string().trim().max(50).optional(),
  categoryCode: z.string().min(1).optional(),
  /** Chỉ có ý nghĩa với xét nghiệm (LAB). */
  specimenTypeCode: z.string().min(1).optional(),
  /** `false` = phòng khám không tự làm, chỉ dùng để chỉ định cho bệnh nhân ra ngoài. */
  isPerformedInHouse: z.boolean().default(true),
  departmentId: z.string().uuid().optional(),
  turnaroundMinutes: z.number().int().positive().max(60 * 24 * 30).optional(),
  resultType: technicalServiceResultTypeSchema.optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export const createTechnicalServiceRequestSchema = technicalServiceFieldsSchema.extend({
  serviceKind: technicalServiceKindSchema,
  /** Bulk-replace đơn giá — bỏ trống = chưa có đơn giá. */
  prices: z.array(examTypePriceInputSchema).optional(),
  indicators: z.array(technicalServiceIndicatorInputSchema).optional(),
});
export type CreateTechnicalServiceRequest = z.infer<typeof createTechnicalServiceRequestSchema>;

/**
 * Sửa dịch vụ — `serviceKind` KHÔNG đổi được sau khi tạo (mã tự sinh theo loại: XN/CD/TD). `null` xoá giá trị
 * đã có (khác `undefined` = không đụng). `prices`/`indicators`: `undefined` = không đụng, mảng = thay TOÀN BỘ
 * (đúng ngữ nghĩa bulk-replace của `examTypePrices`, #079).
 */
export const updateTechnicalServiceRequestSchema = z.object({
  version: z.number().int().positive(),
  name: technicalServiceFieldsSchema.shape.name.optional(),
  shortName: technicalServiceFieldsSchema.shape.shortName.nullable().optional(),
  nationalCode: technicalServiceFieldsSchema.shape.nationalCode.nullable().optional(),
  categoryCode: technicalServiceFieldsSchema.shape.categoryCode.nullable().optional(),
  specimenTypeCode: technicalServiceFieldsSchema.shape.specimenTypeCode.nullable().optional(),
  isPerformedInHouse: z.boolean().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  turnaroundMinutes: technicalServiceFieldsSchema.shape.turnaroundMinutes.nullable().optional(),
  resultType: technicalServiceResultTypeSchema.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  prices: z.array(examTypePriceInputSchema).optional(),
  indicators: z.array(technicalServiceIndicatorInputSchema).optional(),
});
export type UpdateTechnicalServiceRequest = z.infer<typeof updateTechnicalServiceRequestSchema>;

export const listTechnicalServicesQuerySchema = z.object({
  kind: technicalServiceKindSchema.optional(),
  search: z.string().trim().min(1).optional(),
  categoryCode: z.string().min(1).optional(),
  /** Lọc "phòng khám tự làm" (true) hay "chỉ định ra ngoài" (false) — bỏ trống = cả hai. */
  inHouse: z.enum(['true', 'false']).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListTechnicalServicesQuery = z.infer<typeof listTechnicalServicesQuerySchema>;

export const technicalServicePriceItemSchema = examTypePriceInputSchema.and(z.object({ id: z.string().uuid() }));
export type TechnicalServicePriceItem = z.infer<typeof technicalServicePriceItemSchema>;

/** Giá đang hiệu lực HÔM NAY (theo giờ Việt Nam) — mỗi Loại giá một dòng. */
export const technicalServiceCurrentPriceSchema = z.object({
  priceTypeCode: z.string(),
  unitCode: z.string(),
  amount: z.number().int().nonnegative(),
});
export type TechnicalServiceCurrentPrice = z.infer<typeof technicalServiceCurrentPriceSchema>;

export const technicalServiceItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  nationalCode: z.string().nullable(),
  serviceKind: technicalServiceKindSchema,
  categoryCode: z.string().nullable(),
  specimenTypeCode: z.string().nullable(),
  isPerformedInHouse: z.boolean(),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  turnaroundMinutes: z.number().int().nullable(),
  resultType: technicalServiceResultTypeSchema,
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
  currentPrices: z.array(technicalServiceCurrentPriceSchema),
  indicatorCount: z.number().int().nonnegative(),
});
export type TechnicalServiceItem = z.infer<typeof technicalServiceItemSchema>;

export const technicalServiceIndicatorItemSchema = z.object({
  id: z.string().uuid(),
  indicatorId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  abbreviation: z.string().nullable(),
  unit: z.string().nullable(),
  sortOrder: z.number().int(),
  interpretationText: z.string().nullable(),
});
export type TechnicalServiceIndicatorItem = z.infer<typeof technicalServiceIndicatorItemSchema>;

export const technicalServiceDetailSchema = technicalServiceItemSchema.extend({
  prices: z.array(technicalServicePriceItemSchema),
  indicators: z.array(technicalServiceIndicatorItemSchema),
});
export type TechnicalServiceDetail = z.infer<typeof technicalServiceDetailSchema>;

export const listTechnicalServicesResponseSchema = z.object({
  items: z.array(technicalServiceItemSchema),
  /** Đếm theo loại — phục vụ khung "Nhóm dịch vụ" bên trái (không phụ thuộc bộ lọc `kind`/`search` đang chọn). */
  counts: z.object({
    LAB: z.number().int().nonnegative(),
    IMAGING: z.number().int().nonnegative(),
    FUNCTIONAL: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});
export type ListTechnicalServicesResponse = z.infer<typeof listTechnicalServicesResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Chỉ số xét nghiệm + khoảng tham chiếu
// ---------------------------------------------------------------------------------------------

/**
 * Một dòng khoảng tham chiếu theo (giới tính × khoảng tuổi NĂM, gồm cả hai đầu). `displayText` là chữ IN trên
 * phiếu ("< 0.03", "Âm tính", hoặc nhiều dòng kiểu HbA1c); bỏ trống thì tự sinh từ ngưỡng. Với chỉ số TEXT/CHOICE
 * dùng `normalText` (so khớp thay vì so ngưỡng).
 */
export const labIndicatorReferenceInputSchema = z
  .object({
    sex: labReferenceSexSchema.default('ANY'),
    ageFromYears: z.number().int().min(0).max(150).default(0),
    /** Bỏ trống = không giới hạn trên. */
    ageToYears: z.number().int().min(0).max(150).optional(),
    lowValue: z.number().finite().optional(),
    highValue: z.number().finite().optional(),
    lowInclusive: z.boolean().default(true),
    highInclusive: z.boolean().default(true),
    normalText: z.string().trim().max(200).optional(),
    displayText: z.string().max(1000).optional(),
    note: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.ageToYears !== undefined && v.ageToYears < v.ageFromYears) {
      ctx.addIssue({ code: 'custom', path: ['ageToYears'], message: 'Tuổi đến phải lớn hơn hoặc bằng Tuổi từ' });
    }
    if (v.lowValue !== undefined && v.highValue !== undefined && v.lowValue > v.highValue) {
      ctx.addIssue({ code: 'custom', path: ['highValue'], message: 'Ngưỡng cao phải lớn hơn hoặc bằng Ngưỡng thấp' });
    }
  });
export type LabIndicatorReferenceInput = z.infer<typeof labIndicatorReferenceInputSchema>;

export const labIndicatorReferenceItemSchema = z.object({
  id: z.string().uuid(),
  sex: labReferenceSexSchema,
  ageFromYears: z.number().int(),
  ageToYears: z.number().int().nullable(),
  lowValue: z.number().nullable(),
  highValue: z.number().nullable(),
  lowInclusive: z.boolean(),
  highInclusive: z.boolean(),
  normalText: z.string().nullable(),
  displayText: z.string().nullable(),
  note: z.string().nullable(),
});
export type LabIndicatorReferenceItem = z.infer<typeof labIndicatorReferenceItemSchema>;

const labIndicatorFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  abbreviation: z.string().trim().max(50).optional(),
  unit: z.string().trim().max(50).optional(),
  valueType: labIndicatorValueTypeSchema.default('NUMBER'),
  decimals: z.number().int().min(0).max(6).optional(),
  /** Danh sách lựa chọn — chỉ dùng khi `valueType='CHOICE'`. */
  choiceOptions: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export const createLabIndicatorRequestSchema = labIndicatorFieldsSchema
  .extend({ references: z.array(labIndicatorReferenceInputSchema).optional() })
  .superRefine((v, ctx) => {
    if (v.valueType === 'CHOICE' && (v.choiceOptions === undefined || v.choiceOptions.length < 2)) {
      ctx.addIssue({ code: 'custom', path: ['choiceOptions'], message: 'Chỉ số kiểu Chọn cần ít nhất 2 lựa chọn' });
    }
  });
export type CreateLabIndicatorRequest = z.infer<typeof createLabIndicatorRequestSchema>;

export const updateLabIndicatorRequestSchema = z.object({
  version: z.number().int().positive(),
  name: labIndicatorFieldsSchema.shape.name.optional(),
  abbreviation: labIndicatorFieldsSchema.shape.abbreviation.nullable().optional(),
  unit: labIndicatorFieldsSchema.shape.unit.nullable().optional(),
  valueType: labIndicatorValueTypeSchema.optional(),
  decimals: labIndicatorFieldsSchema.shape.decimals.nullable().optional(),
  choiceOptions: labIndicatorFieldsSchema.shape.choiceOptions.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  /** `undefined` = không đụng; mảng = thay TOÀN BỘ khoảng tham chiếu. */
  references: z.array(labIndicatorReferenceInputSchema).optional(),
});
export type UpdateLabIndicatorRequest = z.infer<typeof updateLabIndicatorRequestSchema>;

export const listLabIndicatorsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListLabIndicatorsQuery = z.infer<typeof listLabIndicatorsQuerySchema>;

export const labIndicatorItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  abbreviation: z.string().nullable(),
  unit: z.string().nullable(),
  valueType: labIndicatorValueTypeSchema,
  decimals: z.number().int().nullable(),
  choiceOptions: z.array(z.string()).nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
  referenceCount: z.number().int().nonnegative(),
  /** Số dịch vụ đang dùng chỉ số này. */
  serviceCount: z.number().int().nonnegative(),
});
export type LabIndicatorItem = z.infer<typeof labIndicatorItemSchema>;

export const labIndicatorDetailSchema = labIndicatorItemSchema.extend({
  references: z.array(labIndicatorReferenceItemSchema),
});
export type LabIndicatorDetail = z.infer<typeof labIndicatorDetailSchema>;

export const listLabIndicatorsResponseSchema = z.object({ items: z.array(labIndicatorItemSchema) });
export type ListLabIndicatorsResponse = z.infer<typeof listLabIndicatorsResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Mẫu kết quả
// ---------------------------------------------------------------------------------------------

/**
 * Lời Mô tả / Kết luận điền sẵn, DÙNG CHUNG toàn phòng khám. KHÔNG chứa giá trị chỉ số xét nghiệm — từng thông số
 * luôn nhập tay. Điền xong vẫn sửa được (không khoá), nên mẫu chỉ là điểm bắt đầu.
 */
export const createResultTemplateRequestSchema = z
  .object({
    technicalServiceId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    descriptionText: z.string().max(10000).optional(),
    conclusionText: z.string().max(5000).optional(),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((v) => (v.descriptionText ?? '').trim() !== '' || (v.conclusionText ?? '').trim() !== '', {
    message: 'Mẫu phải có Mô tả hoặc Kết luận',
    path: ['conclusionText'],
  });
export type CreateResultTemplateRequest = z.infer<typeof createResultTemplateRequestSchema>;

export const updateResultTemplateRequestSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  descriptionText: z.string().max(10000).nullable().optional(),
  conclusionText: z.string().max(5000).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateResultTemplateRequest = z.infer<typeof updateResultTemplateRequestSchema>;

export const listResultTemplatesQuerySchema = z.object({
  technicalServiceId: z.string().uuid().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListResultTemplatesQuery = z.infer<typeof listResultTemplatesQuerySchema>;

export const resultTemplateItemSchema = z.object({
  id: z.string().uuid(),
  technicalServiceId: z.string().uuid(),
  name: z.string(),
  descriptionText: z.string().nullable(),
  conclusionText: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type ResultTemplateItem = z.infer<typeof resultTemplateItemSchema>;

export const listResultTemplatesResponseSchema = z.object({ items: z.array(resultTemplateItemSchema) });
export type ListResultTemplatesResponse = z.infer<typeof listResultTemplatesResponseSchema>;
