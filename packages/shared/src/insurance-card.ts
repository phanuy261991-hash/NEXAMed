import { z } from 'zod';

/**
 * Thẻ bảo hiểm y tế (S2-04, docs/DECISIONS.md #243, mockup https://claude.ai/artifact/FAi8GCjycj94s6EwTT9t6b đã chốt
 * 21/10/2026). v1 CHỈ lưu và hiển thị — không tính chi trả, không nối cổng giám định. Mọi thứ nằm sau công tắc
 * "Áp dụng BHYT" (`ClinicSettings.insuranceEnabled`, mặc định TẮT, chung cả công ty).
 *
 * Số thẻ có hai định dạng cùng tồn tại: thẻ MỚI 12 chữ số, thẻ CŨ 15 ký tự gồm chữ và số. Kiểu thẻ là giá trị TÍNH RA
 * từ số thẻ (`detectInsuranceCardKind` ở `@nexamed/core`), không lưu cột riêng. Sai định dạng = cảnh báo mềm, vẫn lưu.
 */

export const INSURANCE_CARD_KINDS = ['NEW_12', 'OLD_15', 'UNKNOWN'] as const;
export const insuranceCardKindSchema = z.enum(INSURANCE_CARD_KINDS);
export type InsuranceCardKindValue = z.infer<typeof insuranceCardKindSchema>;

export const INSURANCE_CARD_KIND_LABELS: Record<InsuranceCardKindValue, string> = {
  NEW_12: 'Thẻ mới · 12 số',
  OLD_15: 'Thẻ cũ · 15 ký tự',
  UNKNOWN: 'Chưa nhận diện được',
};

export const INSURANCE_CARD_VALIDITIES = ['VALID', 'UNKNOWN_EXPIRY', 'EXPIRED', 'NOT_STARTED'] as const;
export const insuranceCardValiditySchema = z.enum(INSURANCE_CARD_VALIDITIES);
export type InsuranceCardValidityValue = z.infer<typeof insuranceCardValiditySchema>;

export const INSURANCE_CARD_VALIDITY_LABELS: Record<InsuranceCardValidityValue, string> = {
  VALID: 'Còn hiệu lực',
  UNKNOWN_EXPIRY: 'Chưa rõ hạn',
  EXPIRED: 'Hết hạn',
  NOT_STARTED: 'Chưa hiệu lực',
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD');

/** Số thẻ người dùng gõ: chuẩn hoá (bỏ khoảng trắng/gạch nối, chữ hoa) ở service; ở đây chỉ chặn rỗng và độ dài vô lý. */
const cardNoInput = z.string().trim().min(1, 'Vui lòng nhập số thẻ').max(24, 'Số thẻ quá dài');
const facilityCode = z.string().regex(/^\d{5}$/, 'Mã cơ sở KCB gồm 5 chữ số');
const facilityName = z.string().trim().min(1).max(200);
const benefitRate = z.number().int().min(0).max(100);

const cardFieldsShape = {
  validFrom: isoDate.nullish(),
  validTo: isoDate.nullish(),
  facilityCode: facilityCode.nullish(),
  facilityName: facilityName.nullish(),
  benefitRate: benefitRate.nullish(),
};

export const createInsuranceCardRequestSchema = z
  .object({ cardNo: cardNoInput, ...cardFieldsShape })
  .refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, {
    message: 'Hạn thẻ phải sau hoặc bằng ngày bắt đầu hiệu lực',
    path: ['validTo'],
  });
export type CreateInsuranceCardRequest = z.infer<typeof createInsuranceCardRequestSchema>;

/** Sửa thẻ: gửi đủ các trường cần đổi (trường vắng = giữ nguyên, `null` = xoá giá trị); `version` bắt buộc cho optimistic locking. */
export const updateInsuranceCardRequestSchema = z
  .object({ cardNo: cardNoInput.optional(), ...cardFieldsShape, version: z.number().int().positive() })
  .refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, {
    message: 'Hạn thẻ phải sau hoặc bằng ngày bắt đầu hiệu lực',
    path: ['validTo'],
  });
export type UpdateInsuranceCardRequest = z.infer<typeof updateInsuranceCardRequestSchema>;

export const removeInsuranceCardQuerySchema = z.object({ version: z.coerce.number().int().positive() });
export type RemoveInsuranceCardQuery = z.infer<typeof removeInsuranceCardQuerySchema>;

export const insuranceCardPhotoSideSchema = z.enum(['front', 'back']);
export type InsuranceCardPhotoSide = z.infer<typeof insuranceCardPhotoSideSchema>;
export const uploadInsuranceCardPhotoFormSchema = z.object({
  side: insuranceCardPhotoSideSchema,
  version: z.coerce.number().int().positive(),
});

export const insuranceCardSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  /** Số thẻ ĐÃ chuẩn hoá, hiện rõ cho người có quyền xem bệnh nhân (chủ dự án chốt, #243 mục 5). */
  cardNo: z.string(),
  /** Số thẻ KHÔNG giải mã được (khoá hệ thống không khớp dữ liệu, #262): `cardNo` rỗng, giao diện hiện "Không đọc được". */
  cardNoUnreadable: z.boolean(),
  kind: insuranceCardKindSchema,
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  validity: insuranceCardValiditySchema,
  facilityCode: z.string().nullable(),
  facilityName: z.string().nullable(),
  benefitRate: z.number().int().nullable(),
  photoFrontUrl: z.string().nullable(),
  photoBackUrl: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type InsuranceCard = z.infer<typeof insuranceCardSchema>;

export const listInsuranceCardsResponseSchema = z.object({
  /** Công tắc "Áp dụng BHYT" của công ty — web ẩn hết khi tắt. */
  enabled: z.boolean(),
  items: z.array(insuranceCardSchema),
  /** Thẻ gợi ý cho lượt khám mới (còn hiệu lực mới nhất, không có thì chưa rõ hạn mới nhất); null = tự chi trả. */
  suggestedCardId: z.string().uuid().nullable(),
});
export type ListInsuranceCardsResponse = z.infer<typeof listInsuranceCardsResponseSchema>;

export const INSURANCE_CARD_WARNINGS = ['UNRECOGNIZED_FORMAT', 'DUPLICATE_CARD_NO'] as const;
export const insuranceCardWarningSchema = z.enum(INSURANCE_CARD_WARNINGS);
export type InsuranceCardWarning = z.infer<typeof insuranceCardWarningSchema>;

export const saveInsuranceCardResponseSchema = z.object({
  card: insuranceCardSchema,
  /** Cảnh báo mềm — thẻ ĐÃ được lưu. */
  warnings: z.array(insuranceCardWarningSchema),
});
export type SaveInsuranceCardResponse = z.infer<typeof saveInsuranceCardResponseSchema>;

/** Lý do lượt khám ghi tự chi trả. */
export const INSURANCE_SELF_PAY_REASONS = ['DISABLED', 'NO_CARD', 'EXPIRED', 'NOT_STARTED', 'DECLINED'] as const;
export const insuranceSelfPayReasonSchema = z.enum(INSURANCE_SELF_PAY_REASONS);
export type InsuranceSelfPayReason = z.infer<typeof insuranceSelfPayReasonSchema>;

/**
 * Bản CHỤP thẻ lưu trên `encounter.insurance_snapshot` (JSONB). Số thẻ lưu MÃ HOÁ (`cardNoEnc`, base64 của AES-256-GCM)
 * — không bao giờ để plaintext trong JSONB; API giải mã khi trả ra (`encounterInsuranceSchema`). Bản ghi cũ chỉ có
 * `{ selfPay: true }` vẫn hợp lệ.
 */
export const storedInsuranceSnapshotSchema = z.object({
  selfPay: z.boolean(),
  reason: insuranceSelfPayReasonSchema.optional(),
  cardId: z.string().uuid().optional(),
  cardNoEnc: z.string().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  facilityCode: z.string().nullable().optional(),
  facilityName: z.string().nullable().optional(),
  benefitRate: z.number().int().nullable().optional(),
});
export type StoredInsuranceSnapshot = z.infer<typeof storedInsuranceSnapshotSchema>;

/** Thông tin BHYT của MỘT lượt khám trả ra cho giao diện/bản in (đã giải mã). Công tắc tắt thì API trả `null`. */
export const encounterInsuranceSchema = z.object({
  selfPay: z.boolean(),
  reason: insuranceSelfPayReasonSchema.nullable(),
  cardNo: z.string().nullable(),
  /** Lượt khám có thẻ nhưng số thẻ KHÔNG giải mã được (#262): `cardNo` null, giao diện KHÔNG coi là tự chi trả. */
  cardNoUnreadable: z.boolean(),
  kind: insuranceCardKindSchema.nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  facilityCode: z.string().nullable(),
  facilityName: z.string().nullable(),
  benefitRate: z.number().int().nullable(),
});
export type EncounterInsurance = z.infer<typeof encounterInsuranceSchema>;

/** Nhãn gọn ở hàng đợi/danh sách (không chứa số thẻ). */
export const encounterInsuranceBadgeSchema = z.object({
  selfPay: z.boolean(),
  benefitRate: z.number().int().nullable(),
});
export type EncounterInsuranceBadge = z.infer<typeof encounterInsuranceBadgeSchema>;

/**
 * Thẻ dùng cho lượt khám lúc Tiếp nhận: `undefined` = tự gợi ý (thẻ còn hiệu lực mới nhất), `null` = "Không dùng thẻ"
 * (tự chi trả), uuid = đúng thẻ đó (phải thuộc bệnh nhân).
 */
export const insuranceCardChoiceSchema = z.string().uuid().nullable().optional();

export const insuranceStatusSchema = z.object({ enabled: z.boolean() });
export type InsuranceStatus = z.infer<typeof insuranceStatusSchema>;
