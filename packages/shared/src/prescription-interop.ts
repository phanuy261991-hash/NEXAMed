import { z } from 'zod';

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
