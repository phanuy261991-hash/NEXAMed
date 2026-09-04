import { z } from 'zod';
import { dataScopeSchema } from './data-scope';

/**
 * Request/response đăng nhập — dùng chung controller (validate) và web (S1-09).
 * tenantId bắt buộc trong request: username chỉ unique theo tenant (không unique toàn hệ
 * thống), và RLS cần biết tenant_id trước khi tra user_account — xem docs/DECISIONS.md #020.
 */
export const loginRequestSchema = z.object({
  tenantId: z.string().uuid(),
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * Danh tính + vai trò của user đang đăng nhập — dùng chung cho `loginResponseSchema.user` và
 * `GET /auth/me` (S1-08, docs/DECISIONS.md #022) để web quyết định ẩn/hiện menu theo vai trò mà
 * không cần đoán/hardcode. `roles` có thể rỗng (user chưa được gán vai trò nào).
 *
 * `roles` là TÊN vai trò dạng chuỗi tự do (không còn giới hạn `userRoleSchema` 5 giá trị) — kể từ
 * ADM-07 (`role.ts`), `clinic_admin` tạo được vai trò tuỳ biến ngoài 5 vai trò hệ thống, tên vai
 * trò đó có thể xuất hiện ở đây.
 *
 * `permissions` (2026-09-04) là NGUỒN SỰ THẬT để web quyết định ẩn/hiện menu, nút, chế độ sửa —
 * KHÔNG dùng `roles` cho việc đó nữa. Trước đây web so khớp TÊN vai trò cứng (`BILLING_ROLES
 * .includes(role)`...), nên `clinic_admin` thu hồi quyền qua "Vai trò & Phân quyền" thì backend
 * chặn đúng nhưng giao diện vẫn mời người dùng bấm vào (bug thật chủ dự án phát hiện 2026-09-04:
 * lễ tân bị gỡ hết quyền thu ngân vẫn thấy menu "Thu ngân"), và vai trò tuỳ biến không bao giờ có
 * đúng menu tương ứng (giới hạn đã biết từ ADM-07 #057, nay gỡ bỏ hẳn). `roles` vẫn giữ cho
 * trường hợp thật sự cần biết DANH TÍNH vai trò (ví dụ "tôi có phải bác sĩ không"), không phải
 * cho phân quyền.
 */
export const currentUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  fullName: z.string(),
  /** Tên hiển thị (ADM-01 mở rộng #082) — null cho tài khoản cũ chưa từng cập nhật. */
  displayName: z.string().nullable(),
  roles: z.array(z.string()),
  /**
   * Quyền THẬT của actor, gộp qua mọi vai trò đang giữ: khoá `"<module>.<action>"` → `data_scope`
   * rộng nhất. Chỉ chứa quyền thật sự được cấp — quyền `none`/bị thu hồi KHÔNG có mặt (khớp đúng
   * cách `PermissionGuard` quyết định ở backend, xem `findAllPermissionsForUser`).
   */
  permissions: z.record(z.string(), dataScopeSchema),
  /**
   * Bắt buộc đổi mật khẩu ở lần đăng nhập kế tiếp (mở rộng ADM-01) — web đọc cờ này để chặn điều
   * hướng tới mọi trang khác ngoài `/change-password` cho tới khi đổi xong, xem
   * `changePasswordRequestSchema` dưới.
   */
  mustChangePassword: z.boolean(),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: currentUserSchema,
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Response của `GET /auth/me` — cùng hình dạng `currentUserSchema` (xem trên). */
export const meResponseSchema = currentUserSchema;

export type MeResponse = z.infer<typeof meResponseSchema>;

/** Response của `POST /auth/refresh` — không kèm `user`, xem docs/DECISIONS.md #022. */
export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

/** Response của `POST /auth/logout`. */
export const logoutResponseSchema = z.object({
  success: z.boolean(),
});

export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

/**
 * Tự đổi mật khẩu (mở rộng ADM-01) — dùng cho cả luồng bắt buộc lần đầu (`mustChangePassword`)
 * lẫn đổi mật khẩu tự nguyện thông thường sau này. `currentPassword` bắt buộc xác thực lại
 * (cùng cách break-glass #014 làm — không tin phiên đã đăng nhập là đủ cho thao tác nhạy cảm).
 */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const changePasswordResponseSchema = z.object({
  success: z.boolean(),
});
export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;

/**
 * Payload JWT dùng chung cho việc verify ở cả access và refresh token — `typ` phân biệt hai
 * loại vì hệ thống dùng chung một JWT_SECRET (xem docs/DECISIONS.md #019). Refresh token không
 * cần mang sessionId: `user_session` được tra theo hash của chính token (SHA-256), không phải
 * theo claim — tránh vấn đề "cần biết id trước khi id được DB sinh ra" lúc issue token.
 * `jti` (random, chỉ có ở refresh token) đảm bảo mỗi refresh token là một chuỗi duy nhất kể cả
 * khi issue hai token cùng user trong cùng một giây (JWT `iat` chỉ có độ chính xác giây) — nếu
 * không có `jti`, hai token trùng hệt nhau sẽ đụng UNIQUE trên `user_session.refresh_token_hash`.
 */
export const jwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  tenantId: z.string().uuid(),
  typ: z.enum(['access', 'refresh']),
  jti: z.string().uuid().optional(),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
