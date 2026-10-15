import { z } from 'zod';

/**
 * Khu quản trị nền tảng SaaS (docs/DECISIONS.md #237) — hợp đồng giữa máy chủ và web. CHỈ có ở chế độ SaaS; chỉ số đếm và thông tin vận hành, KHÔNG có dữ liệu bệnh nhân.
 */

/**
 * `GET /public/tenant-context` — công khai: web hỏi "địa chỉ này là công ty nào" trước khi hiện màn đăng nhập (chế độ SaaS, không có `tenantId` trong `config.json`).
 * `kind: 'platform'` = tên miền phụ của khu quản trị nền tảng. Địa chỉ không ứng với công ty nào → máy chủ trả 404 (`TENANT_NOT_FOUND`).
 */
export const tenantContextResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tenant'),
    tenantId: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    suspended: z.boolean(),
  }),
  z.object({ kind: z.literal('platform') }),
]);
export type TenantContextResponse = z.infer<typeof tenantContextResponseSchema>;

// ---- Đăng nhập người vận hành: mật khẩu rồi OTP ----
export const platformLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});
export type PlatformLoginRequest = z.infer<typeof platformLoginRequestSchema>;

/** Bước 1 đúng mật khẩu → mã tạm (hiệu lực vài phút) chỉ dùng được cho bước OTP. */
export const platformLoginResponseSchema = z.object({ mfaToken: z.string(), expiresIn: z.number().int() });
export type PlatformLoginResponse = z.infer<typeof platformLoginResponseSchema>;

export const platformVerifyOtpRequestSchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Mã xác thực gồm 6 chữ số'),
});
export type PlatformVerifyOtpRequest = z.infer<typeof platformVerifyOtpRequestSchema>;

export const platformOperatorSchema = z.object({ id: z.string().uuid(), username: z.string(), fullName: z.string() });
export type PlatformOperator = z.infer<typeof platformOperatorSchema>;

export const platformSessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  operator: platformOperatorSchema,
});
export type PlatformSessionResponse = z.infer<typeof platformSessionResponseSchema>;

// ---- Công ty khách hàng ----
export const platformTenantStatusSchema = z.enum(['active', 'suspended']);
export type PlatformTenantStatus = z.infer<typeof platformTenantStatusSchema>;

export const platformTenantSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** `null` = công ty cũ chưa có mã (chỉ xảy ra với công ty tạo trước khi có chế độ SaaS). */
  code: z.string().nullable(),
  loginUrl: z.string().nullable(),
  status: platformTenantStatusSchema,
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  createdAt: z.string(),
  /** Số liệu đếm vận hành — không phải dữ liệu bệnh nhân. */
  activeUserCount: z.number().int(),
  branchCount: z.number().int(),
  lastLoginAt: z.string().nullable(),
});
export type PlatformTenantSummary = z.infer<typeof platformTenantSummarySchema>;

export const listPlatformTenantsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'active', 'suspended']).default('all'),
});
export type ListPlatformTenantsQuery = z.infer<typeof listPlatformTenantsQuerySchema>;

export const listPlatformTenantsResponseSchema = z.object({
  items: z.array(platformTenantSummarySchema),
  stats: z.object({ total: z.number().int(), active: z.number().int(), suspended: z.number().int(), createdLast30Days: z.number().int() }),
});
export type ListPlatformTenantsResponse = z.infer<typeof listPlatformTenantsResponseSchema>;

export const platformTenantDetailSchema = platformTenantSummarySchema.extend({
  /** Phiên bản dòng (khoá lạc quan) — gửi kèm khi sửa/khoá/mở khoá. */
  version: z.number().int(),
  operatorNote: z.string().nullable(),
  suspendedAt: z.string().nullable(),
  suspendedReason: z.string().nullable(),
  suspendedByName: z.string().nullable(),
});
export type PlatformTenantDetail = z.infer<typeof platformTenantDetailSchema>;

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createPlatformTenantRequestSchema = z.object({
  name: z.string().trim().min(2).max(150),
  /** Mã công ty = tên miền phụ; đặt MỘT lần, không đổi. Chi tiết kiểm tra ở máy chủ (`checkTenantCode`). */
  code: z.string().trim().min(1).max(60),
  contactName: z.string().trim().min(1).max(100),
  contactPhone: z.string().trim().min(1).max(30),
  contactEmail: optionalText(150),
  adminFullName: z.string().trim().min(1).max(100),
  adminUsername: z.string().trim().min(3).max(50),
  operatorNote: optionalText(1000),
});
export type CreatePlatformTenantRequest = z.infer<typeof createPlatformTenantRequestSchema>;

/** Mật khẩu tạm CHỈ có trong phản hồi này (không lưu dạng đọc được); người dùng bị buộc đổi ở lần đăng nhập đầu. */
export const createPlatformTenantResponseSchema = z.object({
  tenant: platformTenantDetailSchema,
  adminUsername: z.string(),
  temporaryPassword: z.string(),
});
export type CreatePlatformTenantResponse = z.infer<typeof createPlatformTenantResponseSchema>;

export const updatePlatformTenantRequestSchema = z.object({
  version: z.number().int().min(1),
  contactName: z.string().trim().min(1).max(100),
  contactPhone: z.string().trim().min(1).max(30),
  contactEmail: optionalText(150),
  operatorNote: optionalText(1000),
});
export type UpdatePlatformTenantRequest = z.infer<typeof updatePlatformTenantRequestSchema>;

export const suspendPlatformTenantRequestSchema = z.object({ version: z.number().int().min(1), reason: z.string().trim().min(3, 'Bắt buộc nhập lý do').max(500) });
export type SuspendPlatformTenantRequest = z.infer<typeof suspendPlatformTenantRequestSchema>;

export const unsuspendPlatformTenantRequestSchema = z.object({ version: z.number().int().min(1) });
export type UnsuspendPlatformTenantRequest = z.infer<typeof unsuspendPlatformTenantRequestSchema>;

export const resetTenantAdminPasswordResponseSchema = z.object({
  adminUsername: z.string(),
  adminFullName: z.string(),
  temporaryPassword: z.string(),
});
export type ResetTenantAdminPasswordResponse = z.infer<typeof resetTenantAdminPasswordResponseSchema>;

// ---- Nhật ký vận hành ----
export const PLATFORM_AUDIT_ACTION_LABELS = {
  'platform.login': 'Đăng nhập khu quản trị',
  'platform.login_failed': 'Đăng nhập khu quản trị thất bại',
  'platform.tenant_created': 'Tạo công ty và tài khoản quản trị đầu tiên',
  'platform.tenant_updated': 'Sửa thông tin liên hệ',
  'platform.tenant_suspended': 'Khoá công ty',
  'platform.tenant_unsuspended': 'Mở khoá công ty',
  'platform.tenant_admin_password_reset': 'Đặt lại mật khẩu quản trị',
} as const;
export type PlatformAuditAction = keyof typeof PLATFORM_AUDIT_ACTION_LABELS;

export const platformAuditEntrySchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string(),
  operatorName: z.string().nullable(),
  action: z.string(),
  actionLabel: z.string(),
  targetTenantId: z.string().uuid().nullable(),
  targetTenantName: z.string().nullable(),
  /** Lý do/ghi chú đi kèm thao tác (ví dụ lý do khoá) — không chứa mật khẩu hay dữ liệu bệnh nhân. */
  note: z.string().nullable(),
});
export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;

export const listPlatformAuditQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListPlatformAuditQuery = z.infer<typeof listPlatformAuditQuerySchema>;

export const listPlatformAuditResponseSchema = z.object({
  items: z.array(platformAuditEntrySchema),
  nextCursor: z.string().uuid().nullable(),
});
export type ListPlatformAuditResponse = z.infer<typeof listPlatformAuditResponseSchema>;
