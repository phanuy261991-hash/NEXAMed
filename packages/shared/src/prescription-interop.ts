import { z } from 'zod';
import { prescriptionKindSchema } from './business-code';

/**
 * Liên thông đơn thuốc quốc gia (Quyết định 808/QĐ-BYT) — giai đoạn 3 của mã đơn thuốc Bộ Y tế (docs/DECISIONS.md #242, mockup 8d).
 * Đợt này CHỈ có cấu hình: công tắc tổng, địa chỉ cổng, mã + mật khẩu liên thông của cơ sở (theo chi nhánh) và của bác sĩ (chung cả công ty).
 * Chưa kết nối cổng thật (chờ đơn vị vận hành trả lời, xem `docs/product/prescription-interop-questions.md`).
 */

/** Địa chỉ máy chủ theo Quyết định 808/QĐ-BYT. */
export const DEFAULT_INTEROP_GATEWAY_URL = 'https://api.donthuocquocgia.vn';

/** HTTPS bắt buộc (mã + mật khẩu liên thông đi qua đường này); chỉ cho phép http với máy cục bộ để thử. */
const gatewayUrlSchema = z
  .string()
  .trim()
  .max(300)
  .url('Địa chỉ máy chủ không hợp lệ.')
  .refine((value) => /^https:\/\//i.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(value), 'Địa chỉ phải bắt đầu bằng https://.')
  .transform((value) => value.replace(/\/+$/, ''));

export const prescriptionInteropSettingsSchema = z.object({
  /** Công tắc tổng "Có liên thông" — mặc định TẮT; tắt thì ẩn mọi thứ liên thông (theo cả công ty). */
  enabled: z.boolean(),
  /** "Gửi đơn lên cổng" — mặc định TẮT (đơn ký xong chỉ xếp hàng chờ, chưa gửi); chỉ có nghĩa khi `enabled`. */
  sendEnabled: z.boolean(),
  gatewayUrl: z.string(),
  /** Thời gian chờ mỗi lần gọi cổng (giây). */
  timeoutSeconds: z.number().int().min(5).max(120),
  /** Số lần thử lại tối đa khi lỗi mạng. */
  maxRetries: z.number().int().min(0).max(10),
});
export type PrescriptionInteropSettings = z.infer<typeof prescriptionInteropSettingsSchema>;

export const DEFAULT_PRESCRIPTION_INTEROP_SETTINGS: PrescriptionInteropSettings = {
  enabled: false,
  sendEnabled: false,
  gatewayUrl: DEFAULT_INTEROP_GATEWAY_URL,
  timeoutSeconds: 30,
  maxRetries: 5,
};

export const updatePrescriptionInteropSettingsRequestSchema = z
  .object({
    enabled: z.boolean(),
    sendEnabled: z.boolean(),
    gatewayUrl: gatewayUrlSchema,
    timeoutSeconds: z.number().int().min(5).max(120),
    maxRetries: z.number().int().min(0).max(10),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Không có gì để cập nhật.');
export type UpdatePrescriptionInteropSettingsRequest = z.infer<typeof updatePrescriptionInteropSettingsRequestSchema>;

/** Cấu hình + khoá nhà cung cấp phần mềm đã cài ở máy chủ chưa (chỉ trạng thái, KHÔNG bao giờ trả app-name/app-key). */
export const prescriptionInteropSettingsResponseSchema = prescriptionInteropSettingsSchema.extend({ appKeyConfigured: z.boolean() });
export type PrescriptionInteropSettingsResponse = z.infer<typeof prescriptionInteropSettingsResponseSchema>;

/** Tự-phục vụ (mọi nhân viên đã đăng nhập): chỉ đủ để màn kê đơn/menu biết có hiện phần liên thông không. */
export const prescriptionInteropStatusSchema = z.object({ enabled: z.boolean() });
export type PrescriptionInteropStatus = z.infer<typeof prescriptionInteropStatusSchema>;

/**
 * Trạng thái token đăng nhập cổng. Cổng chỉ trả token (không trả hạn) nên `expiresAt` do hệ thống tự tính = giờ nhận + 7 ngày; `EXPIRING` = còn dưới 1 ngày (sẽ tự đăng nhập lại).
 * Token KHÔNG BAO GIỜ trả về qua API — chỉ có trạng thái này.
 */
export const interopTokenStateSchema = z.object({
  status: z.enum(['NONE', 'VALID', 'EXPIRING', 'EXPIRED']),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  remainingMs: z.number().int().min(0),
});
export type InteropTokenState = z.infer<typeof interopTokenStateSchema>;

/**
 * Kết quả một thao tác gọi cổng (kiểm tra kết nối/đăng nhập cơ sở, thêm/xoá bác sĩ) — trả 200 kể cả khi cổng từ chối để giao diện hiện đúng nguyên nhân:
 * `OK`; `REJECTED` = cổng từ chối (sai mã/mật khẩu, bác sĩ chưa được thêm...; `errors` = nội dung cổng trả); `UNREACHABLE` = không kết nối được/hết thời gian chờ/cổng lỗi;
 * `NOT_CONFIGURED` = thiếu mã/mật khẩu ở phía phòng khám nên chưa gọi.
 */
export const interopActionResultSchema = z.object({
  outcome: z.enum(['OK', 'REJECTED', 'UNREACHABLE', 'NOT_CONFIGURED']),
  /** Thông báo viết sẵn tiếng Việt, hiển thị được ngay. */
  message: z.string(),
  /** Nguyên văn các lỗi cổng trả (nếu có). */
  errors: z.array(z.string()),
});
export type InteropActionResult = z.infer<typeof interopActionResultSchema>;

export const interopFacilityRowSchema = z.object({
  branchId: z.string().uuid(),
  branchName: z.string(),
  isDefault: z.boolean(),
  /** Mã liên thông cơ sở (KHÁC mã cơ sở KCB 5 chữ số của mã đơn); `null` = chưa nhập. */
  code: z.string().nullable(),
  /** Đã lưu mật khẩu chưa. Mật khẩu KHÔNG BAO GIỜ trả về. */
  hasPassword: z.boolean(),
  /** Token CƠ SỞ (dùng để thêm/xoá bác sĩ). */
  token: interopTokenStateSchema,
});
export type InteropFacilityRow = z.infer<typeof interopFacilityRowSchema>;
export const listInteropFacilitiesResponseSchema = z.object({ items: z.array(interopFacilityRowSchema) });
export type ListInteropFacilitiesResponse = z.infer<typeof listInteropFacilitiesResponseSchema>;

export const interopDoctorRowSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string(),
  /** Số chứng chỉ hành nghề (`user_account.license_no`), chỉ để nhận diện bác sĩ. */
  licenseNo: z.string().nullable(),
  code: z.string().nullable(),
  hasPassword: z.boolean(),
  /** Đã thêm bác sĩ vào cơ sở (chi nhánh đang làm việc) trên cổng chưa. */
  onGateway: z.boolean(),
  /** Token BÁC SĨ của cặp (bác sĩ, chi nhánh đang làm việc). */
  token: interopTokenStateSchema,
});
export type InteropDoctorRow = z.infer<typeof interopDoctorRowSchema>;
export const listInteropDoctorsResponseSchema = z.object({ items: z.array(interopDoctorRowSchema) });
export type ListInteropDoctorsResponse = z.infer<typeof listInteropDoctorsResponseSchema>;

/**
 * Nhập mã + mật khẩu liên thông (cơ sở hoặc bác sĩ). Mật khẩu chỉ GHI ĐÈ được (mã hoá khi lưu, không hiện lại):
 * lần đầu bắt buộc; đã có mật khẩu thì bỏ trống = giữ nguyên, chỉ đổi mã.
 */
export const saveInteropCredentialRequestSchema = z.object({
  code: z.string().trim().min(1, 'Nhập mã liên thông.').max(100),
  password: z.string().min(1).max(200).optional(),
});
export type SaveInteropCredentialRequest = z.infer<typeof saveInteropCredentialRequestSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Dữ liệu bổ sung bắt buộc khi gửi đơn (mockup 8b) + dải kiểm dữ liệu (8a) + hàng chờ gửi (8c) — docs/DECISIONS.md #242 bổ sung 17.
// ---------------------------------------------------------------------------------------------------------------------

const interopDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD.');

/** Mã số hình thức điều trị (danh mục BYT `TREATMENT_FORM`): cổng nhận giá trị số. */
export const INTEROP_TREATMENT_FORM_CODE_PATTERN = /^\d{1,9}$/;

/** Các ô bổ sung của MỘT loại đơn (C/N/H/Y). Mỗi loại chỉ dùng một phần: C = hình thức điều trị; N/H/Y = đợt dùng thuốc; Y = thêm số thang + cách sắc/uống. */
export const interopKindInfoValueSchema = z.object({
  treatmentFormCode: z.string().regex(INTEROP_TREATMENT_FORM_CODE_PATTERN, 'Mã hình thức điều trị phải là số.').nullable(),
  dosePeriodNumber: z.number().int().min(1).max(999).nullable(),
  doseFrom: interopDateSchema.nullable(),
  doseTo: interopDateSchema.nullable(),
  herbalDoses: z.number().int().min(1).max(999).nullable(),
  herbalInstruction: z.string().trim().max(1000).nullable(),
});
export type InteropKindInfoValue = z.infer<typeof interopKindInfoValueSchema>;

export const EMPTY_INTEROP_KIND_INFO: InteropKindInfoValue = {
  treatmentFormCode: null,
  dosePeriodNumber: null,
  doseFrom: null,
  doseTo: null,
  herbalDoses: null,
  herbalInstruction: null,
};

/** Một vấn đề thiếu/sai dữ liệu để gửi (kết quả `checkInteropReadiness` ở `packages/core`). `required=false` = chỉ nhắc, không chặn gửi. */
export const interopProblemSchema = z.object({
  code: z.string(),
  kind: prescriptionKindSchema,
  message: z.string(),
  required: z.boolean(),
});
export type InteropProblemDto = z.infer<typeof interopProblemSchema>;

export const INTEROP_SUBMISSION_STATUSES = ['PENDING', 'SENT', 'FAILED', 'AMENDED'] as const;
export const interopSubmissionStatusSchema = z.enum(INTEROP_SUBMISSION_STATUSES);
export type InteropSubmissionStatus = z.infer<typeof interopSubmissionStatusSchema>;

export const INTEROP_SUBMISSION_STATUS_LABEL: Record<InteropSubmissionStatus, string> = {
  PENDING: 'Chờ gửi',
  SENT: 'Đã gửi',
  FAILED: 'Lỗi',
  AMENDED: 'Đính chính, chưa gửi',
};

export const encounterInteropKindSchema = z.object({
  kind: prescriptionKindSchema,
  /** Mã đơn chuẩn; `null` khi đơn còn nháp (chưa cấp mã). */
  nationalCode: z.string().nullable(),
  /** Trạng thái hàng chờ của đơn này; `NONE` = chưa xếp hàng (đơn nháp, hoặc ký lúc công tắc liên thông đang tắt). */
  submissionStatus: z.enum(['NONE', ...INTEROP_SUBMISSION_STATUSES]),
  /** Sửa được tới khi đơn được gửi; sau `SENT`/`AMENDED` thì khoá. */
  editable: z.boolean(),
  /** Giá trị đã lưu (null = chưa nhập). */
  info: interopKindInfoValueSchema,
  /** Gợi ý tự điền cho đợt dùng thuốc (từ ngày = ngày kê, đến ngày = ngày kê + số ngày thuốc dài nhất − 1). Hệ thống dùng gợi ý khi ô chưa nhập. */
  suggested: z.object({ dosePeriodNumber: z.number().int().nullable(), doseFrom: interopDateSchema.nullable(), doseTo: interopDateSchema.nullable() }),
});
export type EncounterInteropKind = z.infer<typeof encounterInteropKindSchema>;

/** Người giám hộ (bệnh nhân dưới 72 tháng tuổi) — lấy/ghi ngược vào các trường người thân của hồ sơ bệnh nhân. */
export const encounterInteropGuardianSchema = z.object({
  fullName: z.string().nullable(),
  relationship: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  /** `version` hồ sơ bệnh nhân (khoá lạc quan khi lưu ngược). */
  patientVersion: z.number().int(),
  /** Người dùng có quyền sửa hồ sơ bệnh nhân không (không có thì ô người giám hộ chỉ đọc). */
  canEdit: z.boolean(),
});
export type EncounterInteropGuardian = z.infer<typeof encounterInteropGuardianSchema>;

export const encounterInteropInfoResponseSchema = z.object({
  /** Công tắc tổng "Có liên thông". Tắt thì web ẩn cả khối. */
  enabled: z.boolean(),
  /** Chế độ mã đơn "Chuẩn Bộ Y tế" đang bật — chưa bật thì không có đơn pháp lý nên chưa gửi được. */
  standardMode: z.boolean(),
  /** Đơn đã ký chưa. */
  signed: z.boolean(),
  kinds: z.array(encounterInteropKindSchema),
  /** `null` khi bệnh nhân từ 72 tháng tuổi trở lên. */
  guardian: encounterInteropGuardianSchema.nullable(),
  problems: z.array(interopProblemSchema),
});
export type EncounterInteropInfoResponse = z.infer<typeof encounterInteropInfoResponseSchema>;

export const saveEncounterInteropInfoRequestSchema = z.object({
  kinds: z
    .array(interopKindInfoValueSchema.extend({ kind: prescriptionKindSchema }))
    .max(4)
    .refine((list) => new Set(list.map((k) => k.kind)).size === list.length, 'Mỗi loại đơn chỉ khai một lần.'),
  guardian: z
    .object({
      fullName: z.string().trim().min(1).max(200).optional(),
      phone: z.string().trim().min(1).max(30).optional(),
      address: z.string().trim().min(1).max(500).optional(),
      patientVersion: z.number().int().positive(),
    })
    .optional(),
});
export type SaveEncounterInteropInfoRequest = z.infer<typeof saveEncounterInteropInfoRequestSchema>;

// ---- Hàng chờ gửi (8c) ----

export const listInteropSubmissionsQuerySchema = z.object({
  status: interopSubmissionStatusSchema.optional(),
  /** Lọc theo ngày ký (giờ Việt Nam), `YYYY-MM-DD`. */
  dateFrom: interopDateSchema.optional(),
  dateTo: interopDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListInteropSubmissionsQuery = z.infer<typeof listInteropSubmissionsQuerySchema>;

export const interopSubmissionRowSchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  nationalCode: z.string(),
  kind: prescriptionKindSchema,
  doctorName: z.string().nullable(),
  signedAt: z.string(),
  status: interopSubmissionStatusSchema,
  attempts: z.number().int(),
  /** Số lần thử tối đa đang cấu hình (để hiện "thử 3/5 lần"). */
  maxRetries: z.number().int(),
  lastAttemptAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  lastHttpStatus: z.number().int().nullable(),
  /** Nguyên văn các lỗi cổng trả (hoặc lý do chưa gửi được). */
  errors: z.array(z.string()),
  /** Số mục dữ liệu còn thiếu để gửi (`null` khi đã gửi — không cần tính). */
  missingCount: z.number().int().nullable(),
  /** Nội dung từng mục còn thiếu (cho hộp "Xem"). */
  missing: z.array(interopProblemSchema),
});
export type InteropSubmissionRow = z.infer<typeof interopSubmissionRowSchema>;

export const listInteropSubmissionsResponseSchema = z.object({
  items: z.array(interopSubmissionRowSchema),
  total: z.number().int(),
  /** Công tắc "Gửi đơn lên cổng" — tắt thì "Gửi ngay"/"Gửi lại" không dùng được. */
  sendEnabled: z.boolean(),
});
export type ListInteropSubmissionsResponse = z.infer<typeof listInteropSubmissionsResponseSchema>;

/** Kết quả "Gửi ngay"/"Gửi lại": dòng sau khi xử lý + thông báo viết sẵn. */
export const interopSubmissionActionResponseSchema = z.object({
  row: interopSubmissionRowSchema,
  outcome: z.enum(['SENT', 'REJECTED', 'UNREACHABLE', 'NOT_CONFIGURED', 'NOT_READY']),
  message: z.string(),
});
export type InteropSubmissionActionResponse = z.infer<typeof interopSubmissionActionResponseSchema>;
