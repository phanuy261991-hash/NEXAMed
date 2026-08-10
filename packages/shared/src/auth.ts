import { z } from 'zod';

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

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    fullName: z.string(),
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

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
