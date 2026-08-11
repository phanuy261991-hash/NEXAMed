import { z } from 'zod';
import { userRoleSchema } from './roles';

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
 */
export const currentUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  fullName: z.string(),
  roles: z.array(userRoleSchema),
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
