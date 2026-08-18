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
 * `neighborhood` (Khu phố) thêm ở docs/DECISIONS.md #034. `district` (Quận/Huyện) giữ lại để
 * tương thích ngược với dữ liệu cũ nhưng không còn input trên UI (đã sáp nhập 2 cấp Tỉnh→Xã).
 */
export const patientAddressSchema = z.object({
  street: z.string().min(1).optional(),
  ward: z.string().min(1).optional(),
  neighborhood: z.string().min(1).optional(),
  district: z.string().min(1).optional(),
  province: z.string().min(1).optional(),
});
export type PatientAddress = z.infer<typeof patientAddressSchema>;

/**
 * Mở rộng hồ sơ hành chính (docs/DECISIONS.md #034). `occupation` là text tự do (không danh mục
 * DB, thiếu nguồn dữ liệu chính thức). `ethnicity`/`nationality` đảo ngược #034 — nay là mã
 * (`code`) tham chiếu `reference_catalog` (ví dụ "VNM", "1"), chọn qua dropdown ở web; vẫn khai
 * `z.string()` tự do ở tầng này (không validate khớp danh mục) để không chặn sửa hồ sơ cũ có
 * giá trị dạng tên tự do (ví dụ "Việt Nam") lưu trước khi đổi. `insuranceNumber` độc lập với
 * module Thẻ BHYT (`insurance_card`, S2-04 chưa làm) — chỉ lưu/hiển thị, không tính chi trả.
 */
const patientRequestFieldsSchema = z.object({
  fullName: z.string().min(1),
  dob: z.string().date(),
  gender: patientGenderSchema,
  phone: z.string().min(8).max(15),
  nationalId: z.string().min(9).max(12).optional(),
  nationalIdIssuedAt: z.string().date().optional(),
  nationalIdIssuedPlace: z.string().min(1).optional(),
  ethnicity: z.string().min(1).optional(),
  nationality: z.string().min(1).optional(),
  occupation: z.string().min(1).optional(),
  insuranceNumber: z.string().min(1).optional(),
  address: patientAddressSchema.optional(),
  allergyNote: z.string().optional(),
  relativeFullName: z.string().min(1).optional(),
  relativeRelationship: z.string().min(1).optional(),
  relativePhone: z.string().min(1).optional(),
  relativeAddress: z.string().min(1).optional(),
});

/** Ngưỡng tuổi trưởng thành — dùng cho ràng buộc CCCD bắt buộc bên dưới (docs/DECISIONS.md #035). */
const ADULT_AGE_THRESHOLD = 18;

/** Tuổi tròn năm tính từ `dob` (chuỗi `YYYY-MM-DD`) tới `now`. Tham số `now` chỉ để test tái lập được. */
export function calculateAgeYears(dob: string, now: Date = new Date()): number {
  const birth = new Date(dob);
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * PAT-01 mở rộng (docs/DECISIONS.md #035, yêu cầu chủ dự án): bệnh nhân từ 18 tuổi bắt buộc có
 * CCCD; dưới 18 vẫn tuỳ chọn (khớp edge case "trẻ em/người không giấy tờ" đã có ở
 * .claude/docs/clinical-workflow.md). **Chỉ áp cho TẠO MỚI** — không áp lại cho sửa hồ sơ (tránh
 * chặn sửa các hồ sơ người lớn đã tạo trước khi có ràng buộc này mà chưa có CCCD).
 */
export const createPatientRequestSchema = patientRequestFieldsSchema.superRefine((data, ctx) => {
  if (calculateAgeYears(data.dob) >= ADULT_AGE_THRESHOLD && !data.nationalId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nationalId'],
      message: `Bệnh nhân từ ${ADULT_AGE_THRESHOLD} tuổi trở lên bắt buộc nhập CCCD/CMND.`,
    });
  }
});
export type CreatePatientRequest = z.infer<typeof createPatientRequestSchema>;

/** Sửa hồ sơ — bắt buộc gửi kèm `version` đang có ở client cho optimistic locking. */
export const updatePatientRequestSchema = patientRequestFieldsSchema.partial().extend({
  version: z.number().int().positive(),
});
export type UpdatePatientRequest = z.infer<typeof updatePatientRequestSchema>;

/**
 * Dòng trong danh sách — không kèm CCCD đầy đủ. `nationalIdMasked` (docs/DECISIONS.md #034, cột
 * CCCD ở màn hình Danh sách bệnh nhân) chỉ lộ 4 số cuối ("••••1234"), không phải giá trị giải mã
 * đầy đủ như `patientDetailSchema.nationalId` — vẫn giữ tinh thần "tránh lộ nguyên CCCD trên màn
 * hình dùng chung" dù server phải giải mã để cắt lấy 4 số cuối.
 */
export const patientSummarySchema = z.object({
  id: z.string().uuid(),
  patientCode: z.string(),
  fullName: z.string(),
  dob: z.string(),
  gender: patientGenderSchema,
  phone: z.string(),
  hasNationalId: z.boolean(),
  nationalIdMasked: z.string().nullable(),
  address: patientAddressSchema.nullable(),
  version: z.number().int(),
});
export type PatientSummary = z.infer<typeof patientSummarySchema>;

/**
 * Chi tiết một hồ sơ — kèm CCCD đã giải mã (chỉ khi xem đúng 1 bản ghi, không phải danh sách).
 * `photoUrl`: signed URL có hạn tính tại thời điểm response (không phải giá trị lưu DB — DB chỉ
 * giữ `photoKey`), null khi chưa có ảnh. Xem `apps/api/src/infrastructure/storage/signed-url.ts`.
 */
export const patientDetailSchema = patientSummarySchema.extend({
  nationalId: z.string().nullable(),
  nationalIdIssuedAt: z.string().nullable(),
  nationalIdIssuedPlace: z.string().nullable(),
  ethnicity: z.string().nullable(),
  nationality: z.string().nullable(),
  occupation: z.string().nullable(),
  insuranceNumber: z.string().nullable(),
  address: patientAddressSchema.nullable(),
  allergyNote: z.string().nullable(),
  relativeFullName: z.string().nullable(),
  relativeRelationship: z.string().nullable(),
  relativePhone: z.string().nullable(),
  relativeAddress: z.string().nullable(),
  photoUrl: z.string().nullable(),
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

/**
 * PAT-03 — chống trùng "mềm": gọi TRƯỚC khi `POST /patients` để cảnh báo nghi trùng tên + ngày
 * sinh (trùng CCCD đã chặn cứng bằng DB constraint ở S2-01, không cần endpoint này). Không chặn
 * tạo mới — chỉ trả danh sách hồ sơ đã có khớp để client tự quyết định tiếp tục hay không.
 */
export const checkPatientDuplicateQuerySchema = z.object({
  fullName: z.string().min(1),
  dob: z.string().date(),
});
export type CheckPatientDuplicateQuery = z.infer<typeof checkPatientDuplicateQuerySchema>;

export const checkPatientDuplicateResponseSchema = z.object({
  items: z.array(patientSummarySchema),
});
export type CheckPatientDuplicateResponse = z.infer<typeof checkPatientDuplicateResponseSchema>;

/**
 * Tra trùng SĐT — KHÁC PAT-03 (không chặn/không phải "nghi trùng hồ sơ"): số điện thoại được
 * phép trùng thật sự (ví dụ một phụ huynh dùng chung SĐT cho nhiều con), yêu cầu chủ dự án. Dùng
 * ở 2 nơi: (1) form Thêm/Sửa hồ sơ — cảnh báo mềm liệt kê tên+mã đã dùng SĐT này, không chặn lưu;
 * (2) trang Tiếp nhận — liệt kê để lễ tân CHỌN đúng khách hàng khi tra theo SĐT đã đặt lịch.
 * Khớp CHÍNH XÁC số điện thoại (không phải `startsWith` như tìm kiếm PAT-02) — dùng index có sẵn
 * `(tenant_id, phone)`. `excludePatientId`: bỏ qua chính hồ sơ đang sửa (tránh tự cảnh báo với
 * chính mình khi không đổi SĐT).
 */
export const patientByPhoneQuerySchema = z.object({
  phone: z.string().min(8).max(15),
  excludePatientId: z.string().uuid().optional(),
});
export type PatientByPhoneQuery = z.infer<typeof patientByPhoneQuerySchema>;

export const patientByPhoneResponseSchema = z.object({
  items: z.array(patientSummarySchema),
});
export type PatientByPhoneResponse = z.infer<typeof patientByPhoneResponseSchema>;

/**
 * Tra trùng CCCD — dùng ở màn hình "Tiếp nhận bệnh nhân" (mockup đã duyệt): gõ CCCD tự tra, khớp
 * thì tự điền + khoá 4 field định danh (CCCD/Mã BN/Họ tên/Ngày sinh). KHÁC `by-phone`: CCCD chặn
 * trùng cứng bằng DB constraint C3 (`.claude/docs/data-model.md`) nên tối đa 1 kết quả — vẫn trả
 * `items` mảng (cùng hình dạng `patientByPhoneResponseSchema`) để nơi gọi dùng chung một kiểu xử
 * lý. Băm ở tầng service bằng `hashForLookup` đã có (cùng cơ chế `national_id_hash` lúc tạo/sửa),
 * không lộ CCCD người khác qua endpoint này.
 */
export const patientByNationalIdQuerySchema = z.object({
  nationalId: z.string().min(9).max(12),
  excludePatientId: z.string().uuid().optional(),
});
export type PatientByNationalIdQuery = z.infer<typeof patientByNationalIdQuerySchema>;

export const patientByNationalIdResponseSchema = z.object({
  items: z.array(patientSummarySchema),
});
export type PatientByNationalIdResponse = z.infer<typeof patientByNationalIdResponseSchema>;
