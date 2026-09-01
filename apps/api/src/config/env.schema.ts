import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL là bắt buộc'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET phải có ít nhất 16 ký tự'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY phải có ít nhất 32 ký tự'),
  // CORS cho web dev (Vite mặc định 5173) — refresh token là cookie nên cần credentials:true +
  // origin tường minh (không dùng '*'). Xem apps/api/src/main.ts.
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Thư mục gốc lưu file của StoragePort (adapter local-disk, S1-06) — đặt ngoài web root theo
  // .claude/docs/security-audit.md. Đường dẫn tương đối tính từ thư mục chạy tiến trình API.
  STORAGE_DIR: z.string().min(1).default('./storage'),
  // Cờ `Secure` của cookie refresh token (S1-04) — KHÔNG suy ra từ NODE_ENV (phát hiện thật lúc
  // verify S4-05: on-prem PC/NAS mặc định chạy HTTP thuần, trình duyệt âm thầm bỏ qua cookie
  // Secure trên origin http:// khiến refresh hỏng không báo lỗi). Mặc định giữ hành vi cũ
  // (NODE_ENV==='production' → secure) khi không đặt biến này; đặt "false" tường minh cho bản
  // on-prem HTTP-only, "true" bắt buộc khi có TLS (VPS/cloud — xem docs/Deploy.md Phần 0.2).
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Cấu hình biến môi trường không hợp lệ:\n${details}`);
  }
  return result.data;
}