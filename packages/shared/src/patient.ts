import { z } from 'zod';

/**
 * Hồ sơ hành chính bệnh nhân (S2-01, PAT-01) — xem .claude/docs/data-model.md,
 * .claude/docs/clinical-workflow.md mục "Edge case cần xử lý đúng" (CCCD tuỳ chọn).
 */
export const PATIENT_GENDERS = ['male', 'female', 'other'] as const;
export const patientGenderSchema = z.enum(PATIENT_GENDERS);
export type PatientGender = z.infer<typeof patientGenderSchema>;

/**
 * Địa chỉ — cấu trúc tối thiểu cho v1 (chưa dùng mã địa giới hành chính chuẩn, xem
 * docs/product/future-modules-reference.md mục 2.1, để dành cho v3+ khi làm XML BHYT).
 */
export const patientAddressSchema = z.object({
  street: z.string().min(1).optional(),
  ward: z.string().min(1).optional(),
  district: z.string().min(1).optional(),
  province: z.string().min(1).optional(),
});
export type PatientAddress = z.infer<typeof patientAddressSchema>;

export const createPatientRequestSchema = z.object({
  fullName: z.string().min(1),
  dob: z.string().date(),
  gender: patientGenderSchema,
  phone: z.string().min(8).max(15),
  nationalId: z.string().min(9).max(12).optional(),
  address: patientAddressSchema.optional(),
  allergyNote: z.string().optional(),
});
export type CreatePatientRequest = z.infer<typeof createPatientRequestSchema>;

/** Sửa hồ sơ — bắt buộc gửi kèm `version` đang có ở client cho optimistic locking. */
export const updatePatientRequestSchema = createPatientRequestSchema.partial().extend({
  version: z.number().int().positive(),
});
export type UpdatePatientRequest = z.infer<typeof updatePatientRequestSchema>;

/** Dòng trong danh sách — không kèm CCCD đầy đủ, chỉ báo có/không để tránh giải mã hàng loạt. */
export const patientSummarySchema = z.object({
  id: z.string().uuid(),
  patientCode: z.string(),
  fullName: z.string(),
  dob: z.string(),
  gender: patientGenderSchema,
  phone: z.string(),
  hasNationalId: z.boolean(),
  version: z.number().int(),
});
export type PatientSummary = z.infer<typeof patientSummarySchema>;

/** Chi tiết một hồ sơ — kèm CCCD đã giải mã (chỉ khi xem đúng 1 bản ghi, không phải danh sách). */
export const patientDetailSchema = patientSummarySchema.extend({
  nationalId: z.string().nullable(),
  address: patientAddressSchema.nullable(),
  allergyNote: z.string().nullable(),
  mergedIntoId: z.string().uuid().nullable(),
});
export type PatientDetail = z.infer<typeof patientDetailSchema>;

/** Phân trang cursor — không dùng offset, xem .claude/docs/architecture.md. */
export const listPatientsResponseSchema = z.object({
  items: z.array(patientSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListPatientsResponse = z.infer<typeof listPatientsResponseSchema>;

/**
 * `q` (PAT-02) — tìm theo tên (không dấu), số điện thoại, hoặc mã bệnh nhân, cùng một ô nhập.
 * Không phân biệt tìm theo trường nào — service tự thử khớp cả ba theo kiểu dữ liệu của `q`.
 */
export const listPatientsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().min(1).max(100).optional(),
});
export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;
